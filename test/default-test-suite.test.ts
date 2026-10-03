import { INTEGRATION_CI_TESTS } from './lib/test-categories.js';
import { INTEGRATION_LOCAL_TESTS } from './lib/test-categories.js';
import { buildTestRunPlan } from './lib/test-run-plan.js';
import { readCpuBudgetPolicy, suiteCpuBudget } from './lib/test-cpu-policy.mjs';
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { UNIT_TEST_BUDGET_MS } from './lib/unit-test-budget-reporter.mjs';
import { UNIT_TEST_HEADROOM_MS } from './lib/unit-test-budget-reporter.mjs';
import { withCoverageReporters } from './lib/test-run-plan.js';

// Regression group from test/default-test-suite.test.ts
{
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

  const batchedRun = selectedFiles(['test/presentation-tui.integration.test.ts', 'test/agent-strip.test.ts']);
  assert.ok(batchedRun.args.some(a => typeof a === 'string' && a.includes('bootstrap-parallix-home')),
    'a batched TUI process/PTY contract run must retain the bootstrap preload for co-requested files');
});
}

// Regression group from test/unit-cpu-hosted-policy.test.ts
{
const BUDGET_REPORTER_PATH = 'unit-test-budget-reporter.mjs';

function withGitHubActions<T>(github: boolean, callback: () => T): T {
  const previous = process.env.GITHUB_ACTIONS;
  if (github) process.env.GITHUB_ACTIONS = 'true'; else delete process.env.GITHUB_ACTIONS;
  try {
    return callback();
  } finally {
    if (previous === undefined) delete process.env.GITHUB_ACTIONS;
    else process.env.GITHUB_ACTIONS = previous;
  }
}

test('TASK-2423: GitHub default plan omits the unit-test budget reporter', () => {
  const plan = withGitHubActions(true, () => buildTestRunPlan({
    executionRoot: process.cwd(),
    requestedArgs: [],
    probeNodeVersion: () => 'v24.15.0',
  }));

  assert.ok(!plan.nodeArgs.some(arg => arg.includes(BUDGET_REPORTER_PATH)));
});

test('TASK-2423: headroom remains an opt-in per-test CPU bound', () => {
  const { defaultPlan, headroomPlan } = withGitHubActions(false, () => {
    const options = { executionRoot: process.cwd(), probeNodeVersion: () => 'v24.15.0' };
    return {
      defaultPlan: buildTestRunPlan({ ...options, requestedArgs: [] }),
      headroomPlan: buildTestRunPlan({ ...options, requestedArgs: ['--unit-test-headroom'] }),
    };
  });

  assert.equal(UNIT_TEST_BUDGET_MS, 1_000);
  assert.equal(defaultPlan.unitTestHeadroomMs, null);
  assert.equal(headroomPlan.unitTestHeadroomMs, UNIT_TEST_HEADROOM_MS);
  assert.ok(defaultPlan.nodeArgs.some(arg => arg.includes('cpu-test-hook.mjs')));
  assert.ok(headroomPlan.nodeArgs.some(arg => arg.includes('cpu-test-hook.mjs')));
  assert.ok(defaultPlan.nodeArgs.some(arg => arg.includes(BUDGET_REPORTER_PATH)));
  assert.ok(headroomPlan.nodeArgs.some(arg => arg.includes(BUDGET_REPORTER_PATH)));
});
}

