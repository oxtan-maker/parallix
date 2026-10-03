
/**
 * The request-changes review contract over an injected MissionTransitionStore.
 *
 * Before this wiring the reviewer's verdict reached the review-event trail
 * only: the round kept `decision: null`, the Mission never left `review`
 * through `request-changes`, no implementer resolution was recorded, and the
 * next handoff resubmitted round 1 — which the workflow rejects with "A new
 * review round must advance the same pull request or local branch".
 */
import { fixtureMission, inMemoryTransitionStore } from './fixtures/mission-builders.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MissionLifecycleService } from '../src/application/mission-lifecycle-service.js';
import {
  parseReviewFindings,
  recordImplementerResolution,
  recordRequestedChanges,
} from '../src/adapters/review/review-round.js';
import { applyReviewStateToReview, reviewStateDataFrom } from '../src/adapters/review/review-state-mapping.js';
import { agentFamily } from '../src/domain/agents.js';
import { missionId } from '../src/domain/mission.js';
import {
  beginNextReviewRound,
  changeRevision,
  ConfiguredReviewerEligibility,
  currentReviewRound,
  reviewStatus,
  startReview,
} from '../src/domain/review.js';

const MISSION = missionId('task-round-loop');
const CAPABILITIES = new Set(['mission:intake', 'mission:transition', 'checkpoint:record'] as const);
const reviewer = agentFamily('codex');
const implementer = agentFamily('custom');
const eligibility = ConfiguredReviewerEligibility.fromReviewStep({ eligible: [reviewer] } as never);

const change = {
  kind: 'pull-request' as const,
  provider: 'forgejo',
  id: '305',
  url: 'http://localhost:3300/magnus/parallix/pulls/305',
  sourceBranch: 'mission/task-round-loop',
  targetBranch: 'main',
};

async function reviewInProgress() {
  const store = inMemoryTransitionStore(fixtureMission('task-round-loop', {
    status: 'review', assignee: implementer,
    review: startReview(
      { change, revision: changeRevision('rev-1') }, reviewer, implementer,
      '2026-08-16T13:20:32.869Z', eligibility,
    ),
  }));
  return { store, lifecycle: new MissionLifecycleService(store) };
}

