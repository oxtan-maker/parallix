import test from 'node:test';
import assert from 'node:assert/strict';
import unitTestBudgetReporter, { UNIT_TEST_BUDGET_MS, UNIT_TEST_HEADROOM_MS } from './lib/unit-test-budget-reporter.js';

test('unit-test budget reporter marks measured synchronous work over the bound', async () => {
  async function* events() {
    yield {
      type: 'test:pass' as const,
      data: {
        name: 'sync block', nesting: 0, testNumber: 1,
        details: { duration_ms: UNIT_TEST_BUDGET_MS + 1, type: 'test' as const },
        file: 'slow.test.ts', line: 1, column: 1,
      },
    };
  }

  let output = '';
  for await (const chunk of unitTestBudgetReporter(events())) { output += chunk; }
  assert.match(output, /\[unit-test-budget:exceeded\] sync block: 1001ms > 1000ms/);
});

test('unit-test budget reporter reports opted-in headroom without changing the hard cap', async () => {
  async function* events() {
    yield {
      type: 'test:pass' as const,
      data: {
        name: 'near-bound work', nesting: 0, testNumber: 1,
        details: { duration_ms: UNIT_TEST_HEADROOM_MS + 1, type: 'test' as const },
        file: 'headroom.test.ts', line: 1, column: 1,
      },
    };
  }

  const priorHeadroom = process.env.PARALLIX_UNIT_TEST_HEADROOM;
  process.env.PARALLIX_UNIT_TEST_HEADROOM = '1';
  try {
    let output = '';
    for await (const chunk of unitTestBudgetReporter(events())) { output += chunk; }
    assert.equal(UNIT_TEST_HEADROOM_MS, 500);
    assert.match(output, /\[unit-test-budget:headroom\] near-bound work: 501ms > 500ms/);
    assert.doesNotMatch(output, /\[unit-test-budget:exceeded\]/);
  } finally {
    if (priorHeadroom === undefined) { delete process.env.PARALLIX_UNIT_TEST_HEADROOM; }
    else { process.env.PARALLIX_UNIT_TEST_HEADROOM = priorHeadroom; }
  }
});
