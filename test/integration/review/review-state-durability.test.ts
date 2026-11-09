
import test from 'node:test';
import assert from 'node:assert/strict';

import { withMissionDatabase } from '../../fixtures/review-state-db.js';
import {
  writeReviewState,
  persistReviewStateOrThrow,
  assertReviewStatePersisted,
} from '../../../src/adapters/review/review-state.js';
import { agentFamily } from '../../../src/domain/agents.js';
import { changeRevision, currentReviewRound, reviewFindingId } from '../../../src/domain/review.js';
import { missionId } from '../../../src/domain/mission.js';

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
    }, root, { missionStore: store });

    assert.notEqual(result.outcome, 'committed', 'a mission with no review must not report committed');
    assert.equal(result.outcome, 'write-failed');
    assert.equal(result.stage, 'write');
    assert.match(result.diagnostic, /px review \S+ starts the review/);
  }, { seedReview: false });
});

test('persistReviewStateOrThrow throws rather than continuing past a failed write', async () => {
  await withMissionDatabase('task-2220-throws', async ({ root, slug, store }) => {
    await assert.rejects(
      () => persistReviewStateOrThrow((target, state, worktree) => writeReviewState(target, state, worktree, { missionStore: store }), slug, {
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

test('per-reviewer results survive the SQLite mission aggregate round trip unchanged (PX-0046.01)', async () => {
  const reviewerResults = [{
    publicationId: 'session-42', reviewerId: 'codex-reviewer', agentFamily: agentFamily('codex'),
    revision: changeRevision('rev-1'), decision: 'changes-requested' as const,
    findings: [{ id: reviewFindingId('F1'), summary: 'Keep attribution', location: 'src/domain/review.ts' }],
    outcome: 'completed' as const, status: 0, publishedAt: '2026-11-08T10:00:00Z', revokedAt: null,
  }];
  await withMissionDatabase('px-0046-01-roundtrip', async ({ slug, store, openStore }) => {
    const loaded = await store.load(missionId(slug));
    assert.equal(loaded.kind, 'found');
    if (loaded.kind !== 'found') { return; }
    const round = currentReviewRound(loaded.mission.review!);
    await store.save({ ...loaded.mission, review: { ...loaded.mission.review!, rounds: [{ ...round, reviewerResults }] } }, loaded.version);

    const reopened = await openStore();
    try {
      const reloaded = await reopened.store.load(missionId(slug));
      assert.equal(reloaded.kind, 'found');
      if (reloaded.kind === 'found') {
        assert.deepEqual(currentReviewRound(reloaded.mission.review!).reviewerResults, reviewerResults);
      }
    } finally { await reopened.db.close(); }
  });
});
