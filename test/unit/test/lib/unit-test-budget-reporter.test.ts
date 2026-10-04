import test from 'node:test';
import assert from 'node:assert/strict';
import unitTestBudgetReporter, { onGitHubActions } from '../../../lib/unit-test-budget-reporter.mjs';
import { buildTestRunPlan } from '../../../lib/test-run-plan.js';

test('reporter forwards results without treating elapsed time as compute cost', async () => {
  async function* events() {
    yield {
      type: 'test:pass' as const,
      data: {
        name: 'low CPU wait', nesting: 0, testNumber: 1,
        details: { duration_ms: 10_000, type: 'test' as const },
        file: 'wait.test.ts', line: 1, column: 1,
      },
    };
  }
  let output = '';
  for await (const chunk of unitTestBudgetReporter(events())) { output += chunk; }
  assert.match(output, /low CPU wait/);
  assert.doesNotMatch(output, /budget.*exceeded/i);
});

test('local unit plan loads worker CPU hook; GitHub keeps local budget disabled', () => {
  const prior = process.env.GITHUB_ACTIONS;
  try {
    delete process.env.GITHUB_ACTIONS;
    const local = buildTestRunPlan({ executionRoot: process.cwd(), requestedArgs: [], probeNodeVersion: () => 'v24.15.0' });
    assert.ok(local.nodeArgs.some(arg => arg.includes('cpu-test-hook.mjs')));
    process.env.GITHUB_ACTIONS = 'true';
    assert.equal(onGitHubActions(), true);
    const hosted = buildTestRunPlan({ executionRoot: process.cwd(), requestedArgs: [], probeNodeVersion: () => 'v24.15.0' });
    assert.ok(!hosted.nodeArgs.some(arg => arg.includes('cpu-test-hook.mjs')));
  } finally {
    if (prior === undefined) { delete process.env.GITHUB_ACTIONS; }
    else { process.env.GITHUB_ACTIONS = prior; }
  }
});
