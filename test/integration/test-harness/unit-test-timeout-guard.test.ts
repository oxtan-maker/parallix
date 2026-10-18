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
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { spawn, type SpawnOptions } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkdtemp } from '../../helpers/temp-dir.js';
import { UNIT_TEST_BUDGET_MS, UNIT_TEST_HEADROOM_MS, onGitHubActions } from '../../lib/unit-test-budget-reporter.mjs';
import { buildTestRunPlan } from '../../lib/test-run-plan.js';
import { childCpuUsageModule } from '../../lib/child-cpu-usage.js';
import { cpuSupervisor, readCpuReport } from '../../lib/cpu-supervisor.js';

interface ProbeResult {
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: Error;
}

function runProcess(command: string, args: string[], options: SpawnOptions & { encoding?: string } = {}): Promise<ProbeResult> {
  return new Promise(resolve => {
    const env = options.env ?? process.env;
    // Concurrent tiny probes need no host-sized V8 worker pools. Inherit this
    // bound through wrappers, supervisors and test workers as well; the real
    // hooks, CPU charges and process isolation remain unchanged (TASK-2762).
    const child = spawn(command, args, {
      timeout: 20_000, ...options,
      // Nested fixtures measure enforcement, not source coverage. The outer
      // worker remains instrumented and charges every waited descendant.
      env: { ...env, PARALLIX_TEST_COVERAGE: '', NODE_OPTIONS: `${env.NODE_OPTIONS ?? ''} --v8-pool-size=1`.trim() },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout!.on('data', data => { stdout += data; });
    child.stderr!.on('data', data => { stderr += data; });
    child.on('error', error => resolve({ status: null, signal: null, stdout, stderr, error }));
    child.on('close', (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
}

// Each probe owns its processes, temporary state and CPU charge. Running the
// work in a parent and reporting empty subtests aggregates unrelated contracts
// into one budget and hides their actual cost (TASK-2762).
function probe(name: string, run: () => void | Promise<void>) {
  test(name, run);
}

const ROOT = process.cwd();
const RUNNER_PATH = path.join(ROOT, 'test', 'run-default-tests.ts');
let runnerDirectory: string;
let runnerBundle: string;
let bootstrapBundle: string;
before(async () => {
  runnerDirectory = mkdtemp('cpu-runner-bundle-');
  runnerBundle = path.join(runnerDirectory, 'runner.mjs');
  await build({ entryPoints: [RUNNER_PATH], outfile: runnerBundle, bundle: true,
    minify: true, platform: 'node', format: 'esm', packages: 'external' });
  bootstrapBundle = path.join(runnerDirectory, 'bootstrap.mjs');
  await build({ entryPoints: [path.join(ROOT, 'test/bootstrap-parallix-home.ts')], outfile: bootstrapBundle,
    bundle: true, minify: true, platform: 'node', format: 'esm', packages: 'external' });
});
after(() => { if (runnerDirectory) fs.rmSync(runnerDirectory, { recursive: true, force: true }); });

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

probe('unit-test timeout guard: runner enforces the reporter budget for the default suite', async () => {
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

probe('unit-test timeout guard: default plan keeps the reporter while headroom mode is opt-in', async () => {
  const { defaultPlan, headroomPlan } = withLocalGitHubActions(() => {
    const options = { executionRoot: ROOT, probeNodeVersion: () => 'v24.15.0' } satisfies Partial<NonNullable<Parameters<typeof buildTestRunPlan>[0]>>;
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

probe('unit-test timeout guard: suite-level budget is configurable and documented', async () => {
  const runnerContent = fs.readFileSync(RUNNER_PATH, 'utf8');
  const planContent = fs.readFileSync(path.join(ROOT, 'test', 'lib', 'test-run-plan.ts'), 'utf8');

  assert.ok(
    runnerContent.includes('suiteCpuBudget'),
    'run-default-tests.ts must resolve the executable suite CPU policy',
  );

  assert.ok(
    planContent.includes('PARALLIX_UNIT_TEST_CPU_BUDGET_MS'),
    'test-run-plan.ts must support PARALLIX_UNIT_TEST_CPU_BUDGET_MS override',
  );
});

// Runner cost proofs need the real runner, hooks and supervisor, but no
// unrelated repository catalog. A minimal checkout keeps catalog linting out
// of the timed child while preserving the normal memory and CPU boundaries.
function runnerProofRoot(directory: string): string {
  const root = path.join(directory, 'checkout');
  const lib = path.join(root, 'test', 'lib');
  fs.mkdirSync(lib, { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(root, 'node_modules'));
  for (const file of fs.readdirSync(path.join(ROOT, 'test', 'lib'), { withFileTypes: true })) {
    if (file.isFile() && file.name !== 'test-categories.ts') {
      fs.symlinkSync(path.join(ROOT, 'test', 'lib', file.name), path.join(lib, file.name));
    }
  }
  fs.symlinkSync(bootstrapBundle, path.join(root, 'test', 'bootstrap-parallix-home.ts'));
  fs.mkdirSync(path.join(root, 'tmp'));
  fs.symlinkSync(path.join(ROOT, 'tmp', 'cpu-supervisor'), path.join(root, 'tmp', 'cpu-supervisor'));
  return root;
}

async function runCpuFixture(source: string, extraEnv: Record<string, string> = {}) {
  const directory = mkdtemp('cpu-guard-probe-');
  const throughRunner = Boolean(extraEnv.PARALLIX_SUITE_HANG_TIMEOUT_MS || source.includes("test('wait'"));
  const file = path.join(directory, throughRunner ? 'probe.test.js' : 'probe.test.mjs');
  fs.writeFileSync(file, `import test from 'node:test';\n${source}\n`);
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_NO_WARNINGS: '1', ...extraEnv,
    ...(throughRunner ? { PARALLIX_EXECUTION_ROOT: runnerProofRoot(directory) } : {}),
  };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_V8_COVERAGE;
  try {
    return await runProcess(process.execPath, throughRunner
      ? [runnerBundle, file]
      : ['--import', path.join(ROOT, 'test/lib/cpu-test-hook.mjs'), '--test', file], {
      encoding: 'utf8', timeout: 20_000, env,
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function burnCpuSource(targetUs: number): string {
  return `const cpuStart=process.cpuUsage();for(;;){const used=process.cpuUsage(cpuStart);if(used.user+used.system>=${targetUs})break;}`;
}

probe('worker CPU guard lets a completed low-CPU wait exceed the old wall cap', async () => {
  const result = await runCpuFixture("test('wait', async () => { await new Promise(resolve => setTimeout(resolve, 1200)); });");
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /\[unit-test-cpu\].*elapsed=/);
});

probe('worker CPU guard rejects a burner even when its assertion passes', async () => {
  const result = await runCpuFixture(`test('burn', async () => { ${burnCpuSource(150_000)} });`, {
    PARALLIX_UNIT_TEST_CPU_BUDGET_US: '100000',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /\[unit-test-cpu:exceeded\] burn/);
});

probe('nested tests receive exclusive CPU charges', async () => {
  const burn = burnCpuSource(35_000);
  const source = `test('outer', async t => { ${burn} await t.test('inner', async () => { ${burn} }); });`;
  const result = await runCpuFixture(source, { PARALLIX_UNIT_TEST_CPU_BUDGET_US: '70000' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

probe('overlapping sibling tests fail closed instead of sharing a CPU sample', async () => {
  const source = "test('parent', { concurrency: 2 }, async t => { await Promise.all([t.test('a', async () => { await new Promise(r => setTimeout(r, 100)); }), t.test('b', async () => { await new Promise(r => setTimeout(r, 100)); })]); });";
  const result = await runCpuFixture(source);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /overlapping unit tests cannot share one process CPU counter/);
});

probe('suite watchdog still terminates a low-CPU hang', async () => {
  const result = await runCpuFixture("test('hang', async () => { await new Promise(() => {}); });", {
    PARALLIX_SUITE_HANG_TIMEOUT_MS: '1200',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\[suite-watchdog\]/);
});

probe('suite CPU meter includes a waited grandchild once', async () => {
  const directory = mkdtemp('cpu-tree-probe-');
  const report = path.join(directory, 'cpu.json');
  const burner = `${burnCpuSource(250_000)}const used=process.cpuUsage(cpuStart);process.stdout.write(String(used.user+used.system));`;
  const script = `const {spawnSync}=require("node:child_process");const child=spawnSync(process.execPath,["-e",${JSON.stringify(burner)}],{encoding:"utf8"});if(child.status!==0)process.exit(child.status||1);process.stdout.write(child.stdout);`;
  try {
    const result = await runProcess(cpuSupervisor(ROOT), ['--cpu-report', report, process.execPath, '-e', script], { encoding: 'utf8' });
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

probe('unit-test timeout guard: --test-timeout terminates a test exceeding the bound', async () => {
  // Use a plain Node.js script (not node --test) to avoid the recursive
  // test runner detection. We verify --test-timeout by checking that a
  // script sleeping past the bound produces the expected timeout output.
  const tmpDir = mkdtemp('timeout-guard-proof-');
  const timeoutMs = 200;

  // Write a test file that deliberately exceeds the timeout
  const testFile = path.join(tmpDir, 'slow-test.test.js');
  fs.writeFileSync(
    testFile,
    `'use strict';\n` +
    `const test = require('node:test');\n` +
    `test('slow', async t => { await new Promise(r => { const timer = setTimeout(r, 5000); t.signal.addEventListener('abort', () => clearTimeout(timer), { once: true }); }); });\n`,
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
    const result = await runProcess(
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

probe('unit-test timeout guard: fast test passes within the bound', async () => {
  const tmpDir = mkdtemp('timeout-guard-fast-');
  const timeoutMs = 5000;

  const testFile = path.join(tmpDir, 'fast-test.test.js');
  fs.writeFileSync(
    testFile,
    `'use strict';\n` +
    `const test = require('node:test');\n` +
    `const assert = require('node:assert/strict');\n` +
    `test('fast', async () => { assert.ok(true); });\n`,
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
    const result = await runProcess(
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

probe('unit-test CPU guard: suite budget enforcement fails when exceeded', async () => {
  const tmpDir = mkdtemp('budget-guard-proof-');
  // This is a suite-budget proof, not a throughput benchmark.  A narrow
  // ceiling makes the runner's normal startup cost sufficient evidence and
  // avoids burning 1.55 CPU seconds just to cross an arbitrary large limit.
  const budgetMs = 20;

  // A passing fixture lets the suite meter reject startup cost independently
  // of worker assertion failures.
  const testFile = path.join(tmpDir, 'slow-suite.test.js');
  fs.writeFileSync(
    testFile,
    `import test from 'node:test';\n` +
    `test('passing assertion', async () => { if (1 + 1 !== 2) throw new Error('unexpected arithmetic'); });\n`,
  );

  // Spawn the runner with the tight budget and this single test file.
  // The worker and suite CPU budgets both reject it.
  const runnerEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_NO_WARNINGS: '1',
    PARALLIX_UNIT_TEST_CPU_BUDGET_MS: String(budgetMs),
    PARALLIX_EXECUTION_ROOT: runnerProofRoot(tmpDir),
  };
  delete runnerEnv.NODE_TEST_CONTEXT;
  delete runnerEnv.NODE_V8_COVERAGE;

  try {
    const result = await runProcess(
      process.execPath,
      [runnerBundle, testFile],
      { encoding: 'utf8', timeout: 60_000, env: runnerEnv },
    );

    assert.match(result.stdout, /(?:ℹ|#) fail 0/, 'the fixture passes before the aggregate CPU meter rejects its startup');
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
  } finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
});

// Integration CPU limits include waited command trees, unlike process.cpuUsage().
async function runIntegrationCpuFixture(source: string, extraEnv: Record<string, string> = {}) {
  const directory = mkdtemp('integration-cpu-proof-');
  // These probes contain only JavaScript. Loading tsx adds background loader
  // CPU during the timed wait and can make an idle probe exceed its budget
  // (TASK-2677); exercise the real CPU hook without that unrelated work.
  const file = path.join(directory, 'probe.test.mjs');
  fs.writeFileSync(file, `import test from 'node:test';\nimport { spawnSync } from 'node:child_process';\n${source}\n`);
  const env: NodeJS.ProcessEnv = {
    ...process.env, NODE_NO_WARNINGS: '1',
    PARALLIX_CHILD_CPU_USAGE_MODULE: childCpuUsageModule(ROOT, process.execPath),
    PARALLIX_EXECUTION_ROOT: ROOT, ...extraEnv,
  };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_V8_COVERAGE;
  delete env.PARALLIX_TEST_CPU_PROFILE_DIR;
  try {
    return await runProcess(process.execPath, [
      '--import', path.join(ROOT, 'test/lib/integration-cpu-hook.mjs'), '--test', file,
    ], { encoding: 'utf8', timeout: 20_000, env });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

probe('integration hook CPU guard rejects CPU burned by a waited grandchild (TASK-2622.20)', async () => {
  const burner = burnCpuSource(200_000);
  const child = `require('node:child_process').spawnSync(process.execPath, ['-e', ${JSON.stringify(burner)}]);`;
  const result = await runIntegrationCpuFixture(`test('hook command tree', () => {
    const result = spawnSync(process.execPath, ['-e', ${JSON.stringify(child)}]);
    if (result.status !== 0) throw new Error('child failed');
  });`, { PARALLIX_INTEGRATION_TEST_CPU_BUDGET_MS: '100' });
  assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /\[integration-test-cpu:exceeded\] hook command tree/);
});

probe('integration hook CPU guard accepts low-CPU waits beyond the CPU limit (TASK-2622.20)', async () => {
  const result = await runIntegrationCpuFixture("test('slow wait', async () => { await new Promise(r => setTimeout(r, 350)); });", {
    PARALLIX_INTEGRATION_TEST_CPU_BUDGET_MS: '100',
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

probe('integration hook CPU guard counts teardown CPU (TASK-2622.20)', async () => {
  const teardown = await runIntegrationCpuFixture(`test('teardown burner', t => { t.after(() => { ${burnCpuSource(150_000)} }); });`, {
    PARALLIX_INTEGRATION_TEST_CPU_BUDGET_MS: '100',
  });
  assert.notEqual(teardown.status, 0);
  assert.match(teardown.stdout, /\[integration-test-cpu:exceeded\] teardown burner/);
});

probe('integration hook CPU guard charges nested cases without double counting (TASK-2622.20)', async () => {
  const burn = burnCpuSource(40_000);
  const nested = await runIntegrationCpuFixture(`test('outer', async t => { ${burn} await t.test('inner', async () => { ${burn} }); });`, {
    PARALLIX_INTEGRATION_TEST_CPU_BUDGET_MS: '75',
  });
  assert.equal(nested.status, 0, `${nested.stdout}\n${nested.stderr}`);
});

probe('integration suite CPU budget rejects a passing hook suite (TASK-2622.20)', async () => {
  // Exercise the real runner, supervisor and hook with a private passing
  // fixture. Unrelated sandbox assertions remain in their owning suite.
  const directory = mkdtemp('integration-suite-meter-');
  try {
    const root = runnerProofRoot(directory);
    const relative = 'test/integration/test-harness/unit-test-timeout-guard.test.ts';
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "import test from 'node:test'; test('passing hook fixture', () => {});\n");
    const env: NodeJS.ProcessEnv = { ...process.env, PARALLIX_EXECUTION_ROOT: root,
      PARALLIX_INTEGRATION_SUITE_CPU_BUDGET_MS: '1', NODE_NO_WARNINGS: '1' };
    delete env.NODE_TEST_CONTEXT;
    delete env.NODE_V8_COVERAGE;
    delete env.PARALLIX_TEST_CPU_PROFILE_DIR;
    const result = await runProcess(process.execPath, [runnerBundle, relative], {
      encoding: 'utf8', timeout: 20_000, env,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /(?:ℹ|#) fail 0/);
    assert.match(result.stderr, /\[integration-test-cpu\] SUITE CPU BUDGET EXCEEDED:/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

probe('CPU accounting fails closed for missing modules and missing or malformed reports (TASK-2622.20)', async () => {
  const result = await runIntegrationCpuFixture("test('passes', async () => {});", { PARALLIX_CHILD_CPU_USAGE_MODULE: '' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /integration CPU accounting module is missing/);
  const directory = mkdtemp('cpu-report-proof-');
  const report = path.join(directory, 'report.json');
  try {
    assert.throws(() => readCpuReport(report), /ENOENT/);
    fs.writeFileSync(report, JSON.stringify({ userUs: -1, systemUs: 0 }));
    assert.throws(() => readCpuReport(report), /invalid CPU supervisor report/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
