
const test = require('node:test');
const assert = require('node:assert/strict');

const { withMissionDatabase } = require('./fixtures/review-state-db.js');
const {
  writeReviewState,
  persistReviewStateOrThrow,
  assertReviewStatePersisted,
} = require('../.test-runtime/lib/review/review-state');

// task-2220: a review-state write that did not reach durable storage must never
// report success. The original repro drove a git pre-commit hook rejection;
// after the TASK-2322.12 cutover the same class of failure is a write that never
// reaches the operator database, so the invariant is re-pinned to that.
test('writeReviewState does not report success when the write never reaches durable storage', async () => {
  await withMissionDatabase('task-2220-repro', async ({ root, slug }) => {
    const result = await writeReviewState(slug, {
      reviewer: 'codex',
      implementer: 'claude',
      round: 3,
      phase: 'fixing',
    }, root);

    assert.notEqual(result.outcome, 'committed', 'a mission with no review must not report committed');
    assert.equal(result.outcome, 'write-failed');
    assert.equal(result.stage, 'write');
    assert.match(result.diagnostic, /px handoff starts the review/);
  }, { seedReview: false });
});

test('persistReviewStateOrThrow throws rather than continuing past a failed write', async () => {
  await withMissionDatabase('task-2220-throws', async ({ root, slug }) => {
    await assert.rejects(
      () => persistReviewStateOrThrow(writeReviewState, slug, {
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
