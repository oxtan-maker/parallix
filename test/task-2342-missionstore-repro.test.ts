import test from 'node:test';
import assert from 'node:assert/strict';

import { persistReviewStateOrThrow, ReviewState } from '../src/adapters/review/review-state.js';

test('persistReviewStateOrThrow passes missionStore to writeFn', async () => {
  let receivedArgs: unknown[] = [];
  const mockWriteFn = async (...args: unknown[]) => {
    receivedArgs = args;
    return { outcome: 'committed' };
  };

  const mockStore = { id: 'test-store' };
  const slug = 'task-2342';
  const state = new ReviewState(slug, { reviewer: 'codex', implementer: 'claude' });
  const worktree = '/tmp/worktree';

  // @ts-expect-error -- TASK-2328: runtime-only property/partial test double absent from the inferred type.
  await persistReviewStateOrThrow(mockWriteFn, slug, state, worktree, mockStore);

  // writeFn must be called with 4 args: (slug, state, worktree, { missionStore, lifecycleService })
  assert.equal(receivedArgs.length, 4, 'writeFn should receive 4 arguments');
  assert.equal(receivedArgs[0], slug, 'first arg should be slug');
  assert.ok(receivedArgs[1] instanceof ReviewState, 'second arg should be ReviewState');
  assert.equal(receivedArgs[2], worktree, 'third arg should be worktree');
  assert.deepEqual(
    receivedArgs[3],
    { missionStore: mockStore, lifecycleService: undefined },
    'fourth arg should be the options object carrying missionStore'
  );
});

test('persistReviewStateOrThrow calls writeFn with 4 args even when missionStore omitted', async () => {
  let receivedArgs: unknown[] = [];
  const mockWriteFn = async (...args: unknown[]) => {
    receivedArgs = args;
    return { outcome: 'committed' };
  };

  const slug = 'task-2342';
  const state = new ReviewState(slug, { reviewer: 'codex', implementer: 'claude' });
  const worktree = '/tmp/worktree';

  // Call with only 4 args (no missionStore) — missionStore param omitted by caller
  // @ts-expect-error -- TASK-2328: runtime-only property/partial test double absent from the inferred type.
  await persistReviewStateOrThrow(mockWriteFn, slug, state, worktree);

  // After fix: always 4 args (options.missionStore = undefined when omitted)
  // Before fix: 3 args (missionStore not forwarded to writeFn)
  // RED (before fix): receivedArgs.length === 3
  // GREEN (after fix): receivedArgs.length === 4 and the options object carries undefined missionStore
  assert.equal(
    receivedArgs.length,
    4,
    'writeFn should receive exactly 4 arguments (slug, state, worktree, options)'
  );
  assert.deepEqual(
    receivedArgs[3],
    { missionStore: undefined, lifecycleService: undefined },
    'fourth arg options should carry undefined missionStore when omitted'
  );
});
