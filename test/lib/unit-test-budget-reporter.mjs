import { spec } from 'node:test/reporters';
import { Readable } from 'node:stream';

export const UNIT_TEST_BUDGET_MS = 1_000;
export const UNIT_TEST_HEADROOM_MS = 500;

export function onGitHubActions() {
  return process.env.GITHUB_ACTIONS === 'true';
}

// Formatting stays in the parent reporter. CPU enforcement runs in each test
// file worker via cpu-test-hook.mjs, before result events reach this process.
export default async function* unitTestBudgetReporter(source) {
  yield* Readable.from(source).pipe(spec());
}
