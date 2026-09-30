/**
 * TASK-2542 — regression proof that GitHub CI test selection excludes timing
 * enforcement while the local/headroom path retains it.
 *
 * Red at the mission parent commit: the GitHub run plan still selects the
 * timing reporter (default suite) and the timing test (integration-ci lane).
 * Green once the GitHub test-run selection change lands. Hermetic: asserts on
 * the resolved plan object returned by `buildTestRunPlan`, no process spawn.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { buildTestRunPlan } from './lib/test-run-plan.js';
import { UNIT_TEST_HEADROOM_MS } from './lib/unit-test-budget-reporter.mjs';

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
