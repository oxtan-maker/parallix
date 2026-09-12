
import test from 'node:test';
import assert from 'node:assert/strict';

import { withMissionDatabase } from './fixtures/review-state-db.js';
import {
  writeReviewState,
  persistReviewStateOrThrow,
  assertReviewStatePersisted,
} from '../src/adapters/review/review-state.js';

// task-2220: a review-state write that did not reach durable storage must never
// report success. The original repro drove a git pre-commit hook rejection;
// after the TASK-2322.12 cutover the same class of failure is a write that never
// reaches the operator database, so the invariant is re-pinned to that.
test('writeReviewState does not report success when the write never reaches durable storage', async () => {
  await withMissionDatabase('task-2220-repro', async ({ root, slug, store }) => {
    const result = await writeReviewState(slug, {
      reviewer: 'codex',
      implementer: 'claude',
      round: 3,
      phase: 'fixing',
    }, root, store);

    assert.notEqual(result.outcome, 'committed', 'a mission with no review must not report committed');
    assert.equal(result.outcome, 'write-failed');
    assert.equal(result.stage, 'write');
    assert.match(result.diagnostic, /--start starts the review/);
  }, { seedReview: false });
});

test('persistReviewStateOrThrow throws rather than continuing past a failed write', async () => {
  await withMissionDatabase('task-2220-throws', async ({ root, slug, store }) => {
    await assert.rejects(
      () => persistReviewStateOrThrow((target, state, worktree) => writeReviewState(target, state, worktree, store), slug, {
        reviewer: 'codex',
        implementer: 'claude',
        round: 3,
        phase: 'fixing',
      }, root),
      /mission task-2220-throws, phase fixing, round 3, stage write/
    );
  }, { seedReview: false });
});

test('durable review checkpoints fail closed with mission phase round stage and diagnostic', () => {
  assert.throws(
    () => assertReviewStatePersisted(
      { outcome: 'write-failed', stage: 'write', diagnostic: 'rename denied' },
      { slug: 'task-2220', phase: 'fixing', round: 4 }
    ),
    /mission task-2220, phase fixing, round 4, stage write: rename denied/
  );
});
