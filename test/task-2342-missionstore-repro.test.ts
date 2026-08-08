const test = require('node:test');
const assert = require('node:assert/strict');

const { persistReviewStateOrThrow, ReviewState } = require('../.test-runtime/adapters/review/review-state.js');

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

  await persistReviewStateOrThrow(mockWriteFn, slug, state, worktree, mockStore);

  // writeFn must be called with 4 args: (slug, state, worktree, missionStore)
  assert.equal(receivedArgs.length, 4, 'writeFn should receive 4 arguments');
  assert.equal(receivedArgs[0], slug, 'first arg should be slug');
  assert.ok(receivedArgs[1] instanceof ReviewState, 'second arg should be ReviewState');
  assert.equal(receivedArgs[2], worktree, 'third arg should be worktree');
  assert.equal(receivedArgs[3], mockStore, 'fourth arg should be missionStore');
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
  await persistReviewStateOrThrow(mockWriteFn, slug, state, worktree);

  // After fix: always 4 args (missionStore = undefined when omitted)
  // Before fix: 3 args (missionStore not forwarded to writeFn)
  // RED (before fix): receivedArgs.length === 3
  // GREEN (after fix): receivedArgs.length === 4 and receivedArgs[3] === undefined
  assert.equal(
    receivedArgs.length,
    4,
    'writeFn should receive exactly 4 arguments (slug, state, worktree, missionStore=undefined)'
  );
  assert.equal(receivedArgs[3], undefined, 'fourth arg should be undefined when missionStore omitted');
});
