/**
 * TASK-2326 — deterministic proof that the unit-test timing guard fires.
 *
 * The default test suite passes `--test-timeout=30000` to node --test.
 * This test proves the guard is active and correctly configured.
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

const ROOT = process.cwd();
const RUNNER_PATH = path.join(ROOT, 'test', 'run-default-tests.ts');

test('unit-test timeout guard: runner enforces --test-timeout for the default suite', () => {
  const runnerContent = fs.readFileSync(RUNNER_PATH, 'utf8');

  // Must define a numeric timeout constant
  assert.ok(
    runnerContent.includes('UNIT_TEST_TIMEOUT_MS'),
    'run-default-tests.ts must define UNIT_TEST_TIMEOUT_MS',
  );

  // Must pass --test-timeout to the node test runner
  assert.ok(
    runnerContent.includes('--test-timeout='),
    'run-default-tests.ts must include --test-timeout argument',
  );

  // Must conditionally apply it (not to integration suite)
  assert.ok(
    runnerContent.includes('runsIntegrationSuite'),
    'run-default-tests.ts must conditionally apply timeout based on suite type',
  );
});

test('unit-test timeout guard: suite-level budget is configurable and documented', () => {
  const runnerContent = fs.readFileSync(RUNNER_PATH, 'utf8');

  assert.ok(
    runnerContent.includes('UNIT_TEST_BUDGET_MS'),
    'run-default-tests.ts must define UNIT_TEST_BUDGET_MS',
  );

  assert.ok(
    runnerContent.includes('PARALLIX_UNIT_TEST_BUDGET_MS'),
    'run-default-tests.ts must support PARALLIX_UNIT_TEST_BUDGET_MS override',
  );
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
    const childEnv = { ...process.env, NODE_NO_WARNINGS: '1' };
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
    const childEnv = { ...process.env, NODE_NO_WARNINGS: '1' };
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

test('unit-test timeout guard: suite budget enforcement fails when exceeded', () => {
  // Proof that the runner's suite-level budget (UNIT_TEST_BUDGET_MS) is
  // actually enforced — not just printed. The runner measures elapsed time
  // with process.hrtime and fails the suite (exit 1) when it exceeds the
  // configured PARALLIX_UNIT_TEST_BUDGET_MS. This test spawns the runner
  // with a 500ms budget and a test file that sleeps 2s to prove the guard fires.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-guard-proof-'));
  const budgetMs = 500;

  // Write a test file that deliberately takes longer than the budget
  const testFile = path.join(tmpDir, 'slow-suite.test.js');
  fs.writeFileSync(
    testFile,
    `'use strict';\n` +
    `const test = require('node:test');\n` +
    `test('slow test', async () => { await new Promise(r => setTimeout(r, 2000)); });\n`,
  );

  // Spawn the runner with the tight budget and this single test file.
  // The runner's --test-timeout=30000 will not trigger (2s < 30s),
  // but the suite budget (500ms) will be exceeded.
  const runnerEnv = {
    ...process.env,
    NODE_NO_WARNINGS: '1',
    PARALLIX_UNIT_TEST_BUDGET_MS: String(budgetMs),
  };
  delete runnerEnv.NODE_TEST_CONTEXT;
  delete runnerEnv.NODE_V8_COVERAGE;

  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', RUNNER_PATH, testFile],
    { encoding: 'utf8', timeout: 60_000, env: runnerEnv },
  );

  // The runner should fail because elapsed time (2s) exceeds budget (500ms)
  assert.notEqual(
    result.status,
    0,
    `Expected non-zero exit when suite exceeds budget ${budgetMs}ms (got status=${result.status})`,
  );

  // Output should mention the budget exceeded message
  const combinedOutput = (result.stdout || '') + (result.stderr || '');
  assert.ok(
    combinedOutput.includes('SUITE BUDGET EXCEEDED') || combinedOutput.includes('unit-test-budget'),
    `Expected budget output in: ${combinedOutput.slice(-500)}`,
  );
});
