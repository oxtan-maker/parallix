import test from 'node:test';
import assert from 'node:assert/strict';
import unitTestBudgetReporter from './lib/unit-test-budget-reporter.js';
import { buildTestRunPlan } from './lib/test-run-plan.js';

test('TASK-2423: headroom mode reports 501ms work while preserving the 1000ms hard cap', async () => {
  async function* events() {
    for (const [name, duration_ms] of [['headroom work', 501], ['hard-cap work', 1001]] as const) {
      yield {
        type: 'test:pass' as const,
        data: {
          name, nesting: 0, testNumber: 1,
          details: { duration_ms, type: 'test' as const },
          file: 'task-2423-repro.test.ts', line: 1, column: 1,
        },
      };
    }
  }

  const priorHeadroom = process.env.PARALLIX_UNIT_TEST_HEADROOM;
  process.env.PARALLIX_UNIT_TEST_HEADROOM = '1';
  try {
    let output = '';
    for await (const chunk of unitTestBudgetReporter(events())) { output += chunk; }
    assert.match(output, /\[unit-test-budget:headroom\] headroom work: 501ms > 500ms/);
    assert.match(output, /\[unit-test-budget:exceeded\] hard-cap work: 1001ms > 1000ms/);
  } finally {
    if (priorHeadroom === undefined) { delete process.env.PARALLIX_UNIT_TEST_HEADROOM; }
    else { process.env.PARALLIX_UNIT_TEST_HEADROOM = priorHeadroom; }
  }
});

test('TASK-2423: headroom mode requests a 500ms timeout without changing the default plan', () => {
  const options = {
    executionRoot: process.cwd(),
    probeNodeVersion: () => 'v24.15.0',
  };
  const defaultPlan = buildTestRunPlan({ ...options, requestedArgs: [] });
  const headroomPlan = buildTestRunPlan({ ...options, requestedArgs: ['--unit-test-headroom'] });

  assert.ok(defaultPlan.nodeArgs.includes('--test-timeout=1000'));
  assert.equal(headroomPlan.unitTestHeadroomMs, 500);
});
