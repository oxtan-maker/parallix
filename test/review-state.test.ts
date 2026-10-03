
import test from 'node:test';
import assert from 'node:assert/strict';

import { withMissionDatabase } from './fixtures/review-state-db.js';
import { reviewLoopBindings } from '../src/composition/review-persistence.js';
import { openMigratedMissionStore } from './fixtures/mission-sqlite-store.js';
import { fixtureMission } from './fixtures/mission-builders.js';
import { MissionLifecycleService } from '../src/application/mission-lifecycle-service.js';
import { agentFamily } from '../src/domain/agents.js';
import { missionId } from '../src/domain/mission.js';
import {
  beginNextReviewRound, changeRevision, ConfiguredReviewerEligibility,
  currentReviewRound, startReview,
} from '../src/domain/review.js';
import {
  parseReviewFindings, recordApproval, recordImplementerResolution, recordRequestedChanges,
} from '../src/adapters/review/review-round.js';
import {
  reviewStateFile,
  readReviewState,
  writeReviewState,
  resetReviewState,
} from '../src/adapters/review/review-state.js';

test('reviewStateFile returns null for unknown slug', () => {
  assert.equal(reviewStateFile('task-nonexistent-zzz'), null);
});

async function durableReviewFixture(slug: string) {
  const reviewer = agentFamily('codex');
  const implementer = agentFamily('claude');
  const eligibility = ConfiguredReviewerEligibility.fromReviewStep({ eligible: [reviewer], strategy: 'random' });
  const review = startReview(
    { change: { kind: 'local-branch', sourceBranch: `mission/${slug}`, targetBranch: 'main' }, revision: changeRevision('rev-1') },
    reviewer, implementer, '2026-08-21T07:00:00.000Z', eligibility,
  );
  const fixture = await openMigratedMissionStore([fixtureMission(slug, { status: 'review', assignee: implementer, review })]);
  return { ...fixture, reviewer, implementer, eligibility, lifecycle: new MissionLifecycleService(fixture.store) };
}

test('approval and its round idempotency key survive SQLite reopen (TASK-2398, TASK-2622.08)', async () => {
  const slug = 'durable-review-approval';
  const fixture = await durableReviewFixture(slug);
  try {
    const result = await recordApproval(slug, {
      comment: 'LGTM', decidedAt: '2026-08-21T08:00:00.000Z', source: { kind: 'local' },
    }, { missionStore: fixture.store, lifecycleService: fixture.lifecycle });
    assert.deepEqual(result, { outcome: 'recorded' });
    await fixture.database.close();
    await fixture.database.open({ path: `${fixture.root}/parallix.db` });
    const loaded = await fixture.store.load(missionId(slug));
    assert.equal(loaded.kind, 'found');
    if (loaded.kind !== 'found') throw new Error('Persisted approval is missing');
    assert.equal(loaded.mission.status, 'integration');
    assert.equal(currentReviewRound(loaded.mission.review!).decision?.kind, 'approved');
    assert.equal(currentReviewRound(loaded.mission.review!).decision?.decidedAt, '2026-08-21T08:00:00.000Z');
    const rows = await fixture.database.query<{ idempotency_key: string }>(
      'SELECT idempotency_key FROM board_lane_events WHERE mission_id = ?', [slug],
    );
    assert.ok(rows.some(row => row.idempotency_key === `approve:${slug}:round-1`));
    const replay = await recordApproval(slug, {
      comment: 'replay', decidedAt: '2026-08-21T09:00:00.000Z',
    }, { missionStore: fixture.store, lifecycleService: fixture.lifecycle });
    assert.equal(replay.outcome, 'unchanged');
    assert.equal((await fixture.laneEvents(slug)).length, 1, 'replay cannot duplicate the persisted lane event');
  } finally {
    await fixture.close();
  }
});

test('requested changes and resolution persist into a new round after SQLite reopen (TASK-2478, TASK-2622.08)', async () => {
  const slug = 'durable-review-rounds';
  const fixture = await durableReviewFixture(slug);
  try {
    assert.deepEqual(await recordRequestedChanges(slug, {
      findings: parseReviewFindings('## F1: first\n## F2: second'), comment: null,
      decidedAt: '2026-08-21T08:00:00.000Z',
    }, { missionStore: fixture.store, lifecycleService: fixture.lifecycle }), { outcome: 'recorded' });
    assert.deepEqual(await recordImplementerResolution(slug, {
      itemDispositions: [{ kind: 'pushed_back', findingId: 'F2' as never }],
      evidence: 'CHANGES_MADE', resultingRevision: 'rev-2', respondedAt: '2026-08-21T09:00:00.000Z',
    }, { missionStore: fixture.store }), { outcome: 'recorded' });
    const resolved = await fixture.store.load(missionId(slug));
    assert.equal(resolved.kind, 'found');
    if (resolved.kind !== 'found') throw new Error('Persisted resolution is missing');
    const next = beginNextReviewRound(resolved.mission.review!, fixture.reviewer, fixture.implementer,
      '2026-08-21T10:00:00.000Z', fixture.eligibility);
    await fixture.store.save({ ...resolved.mission, review: next }, resolved.version);
    await fixture.database.close();
    await fixture.database.open({ path: `${fixture.root}/parallix.db` });
    const loaded = await fixture.store.load(missionId(slug));
    assert.equal(loaded.kind, 'found');
    if (loaded.kind !== 'found') throw new Error('Persisted next round is missing');
    const [first, second] = loaded.mission.review!.rounds;
    assert.equal(first.decision?.kind, 'changes-requested');
    assert.equal(first.decision?.decidedAt, '2026-08-21T08:00:00.000Z');
    assert.deepEqual(first.response?.resolutions.map(resolution => resolution.kind), ['fixed', 'disputed']);
    assert.equal(second.number, 2);
    assert.equal(second.subject.revision, changeRevision('rev-2'));
    assert.equal(second.decision, null);
  } finally {
    await fixture.close();
  }
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
