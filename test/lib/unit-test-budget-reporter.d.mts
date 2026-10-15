import type { TestEvent } from 'node:test/reporters';
export const UNIT_TEST_BUDGET_MS: 1000;
export const UNIT_TEST_HEADROOM_MS: 500;
export function onGitHubActions(): boolean;
export default function unitTestBudgetReporter(source: AsyncIterable<TestEvent>): AsyncGenerator<string | Uint8Array, void, unknown>;
