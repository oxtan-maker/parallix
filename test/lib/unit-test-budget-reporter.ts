import { spec, type TestEvent } from 'node:test/reporters';
import { Readable } from 'node:stream';

export const UNIT_TEST_BUDGET_MS = 1_000;
export const UNIT_TEST_HEADROOM_MS = 500;

export default async function* unitTestBudgetReporter(source: AsyncIterable<TestEvent>) {
  const overBudget: Array<{ name: string; durationMs: number }> = [];
  const overHeadroom: Array<{ name: string; durationMs: number }> = [];
  const enforcesHeadroom = process.env.PARALLIX_UNIT_TEST_HEADROOM === '1';

  async function* measure() {
    for await (const event of source) {
      if (event.type === 'test:pass'
          && event.data.details.type !== 'suite'
          && !event.data.skip
          && !event.data.todo
          ) {
        const test = { name: event.data.name, durationMs: event.data.details.duration_ms };
        if (test.durationMs > UNIT_TEST_BUDGET_MS) {
          overBudget.push(test);
        } else if (enforcesHeadroom && test.durationMs > UNIT_TEST_HEADROOM_MS) {
          overHeadroom.push(test);
        }
      }
      yield event;
    }
  }

  yield* Readable.from(measure()).pipe(spec());
  for (const test of overHeadroom) {
    yield `\n[unit-test-budget:headroom] ${test.name}: ${Math.round(test.durationMs)}ms > ${UNIT_TEST_HEADROOM_MS}ms`;
  }
  if (overBudget.length > 0) {
    for (const test of overBudget) {
      yield `\n[unit-test-budget:exceeded] ${test.name}: ${Math.round(test.durationMs)}ms > ${UNIT_TEST_BUDGET_MS}ms`;
    }
  }
}
