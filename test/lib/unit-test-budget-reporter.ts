import { spec, type TestEvent } from 'node:test/reporters';
import { Readable } from 'node:stream';

export const UNIT_TEST_BUDGET_MS = 1_000;
export const UNIT_TEST_HEADROOM_MS = 500;

// Single source of truth for "running on GitHub Actions". Both enforcement
// points (this reporter and test/run-default-tests.ts) import this so the
// timing budget is disabled on GitHub-hosted runners in exactly one place.
// Scope to the exact value GitHub Actions sets; any GitHub-ish var must not
// disable the local fast-dev timecheck (task-2531).
export function onGitHubActions(): boolean {
  return process.env.GITHUB_ACTIONS === 'true';
}

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
        // On GitHub-hosted runners the budget is disabled: runner speed is
        // uncontrollable, so no per-test budget or headroom signal fires there.
        // Guard the accounting, do NOT `return` from the generator: the
        // generator is piped into node:test's `spec()` reporter, and an early
        // `return` would stop forwarding every subsequent event, silencing the
        // whole suite output on GitHub Actions. Budget and event forwarding are
        // distinct concerns (task-2531, reviewer F1).
        if (!onGitHubActions()) {
          if (test.durationMs > UNIT_TEST_BUDGET_MS) {
            overBudget.push(test);
          } else if (enforcesHeadroom && test.durationMs > UNIT_TEST_HEADROOM_MS) {
            overHeadroom.push(test);
          }
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
