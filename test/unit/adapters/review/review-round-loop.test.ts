import { pollForReview } from '../../../../src/adapters/review/review-polling.js';
import { providerReviewObservation } from '../../../../src/adapters/review/review-provider-observations.js';
import { assessApprovalCoverage } from '../../../../src/domain/approval-coverage.js';
import { MissionStaleVersion } from '../../../../src/application/domain-ports.js';
import { createReviewObservationRecorder } from '../../../../src/adapters/review/review-observation-recording.js';
import { ReviewState, readReviewState, writeReviewState, assertReviewStatePersisted } from '../../../../src/adapters/review/review-state.js';
import { runReviewLoop } from '../../../../src/application/review-loop/review-loop.js';
import { fakeReviewLoopPorts } from '../../../helpers/review-loop-ports.js';
import { openReviewRound } from '../../../../src/adapters/review/review-round-open.js';
import { reviewFindingId } from '../../../../src/domain/review.js';

/**
 * The request-changes review contract over an injected MissionTransitionStore.
 *
 * Before this wiring the reviewer's verdict reached the review-event trail
 * only: the round kept `decision: null`, the Mission never left `review`
 * through `request-changes`, no implementer resolution was recorded, and the
 * next handoff resubmitted round 1 — which the workflow rejects with "A new
 * review round must advance the same pull request or local branch".
 */
import { fixtureMission, inMemoryTransitionStore } from '../../../fixtures/mission-builders.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MissionLifecycleService } from '../../../../src/application/mission-lifecycle-service.js';
import {
  parseReviewFindings,
  recordApproval,
  recordImplementerResolution,
  recordRequestedChanges,
} from '../../../../src/adapters/review/review-round.js';
import { applyReviewStateToReview, reviewStateDataFrom } from '../../../../src/adapters/review/review-state-mapping.js';
import { agentFamily } from '../../../../src/domain/agents.js';
import { missionId } from '../../../../src/domain/mission.js';
import {
  beginNextReviewRound,
  changeRevision,
  ConfiguredReviewerEligibility,
  currentReviewRound,
  reviewStatus,
  startReview,
} from '../../../../src/domain/review.js';

const MISSION = missionId('task-round-loop');
const CAPABILITIES = new Set(['mission:intake', 'mission:transition', 'checkpoint:record'] as const);
const reviewer = agentFamily('codex');
const implementer = agentFamily('custom');
const eligibility = ConfiguredReviewerEligibility.fromReviewStep({ eligible: [reviewer], strategy: 'random' });

const change = {
  kind: 'pull-request' as const,
  provider: 'forgejo',
  id: '305',
  url: 'http://localhost:3300/magnus/parallix/pulls/305',
  sourceBranch: 'mission/task-round-loop',
  targetBranch: 'main',
} satisfies import("../../../../src/domain/review.js").ReviewedChange;

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

  it("resolves the round so the next review preparation can submit round 2 on the same pull request", async () => {
    const { store, lifecycle } = await reviewInProgress();
    await recordRequestedChanges(MISSION, {
      findings: parseReviewFindings('## F1 (blocking): first\n## F2: second'),
      comment: null,
      decidedAt: '2026-08-16T13:51:30.650Z',
    }, { missionStore: store, lifecycleService: lifecycle });

    const resolved = await recordImplementerResolution(MISSION, {
      itemDispositions: [{ kind: 'pushed_back', findingId: reviewFindingId('F2') }],
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
    });
    assert.equal(submitted.status, 'completed', submitted.error?.message ?? '');

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
      itemDispositions: [{ kind: 'fixed', findingId: reviewFindingId('F1') }],
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
    await store.save({ ...loaded.mission, status: 'active', closedAt: null }, loaded.version);

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
    });
    assert.equal(resubmitted.status, 'completed', resubmitted.error?.message ?? '');
  });
});