// Regression group from test/test-timing-tier-policy.test.ts
{
const ROOT = process.cwd();

const BUDGET_REPORTER_ARG = '--test-reporter=';
const BUDGET_REPORTER_PATH = 'unit-test-budget-reporter';
const TIMEOUT_GUARD = 'unit-test-timeout-guard';

/**
 * Resolve a run plan with the GitHub Actions env flag toggled so the plan's
 * `onGitHubActions()` branch is exercised deterministically. `--unit-test-
 * headroom` is the local authoring path and never carries the GitHub flag.
 */
function planFor(args: string[], github: boolean) {
  const previous = process.env.GITHUB_ACTIONS;
  try {
    if (github) {
      process.env.GITHUB_ACTIONS = 'true';
    } else {
      delete process.env.GITHUB_ACTIONS;
    }
    return buildTestRunPlan({
      executionRoot: ROOT,
      requestedArgs: args,
      probeNodeVersion: () => 'v24.15.0',
      probeTestConcurrency: () => true,
    });
  } finally {
    if (previous === undefined) delete process.env.GITHUB_ACTIONS;
    else process.env.GITHUB_ACTIONS = previous;
  }
}

test('task-2542: GitHub default plan must not select the timing reporter', () => {
  const plan = planFor([], true);
  const hasReporter = plan.nodeArgs.some(
    arg => arg.startsWith(BUDGET_REPORTER_ARG) && arg.includes(BUDGET_REPORTER_PATH),
  );
  assert.ok(
    !hasReporter,
    'GitHub CI must not execute the unit-test budget reporter; nodeArgs='
      + JSON.stringify(plan.nodeArgs.slice(0, 8)),
  );
});

test('task-2542: GitHub integration-ci plan must not select the timing test', () => {
  const plan = planFor(['--integration-ci'], true);
  const selected = plan.testFiles
    .map(file => path.relative(ROOT, file))
    .filter(file => file.includes(TIMEOUT_GUARD));
  assert.deepEqual(
    selected,
    [],
    'GitHub CI must not run unit-test-timeout-guard; selected=' + JSON.stringify(selected),
  );
});

test('task-2542: local headroom path retains the timing reporter and budget', () => {
  const plan = planFor(['--unit-test-headroom'], false);
  const hasReporter = plan.nodeArgs.some(
    arg => arg.startsWith(BUDGET_REPORTER_ARG) && arg.includes(BUDGET_REPORTER_PATH),
  );
  assert.ok(
    hasReporter,
    'local headroom plan must select the unit-test budget reporter',
  );
  const reporterArg = plan.nodeArgs.find(
    arg => arg.startsWith(BUDGET_REPORTER_ARG) && arg.includes(BUDGET_REPORTER_PATH),
  );
  assert.match(
    reporterArg ?? '',
    /unit-test-budget-reporter\.mjs$/,
    'custom reporters must be native ESM because Node 22 does not apply the TypeScript preload to them',
  );
  assert.equal(
    plan.unitTestHeadroomMs,
    UNIT_TEST_HEADROOM_MS,
    'local headroom plan must enforce the unit-test headroom budget',
  );
});

test('task-2542: local integration-local lane still selects the timing test', () => {
  const plan = planFor(['--integration-local'], false);
  const selected = plan.testFiles
    .map(file => path.relative(ROOT, file))
    .filter(file => file.includes(TIMEOUT_GUARD));
  assert.deepEqual(
    selected,
    ['test/unit-test-timeout-guard.test.ts'],
    'required local verification must still run unit-test-timeout-guard; selected=' + JSON.stringify(selected),
  );
});
}

// Regression group from test/coverage-reporter-pairing.test.ts
{
const root = path.join(import.meta.dirname, '..');

function withGitHubActions<T>(callback: () => T): T {
  const previous = process.env.GITHUB_ACTIONS;
  process.env.GITHUB_ACTIONS = 'true';
  try {
    return callback();
  } finally {
    if (previous === undefined) delete process.env.GITHUB_ACTIONS;
    else process.env.GITHUB_ACTIONS = previous;
  }
}

test('task-2586: GitHub coverage balances reporter and destination flags for unit and integration-ci', () => {
  for (const requestedArgs of [[], ['--integration-ci']]) {
    const plan = withGitHubActions(() => buildTestRunPlan({
      executionRoot: root,
      requestedArgs,
      probeNodeVersion: () => 'v24.15.0',
    }));
    const args = withCoverageReporters(plan.nodeArgs, 'coverage/test.info');
    assert.equal(
      args.filter(arg => arg.startsWith('--test-reporter=')).length,
      args.filter(arg => arg.startsWith('--test-reporter-destination=')).length,
      `${requestedArgs.join(' ') || 'unit'} has one destination per reporter`,
    );
    assert.deepEqual(args.filter(arg => arg.startsWith('--test-reporter-destination=')), [
      '--test-reporter-destination=stdout',
      '--test-reporter-destination=coverage/test.info',
    ]);
    assert.ok(args.includes('--test-reporter=spec'));
  }
});
}

