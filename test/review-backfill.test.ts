// Backfill of the Review aggregate from a pre-cutover review-state.json.
//
// TASK-2322.12 made the Review aggregate the sole write authority for
// review-loop state. Missions handed off before that cutover carry a
// review-state.json and no Review, so `writeReviewState` fails closed and the
// loop can never resume them. These tests pin the migration path that carries
// those missions across.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { withMissionDatabase } = require('./fixtures/review-state-db.js');
const {
  backfillReviewFromLegacyState,
  readReviewState,
  writeReviewState,
} = require('../.test-runtime/adapters/review/review-state.js');
const { review } = require('../.test-runtime/adapters/review/review-commands.js');

/** The shape the file-backed loop left behind: round 3, mid-fix, blocked. */
const LEGACY_STATE = {
  reviewer: 'codex',
  implementer: 'claude',
  round: 3,
  startedAt: '2026-08-02T17:32:19.903Z',
  phase: 'fixing',
  disposition: 'BLOCKED',
  metadata: {
    recordedStageLaunches: {
      'review:codex': ['codex||2026-08-02T17:11:13.178Z|2026-08-02T17:14:11.460Z|0'],
      'follow-up:claude': ['claude|abc|2026-08-02T17:20:52.117Z|2026-08-02T17:20:52.117Z|0'],
    },
  },
};

function writeLegacyState(missionDir: string, state: unknown = LEGACY_STATE): void {
  fs.writeFileSync(path.join(missionDir, 'review-state.json'), JSON.stringify(state, null, 2));
}

test('backfill seeds a Review for a mission handed off before the cutover', async () => {
  await withMissionDatabase('task-bf-1', async ({ root, slug, missionDir, store }: any) => {
    writeLegacyState(missionDir);
    assert.equal(await readReviewState(slug, root, store), null, 'precondition: no Review yet');

    const result = await backfillReviewFromLegacyState(slug, root, { missionStore: store });
    assert.equal(result.outcome, 'backfilled');
    assert.equal(result.rounds, 3, 'round 3 implies three rounds on the aggregate');
    assert.equal(result.round, 3);
    assert.equal(result.phase, 'fixing');

    const state = await readReviewState(slug, root, store);
    assert.ok(state, 'the loop can now read its state');
    assert.equal(state.reviewer, 'codex');
    assert.equal(state.implementer, 'claude');
    assert.equal(state.round, 3);
    assert.equal(state.phase, 'fixing');
    assert.equal(state.disposition, 'BLOCKED');
  }, { seedReview: false });
});

test('backfill preserves recorded stage launches so the loop does not relaunch finished stages', async () => {
  await withMissionDatabase('task-bf-2', async ({ root, slug, missionDir, store }: any) => {
    writeLegacyState(missionDir);
    await backfillReviewFromLegacyState(slug, root, { missionStore: store });

    const state = await readReviewState(slug, root, store);
    assert.deepEqual(
      state.metadata.recordedStageLaunches,
      LEGACY_STATE.metadata.recordedStageLaunches,
      'every stage-launch fingerprint survives the migration',
    );
  }, { seedReview: false });
});

test('backfill unblocks the write path that fails closed before it', async () => {
  await withMissionDatabase('task-bf-3', async ({ root, slug, missionDir, store }: any) => {
    writeLegacyState(missionDir);

    const before = await writeReviewState(slug, { ...LEGACY_STATE, phase: 'reviewing' }, root, store);
    assert.equal(before.outcome, 'write-failed', 'precondition: the loop cannot write without a Review');
    assert.match(before.diagnostic, /--backfill-review/, 'the failure names the migration path');

    await backfillReviewFromLegacyState(slug, root, { missionStore: store });

    const after = await writeReviewState(slug, {
      reviewer: 'codex', implementer: 'claude', round: 3, phase: 'reviewing',
    }, root, store);
    assert.equal(after.outcome, 'committed', 'the loop can persist once the Review exists');
  }, { seedReview: false });
});

test('backfill dry run reports the migration without writing', async () => {
  await withMissionDatabase('task-bf-4', async ({ root, slug, missionDir, store }: any) => {
    writeLegacyState(missionDir);

    const result = await backfillReviewFromLegacyState(slug, root, { apply: false, missionStore: store });
    assert.equal(result.outcome, 'would-backfill');
    assert.equal(result.round, 3);
    assert.equal(await readReviewState(slug, root, store), null, 'a dry run writes nothing');
  }, { seedReview: false });
});