describe('review round advancement', () => {
  it('parses reviewer finding headings into domain findings', () => {
    const findings = parseReviewFindings([
      '# Review findings — task-2378, round 1',
      '',
      'Verdict: request-changes (2 findings).',
      '',
      '## F1 (blocking): `px stats` runs the import gate',
      'body text',
      '## F2: second problem',
      '## F1 (duplicate heading is ignored)',
    ].join('\n'));
    assert.deepEqual(findings.map((finding) => finding.id), ['F1', 'F2']);
    assert.equal(findings[0].summary, 'px stats runs the import gate');
  });

  it('records the reviewer decision and returns the mission to the implementer', async () => {
    const { store } = await reviewInProgress();
    const result = await recordRequestedChanges(MISSION, {
      findings: parseReviewFindings('## F1 (blocking): the import gate mutates the operator db'),
      comment: 'Outcome: request-changes',
      decidedAt: '2026-08-16T13:51:30.650Z',
    }, { missionStore: store, lifecycleService: new MissionLifecycleService(store) });
    assert.deepEqual(result, { outcome: 'recorded' });

    const loaded = await store.load(MISSION);
    assert.equal(loaded.kind, 'found');
    const round = currentReviewRound(loaded.mission.review!);
    assert.equal(round.decision?.kind, 'changes-requested');
    assert.equal(round.disposition, 'REQUEST_CHANGES');
    assert.equal(loaded.mission.status, 'active');
    assert.equal(reviewStatus(loaded.mission.review!), 'awaiting-implementation');

    // Replaying the same consumption is not a second decision.
    const replay = await recordRequestedChanges(MISSION, {
      findings: parseReviewFindings('## F1 (blocking): the import gate mutates the operator db'),
      comment: null,
      decidedAt: '2026-08-16T14:00:00.000Z',
    }, { missionStore: store, lifecycleService: new MissionLifecycleService(store) });
    assert.equal(replay.outcome, 'unchanged');
  });

  it('keeps the request-changes decidedAt when a flat writer re-persists the round', async () => {
    const { store } = await reviewInProgress();
    const decidedAt = '2026-08-16T13:51:30.650Z';
    await recordRequestedChanges(MISSION, {
      findings: parseReviewFindings('## F1 (blocking): the import gate mutates the operator db'),
      comment: 'Outcome: request-changes',
      decidedAt,
    }, { missionStore: store, lifecycleService: new MissionLifecycleService(store) });

    const loaded = await store.load(MISSION);
    assert.equal(loaded.kind, 'found');
    const review = loaded.mission.review!;
    const decidedRound = currentReviewRound(review);
    // The decision time is the reviewer's, not the round's start — otherwise
    // the aggregate skews away from the lane event that fired review -> active.
    assert.notEqual(decidedRound.startedAt, decidedAt);

    // A flat writer (legacy loop-state view) re-persisting the same round
    // must not rewrite the retained decision's time to the round start.
    const rePersisted = applyReviewStateToReview(review, reviewStateDataFrom(review));
    const round = currentReviewRound(rePersisted);
    assert.equal(round.decision?.kind, 'changes-requested');
    assert.equal(round.decision?.decidedAt, decidedAt);
  });

  it('resolves the round so the next handoff can submit round 2 on the same pull request', async () => {
    const { store, lifecycle } = await reviewInProgress();
    await recordRequestedChanges(MISSION, {
      findings: parseReviewFindings('## F1 (blocking): first\n## F2: second'),
      comment: null,
      decidedAt: '2026-08-16T13:51:30.650Z',
    }, { missionStore: store, lifecycleService: lifecycle });

    const resolved = await recordImplementerResolution(MISSION, {
      itemDispositions: [{ kind: 'pushed_back', findingId: 'F2' as never }],
      evidence: 'CHANGES_MADE — round summary',
      resultingRevision: 'rev-2',
      respondedAt: '2026-08-16T16:00:00.000Z',
    }, { missionStore: store });
    assert.deepEqual(resolved, { outcome: 'recorded' });

    const afterResolution = await store.load(MISSION);
    assert.equal(afterResolution.kind, 'found');
    assert.equal(reviewStatus(afterResolution.mission.review!), 'ready-for-next-round');
    assert.deepEqual(
      currentReviewRound(afterResolution.mission.review!).response?.resolutions.map((r) => r.kind),
      ['fixed', 'disputed'],
    );

    // This is what the handoff does on the next round.
    const nextRound = beginNextReviewRound(
      afterResolution.mission.review!,
      reviewer,
      implementer,
      '2026-08-16T16:05:00.000Z',
      eligibility,
    );
    const submitted = await lifecycle.transition({
      operationId: 'op-submit-2',
      missionId: MISSION,
      capabilities: CAPABILITIES,
      command: {
        type: 'submit-for-review',
        gatesPassed: true,
        review: nextRound,
        reviewerEligibility: eligibility,
      },
      actor: reviewer,
      occurredAt: '2026-08-16T16:05:00.000Z',
      idempotencyKey: 'submit-2',
    } as never);
    assert.equal(submitted.status, 'completed', submitted.error?.message);

    const afterSubmit = await store.load(MISSION);
    assert.equal(afterSubmit.kind, 'found');
    assert.equal(afterSubmit.mission.status, 'review');
    assert.equal(currentReviewRound(afterSubmit.mission.review!).number, 2);
    assert.deepEqual(currentReviewRound(afterSubmit.mission.review!).subject.change, change);
  });

  it('rejects an implementer resolution whose resulting revision is unchanged (TASK-2478 criterion 8)', async () => {
    const { store } = await reviewInProgress();
    await recordRequestedChanges(MISSION, {
      findings: parseReviewFindings('## F1 (blocking): the import gate mutates the operator db'),
      comment: null,
      decidedAt: '2026-08-16T13:51:30.650Z',
    }, { missionStore: store, lifecycleService: new MissionLifecycleService(store) });

    // The implementer reports CHANGES_MADE but the branch never moved: the
    // resulting revision is the round's own subject revision (rev-1), not a
    // new one. Recording it would flip the round to ready-for-next-round on
    // the unchanged tree, letting a later resume approve the finding.
    const unchanged = await recordImplementerResolution(MISSION, {
      itemDispositions: [{ kind: 'fixed', findingId: 'F1' as never }],
      evidence: 'CHANGES_MADE — round summary (no code change)',
      resultingRevision: 'rev-1',
      respondedAt: '2026-08-16T16:00:00.000Z',
    }, { missionStore: store });
    assert.equal(unchanged.outcome, 'unchanged');
    assert.equal(unchanged.noRevisionChange, true);

    const after = await store.load(MISSION);
    assert.equal(after.kind, 'found');
    assert.equal(reviewStatus(after.mission.review!), 'awaiting-implementation', 'the round stays awaiting-implementation, never advancing to a stale round 2');
    assert.equal(currentReviewRound(after.mission.review!).response, null, 'no resolution was recorded');
  });

  it('accepts a resubmission of the round the reviewer has not decided yet', async () => {
    const { store, lifecycle } = await reviewInProgress();
    // A relaunched handoff replays the transition against a mission that was
    // bounced back to active with its undecided round still recorded.
    const loaded = await store.load(MISSION);
    assert.equal(loaded.kind, 'found');
    await store.save({ ...loaded.mission, status: 'active' } as never, loaded.version);

    const resubmitted = await lifecycle.transition({
      operationId: 'op-resubmit',
      missionId: MISSION,
      capabilities: CAPABILITIES,
      command: {
        type: 'submit-for-review',
        gatesPassed: true,
        review: loaded.mission.review!,
        reviewerEligibility: eligibility,
      },
      actor: reviewer,
      occurredAt: '2026-08-16T15:00:00.000Z',
      idempotencyKey: 'resubmit',
    } as never);
    assert.equal(resubmitted.status, 'completed', resubmitted.error?.message);
  });
});
