
const test = require('node:test');
const assert = require('node:assert/strict');

const { withMissionDatabase } = require('./fixtures/review-state-db.js');
const {
  reviewStateFile,
  readReviewState,
  writeReviewState,
  resetReviewState,
} = require('../.test-runtime/adapters/review/review-state.js');

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
      reviewerRetryCount: 1,
      implementerRetryCount: 2,
      metadata: {
        recordedStageLaunches: { 'review:codex': ['codex|s1|t0|t1|0'] },
        gateFailureRetryCount: 1,
      },
    }, root, store);
    assert.deepEqual(result, { outcome: 'committed' });

    const read = await readReviewState(slug, root, store);
    assert.ok(read, 'state should be readable after write');
    assert.equal(read.round, 2, 'the loop advancing a round appends one to the aggregate');
    assert.equal(read.phase, 'fixing');
    assert.equal(read.disposition, 'REQUEST_CHANGES');
    assert.equal(read.reviewerRetryCount, 1);
    assert.equal(read.implementerRetryCount, 2);
    assert.deepEqual(read.metadata.recordedStageLaunches, { 'review:codex': ['codex|s1|t0|t1|0'] });
    assert.equal(read.metadata.gateFailureRetryCount, 1);
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
    assert.match(result.diagnostic, /px handoff starts the review/);
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
    await writeReviewState(slug, {
      reviewer: 'codex',
      implementer: 'claude',
      round: 1,
      phase: 'fixing',
      disposition: 'REQUEST_CHANGES',
      reviewerRetryCount: 2,
      metadata: {
        recordedStageLaunches: { 'review:codex': ['codex|s1|t0|t1|0'] },
        gateFailureRetryCount: 2,
      },
    }, root, store);

    assert.deepEqual(await resetReviewState(slug, root, store), { outcome: 'committed' });

    const read = await readReviewState(slug, root, store);
    assert.ok(read, 'the review itself survives a reset');
    assert.equal(read.phase, 'reviewing');
    assert.equal(read.disposition, null);
    assert.equal(read.reviewerRetryCount, 0);
    assert.deepEqual(read.metadata, {}, 'stage launches and the gate budget are cleared');
  });
});