// TASK-2622.20: performance policy is the authority for every runner profile.

test('CPU policy covers unit and integration profiles and rejects invalid overrides (TASK-2622.20)', () => {
  const policy = readCpuBudgetPolicy(path.join(import.meta.dirname, '..'));
  for (const integration of [false, true]) {
    for (const covered of [false, true]) {
      for (const fast of [false, true]) {
        for (const ci of [false, true]) {
          const options = { integration, ci, local: !ci, fast, covered, env: {} };
          const budget = suiteCpuBudget(policy, options);
          assert.ok(Number.isSafeInteger(budget) && budget > 0);
          const key = integration ? 'PARALLIX_INTEGRATION_SUITE_CPU_BUDGET_MS' : 'PARALLIX_UNIT_TEST_CPU_BUDGET_MS';
          assert.equal(suiteCpuBudget(policy, { ...options, env: { [key]: '7' } }), 7);
          for (const invalid of ['', '0', '-1', 'NaN', 'Infinity', '2.5']) {
            assert.throws(() => suiteCpuBudget(policy, { ...options, env: { [key]: invalid } }), /invalid .* CPU budget/);
          }
        }
      }
    }
  }
});

test('focused integration hooks retain CPU enforcement and tier boundaries (TASK-2622.20)', () => {
  const root = path.join(import.meta.dirname, '..');
  const options = { executionRoot: root, probeNodeVersion: () => 'v24.15.0', probeTestConcurrency: () => true };
  const previous = process.env.GITHUB_ACTIONS;
  try {
    delete process.env.GITHUB_ACTIONS;
    assert.throws(() => buildTestRunPlan({ ...options, requestedArgs: ['test/missing-contract.test.ts'] }), /requested test file does not exist/);
    const file = 'test/repository-gates.integration.test.ts';
    const plan = buildTestRunPlan({ ...options, requestedArgs: [file] });
    assert.equal(plan.runsIntegrationSuite, true);
    assert.equal(plan.runsIntegrationCiSuite, true);
    assert.deepEqual(plan.testFiles, [file]);
    assert.ok(plan.nodeArgs.some(arg => arg.endsWith('integration-cpu-hook.mjs')));
    const tierPlan = buildTestRunPlan({ ...options, requestedArgs: ['--integration-ci', file] });
    assert.deepEqual(tierPlan.testFiles, [file]);
    assert.throws(() => buildTestRunPlan({ ...options, requestedArgs: ['--integration-ci', 'test/unit-test-timeout-guard.test.ts'] }),
      /must belong to the requested verification tier/);
    process.env.GITHUB_ACTIONS = 'true';
    const hosted = buildTestRunPlan({ ...options, requestedArgs: [file] });
    assert.ok(!hosted.nodeArgs.some(arg => arg.endsWith('integration-cpu-hook.mjs')));
  } finally {
    if (previous === undefined) delete process.env.GITHUB_ACTIONS;
    else process.env.GITHUB_ACTIONS = previous;
  }
});

test('CPU profiles name live integration owners and new cases retain a finite fallback (TASK-2622.20)', () => {
  const root = path.join(import.meta.dirname, '..');
  const policy = readCpuBudgetPolicy(root);
  const integration = new Set(buildTestRunPlan({ executionRoot: root, requestedArgs: ['--integration'], probeNodeVersion: () => 'v24.15.0' })
    .testFiles.map(file => path.relative(path.join(root, 'test'), file)));
  for (const profile of ['plain', 'covered']) {
    assert.deepEqual(Object.keys(policy.integrationCases[profile]).filter(file => !integration.has(file)), [],
      'Remove stale CPU profile entries when behavior ownership changes.');
  }
  assert.ok(policy.integrationCases.defaultMs <= 1_000,
    'New integration cases must begin with a finite CPU ceiling; expensive contracts require a measured profile.');
  assert.ok(policy.unitSuites.plain < 650_000 && policy.unitSuites.covered < 900_000
    && policy.unitSuites.fastCovered < 520_000,
    'The pre-wave provisional limits must not silently replace the calibrated CPU policy.');
});
