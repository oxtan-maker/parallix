
import test from 'node:test';
import assert from 'node:assert/strict';

import { withMissionDatabase } from './fixtures/review-state-db.js';
import { reviewLoopBindings } from '../src/composition/review-persistence.js';
import {
  reviewStateFile,
  readReviewState,
  writeReviewState,
  resetReviewState,
} from '../src/adapters/review/review-state.js';

test('reviewStateFile returns null for unknown slug', () => {
  assert.equal(reviewStateFile('task-nonexistent-zzz'), null);
});

test('readReviewState returns null when the mission has no review', async () => {
  await withMissionDatabase('task-rs-1', async ({ root, slug, store }) => {
    assert.equal(await readReviewState(slug, root, store), null);
  }, { seedReview: false });
});

test('readReviewState returns null for a mission the database does not hold', async () => {
  await withMissionDatabase('task-rs-2', async ({ root, store }) => {
    assert.equal(await readReviewState('task-rs-absent', root, store), null);
  });
});

test('readReviewState hydrates the loop view from the Review aggregate', async () => {
  await withMissionDatabase('task-rs-3', async ({ root, slug, store }) => {
    const state = await readReviewState(slug, root, store);
    assert.ok(state, 'a seeded review should be readable');
    assert.equal(state.reviewer, 'codex');
    assert.equal(state.implementer, 'claude');
    assert.equal(state.round, 1);
    assert.equal(state.phase, 'reviewing');
    assert.equal(state.disposition, null);
  });
});

test('writeReviewState round-trips workflow state through the operator database', async () => {
  await withMissionDatabase('task-rs-4', async ({ root, slug, store }) => {
    const result = await writeReviewState(slug, {
      reviewer: 'codex',
      implementer: 'claude',
      round: 2,
      phase: 'fixing',
      disposition: 'REQUEST_CHANGES',
      metadata: {
        recordedStageLaunches: { 'review:codex': ['codex|s1|t0|t1|0'] },
      },
    }, root, store);
    assert.deepEqual(result, { outcome: 'committed' });

    const read = await readReviewState(slug, root, store);
    assert.ok(read, 'state should be readable after write');
    assert.equal(read.round, 2, 'the loop advancing a round appends one to the aggregate');
    assert.equal(read.phase, 'fixing');
    assert.equal(read.disposition, 'REQUEST_CHANGES');
    assert.deepEqual(read.metadata.recordedStageLaunches, { 'review:codex': ['codex|s1|t0|t1|0'] });
    // TASK-2377.04: no persisted retry counters remain — the loop view
    // carries none and the metadata pass-through for them is deleted.
    assert.equal((read as { reviewerRetryCount?: unknown }).reviewerRetryCount, undefined);
    assert.equal(read.metadata.gateFailureRetryCount, undefined);
    assert.equal(read.metadata.hookFailureRetryCount, undefined);
  });
});

test('a stale reviewer-launch state cannot erase a recorded approval', async () => {
  await withMissionDatabase('task-rs-approval', async ({ root, slug, store }) => {
    const stale = await readReviewState(slug, root, store);
    const loaded = await store.load(slug);
    assert.ok(stale && loaded.kind === 'found' && loaded.mission.review);
    const round = loaded.mission.review.rounds[0];
    const decided = {
      ...loaded.mission,
      review: {
        ...loaded.mission.review,
        rounds: [{ ...round, phase: 'approved' as const, disposition: 'APPROVED' as const,
          decision: { kind: 'approved' as const, decidedAt: '2026-08-02T11:00:00.000Z', comment: 'passed', source: { kind: 'local' as const } },
        }],
      },
    };
    await store.save(decided as typeof loaded.mission, loaded.version);

    assert.deepEqual(await writeReviewState(slug, stale, root, store), { outcome: 'committed' });
    const after = await store.load(slug);
    assert.equal(after.kind, 'found');
    assert.equal(after.mission.review?.rounds[0].decision?.kind, 'approved');
    assert.equal((await readReviewState(slug, root, store))?.phase, 'approved');
  });
});

test('writeReviewState records a human escalation as a review intervention', async () => {
  await withMissionDatabase('task-rs-5', async ({ root, slug, store }) => {
    await writeReviewState(slug, {
      reviewer: 'codex',
      implementer: 'claude',
      round: 1,
      phase: 'reviewing',
      // Not a ReviewDisposition: the loop invents this one for the escalation.
      disposition: 'MAX_ATTEMPTS',
      metadata: {
        humanEscalationReason: 'MAX_ATTEMPTS',
        humanEscalatedAt: '2026-08-02T12:00:00.000Z',
      },
    }, root, store);

    const read = await readReviewState(slug, root, store);
    assert.equal(read.metadata.humanEscalationReason, 'MAX_ATTEMPTS');
    assert.equal(read.metadata.humanEscalatedAt, '2026-08-02T12:00:00.000Z');
  });
});

test('writeReviewState reports write-failed when the mission has no review', async () => {
  await withMissionDatabase('task-rs-6', async ({ root, slug, store }) => {
    const result = await writeReviewState(slug, { reviewer: 'codex', implementer: 'claude' }, root, store);
    assert.equal(result.outcome, 'write-failed');
    assert.match(result.diagnostic, /--start starts the review/);
  }, { seedReview: false });
});

test('writeReviewState reports write-failed for a mission the database does not hold', async () => {
  await withMissionDatabase('task-rs-7', async ({ root, store }) => {
    const result = await writeReviewState('task-rs-absent', { reviewer: 'codex', implementer: 'claude' }, root, store);
    assert.equal(result.outcome, 'write-failed');
    assert.match(result.diagnostic, /not in the operator database/);
  });
});

test('resetReviewState returns unchanged when the mission has no review', async () => {
  await withMissionDatabase('task-rs-8', async ({ root, slug, store }) => {
    assert.deepEqual(await resetReviewState(slug, root, store), { outcome: 'unchanged' });
  }, { seedReview: false });
});

test('resetReviewState clears loop bookkeeping but keeps the review conversation', async () => {
  await withMissionDatabase('task-rs-9', async ({ root, slug, store }) => {
    const before = await readReviewState(slug, root, store);
    const deleted = [];
    await writeReviewState(slug, {
      reviewer: 'codex',
      implementer: 'claude',
      round: 1,
      phase: 'fixing',
      disposition: 'REQUEST_CHANGES',
      metadata: {
        recordedStageLaunches: { 'review:codex': ['codex|s1|t0|t1|0'] },
      },
    }, root, store);

    assert.deepEqual(await resetReviewState(slug, root, store, {
      delete: async (mission, role) => { deleted.push([mission, role]); },
    } as never), { outcome: 'committed' });

    const read = await readReviewState(slug, root, store);
    assert.ok(read, 'the review itself survives a reset');
    assert.equal(read.phase, 'reviewing');
    assert.equal(read.disposition, null);
    assert.ok(Date.parse(read.startedAt) > Date.parse(before.startedAt));
    assert.deepEqual(read.metadata, {}, 'stage launches are cleared');
    assert.deepEqual(deleted, [[slug, 'review']], 'the old reviewer session is cleared');
  });
});

test('review loop reset clears the reviewer session marker', async () => {
  await withMissionDatabase('task-rs-session', async ({ root, slug, store }) => {
    const deleted = [];
    const bindings = reviewLoopBindings(store, null, {
      delete: async (mission, role) => { deleted.push([mission, role]); },
    } as never);

    assert.deepEqual(await bindings.resetReviewStateFn(slug, root), { outcome: 'committed' });
    assert.deepEqual(deleted, [[slug, 'review']]);
  });
});
