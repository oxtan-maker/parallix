/**
 * TASK-2326 — deterministic proof that the unit-test timing guard fires.
 *
 * The default test suite's worker hook enforces the 1,000 ms CPU cap.
 * Node's file-worker timeout is intentionally not used: it charges bootstrap
 * startup as test time under host contention.
 *
 * Note: We cannot use `node --test` inside a running test (Node detects
 * recursive test runner calls and skips). Instead, we verify the guard
 * through the runner configuration and a plain Node.js timeout check.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { UNIT_TEST_BUDGET_MS, UNIT_TEST_HEADROOM_MS, onGitHubActions } from './lib/unit-test-budget-reporter.mjs';
import { buildTestRunPlan } from './lib/test-run-plan.js';
import { cpuSupervisor, readCpuReport } from './lib/cpu-supervisor.js';

const ROOT = process.cwd();
const RUNNER_PATH = path.join(ROOT, 'test', 'run-default-tests.ts');

function withLocalGitHubActions<T>(callback: () => T): T {
  const previous = process.env.GITHUB_ACTIONS;
  delete process.env.GITHUB_ACTIONS;
  try {
    return callback();
  } finally {
    if (previous === undefined) delete process.env.GITHUB_ACTIONS;
    else process.env.GITHUB_ACTIONS = previous;
  }
}

test('unit-test timeout guard: runner enforces the reporter budget for the default suite', () => {
  const planContent = fs.readFileSync(path.join(ROOT, 'test', 'lib', 'test-run-plan.ts'), 'utf8');

  // Must define a numeric timeout constant
  assert.ok(
    planContent.includes('UNIT_TEST_BUDGET_MS'),
    'test-run-plan.ts must use the unit-test budget',
  );

  // The worker-side hook measures CPU, not elapsed result durations.
  assert.ok(
    planContent.includes('cpu-test-hook.mjs'),
    'test-run-plan.ts must include the worker CPU hook',
  );
  assert.ok(
    UNIT_TEST_BUDGET_MS === 1_000,
    'the unit-test budget must be 1,000 ms',
  );

  // Must conditionally apply it (not to integration suite)
  assert.ok(
    planContent.includes('runsIntegrationSuite'),
    'test-run-plan.ts must conditionally apply timeout based on suite type',
  );
});

test('unit-test timeout guard: default plan keeps the reporter while headroom mode is opt-in', () => {
  const { defaultPlan, headroomPlan } = withLocalGitHubActions(() => {
    const options = { executionRoot: ROOT, probeNodeVersion: () => 'v24.15.0' };
    return {
      defaultPlan: buildTestRunPlan({ ...options, requestedArgs: [] }),
      headroomPlan: buildTestRunPlan({ ...options, requestedArgs: ['--unit-test-headroom'] }),
    };
  });

  assert.equal(UNIT_TEST_HEADROOM_MS, 500);
  assert.ok(defaultPlan.nodeArgs.some(arg => arg.includes('cpu-test-hook.mjs')));
  assert.equal(defaultPlan.unitTestHeadroomMs, null);
  assert.equal(headroomPlan.unitTestHeadroomMs, UNIT_TEST_HEADROOM_MS);
  assert.ok(headroomPlan.nodeArgs.some(arg => arg.includes('cpu-test-hook.mjs')));
});

test('unit-test timeout guard: suite-level budget is configurable and documented', () => {
  const runnerContent = fs.readFileSync(RUNNER_PATH, 'utf8');
  const planContent = fs.readFileSync(path.join(ROOT, 'test', 'lib', 'test-run-plan.ts'), 'utf8');

  assert.ok(
    runnerContent.includes('UNIT_TEST_CPU_BUDGET_MS'),
    'run-default-tests.ts must define UNIT_TEST_CPU_BUDGET_MS',
  );

  assert.ok(
    planContent.includes('PARALLIX_UNIT_TEST_CPU_BUDGET_MS'),
    'test-run-plan.ts must support PARALLIX_UNIT_TEST_CPU_BUDGET_MS override',
  );
});

function runCpuFixture(source: string, extraEnv: Record<string, string> = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cpu-guard-probe-'));
  const file = path.join(directory, 'probe.test.ts');
  fs.writeFileSync(file, `import test from 'node:test';\n${source}\n`);
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_NO_WARNINGS: '1', ...extraEnv };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_V8_COVERAGE;
  try {
    return spawnSync(process.execPath, ['--import', 'tsx', RUNNER_PATH, file], {
      encoding: 'utf8', timeout: 20_000, env,
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function burnCpuSource(targetUs: number): string {
  return `const cpuStart=process.cpuUsage();for(;;){const used=process.cpuUsage(cpuStart);if(used.user+used.system>=${targetUs})break;}`;
}

test('worker CPU guard lets a completed low-CPU wait exceed the old wall cap', () => {
  const result = runCpuFixture("test('wait', async () => { await new Promise(resolve => setTimeout(resolve, 1200)); });");
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /\[unit-test-cpu\].*elapsed=/);
});

test('worker CPU guard rejects a burner even when its assertion passes', () => {
  const result = runCpuFixture(`test('burn', () => { ${burnCpuSource(150_000)} });`, {
    PARALLIX_UNIT_TEST_CPU_BUDGET_US: '100000',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /\[unit-test-cpu:exceeded\] burn/);
});

test('nested tests receive exclusive CPU charges', () => {
  const burn = burnCpuSource(35_000);
  const source = `test('outer', async t => { ${burn} await t.test('inner', () => { ${burn} }); });`;
  const result = runCpuFixture(source, { PARALLIX_UNIT_TEST_CPU_BUDGET_US: '70000' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test('overlapping sibling tests fail closed instead of sharing a CPU sample', () => {
  const source = "test('parent', { concurrency: 2 }, async t => { await Promise.all([t.test('a', async () => { await new Promise(r => setTimeout(r, 100)); }), t.test('b', async () => { await new Promise(r => setTimeout(r, 100)); })]); });";
  const result = runCpuFixture(source);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /overlapping unit tests cannot share one process CPU counter/);
});

test('suite watchdog still terminates a low-CPU hang', () => {
  const result = runCpuFixture("test('hang', async () => { await new Promise(() => {}); });", {
    PARALLIX_SUITE_HANG_TIMEOUT_MS: '1200',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\[suite-watchdog\]/);
});

test('suite CPU meter includes a waited grandchild once', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cpu-tree-probe-'));
  const report = path.join(directory, 'cpu.json');
  const burner = `${burnCpuSource(250_000)}const used=process.cpuUsage(cpuStart);process.stdout.write(String(used.user+used.system));`;
  const script = `const {spawnSync}=require("node:child_process");const child=spawnSync(process.execPath,["-e",${JSON.stringify(burner)}],{encoding:"utf8"});if(child.status!==0)process.exit(child.status||1);process.stdout.write(child.stdout);`;
  try {
    const result = spawnSync(cpuSupervisor(ROOT), ['--cpu-report', report, process.execPath, '-e', script], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const cpu = readCpuReport(report);
    const burnedMs = Number(result.stdout) / 1_000;
    const totalMs = (cpu.userUs + cpu.systemUs) / 1_000;
    assert.ok(Number.isFinite(burnedMs) && burnedMs >= 250, `grandchild CPU measurement missing: ${result.stdout}`);
    assert.ok(totalMs >= burnedMs, `grandchild CPU omitted: ${totalMs}ms < ${burnedMs}ms`);
    assert.ok(totalMs < burnedMs * 1.75, `grandchild CPU counted more than once: ${totalMs}ms vs ${burnedMs}ms`);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('unit-test timeout guard: --test-timeout terminates a test exceeding the bound', () => {
  // Use a plain Node.js script (not node --test) to avoid the recursive
  // test runner detection. We verify --test-timeout by checking that a
  // script sleeping past the bound produces the expected timeout output.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'timeout-guard-proof-'));
  const timeoutMs = 200;

  // Write a test file that deliberately exceeds the timeout
  const testFile = path.join(tmpDir, 'slow-test.test.js');
  fs.writeFileSync(
    testFile,
    `'use strict';\n` +
    `const test = require('node:test');\n` +
    `test('slow', async () => { await new Promise(r => setTimeout(r, 5000)); });\n`,
  );

  // Write a wrapper script that runs node --test and captures output
  const wrapperFile = path.join(tmpDir, 'wrapper.js');
  fs.writeFileSync(
    wrapperFile,
    `'use strict';\n` +
    `const { spawnSync } = require('child_process');\n` +
    `const result = spawnSync(process.execPath, [\n` +
    `  '--test-timeout=${timeoutMs}',\n` +
    `  '--test',\n` +
    `  ${JSON.stringify(testFile)}\n` +
    `], { encoding: 'utf8', timeout: 15000 });\n` +
    `process.stdout.write(JSON.stringify({\n` +
    `  status: result.status,\n` +
    `  signal: result.signal,\n` +
    `  stdout: result.stdout || '',\n` +
    `  stderr: result.stderr || ''\n` +
    `}));\n`,
  );

  try {
    // Run the wrapper as a plain Node.js script (no --test flag).
    // Clear NODE_TEST_CONTEXT so the inner `node --test` does not detect
    // a recursive test runner call and skip (task-2326 finding).
    const childEnv: NodeJS.ProcessEnv = { ...process.env, NODE_NO_WARNINGS: '1' };
    delete childEnv.NODE_TEST_CONTEXT;
    delete childEnv.NODE_V8_COVERAGE;
    const result = spawnSync(
      process.execPath,
      [wrapperFile],
      { encoding: 'utf8', timeout: 15_000, env: childEnv },
    );

    assert.equal(result.status, 0, 'wrapper script must exit 0');

    const data = JSON.parse(result.stdout);
    assert.notEqual(
      data.status,
      0,
      `Expected non-zero exit when test exceeds --test-timeout=${timeoutMs}ms (got ${data.status})`,
    );

    assert.ok(
      data.stdout.includes('timed out'),
      `Expected 'timed out' in output but got: ${data.stdout.slice(0, 200)}`,
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('unit-test timeout guard: fast test passes within the bound', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'timeout-guard-fast-'));
  const timeoutMs = 5000;

  const testFile = path.join(tmpDir, 'fast-test.test.js');
  fs.writeFileSync(
    testFile,
    `'use strict';\n` +
    `const test = require('node:test');\n` +
    `const assert = require('node:assert/strict');\n` +
    `test('fast', () => { assert.ok(true); });\n`,
  );

  const wrapperFile = path.join(tmpDir, 'wrapper.js');
  fs.writeFileSync(
    wrapperFile,
    `'use strict';\n` +
    `const { spawnSync } = require('child_process');\n` +
    `const result = spawnSync(process.execPath, [\n` +
    `  '--test-timeout=${timeoutMs}',\n` +
    `  '--test',\n` +
    `  ${JSON.stringify(testFile)}\n` +
    `], { encoding: 'utf8', timeout: 15000 });\n` +
    `process.stdout.write(JSON.stringify({ status: result.status }));\n`,
  );

  try {
    // Clear NODE_TEST_CONTEXT for the same recursive-detection reason.
    const childEnv: NodeJS.ProcessEnv = { ...process.env, NODE_NO_WARNINGS: '1' };
    delete childEnv.NODE_TEST_CONTEXT;
    delete childEnv.NODE_V8_COVERAGE;
    const result = spawnSync(
      process.execPath,
      [wrapperFile],
      { encoding: 'utf8', timeout: 15_000, env: childEnv },
    );

    const data = JSON.parse(result.stdout);
    assert.equal(
      data.status,
      0,
      `Expected zero exit for fast test within --test-timeout=${timeoutMs}ms`,
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('unit-test CPU guard: suite budget enforcement fails when exceeded', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-guard-proof-'));
  const budgetMs = 1_500;

  // Write a test file that deliberately uses more CPU than the budget.
  const testFile = path.join(tmpDir, 'slow-suite.test.ts');
  fs.writeFileSync(
    testFile,
    `import test from 'node:test';\n` +
    `test('CPU burner', () => { ${burnCpuSource(1_550_000)} });\n`,
  );

  // Spawn the runner with the tight budget and this single test file.
  // The worker and suite CPU budgets both reject it.
  const runnerEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_NO_WARNINGS: '1',
    PARALLIX_UNIT_TEST_CPU_BUDGET_MS: String(budgetMs),
  };
  delete runnerEnv.NODE_TEST_CONTEXT;
  delete runnerEnv.NODE_V8_COVERAGE;

  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', RUNNER_PATH, testFile],
    { encoding: 'utf8', timeout: 60_000, env: runnerEnv },
  );

  // Output should mention the budget exceeded message
  const combinedOutput = (result.stdout || '') + (result.stderr || '');

  // GitHub-hosted runs retain the existing policy of suspending local cost
  // budgets. The separate timeout probes above cover wall liveness.
  if (onGitHubActions()) {
    assert.equal(result.status, 0);
    assert.ok(
      !combinedOutput.includes('SUITE CPU BUDGET EXCEEDED')
        && !combinedOutput.includes('unit-test-cpu'),
      `GitHub disables the suite budget; no budget message expected in: ${combinedOutput.slice(-500)}`,
    );
  } else {
    // The suite reports CPU cost independently of elapsed time.
    assert.notEqual(
      result.status,
      0,
      `Expected non-zero exit when suite exceeds CPU budget ${budgetMs}ms (got status=${result.status})`,
    );

    // Output should mention the budget exceeded message
    assert.ok(
      combinedOutput.includes('SUITE CPU BUDGET EXCEEDED'),
      `Expected budget output in: ${combinedOutput.slice(-500)}`,
    );
  }
});