it('workflow-rejected verdicts expose cause and supported recovery without clearing stops (px-0017)', async () => {
  const { pendingReview } = await import('../../../fixtures/mission-builders.js');
  const { recordApproval } = await import('../../../../src/adapters/review/review-round.js');
  const slug = 'stopped-verdict';
  const review = { ...pendingReview(slug), intervention: {
    reason: 'REVIEWER_LAUNCH_FAILURE', requestedAt: '2026-10-19T10:00:00Z', requestedBy: 'workflow' as const,
  } };
  const store = inMemoryTransitionStore(fixtureMission(slug, { status: 'review', review }));
  for (const outcome of [
    await recordApproval(slug, { comment: null, decidedAt: '2026-10-19T10:01:00Z' }, { missionStore: store }),
    await recordRequestedChanges(slug, { comment: null, findings: [], decidedAt: '2026-10-19T10:01:00Z' }, { missionStore: store }),
  ]) {
    assert.equal(outcome.outcome, 'failed');
    if (outcome.outcome !== 'failed') { assert.fail('must fail'); }
    assert.equal(outcome.workflowBlock?.cause, 'REVIEWER_LAUNCH_FAILURE');
    assert.match(outcome.workflowBlock?.nextAction ?? '', /px review stopped-verdict/);
  }
  assert.deepEqual(store.mission().review?.intervention, review.intervention);
});

it('approval rejects observations from a prior round or reset before writing (TASK-2821)', async () => {
  const startedAt = '2026-10-25T00:00:00Z';
  const review = startReview({ change, revision: changeRevision('review-head') }, reviewer, implementer, startedAt, eligibility);
  const store = inMemoryTransitionStore(fixtureMission(String(MISSION), { status: 'review', assignee: implementer, review }));
  const lifecycleService = new MissionLifecycleService(store);
  for (const observedRound of [{ number: 2, startedAt }, { number: 1, startedAt: '2026-10-24T00:00:00Z' }]) {
    const result = await recordApproval(String(MISSION), { comment: null, decidedAt: '2026-10-25T01:00:00Z', observedRound }, { missionStore: store, lifecycleService });
    assert.equal(result.outcome, 'failed');
    assert.equal(store.mission().status, 'review');
    assert.equal(currentReviewRound(store.mission().review!).decision, null);
    assert.equal(store.events.length, 0);
  }
});

it('observed approval retries one stale write and rechecks the round (TASK-2821 review P3)', async () => {
  for (const race of ['event', 'reset', 'always'] as const) {
    const { store } = await reviewInProgress();
    const snapshot = currentReviewRound(store.mission().review!);
    let attempts = 0;
    const racing = { ...store, save: async (...args: Parameters<typeof store.save>) => {
      attempts++;
      if (attempts === 1 || race === 'always') {
        const loaded = await store.load(MISSION);
        assert.equal(loaded.kind, 'found');
        const review = loaded.mission.review!;
        const rounds = race === 'reset' ? [{ ...review.rounds[0], startedAt: '2026-10-25T03:00:00Z' }] as const : review.rounds;
        const actual = await store.save({ ...loaded.mission, title: 'concurrent event', review: { ...review, rounds } }, loaded.version);
        throw new MissionStaleVersion(MISSION, args[1] ?? null, actual);
      }
      return store.save(...args);
    } };
    const recorder = createReviewObservationRecorder(String(MISSION), () => 'new-head', true, { missionStore: racing, lifecycleService: new MissionLifecycleService(racing) });
    const state = new ReviewState(String(MISSION), { round: snapshot.number, startedAt: snapshot.startedAt, phase: 'approved' });
    if (race === 'event') {
      await recorder.recordApproval(state, { disposition: 'APPROVED', revision: 'rev-1', decidedAt: '2026-08-16T14:00:00.000Z', comment: null });
      assert.equal(store.mission().status, 'integration');
      assert.equal(currentReviewRound(store.mission().review!).decision?.kind, 'approved');
      assert.equal(currentReviewRound(store.mission().review!).reviewerResults?.length, 1,
        'the conflict retry preserves one publication');
      assert.equal(store.mission().title, 'concurrent event');
      assert.equal(attempts, 2);
    } else {
      await assert.rejects(() => recorder.recordApproval(state, { disposition: 'APPROVED', revision: 'rev-1', decidedAt: '2026-08-16T14:00:00.000Z', comment: null }), /stale|Stale/);
      assert.equal(store.mission().status, 'review');
      assert.equal(currentReviewRound(store.mission().review!).decision, null);
      assert.equal(attempts, race === 'reset' ? 1 : 2);
    }
  }
});

