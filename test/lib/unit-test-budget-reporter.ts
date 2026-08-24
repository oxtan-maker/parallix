import { spec, type TestEvent } from 'node:test/reporters';
import { Readable } from 'node:stream';

export const UNIT_TEST_BUDGET_MS = 1_000;

export default async function* unitTestBudgetReporter(source: AsyncIterable<TestEvent>) {
  const overBudget: Array<{ name: string; durationMs: number }> = [];

  async function* measure() {
    for await (const event of source) {
      if (event.type === 'test:pass'
          && event.data.details.type !== 'suite'
          && !event.data.skip
          && !event.data.todo
          && event.data.details.duration_ms > UNIT_TEST_BUDGET_MS) {
        overBudget.push({ name: event.data.name, durationMs: event.data.details.duration_ms });
      }
      yield event;
    }
  }

  yield* Readable.from(measure()).pipe(spec());
  if (overBudget.length > 0) {
    for (const test of overBudget) {
      yield `\n[unit-test-budget:exceeded] ${test.name}: ${Math.round(test.durationMs)}ms > ${UNIT_TEST_BUDGET_MS}ms`;
    }
  }
}
