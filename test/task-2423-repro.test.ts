import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTestRunPlan } from './lib/test-run-plan.js';
import { UNIT_TEST_BUDGET_MS, UNIT_TEST_HEADROOM_MS } from './lib/unit-test-budget-reporter.mjs';

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