it('polled changes and resolution advance through their owners to round two (TASK-2821 review P2)', async () => {
  for (const scenario of ['CHANGES_MADE', 'PUSHBACK_ALL', 'interrupted-request', 'human-mid-loop', 'human-ready-resume'] as const) {
    const disposition = scenario === 'PUSHBACK_ALL' ? scenario : 'CHANGES_MADE';
    const { store, lifecycle } = await reviewInProgress();
    let head = 'rev-1';
    let reviews = ['interrupted-request', 'human-ready-resume'].includes(scenario) ? 1 : 0;
    let fixes = 0;
    const decisionTime = '2026-08-16T14:00:00.000Z';
    const responseTime = '2026-08-16T15:00:00.000Z';
    if (scenario === 'interrupted-request') {
      const interrupted = await recordRequestedChanges(String(MISSION), {
        findings: parseReviewFindings('## F1: provider finding'), comment: '## F1: provider finding', revision: 'rev-1', decidedAt: decisionTime,
      }, { missionStore: store, lifecycleService: { transition: async () => ({ status: 'failed', error: { kind: 'execution', message: 'interrupted transition' }, durableEvidence: [] }) } });
      assert.equal(interrupted.outcome, 'failed');
      assert.equal(store.mission().status, 'review');
      assert.equal(currentReviewRound(store.mission().review!).decision?.kind, 'changes-requested');
    }
    if (scenario === 'human-ready-resume') {
      await recordRequestedChanges(String(MISSION), { findings: parseReviewFindings('## F1: provider finding'),
        comment: 'reviewer', revision: head, decidedAt: decisionTime }, { missionStore: store, lifecycleService: lifecycle });
      await recordImplementerResolution(String(MISSION), { resultingRevision: 'rev-2', itemDispositions: [], evidence: 'Provider fix evidence',
        respondedAt: responseTime }, { missionStore: store });
      head = 'rev-2'; fixes = 1;
    }
    const fake = fakeReviewLoopPorts({
      slug: String(MISSION), missionStore: store, lifecycle,
      reviewPreparation: scenario === 'human-ready-resume' ? { reviewPreparation: prepareReady } : null,
      stateport: {
        read: () => readReviewState(String(MISSION), undefined, store),
        persist: async state => { assertReviewStatePersisted(await writeReviewState(String(MISSION), state, fake.ports.worktree, { missionStore: store }), { slug: String(MISSION), round: state.round }); },
        ...createReviewObservationRecorder(String(MISSION), () => head, true, { missionStore: store, lifecycleService: lifecycle }),
        openRound: async state => (await openReviewRound(String(MISSION), state, { worktree: fake.ports.worktree, log: () => {}, error: message => { throw new Error(message); }, missionStore: store, lifecycleService: lifecycle })).ok,
      },
      provider: {
        openPullRequest: () => change,
        pollReview: async () => ++reviews === 1 ? 'REQUEST_CHANGES' : { disposition: 'APPROVED', revision: head, decidedAt: '2026-08-16T16:00:00.000Z', comment: 'Verified fix' },
        readRequestedChanges: async () => ({ disposition: 'REQUEST_CHANGES', findings: parseReviewFindings('## F1: provider finding'), comment: '## F1: provider finding', revision: 'rev-1', decidedAt: decisionTime }),
        pollDisposition: async (_agent, _since, request) => request.quick ? null : disposition,
        readResolution: async () => ({ disposition, itemDispositions: [], evidence: 'Provider fix evidence', respondedAt: responseTime }),
      },
      agents: { launch: async request => {
        assert.equal(store.mission().status, request.role === 'implementer' ? 'active' : 'review');
        if (request.role === 'implementer') { head = `rev-${++fixes + 1}`; }
        return { agent: request.agent, result: { status: null } };
      } },
      preReview: { head: () => head },
    });
    let acknowledged = false;
    const human = scenario.startsWith('human-');
    async function prepareReady(): Promise<{ ok: boolean }> {
      const state = (await readReviewState(String(MISSION), '/fixture', store))!;
      state.advanceRound();
      assert.equal((await openReviewRound(String(MISSION), state, { worktree: fake.ports.worktree,
        missionStore: store, lifecycleService: lifecycle, log: () => {}, error: message => { throw new Error(message); } })).ok, true);
      return { ok: true };
    }
    if (human) {
      fake.ports.humanFeedback.reconcile = async state => (state.round === 2 || scenario === 'human-ready-resume') && !acknowledged ? {
        source: 'forgejo:review:7', author: 'operator', state: 'current', disposition: 'REQUEST_CHANGES',
        approval: false, reason: 'mid-loop correction', findings: [{ id: 'human-review-7', summary: 'mid-loop correction' }],
      } : null;
      fake.ports.humanFeedback.acknowledge = async () => { acknowledged = true; };
    }
    await runReviewLoop({ slug: String(MISSION), isContinue: true, maxAttempts: human ? 3 : 2 }, fake.ports);
    if (human) {
      assert.equal(acknowledged, true, `${scenario}: ${[...fake.errors, ...fake.logs].join('\n')}`);
      assert.equal(store.mission().status, 'integration', fake.errors.join('\n'));
      assert.equal(store.mission().review!.rounds.length, 3);
      const decision = store.mission().review!.rounds[1].decision;
      assert.ok(decision?.kind === 'changes-requested');
      assert.deepEqual(decision.findings.map(f => f.id), ['human-review-7']);
      assert.deepEqual(fake.exits, [], fake.errors.join('\n'));
      assert.equal(store.events.filter(e => e.to === 'active').at(-1)?.agent, 'operator');
      continue;
    }
    assert.deepEqual(fake.exits, [], fake.errors.join('\n'));
    const mission = store.mission();
    assert.equal(mission.status, 'integration');
    assert.equal(mission.review?.rounds.length, 2);
    const first = mission.review!.rounds[0];
    assert.equal(first.decision?.kind, 'changes-requested');
    assert.equal(first.decision?.decidedAt, decisionTime);
    assert.equal(first.response?.respondedAt, responseTime);
    assert.equal(first.response?.resultingRevision, 'rev-2');
    assert.deepEqual(first.response?.resolutions, [disposition === 'CHANGES_MADE'
      ? { findingId: 'F1', kind: 'fixed', evidence: 'Provider fix evidence' }
      : { findingId: 'F1', kind: 'disputed', rationale: 'pushed_back: Provider fix evidence' }]);
    assert.deepEqual(store.events.map(event => [event.from, event.to]), [['review', 'active'], ['active', 'review'], ['review', 'integration']]);
  }
});