test('backfill leaves an existing Review untouched', async () => {
  await withMissionDatabase('task-bf-5', async ({ root, slug, missionDir, store }: any) => {
    writeLegacyState(missionDir);
    const before = await readReviewState(slug, root, store);
    assert.equal(before.round, 1, 'precondition: the seeded review is at round 1');

    const result = await backfillReviewFromLegacyState(slug, root, { missionStore: store });
    assert.equal(result.outcome, 'already-present');

    const after = await readReviewState(slug, root, store);
    assert.equal(after.round, 1, 'the legacy file does not overwrite live state');
    assert.equal(after.phase, 'reviewing');
  });
});

test('backfill is idempotent: a second run does not duplicate rounds', async () => {
  await withMissionDatabase('task-bf-6', async ({ root, slug, missionDir, store }: any) => {
    writeLegacyState(missionDir);
    await backfillReviewFromLegacyState(slug, root, { missionStore: store });
    const second = await backfillReviewFromLegacyState(slug, root, { missionStore: store });

    assert.equal(second.outcome, 'already-present');
    assert.equal((await readReviewState(slug, root, store)).round, 3);
  }, { seedReview: false });
});

test('backfill reports a mission with no legacy state instead of inventing a Review', async () => {
  await withMissionDatabase('task-bf-7', async ({ root, slug, store }: any) => {
    const result = await backfillReviewFromLegacyState(slug, root, { missionStore: store });
    assert.equal(result.outcome, 'no-legacy-state');
    assert.equal(await readReviewState(slug, root, store), null, 'no Review is invented');
  }, { seedReview: false });
});

test('backfill fails loudly on a review-state.json it cannot reconstruct a round from', async () => {
  await withMissionDatabase('task-bf-8', async ({ root, slug, missionDir, store }: any) => {
    writeLegacyState(missionDir, { round: 2, phase: 'fixing' });

    const result = await backfillReviewFromLegacyState(slug, root, { missionStore: store });
    assert.equal(result.outcome, 'failed');
    assert.match(result.diagnostic, /reviewer, implementer or startedAt/);
    assert.equal(await readReviewState(slug, root, store), null, 'a failed backfill writes nothing');
  }, { seedReview: false });
});

test('backfill fails loudly on unparseable legacy state', async () => {
  await withMissionDatabase('task-bf-9', async ({ root, slug, missionDir, store }: any) => {
    fs.writeFileSync(path.join(missionDir, 'review-state.json'), '{ not json');

    const result = await backfillReviewFromLegacyState(slug, root, { missionStore: store });
    assert.equal(result.outcome, 'failed');
    assert.equal(await readReviewState(slug, root, store), null);
  }, { seedReview: false });
});

test('px review <slug> --backfill-review dispatches the migration', async () => {
  await withMissionDatabase('task-bf-10', async ({ root, slug, missionDir, store }: any) => {
    writeLegacyState(missionDir);

    const out: string[] = [];
    await review([slug, '--backfill-review', '--dry-run'], {
      log: (m: string) => out.push(m), error: (m: string) => out.push(m),
      backfillReviewFn: (target: string, worktree: string, options: any) => backfillReviewFromLegacyState(target, worktree, { ...options, missionStore: store }),
    });
    assert.equal(await readReviewState(slug, root, store), null, '--dry-run writes nothing');
    assert.ok(out.join('\n').includes('Would backfill'), `expected a dry-run report, got:\n${out.join('\n')}`);

    out.length = 0;
    await review([slug, '--backfill-review'], {
      log: (m: string) => out.push(m), error: (m: string) => out.push(m),
      backfillReviewFn: (target: string, worktree: string, options: any) => backfillReviewFromLegacyState(target, worktree, { ...options, missionStore: store }),
    });
    assert.ok(out.join('\n').includes('Backfilled review'), `expected a backfill report, got:\n${out.join('\n')}`);

    const state = await readReviewState(slug, root, store);
    assert.equal(state.round, 3);
    assert.equal(state.phase, 'fixing');
    assert.equal(state.disposition, 'BLOCKED');
  }, { seedReview: false });
});
