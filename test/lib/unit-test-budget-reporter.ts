import { spec, type TestEvent } from 'node:test/reporters';
import { Readable } from 'node:stream';

export const UNIT_TEST_BUDGET_MS = 1_000;
export const UNIT_TEST_HEADROOM_MS = 500;

export function onGitHubActions(): boolean {
  return process.env.GITHUB_ACTIONS === 'true';
}

// Native ESM mirror for source typing. The CPU guard executes inside file
// workers; the parent only formats the events it receives.
export default async function* unitTestBudgetReporter(source: AsyncIterable<TestEvent>) {
  yield* Readable.from(source).pipe(spec());
}
