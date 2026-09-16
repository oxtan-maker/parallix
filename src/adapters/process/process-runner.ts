/**
 * The raw synchronous process runner, re-exported as a named mechanism so CLI
 * adapters can bind it to an application port without importing
 * `node:child_process` themselves (TASK-2512). `src/adapters/git/git.ts` owns
 * the normalized `run()` wrapper; this is the unwrapped form callers that need
 * `SpawnSyncReturns` (verification proof capture) require.
 */
export { spawnSync } from 'node:child_process';