it('provider polling preserves the judged revision and submission time after HEAD moves (TASK-2821 review P4)', async () => {
  const { store, lifecycle } = await reviewInProgress();
  const decidedAt = '2026-08-16T14:00:00.000Z';
  const observed = { state: 'APPROVED', revision: 'rev-1', submittedAt: decidedAt, body: 'Reviewed A' };
  const recorder = createReviewObservationRecorder(String(MISSION), () => 'unreviewed-B', true, { missionStore: store, lifecycleService: lifecycle });
  const fake = fakeReviewLoopPorts({
    slug: String(MISSION), missionStore: store, lifecycle,
    state: await readReviewState(String(MISSION), '/fixture', store),
    stateport: recorder,
    provider: { openPullRequest: () => change, pollReview: async () => {
      const result = await pollForReview(305, 'codex', '2026-08-16T13:20:32.869Z', 'fixture-token', {
        getLatestReviewForPrFn: async () => observed, log: () => {},
      });
      return result && 'state' in result ? providerReviewObservation(result) : result;
    } },
    preReview: { head: () => 'unreviewed-B' },
  });
  await runReviewLoop({ slug: String(MISSION), isContinue: true, maxAttempts: 1 }, fake.ports);
  assert.deepEqual(fake.exits, [], fake.errors.join('\n'));
  const review = store.mission().review!;
  const decision = currentReviewRound(review).decision;
  assert.equal(decision?.revision, 'rev-1');
  assert.equal(decision?.decidedAt, decidedAt);
  assert.equal(decision?.comment, 'Reviewed A');
  assert.equal(assessApprovalCoverage(review, { landedRevision: changeRevision('unreviewed-B'), sameChange: false })?.kind, 'stale');
  await recorder.recordApproval(fake.current()!);
  assert.deepEqual(currentReviewRound(store.mission().review!).decision, decision, 'replay preserves the original provider judgment');
  assert.equal(store.events.length, 1);
});

