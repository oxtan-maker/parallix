


import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildTestRunPlan } from './lib/test-run-plan.js';
import { INTEGRATION_CI_TESTS, INTEGRATION_LOCAL_TESTS } from './lib/test-categories.js';

function selectedFiles(args, version = process.version) {
  // TASK-2328: the runner's suite selection and argv assembly live in
  // test/lib/test-run-plan.ts, so this guard calls the same ESM module the
  // runner calls instead of transpiling the runner into a CommonJS vm sandbox.
  const plan = buildTestRunPlan({
    executionRoot: path.join(import.meta.dirname, '..'),
    requestedArgs: args,
    probeNodeVersion: () => version,
  });
  return {
    files: Array.from(plan.nodeArgs.slice(plan.nodeArgs.indexOf('--test') + 1), file => path.basename(file)).sort(),
    args: plan.nodeArgs,
  };
}

test('default test runner routes registered integration tests out of the default suite', () => {
  const runner = fs.readFileSync(path.join(import.meta.dirname, 'run-default-tests.ts'), 'utf8')
    + fs.readFileSync(path.join(import.meta.dirname, 'lib', 'test-run-plan.ts'), 'utf8')
    + fs.readFileSync(path.join(import.meta.dirname, 'lib', 'test-tier-selection.ts'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'package.json'), 'utf8'));

  const defaultRun = selectedFiles([]);
  const integrationRun = selectedFiles(['--integration']);
  const defaultFiles = defaultRun.files;
  const integrationFiles = integrationRun.files;

  const registeredIntegrationFiles = [...INTEGRATION_CI_TESTS, ...INTEGRATION_LOCAL_TESTS].sort();
  assert.deepEqual(integrationFiles, registeredIntegrationFiles);
  for (const file of registeredIntegrationFiles) {
    assert.ok(!defaultFiles.includes(file), `${file} must be excluded from npm test`);
  }
  assert.ok(defaultFiles.includes('file-size-cap.test.ts'),
    'the file-size-cap guardrail must stay in the default unit suite');
  assert.ok(!integrationFiles.includes('e2e-mission-lifecycle.test.ts'));
  assert.ok(!integrationFiles.includes('e2e-real-agent-smoke.test.ts'));
  assert.match(runner, /runsIntegrationSuite/);
  assert.doesNotMatch(runner, /npm', \['run', 'build'/,
    'the runner selects tests and never owns canonical bundle orchestration');
  assert.equal(pkg.scripts.pretest, undefined,
    'building belongs to the runner so direct and npm-invoked suites have the same protection');
  // --test-force-exit makes file workers exit before their result stream is
  // flushed, silently dropping trailing tests while the file reports success.
  // The runner's process-group watchdog covers the hang case instead.
  assert.ok(!defaultRun.args.includes('--test-force-exit'));
  assert.ok(!integrationRun.args.includes('--test-force-exit'));
  // Integration files spawn real children; cap their parallelism so host
  // contention cannot starve child startup past test-internal deadlines.
  assert.ok(integrationRun.args.some(a => a.startsWith('--test-concurrency=')));
  assert.ok(defaultRun.args.some(a => a === '--test-concurrency=4'),
    'unit concurrency is bounded so measured durations are not host-oversubscription artifacts');
  assert.equal(pkg.scripts['test:integration:prebuilt'], 'PARALLIX_PREBUILT_PACK=1 FORCE_COLOR=0 tsx test/run-default-tests.ts --integration');
  assert.match(runner, /file\.endsWith\('\.integration\.test\.ts'\)/,
    'integration suffix must provide an explicit category independent of dependency heuristics');
});

test('default test runner selects a Node version that supports node:test', () => {
  const runner = fs.readFileSync(path.join(import.meta.dirname, 'lib', 'test-run-plan.ts'), 'utf8');
  assert.match(runner, /MINIMUM_TEST_NODE_MAJOR = 20/);
  assert.match(runner, /MINIMUM_TEST_NODE_MINOR = 6/);
  assert.match(runner, /PARALLIX_TEST_NODE/);
  assert.match(runner, /compatibleTestNode\(\)/);
  assert.throws(
    () => selectedFiles([], 'v20.5.0'),
    /Node 20\.6\+ is required for TypeScript tests/
  );
});

test('default test runner preserves an explicitly selected execution root for every child process', () => {
  const runner = fs.readFileSync(path.join(import.meta.dirname, 'run-default-tests.ts'), 'utf8');
  assert.match(runner, /PARALLIX_EXECUTION_ROOT/);
  assert.match(runner, /cwd: executionRoot/);
  assert.match(runner, /env: \{[\s\S]*?\.\.\.process\.env[\s\S]*?PARALLIX_EXECUTION_ROOT: executionRoot[\s\S]*?PARALLIX_TEST_MANIFEST_DIR/);
});

test('default test runner classifies the TUI boundary contract as integration and preserves its bootstrap isolation', () => {
  const defaultRun = selectedFiles([]);
  const integrationRun = selectedFiles(['--integration']);
  const defaultFiles = defaultRun.files;
  const integrationFiles = integrationRun.files;

  assert.ok(!defaultFiles.includes('presentation-tui.integration.test.ts'),
    'the TUI process/PTY contract must NOT be in the default (unit) suite');
  assert.ok(integrationFiles.includes('presentation-tui.integration.test.ts'),
    'the TUI process/PTY contract must be in the integration suite');

  const soloRun = selectedFiles(['test/presentation-tui.integration.test.ts']);
  assert.ok(!soloRun.args.some(a => typeof a === 'string' && a.includes('bootstrap-parallix-home')),
    'a solo TUI process/PTY contract run must bypass the full bootstrap preload');

  const batchedRun = selectedFiles(['test/presentation-tui.integration.test.ts', 'test/foo.test.ts']);
  assert.ok(batchedRun.args.some(a => typeof a === 'string' && a.includes('bootstrap-parallix-home')),
    'a batched TUI process/PTY contract run must retain the bootstrap preload for co-requested files');
});