it('provider approval never substitutes HEAD or the current time for missing evidence (TASK-2821 review P4)', async () => {
  const { store, lifecycle } = await reviewInProgress();
  const recorder = createReviewObservationRecorder(String(MISSION), () => 'unreviewed-B', true, { missionStore: store, lifecycleService: lifecycle });
  const state = (await readReviewState(String(MISSION), '/fixture', store))!;
  await assert.rejects(() => recorder.recordApproval(state), /observed revision and submission time/);
  assert.equal(currentReviewRound(store.mission().review!).decision, null);
  assert.throws(() => providerReviewObservation({ state: 'APPROVED', revision: 'rev-1', submittedAt: '', body: '' }), /submission time/);
  const missingRevision = providerReviewObservation({ state: 'APPROVED', revision: null, submittedAt: '2026-08-16T14:00:00.000Z', body: '' });
  assert.ok(missingRevision?.disposition === 'APPROVED');
  await recorder.recordApproval(state, missingRevision);
  const review = store.mission().review!;
  assert.equal(currentReviewRound(review).decision?.revision, null);
  assert.equal(assessApprovalCoverage(review, { landedRevision: changeRevision('unreviewed-B'), sameChange: false })?.kind, 'unverifiable');
});

it('persists operator findings alongside a pending reviewer decision before acknowledging (px-0020)', async () => {
  const { store, lifecycle } = await reviewInProgress();
  const recorder = createReviewObservationRecorder(String(MISSION), () => 'rev-2', true, { missionStore: store, lifecycleService: lifecycle });
  const state = (await readReviewState(String(MISSION), '/fixture', store))!;
  await recorder.recordRequestedChanges(state, { disposition: 'REQUEST_CHANGES', findings: parseReviewFindings('## F1: reviewer finding'),
    comment: 'reviewer', revision: 'rev-1', decidedAt: '2026-08-16T14:00:00Z' });
  await recorder.recordRequestedChanges(state, { disposition: 'REQUEST_CHANGES', source: { kind: 'operator', author: 'human' },
    findings: [{ id: reviewFindingId('human-review-7'), summary: 'operator correction', location: null }],
    comment: 'operator correction', revision: null, decidedAt: '2026-08-16T15:00:00Z' });
  const decision = currentReviewRound(store.mission().review!).decision;
  assert.equal(decision?.kind, 'changes-requested');
  if (decision?.kind !== 'changes-requested') { assert.fail('Missing decision'); }
  assert.deepEqual(decision.findings.map(f => f.id), ['F1', 'human-review-7']);
  assert.equal(decision.decidedAt, '2026-08-16T14:00:00Z', 'original reviewer attribution is preserved');
});

it('does not acknowledge a correction over a resolved round without opening a new round (px-0020)', async () => {
  const { store, lifecycle } = await reviewInProgress();
  await recordRequestedChanges(String(MISSION), { findings: parseReviewFindings('## F1: reviewer finding'), comment: 'reviewer',
    revision: 'rev-1', decidedAt: '2026-08-16T14:00:00Z' }, { missionStore: store, lifecycleService: lifecycle });
  await recordImplementerResolution(String(MISSION), { resultingRevision: 'rev-2', itemDispositions: [], evidence: 'fixed F1',
    respondedAt: '2026-08-16T15:00:00Z' }, { missionStore: store });
  const before = store.mission();
  const state = (await readReviewState(String(MISSION), '/fixture', store))!;
  const recorder = createReviewObservationRecorder(String(MISSION), () => 'rev-2', true, { missionStore: store, lifecycleService: lifecycle });
  await assert.rejects(recorder.recordRequestedChanges(state, { disposition: 'REQUEST_CHANGES', source: { kind: 'operator', author: 'human' },
    findings: [{ id: reviewFindingId('human-review-7'), summary: 'operator correction', location: null }],
    comment: 'operator correction', revision: null, decidedAt: '2026-08-16T16:00:00Z' }), /open the next review round/);
  assert.deepEqual(store.mission(), before);
});
