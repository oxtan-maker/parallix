import test from 'node:test';
import assert from 'node:assert/strict';
import type { IdempotentOperationalHistoryRepository, OperationalHistoryEntry } from '../../../../src/application/ports/operation-history.js';
import { OperationalHistoryService } from '../../../../src/application/services/operational-history-service.js';
import { fixedVerificationNextAction, humanReviewDue } from '../../../../src/application/verification-policy/fixed-next-action.js';
import {
  REVIEW_ENTRY_PIN_EVENT,
  REVIEW_START_DECISION_EVENT,
  observePolicyReviewStart,
  observePolicyTestsStart,
  observeReviewStartDecision,
  reviewEntryPin,
  reviewStartDecision,
  reviewStartDecisionKey,
  selectPolicyAction,
} from '../../../../src/application/verification-policy/review-start-decision.js';
import type { ReviewStartDecision, ReviewStartDecisionInput, ReviewStartFailure,
  ReviewEntryPinInput, ReviewStartPolicyPorts } from '../../../../src/application/ports/verification-policy.js';
import { attentionAction, attentionReason } from '../../../../src/application/projections/board.js';
import { projectMissionCard, type MissionCard, type MissionOperationalFacts } from '../../../../src/application/projections/mission-board.js';
import type { GateState } from '../../../../src/application/projections/gate-observation.js';
import { missionVersion } from '../../../../src/application/domain-ports.js';
import { assertRecoveredIntegrationHandoff } from '../../../../src/application/integrate/recovery.js';
import { agentFamily } from '../../../../src/domain/agents.js';
import type { ApprovalCoverage } from '../../../../src/domain/approval-coverage.js';
import type { CheckpointData } from '../../../../src/domain/checkpoint.js';
import { MISSION_STATUSES, missionId, type Mission, type MissionStatus } from '../../../../src/domain/mission.js';
import { changeRevision, revokeApprovedDecision } from '../../../../src/domain/review.js';
import { REVIEW_PHASES, type ReviewPhase } from '../../../../src/domain/review-phase-policy.js';
import { repositoryId } from '../../../../src/domain/repository.js';
import { parsePolicyArtifact } from '../../../../src/application/verification-policy/policy-artifact.js';
import { approvedReview, fixtureMission } from '../../../fixtures/mission-builders.js';
import { repeatReview } from '../../../fixtures/repeat-review.js';
import { stubIntegrateWorkflowPorts } from '../../../helpers/stub-integrate-workflow-ports.js';
import { policyArtifactFixture, syntheticPolicyArtifactV2 } from './policy-artifact.fixture.js';
import { createPolicyArtifactLoader } from '../../../../src/adapters/config/verification-policy.js';
import { verificationHistoryRecord, type VerificationHistoryEntry } from '../../../../src/application/verification-policy/belief.js';
import type { IntegrationTestsState } from '../../../../src/application/verification-policy/history-adapter.js';

function reviewFor(phase: ReviewPhase, pending: boolean): NonNullable<Mission['review']> {
  const fixture = repeatReview(), current = fixture.rounds.at(-1)!;
  const approved = { kind: 'approved' as const, revision: current.subject.revision,
    decidedAt: '2026-11-17T10:00:00Z', comment: null, source: { kind: 'local' as const } };
  return { ...fixture, rounds: [{ ...current, phase, response: null,
    decision: pending ? approved : null,
    ...(pending ? { integrationRepairAssessment: { assessedAt: '2026-11-17T10:01:00Z',
      approvedRevision: current.subject.revision, candidateRevision: current.subject.revision,
      failedGate: 'unit', outcome: 'pending' as const, repair: { startedAt: '2026-11-17T10:00:30Z',
        cause: { kind: 'integration-gate-failure' as const, gate: 'unit' } } } } : {}) }] };
}

test('fixed next-action owner resolves every reachable state to action, wait, or typed handoff (TASK-2859.12)', () => {
  const decide = (status: MissionStatus, reviewPhase: ReviewPhase | null, pendingRepair: boolean,
    ownedAction = false, humanOnlyReason: string | null = null, reviewRequired = false) => fixedVerificationNextAction({
    status, reviewPhase, pendingRepair, reviewRequired, ownedAction, humanOnlyReason, humanIntervention: false,
  });
  const rows = [
    ['ordinary-active', decide('active', null, false).kind, 'agent-review'],
    ['active-with-undecided-round', decide('active', 'reviewing', false).kind, 'agent-review'],
    ['approved-but-repair-pending', decide('active', 'approved', true).kind, 'repair'],
    ['retained-gate-repair-precedes-rereview', decide('review', 'reviewing', true, false, null, true).kind, 'repair'],
    ['withdrawn-approval-needs-review', decide('review', 'reviewing', false, false, null, true).kind, 'agent-review'],
    ['review-awaiting-verdict', decide('review', 'reviewing', false).kind, 'agent-review'],
    ['review-fixing', decide('review', 'fixing', false).kind, 'repair'],
    ['live-review', decide('review', 'reviewing', false, true).kind, 'wait'],
    ['covered-integration', decide('integration', 'approved', false).kind, 'integration-handoff'],
    ['active-approved-still-needs-review-entry', decide('active', 'approved', false).kind, 'agent-review'],
    ['pending-approval-needs-agent-rereview', decide('review', 'pending-approval', false).kind, 'agent-review'],
    ['review-approved-reaches-human-handoff', decide('review', 'approved', false).kind, 'human-review'],
    ['operator-review-blocker', decide('review', 'pending-approval', false, false, 'operator').kind, 'human-handoff'],
  ] as const;
  for (const [name, actual, expected] of rows) { assert.equal(actual, expected, name); }

  const live = { operationId: 'op', phase: 'review', summary: 'working', agent: agentFamily('codex'),
    updatedAt: '2026-11-17T10:00:00Z', freshness: 'live' as const };
  type Coverage = 'none' | ApprovalCoverage['kind'];
  const coverage = (kind: Exclude<Coverage, 'none'>): ApprovalCoverage => kind === 'covers'
    ? { kind, round: 1, approvedRevision: changeRevision('a'.repeat(40)) }
    : kind === 'stale'
      ? { kind, round: 1, approvedRevision: changeRevision('a'.repeat(40)),
        landedRevision: changeRevision('b'.repeat(40)), recorded: null }
      : { kind, round: 1, approvedRevision: null, reason: 'unknown revision' };
  const card = (name: string, status: MissionStatus, phase: ReviewPhase | null, pending: boolean,
    check: GateState, approval: Coverage, facts: Partial<Pick<MissionOperationalFacts,
      'currentWork' | 'blockingReason' | 'blockerRequiresOperator'>> = {}) => {
    const review = phase || pending ? reviewFor(phase ?? 'reviewing', pending) : null;
    const aggregate = fixtureMission(`matrix-${name}`, { status, review });
    const subject = review?.rounds.at(-1)?.subject ?? null;
    return projectMissionCard(aggregate, {
      latestGate: check, currentWork: facts.currentWork ?? null,
      blockingReason: facts.blockingReason ?? null,
      ...(facts.blockerRequiresOperator === undefined ? {} : { blockerRequiresOperator: facts.blockerRequiresOperator }),
      flags: [], approvalCoverage: approval === 'none' ? null : coverage(approval),
      reviewApproval: approval === 'none' || !subject ? null : { subject, approvedAt: '2026-11-17T10:00:00Z' },
    });
  };
  const outcome = (candidate: MissionCard) => {
    const reason = attentionReason(candidate), action = attentionAction(candidate, reason);
    return reason.kind === 'none' ? 'wait'
      : reason.kind === 'human-review' && action === null ? 'handoff:human-review'
      : action ? `${action.kind === 'integrate:merge' || action.kind === 'manual' ? 'handoff' : 'action'}:${action.kind}` : 'unhandled';
  };
  const projectionRows: ReadonlyArray<{ name: string; status: MissionStatus; phase: ReviewPhase | null; pending: boolean;
    check: GateState; approval: Coverage; facts?: Parameters<typeof card>[6]; expected: string }> = [
    { name: 'ordinary-active', status: 'active', phase: null, pending: false, check: 'passed', approval: 'none', expected: 'action:active:execute' },
    { name: 'active-with-undecided-round', status: 'active', phase: 'reviewing', pending: false, check: 'passed', approval: 'none', expected: 'action:active:execute' },
    { name: 'approved-but-repair-pending', status: 'active', phase: 'approved', pending: true, check: 'failed', approval: 'covers', expected: 'action:active:execute' },
    { name: 'review-awaiting-verdict', status: 'review', phase: 'reviewing', pending: false, check: 'passed', approval: 'none', expected: 'action:review:submit' },
    { name: 'review-approved-awaits-human', status: 'review', phase: 'approved', pending: false, check: 'passed', approval: 'covers', expected: 'handoff:human-review' },
    { name: 'review-fixing', status: 'review', phase: 'fixing', pending: false, check: 'failed', approval: 'none', expected: 'action:active:execute' },
    { name: 'live-review', status: 'review', phase: 'reviewing', pending: false, check: 'running', approval: 'none', facts: { currentWork: live }, expected: 'wait' },
    { name: 'covered-integration', status: 'integration', phase: 'approved', pending: false, check: 'passed', approval: 'covers', expected: 'handoff:integrate:merge' },
    { name: 'stale-approval-integration', status: 'integration', phase: 'approved', pending: false, check: 'stale', approval: 'stale', expected: 'handoff:integrate:merge' },
    { name: 'unverifiable-approval-integration', status: 'integration', phase: 'approved', pending: false, check: 'unavailable', approval: 'unverifiable', expected: 'handoff:integrate:merge' },
    { name: 'operator-review-blocker', status: 'review', phase: 'pending-approval', pending: false, check: 'not-run', approval: 'none',
      facts: { blockingReason: 'Operator decision required', blockerRequiresOperator: true }, expected: 'handoff:manual' },
  ];
  for (const row of projectionRows) {
    assert.equal(outcome(card(row.name, row.status, row.phase, row.pending, row.check, row.approval, row.facts)), row.expected, row.name);
  }

  const checks: readonly GateState[] = ['unconfigured', 'not-run', 'running', 'passed', 'failed', 'stale', 'unavailable'];
  const approvals: readonly Coverage[] = ['none', 'covers', 'stale', 'unverifiable'];
  const phases = [null, ...REVIEW_PHASES] as const;
  let combinations = 0;
  for (const status of MISSION_STATUSES) for (const phase of phases) for (const pending of [false, true]) {
    if (pending && status !== 'active' && status !== 'review') { continue; }
    for (const check of checks) for (const approval of approvals) {
      const ownsVerification = status === 'active' || status === 'review' || status === 'integration';
      if (!ownsVerification && (phase !== null || pending || approval !== 'none')) { continue; }
      if (status === 'backlog' && check !== 'unconfigured' && check !== 'not-run') { continue; }
      if (status === 'done' && check !== 'passed') { continue; }
      combinations++;
      assert.notEqual(outcome(card(`${combinations}`, status, phase, pending, check, approval)), 'unhandled',
        `${status}/${phase ?? 'none'}/pending=${pending}/${check}/${approval}`);
    }
  }
  assert.equal(combinations, 710, 'the five-dimension reachable-state population stays explicit');
});

test('a policy selection or known-missing tests in the landing lane reach the tests action; unknown evidence never does (TASK-2859.14, TASK-2859.17)', () => {
  const decide = (status: MissionStatus, reviewPhase: ReviewPhase | null, extra: Partial<Parameters<typeof fixedVerificationNextAction>[0]> = {}) =>
    fixedVerificationNextAction({ status, reviewPhase, pendingRepair: false, reviewRequired: false, ownedAction: false,
      humanOnlyReason: null, humanIntervention: false, ...extra } as Parameters<typeof fixedVerificationNextAction>[0]);
  for (const status of MISSION_STATUSES) for (const reviewPhase of [null, ...REVIEW_PHASES]) {
    for (const pendingRepair of [false, true]) for (const reviewRequired of [false, true]) {
      for (const policySelection of [undefined, null] as const) for (const testsCurrent of [undefined, null, true] as const) {
        assert.notEqual(decide(status, reviewPhase, { pendingRepair, reviewRequired, policySelection, testsConfigured: true, testsCurrent }).kind, 'tests',
          `${status}/${reviewPhase ?? 'none'}/repair=${pendingRepair}/review=${reviewRequired}/selection=${policySelection}/current=${testsCurrent}`);
      }
    }
  }
  // The fixed sequence (decisions 5 and 7): only an approved candidate in the landing lane, with tests positively
  // known to be configured and not current, owes the tests action. Unknown, unconfigured and current stay a handoff.
  const handoff = { kind: 'integration-handoff', reason: 'fixed-sequence-complete' };
  for (const facts of [{}, { testsConfigured: null, testsCurrent: false }, { testsConfigured: false, testsCurrent: false },
    { testsConfigured: true, testsCurrent: null }, { testsConfigured: true, testsCurrent: true }] as const) {
    assert.deepEqual(decide('integration', 'approved', facts), handoff, JSON.stringify(facts));
  }
  assert.deepEqual(decide('integration', 'approved', { testsConfigured: true, testsCurrent: false }),
    { kind: 'tests', reason: 'tests-not-current' });
  assert.deepEqual(decide('integration', 'approved', { testsConfigured: true, testsCurrent: false, pendingRepair: true }),
    { kind: 'repair', reason: 'repair-pending' }, 'a pending repair precedes the fixed tests action');
  assert.deepEqual(decide('integration', 'approved', { testsConfigured: true, testsCurrent: false, ownedAction: true }),
    { kind: 'wait', reason: 'action-owned' });
  const selected = { policySelection: 'tests' as const };
  const rows = [
    ['review-undecided', decide('review', 'reviewing', selected), { kind: 'tests', reason: 'policy-selected' }],
    ['review-approved-before-human', decide('review', 'approved', selected), { kind: 'tests', reason: 'policy-selected' }],
    ['active-without-review', decide('active', null, selected), { kind: 'tests', reason: 'policy-selected' }],
    ['fixing-repairs-first', decide('review', 'fixing', selected), { kind: 'repair', reason: 'findings-pending' }],
    ['pending-repair-first', decide('active', 'approved', { ...selected, pendingRepair: true }), { kind: 'repair', reason: 'repair-pending' }],
    ['withdrawn-approval-reviews-first', decide('review', 'reviewing', { ...selected, reviewRequired: true }), { kind: 'agent-review', reason: 'review-unfinished' }],
    ['integration-lane-after-agent-approval-still-owes-selected-tests (PX-0074.01)', decide('integration', 'approved', selected), { kind: 'tests', reason: 'policy-selected' }],
    ['integration-lane-never-tests-while-fixing', decide('integration', 'fixing', selected), { kind: 'integration-handoff', reason: 'fixed-sequence-complete' }],
    ['owned-action-waits', decide('review', 'reviewing', { ...selected, ownedAction: true }), { kind: 'wait', reason: 'action-owned' }],
    ['blocker-hands-off', decide('review', 'reviewing', { ...selected, humanOnlyReason: 'operator' }), { kind: 'human-handoff', reason: 'recorded-blocker' }],
    ['escalation-hands-off', decide('active', null, { ...selected, humanIntervention: true }), { kind: 'human-handoff', reason: 'human-intervention' }],
    ['refined-not-verifying', decide('refined', null, selected), { kind: 'wait', reason: 'not-verifying' }],
  ] as const;
  for (const [name, actual, expected] of rows) { assert.deepEqual(actual, expected, name); }
  const mission = fixtureMission('task-selected-tests', { status: 'review', review: reviewFor('reviewing', false) });
  assert.deepEqual(fixedVerificationNextAction({ mission, policySelection: 'tests' }), { kind: 'tests', reason: 'policy-selected' });
  assert.deepEqual(fixedVerificationNextAction({ mission }), { kind: 'agent-review', reason: 'review-unfinished' });
});

test('fixed owner names only exact-current agent and tests evidence as integrate-shortcut eligible (TASK-2859.16)', () => {
  const mission = fixtureMission('task-integrate-shortcut', { status: 'review', review: approvedReview('task-integrate-shortcut') });
  assert.deepEqual(fixedVerificationNextAction({ mission, agentReviewCurrent: true, testsCurrent: true }),
    { kind: 'human-review', reason: 'integrate-shortcut-eligible' });
  for (const facts of [
    {}, { agentReviewCurrent: null, testsCurrent: null }, { agentReviewCurrent: true, testsCurrent: false },
    { agentReviewCurrent: false, testsCurrent: true },
  ]) {
    assert.deepEqual(fixedVerificationNextAction({ mission, ...facts }),
      { kind: 'human-review', reason: 'agent-review-approved' }, JSON.stringify(facts));
  }
  assert.deepEqual(fixedVerificationNextAction({ mission: { ...mission, status: 'integration', closedAt: null },
    agentReviewCurrent: true, testsCurrent: true }), { kind: 'integration-handoff', reason: 'fixed-sequence-complete' });
});

test('fixed owner limits historical repair debt to the lifecycle stage that can resume it (TASK-2859.12)', () => {
  const slug = 'task-covered-repair';
  const occurrence = { openedMissionRevision: 1, worktree: '/fixture', failureRevision: 'old', failureEvidenceId: 'failure' };
  const target: CheckpointData = { missionId: missionId(slug), name: 'CP-1', nextActionText: 'repair',
    goalCheck: [{ criterion: 'feature', evidence: 'feature.ts' }], repair: { incidentId: 'old', command: 'verify',
      authorizedGates: [], authorizedCriteria: [], attempt: 1, verified: false, evidenceRecorded: true, occurrence } };
  const source: CheckpointData = { ...target, name: 'CP-2',
    recording: { recordedAt: '2026-09-20T11:00:00Z', recordedRound: null, missionRevision: 2 },
    repair: { ...target.repair!, incidentId: 'new', verified: true,
      exactSuccessCoverage: { producer: 'harness-exact-check', missionId: missionId(slug), worktree: '/fixture', command: 'verify',
        authorizedGates: [], authorizedCriteria: [], executionRevision: 'candidate', executionMissionRevision: 2,
        checkpointEvidenceRevision: 2, verifiedMissionRevision: 3,
        execution: { id: 'receipt', producer: 'rebound-exact-verifier', exitCode: 0,
          startedAt: '2026-09-20T11:00:00Z', completedAt: '2026-09-20T11:01:00Z' },
        verifiedOccurrence: { ...occurrence, checkpoint: 'CP-2', incidentId: 'new', attempt: 1 },
        coveredOccurrences: [{ ...occurrence, checkpoint: 'CP-1', incidentId: 'old', attempt: 1 }] } } };
  const mission = fixtureMission(slug, { status: 'integration', checkpoints: [target, source] });
  assert.deepEqual(fixedVerificationNextAction({ mission }),
    { kind: 'integration-handoff', reason: 'fixed-sequence-complete' });
  const ports = stubIntegrateWorkflowPorts({ landing: { createAbort: () => new Error('integration aborted') } });
  assert.doesNotThrow(() => assertRecoveredIntegrationHandoff(
    { kind: 'found', mission, version: missionVersion(3) }, ports.landing, slug));

  const historical: CheckpointData = { ...target, name: 'CP-legacy',
    repair: { ...target.repair!, incidentId: 'legacy', command: 'review-preparation', occurrence: undefined } };
  const legacyMission = fixtureMission('task-legacy-workflow-repair', { status: 'integration', checkpoints: [historical] });
  assert.deepEqual(fixedVerificationNextAction({ mission: legacyMission }),
    { kind: 'integration-handoff', reason: 'fixed-sequence-complete' });
  const legacyCard = projectMissionCard(legacyMission, { latestGate: 'passed', reviewApproval: null,
    currentWork: null, blockingReason: null, flags: [] });
  assert.equal(legacyCard.verificationFacts.pendingRepair, false, 'board and workflow consume the same repair fact');
  assert.equal(attentionAction(legacyCard, attentionReason(legacyCard))?.kind, 'integrate:merge');
  assert.doesNotThrow(() => assertRecoveredIntegrationHandoff(
    { kind: 'found', mission: legacyMission, version: missionVersion(1) }, ports.landing, 'task-legacy-workflow-repair'));

  const reviewed = fixtureMission('task-reviewed-gate-repair', {
    status: 'review', review: approvedReview('task-reviewed-gate-repair'),
    checkpoints: [{ ...target, missionId: missionId('task-reviewed-gate-repair') }],
  });
  assert.deepEqual(fixedVerificationNextAction({ mission: reviewed }),
    { kind: 'human-review', reason: 'agent-review-approved' }, 'historical gate debt cannot override approved review');
  const integrating = fixtureMission('task-reviewed-gate-repair', {
    status: 'integration', review: reviewed.review, checkpoints: reviewed.checkpoints,
  });
  assert.deepEqual(fixedVerificationNextAction({ mission: integrating }),
    { kind: 'integration-handoff', reason: 'fixed-sequence-complete' }, 'historical gate debt cannot override integration');
  assert.doesNotThrow(() => assertRecoveredIntegrationHandoff(
    { kind: 'found', mission: integrating, version: missionVersion(1) }, ports.landing, 'task-reviewed-gate-repair'));

  const preparation = fixtureMission('task-preparation-gate-repair', { status: 'review', review: reviewFor('reviewing', false),
    reviewPreparationPending: true, checkpoints: [{ ...target, missionId: missionId('task-preparation-gate-repair') }] });
  assert.deepEqual(fixedVerificationNextAction({ mission: preparation }), { kind: 'repair', reason: 'repair-pending' });
  const preparationCard = projectMissionCard(preparation, { latestGate: 'failed', reviewApproval: null,
    currentWork: null, blockingReason: null, flags: [] });
  assert.equal(attentionAction(preparationCard, attentionReason(preparationCard))?.kind, 'review:submit',
    'review preparation owns retained gate recovery when active execution is ineligible');

  const approved = reviewFor('approved', true);
  const withdrawn = revokeApprovedDecision(approved, approved.rounds.at(-1)!.number, {
    revokedAt: '2026-09-20T11:00:00Z', revokedBy: 'workflow', reason: 'gate repair changed the revision',
    cause: { kind: 'integration-gate-failure', gate: 'unit' },
  });
  assert.deepEqual(fixedVerificationNextAction({ mission: fixtureMission('task-rereview-with-history', {
    status: 'review', review: withdrawn, checkpoints: [historical],
  }) }), { kind: 'agent-review', reason: 'review-unfinished' }, 'workflow repair history cannot skip required re-review');

  const blocked = { ...historical, name: 'CP-blocked', repair: { ...historical.repair!, blocker: {
    command: 'review-preparation', diagnostic: 'operator contract conflict', authorityReason: 'operator decision required',
    proposedCorrection: 'choose the contract',
  } } } satisfies CheckpointData;
  assert.deepEqual(fixedVerificationNextAction({ mission: fixtureMission('task-blocked-repair', {
    status: 'integration', checkpoints: [historical, blocked],
  }) }), { kind: 'human-handoff', reason: 'recorded-blocker' }, 'any recorded blocker outranks repair history');
});

function decision(overrides: Partial<ReviewStartDecisionInput> = {}): ReviewStartDecisionInput {
  return {
    missionId: missionId('task-2859.09'),
    repositoryId: repositoryId('repository-1'),
    changeIdentity: 'patch-123',
    configuredMode: 'shadow',
    effectiveMode: 'shadow',
    artifactSha256: 'artifact-hash',
    recommendedAction: 'tests',
    predictedPassProbability: { agent: 0.7, human: 0.6, tests: 0.5 },
    actualAction: 'agent',
    operatorOverride: true,
    verdictCorrelation: 'review:round-2',
    agentRunId: 'run-reviewer',
    gateRunId: null,
    operationId: 'operation-9',
    failureReason: null,
    ...overrides,
  };
}

function historyRepository() {
  const entries: OperationalHistoryEntry[] = [];
  const keys = new Set<string>();
  const repository = {
    findAll: async () => entries,
    findByType: async type => entries.filter(entry => entry.eventType === type),
    findByTypeForMission: async (type, mission) => entries.filter(entry => entry.eventType === type
      && (JSON.parse(entry.eventData) as { missionId?: string }).missionId === mission),
    append: async entry => { entries.push(entry); },
    appendIdempotent: async (entry, key) => {
      if (keys.has(key)) { return false; }
      keys.add(key); entries.push(entry); return true;
    },
    clear: async () => { entries.length = 0; keys.clear(); },
  } satisfies IdempotentOperationalHistoryRepository;
  return { entries, repository };
}

function assignment(mission: string, overrides: Partial<ReviewEntryPinInput> = {}): ReviewEntryPinInput {
  return {
    missionId: missionId(mission), repositoryId: repositoryId('repository-1'), changeIdentity: `patch-${mission}`,
    configuredMode: 'pilot', artifactSha256: 'pinned-hash', failureReason: null,
    ...overrides,
  };
}

test('OperationalHistoryService pins each pilot mission once under concurrent entry, with no arms (TASK-2859.19)', async () => {
  const { entries, repository } = historyRepository();
  const services = Array.from({ length: 5 }, () => new OperationalHistoryService(repository));
  const pinned = await Promise.all(services.map((service, index) =>
    service.resolveReviewEntryPin(assignment(`task-entry-${index + 1}`))));
  assert.deepEqual(pinned.map(row => row?.missionId), [1, 2, 3, 4, 5].map(index => `task-entry-${index}`));
  for (const row of pinned) {
    assert.equal(row?.artifactSha256, 'pinned-hash', 'every pilot mission records the pinned artifact hash');
    assert.equal('arm' in (row ?? {}), false, 'no arm or sentinel assignment exists');
  }
  const racing = await Promise.all(services.map(service =>
    service.resolveReviewEntryPin(assignment('task-racing', { changeIdentity: 'patch-racing' }))));
  assert.equal(new Set(racing.map(row => row?.idempotencyKey)).size, 1, 'competing entries adopt one pin');
  const replayed = await new OperationalHistoryService(repository)
    .resolveReviewEntryPin(assignment('task-entry-1', { changeIdentity: 'replacement-patch' }));
  assert.equal(replayed?.changeIdentity, 'patch-task-entry-1');
  assert.equal(entries.filter(entry => entry.eventType === REVIEW_ENTRY_PIN_EVENT
    && (JSON.parse(entry.eventData) as { missionId: string }).missionId === 'task-entry-1').length, 1);
});

test('pilot pin identity is repository-scoped (TASK-2859.19)', async () => {
  const { entries, repository } = historyRepository();
  const service = new OperationalHistoryService(repository);
  const first = await service.resolveReviewEntryPin(assignment('task-shared'));
  const second = await service.resolveReviewEntryPin(assignment('task-shared', {
    repositoryId: repositoryId('repository-2'),
  }));
  assert.equal(entries.filter(entry => entry.eventType === REVIEW_ENTRY_PIN_EVENT).length, 2);
  assert.notEqual(first?.idempotencyKey, second?.idempotencyKey);
});

test('review-start decision keeps every identity and unknown explicit (TASK-2859.09)', () => {
  const record = reviewStartDecision(decision({
    artifactSha256: null,
    recommendedAction: null,
    predictedPassProbability: { agent: null, human: null, tests: null },
    agentRunId: null,
    operationId: null,
    failureReason: { kind: 'artifact-missing', message: 'configured artifact is absent' },
  }), 3, true);
  assert.deepEqual(record, {
    schemaVersion: 1,
    idempotencyKey: 'review-start:task-2859.09:patch-123:3',
    missionId: 'task-2859.09', repositoryId: 'repository-1', changeIdentity: 'patch-123',
    configuredMode: 'shadow', effectiveMode: 'shadow', artifactSha256: null,
    recommendedAction: null, predictedPassProbability: { agent: null, human: null, tests: null },
    actualAction: 'agent', operatorOverride: true, verdictCorrelation: 'review:round-2',
    agentRunId: null, gateRunId: null, operationId: null, actionSequence: 3, sameRevisionRerun: true,
    failureReason: { kind: 'artifact-missing', message: 'configured artifact is absent' },
    recordedAt: record.recordedAt,
  });
  assert.equal(Number.isNaN(Date.parse(record.recordedAt)), false);
});
test('review-start key is derived only from mission, change and sequence (TASK-2859.09)', () => {
  const input = decision();
  assert.equal(reviewStartDecisionKey({ ...input, actionSequence: 3 }), reviewStartDecisionKey({
    missionId: input.missionId, changeIdentity: input.changeIdentity, actionSequence: 3,
  }));
  assert.throws(() => reviewStartDecisionKey({ ...input, actionSequence: 0 }),
    /positive safe integer/);
});

test('OperationalHistoryService appends one review-start row across restart replay (TASK-2859.09)', async () => {
  const { entries, repository } = historyRepository();
  const firstProcess = new OperationalHistoryService(repository);
  const restartedProcess = new OperationalHistoryService(repository);
  const input = decision();
  assert.equal(await firstProcess.recordReviewStartDecision(input), true);
  assert.equal(await restartedProcess.recordReviewStartDecision(input), false);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.eventType, REVIEW_START_DECISION_EVENT);
  const stored = JSON.parse(entries[0]!.eventData) as ReviewStartDecision;
  const expected = reviewStartDecision(input, 1, false);
  assert.deepEqual({ ...stored, recordedAt: undefined }, { ...expected, recordedAt: undefined });
  assert.equal(Number.isNaN(Date.parse(stored.recordedAt)), false);
});

test('OperationalHistoryService deduplicates agent replay without a run id (TASK-2859.10 F1)', async () => {
  const { entries, repository } = historyRepository();
  const input = decision({ agentRunId: null });
  assert.equal(await new OperationalHistoryService(repository).recordReviewStartDecision(input), true);
  assert.equal(await new OperationalHistoryService(repository).recordReviewStartDecision(input), false);
  assert.equal(entries.length, 1);
});

test('OperationalHistoryService sequences distinct same-round run identities (TASK-2859.09 F10)', async () => {
  const { entries, repository } = historyRepository();
  const service = new OperationalHistoryService(repository);
  const first = decision({ agentRunId: 'claude-run-1', verdictCorrelation: 'review:1:agent:claude-verdict' });
  const replacement = decision({ agentRunId: 'qwen-run-1', verdictCorrelation: 'review:1:agent:qwen-verdict' });
  assert.equal(await service.recordReviewStartDecision(first), true);
  assert.equal(await service.recordReviewStartDecision(replacement), true);
  assert.equal(await new OperationalHistoryService(repository).recordReviewStartDecision(replacement), false);
  assert.deepEqual(entries.map(entry => {
    const row = JSON.parse(entry.eventData) as ReviewStartDecision;
    return [row.actionSequence, row.agentRunId, row.idempotencyKey];
  }), [
    [1, 'claude-run-1', 'review-start:task-2859.09:patch-123:1'],
    [2, 'qwen-run-1', 'review-start:task-2859.09:patch-123:2'],
  ]);
});

test('OperationalHistoryService deduplicates tests actions by gate run and shares the action sequence (TASK-2859.10)', async () => {
  const { entries, repository } = historyRepository();
  const service = new OperationalHistoryService(repository);
  const review = decision({ agentRunId: 'review-run', verdictCorrelation: 'review:1' });
  const tests = decision({ actualAction: 'tests', agentRunId: null, gateRunId: 'gate-run-1',
    verdictCorrelation: 'gate-run-1', operatorOverride: false });
  const rerun = { ...tests, gateRunId: 'gate-run-2', verdictCorrelation: 'gate-run-2' };
  assert.equal(await service.recordReviewStartDecision(review), true);
  assert.equal(await service.recordReviewStartDecision(tests), true);
  assert.equal(await new OperationalHistoryService(repository).recordReviewStartDecision(tests), false);
  assert.equal(await service.recordReviewStartDecision(rerun), true);
  assert.deepEqual(entries.map(entry => {
    const row = JSON.parse(entry.eventData) as ReviewStartDecision;
    return [row.actionSequence, row.actualAction, row.gateRunId];
  }), [[1, 'agent', null], [2, 'tests', 'gate-run-1'], [3, 'tests', 'gate-run-2']]);
});

test('review-start observation isolates policy, writer and timeout failures (TASK-2859.09)', async () => {
  const failures: ReviewStartFailure[] = [];
  const reports = (failure: ReviewStartFailure) => { failures.push(failure); };
  const writer = { recordReviewStartDecision: async () => { throw new Error('database unavailable'); } };
  assert.equal(await observeReviewStartDecision(async () => { throw new Error('policy exploded'); }, writer, reports), 'failed');
  assert.equal(failures.shift()?.kind, 'policy-exception');
  assert.equal(await observeReviewStartDecision(async () => decision(), writer, reports), 'failed');
  assert.equal(failures.shift()?.kind, 'writer-failure');
  assert.equal(await observeReviewStartDecision(async () => await new Promise<never>(() => {}), writer, reports,
    { deadlineMs: 5 }), 'timed-out');
  assert.equal(failures.shift()?.kind, 'observation-timeout');
  assert.equal(await observeReviewStartDecision(async () => { throw new Error('policy exploded'); }, writer,
    () => { throw new Error('diagnostic output failed'); }), 'failed');
});

const parsed = parsePolicyArtifact(policyArtifactFixture());
if (!parsed.ok) { throw new Error(parsed.rejection.message); }
const parsedArtifact = parsed.artifact;

const policyHistory = (entries: readonly VerificationHistoryEntry[] = [], tests: IntegrationTestsState = 'unobserved') =>
  ({ ok: true as const, entries, record: verificationHistoryRecord(entries), tests });

function policyPorts(overrides: Partial<ReviewStartPolicyPorts> = {}) {
  const records: ReviewStartDecisionInput[] = [];
  const failures: ReviewStartFailure[] = [];
  const ports: ReviewStartPolicyPorts = {
    configuration: { mode: 'shadow', artifact: 'policy.json' },
    repositoryId: repositoryId('repository-1'), targetBranch: 'main', operationId: 'operation-9',
    loadPolicy: () => ({ mode: 'shadow', hash: 'pinned-hash', artifact: parsedArtifact }),
    readHistory: async () => policyHistory(),
    identity: { branchHead: () => 'abc1234', changeIdentity: () => 'patch-123', onlyBookkeepingSince: () => false },
    writer: {
      recordReviewStartDecision: async input => { records.push(input); return true; },
      resolveReviewEntryPin: async input => input.configuredMode === 'pilot'
        ? reviewEntryPin(input)
        : null,
      settleReviewStartOutcomes: async () => 0,
    },
    readOutcomeFacts: async () => ({ review: null, runs: [] }),
    diagnostic: failure => { failures.push(failure); },
    ...overrides,
  };
  return { ports, records, failures };
}

function startFacts(overrides: Partial<Parameters<typeof observePolicyReviewStart>[0]> = {}) {
  return {
    missionId: missionId('task-2859.09'), actualAction: 'agent' as const, revision: 'abc1234',
    verdictCorrelation: 'review:1:agent-verdict', agentRunId: 'run-1',
    operatorInvocation: true, ...overrides,
  };
}

test('shadow and pilot evaluate recommendations, probabilities, overrides and switch changes (TASK-2859.09)', async () => {
  const shadow = policyPorts();
  assert.equal(await observePolicyReviewStart(startFacts(), shadow.ports), 'recorded');
  assert.equal(shadow.records[0]?.configuredMode, 'shadow');
  assert.equal(shadow.records[0]?.effectiveMode, 'shadow');
  assert.equal(shadow.records[0]?.recommendedAction, 'human');
  assert.deepEqual(shadow.records[0]?.predictedPassProbability, { tests: 1, agent: 1, human: 1 });
  assert.equal(shadow.records[0]?.operatorOverride, true);
  assert.equal(shadow.records[0]?.artifactSha256, 'pinned-hash');

  const pilot = policyPorts({ configuration: { mode: 'pilot', artifact: 'policy.json' } });
  assert.equal(await observePolicyReviewStart(startFacts({ actualAction: 'human', agentRunId: null }), pilot.ports), 'recorded');
  assert.equal(pilot.records[0]?.configuredMode, 'pilot');
  assert.equal(pilot.records[0]?.effectiveMode, 'fixed', 'a human turn before agent approval falls back to the fixed policy');
  assert.equal(pilot.records[0]?.failureReason?.kind, 'human-turn-unavailable');
  assert.equal(pilot.records[0]?.recommendedAction, null);

  const approved = policyPorts({ configuration: { mode: 'pilot', artifact: 'policy.json' },
    readHistory: async () => policyHistory([{ kind: 'verdict', check: 'agent', passed: true }]) });
  assert.equal(await observePolicyReviewStart(startFacts({ actualAction: 'human', agentRunId: null }), approved.ports), 'recorded');
  assert.equal(approved.records[0]?.effectiveMode, 'pilot');
  assert.equal(approved.records[0]?.operatorOverride, false);
  assert.notEqual(approved.records[0]?.recommendedAction, 'agent', 'a passed check is never recommended on the same change');

  const automated = policyPorts();
  assert.equal(await observePolicyReviewStart(startFacts({ operatorInvocation: false }), automated.ports), 'recorded');
  assert.equal(automated.records[0]?.operatorOverride, false, 'workflow automation is not an operator override');
});

test('tests action records the full linked row and preserves unknown policy values (TASK-2859.10)', async () => {
  const linked = policyPorts();
  assert.equal(await observePolicyTestsStart({ missionId: missionId('task-2859.10'), actualAction: 'tests',
    revision: 'abc1234', verdictCorrelation: 'gate-run-42', agentRunId: null, gateRunId: 'gate-run-42',
    operatorInvocation: true }, linked.ports), 'recorded');
  assert.deepEqual(linked.records[0], {
    missionId: 'task-2859.10', repositoryId: 'repository-1', changeIdentity: 'patch-123',
    configuredMode: 'shadow', effectiveMode: 'shadow', artifactSha256: 'pinned-hash',
    recommendedAction: 'human', predictedPassProbability: { tests: 1, agent: 1, human: 1 },
    actualAction: 'tests', operatorOverride: true, verdictCorrelation: 'gate-run-42',
    agentRunId: null, gateRunId: 'gate-run-42', operationId: 'operation-9', failureReason: null,
  });

  const missing = policyPorts({ loadPolicy: () => ({ mode: 'fixed', reason: 'missing' }),
    identity: { branchHead: () => null, changeIdentity: () => null, onlyBookkeepingSince: () => false } });
  assert.equal(await observePolicyTestsStart({ missionId: missionId('task-2859.10'), actualAction: 'tests',
    revision: '', verdictCorrelation: 'gate-run-unknown', agentRunId: null, gateRunId: 'gate-run-unknown',
    operatorInvocation: false }, missing.ports), 'recorded');
  assert.equal(missing.records[0]?.changeIdentity, null);
  assert.equal(missing.records[0]?.artifactSha256, null);
  assert.deepEqual(missing.records[0]?.predictedPassProbability, { agent: null, human: null, tests: null });
  assert.equal(missing.records[0]?.failureReason?.kind, 'artifact-missing');
});

test('artifact and history failures record typed fixed-policy decisions (TASK-2859.09)', async () => {
  const artifactReasons = ['missing', 'invalid', 'hash-mismatch', 'unreadable'] as const;
  for (const reason of artifactReasons) {
    const fixture = policyPorts({ loadPolicy: () => ({ mode: 'fixed', reason }) });
    assert.equal(await observePolicyReviewStart(startFacts(), fixture.ports), 'recorded');
    assert.equal(fixture.records[0]?.effectiveMode, 'fixed');
    assert.equal(fixture.records[0]?.failureReason?.kind, `artifact-${reason}`);
    assert.equal(fixture.failures[0]?.kind, `artifact-${reason}`);
  }
  for (const kind of ['unavailable', 'invalid', 'contradiction', 'unmodelled-history'] as const) {
    const fixture = policyPorts({ readHistory: async () => ({ ok: false, failure: { kind, message: kind } }) });
    assert.equal(await observePolicyReviewStart(startFacts(), fixture.ports), 'recorded');
    assert.equal(fixture.records[0]?.failureReason?.kind,
      `history-${kind}`);
  }
});

test('a synthetic v2 artifact is observed in shadow and each invalid one falls back without throwing (TASK-2867.01)', async () => {
  const loaded = (artifact: unknown, mode: 'shadow' | 'pilot' = 'shadow') => policyPorts({ configuration: { mode, artifact: 'policy.json' },
    loadPolicy: createPolicyArtifactLoader('/repo', { mode, artifact: 'policy.json' }, () => JSON.stringify(artifact)) });
  const valid = loaded(syntheticPolicyArtifactV2());
  assert.equal(await observePolicyReviewStart(startFacts(), valid.ports), 'recorded');
  assert.equal(valid.records[0]?.effectiveMode, 'shadow');
  assert.equal(valid.records[0]?.recommendedAction, 'tests');
  assert.equal(valid.records[0]?.failureReason, null);
  assert.match(valid.records[0]?.artifactSha256 ?? '', /^[0-9a-f]{64}$/);
  const pilot = loaded(syntheticPolicyArtifactV2(), 'pilot');
  assert.equal((await selectPolicyAction(SELECTION_FACTS, pilot.ports)).action, 'tests');

  const invalid = {
    'dimension mismatch': (a: Record<string, any>) => { a.transition.tests.pop(); },
    'bad action names': (a: Record<string, any>) => { a.actions[6] = 'deploy'; },
    'bad hash': (a: Record<string, any>) => { a.parameterHash = 'not-a-digest'; },
    'bad rule check': (a: Record<string, any>) => { a.ruleCheck.violatingMissions = 4; },
  };
  const rejections = new Set<string>();
  for (const [name, change] of Object.entries(invalid)) {
    const artifact = syntheticPolicyArtifactV2(); change(artifact);
    const fixture = loaded(artifact);
    const result = fixture.ports.loadPolicy();
    assert.ok(result.mode === 'fixed' && result.reason === 'invalid' && result.rejection, name);
    rejections.add(result.rejection.code);
    assert.equal(await observePolicyReviewStart(startFacts(), fixture.ports), 'recorded', name);
    assert.deepEqual([fixture.records[0]?.effectiveMode, fixture.records[0]?.failureReason?.kind, fixture.records[0]?.recommendedAction,
      fixture.records[0]?.artifactSha256], ['fixed', 'artifact-invalid', null, null], name);
    const selection = await selectPolicyAction(SELECTION_FACTS, loaded(artifact, 'pilot').ports);
    assert.equal(selection.action, null, name);
  }
  assert.equal(rejections.size, Object.keys(invalid).length, 'each invalid class carries its own typed rejection');
});

test('a timed-out evaluation still lands a typed observation-timeout row with unknowns left unknown (TASK-2859.19)', async () => {
  const slow = policyPorts({ readHistory: () => new Promise<never>(() => {}) });
  assert.equal(await observePolicyReviewStart(startFacts(), slow.ports), 'recorded');
  assert.equal(slow.records[0]?.failureReason?.kind, 'observation-timeout');
  assert.equal(slow.records[0]?.changeIdentity, null);
  assert.equal(slow.records[0]?.effectiveMode, 'fixed');
  assert.deepEqual(slow.records[0]?.predictedPassProbability, { agent: null, human: null, tests: null });
});

test('artifact action presence permits a failed test re-run independently of the flake parameter (TASK-2867.05)', async () => {
  const flakyLoader = createPolicyArtifactLoader('/repo', { mode: 'shadow', artifact: 'policy.json' },
    () => JSON.stringify(syntheticPolicyArtifactV2(undefined, undefined, 0.25)));
  const pending = policyPorts({ loadPolicy: flakyLoader, readHistory: async () =>
    policyHistory([{ kind: 'verdict', check: 'tests', passed: false }], 'passed') });
  assert.equal(await observePolicyReviewStart(startFacts(), pending.ports), 'recorded');
  assert.equal(pending.records[0]?.failureReason, null);
  assert.equal(pending.records[0]?.recommendedAction, 'tests');

  const rerunPassed = policyPorts({ loadPolicy: flakyLoader, readHistory: async () => policyHistory([
    { kind: 'verdict', check: 'tests', passed: false },
    { kind: 'verdict', check: 'tests', passed: true },
  ], 'passed') });
  assert.equal(await observePolicyReviewStart(startFacts(), rerunPassed.ports), 'recorded');
  assert.equal(rerunPassed.records[0]?.failureReason, null);
  assert.notEqual(rerunPassed.records[0]?.recommendedAction, 'tests');

  const zeroFlake = policyPorts({ loadPolicy: createPolicyArtifactLoader('/repo',
    { mode: 'shadow', artifact: 'policy.json' }, () => JSON.stringify(syntheticPolicyArtifactV2())),
  readHistory: async () => policyHistory([{ kind: 'verdict', check: 'tests', passed: false }], 'passed') });
  assert.equal(await observePolicyReviewStart(startFacts(), zeroFlake.ports), 'recorded');
  assert.equal(zeroFlake.records[0]?.failureReason, null);
  assert.equal(zeroFlake.records[0]?.effectiveMode, 'shadow');
  assert.equal(zeroFlake.records[0]?.recommendedAction, 'tests');
  assert.equal(zeroFlake.records[0]?.predictedPassProbability.tests, 0);

  const missingAction = syntheticPolicyArtifactV2(undefined, undefined, 0.25);
  missingAction.vectors = missingAction.vectors.filter((vector: Record<string, unknown>) => vector.action !== 'tests');
  const absent = policyPorts({ loadPolicy: createPolicyArtifactLoader('/repo',
    { mode: 'shadow', artifact: 'policy.json' }, () => JSON.stringify(missingAction)),
  readHistory: async () => policyHistory([{ kind: 'verdict', check: 'tests', passed: false }], 'failed') });
  assert.equal(await observePolicyReviewStart(startFacts(), absent.ports), 'recorded');
  assert.equal(absent.records[0]?.failureReason?.kind, 'no-recommendation');
  assert.equal(absent.records[0]?.recommendedAction, null, 'an artifact without the re-run vector keeps repair in charge');

  const complete = policyPorts({ readHistory: async () => policyHistory([
    { kind: 'verdict', check: 'tests', passed: true },
    { kind: 'verdict', check: 'agent', passed: true },
    { kind: 'verdict', check: 'human', passed: true },
  ], 'passed') });
  assert.equal(await observePolicyReviewStart(startFacts(), complete.ports), 'recorded');
  assert.equal(complete.records[0]?.failureReason?.kind, 'no-recommendation');
  assert.equal(complete.records[0]?.effectiveMode, 'shadow');
});

const SELECTION_FACTS = { missionId: missionId('task-select'), revision: 'abc1234' };
const pilotConfiguration = { mode: 'pilot', artifact: 'policy.json' } as const;

test('only pilot selects, and shadow or off do no policy work (TASK-2859.19)', async () => {
  let work = 0;
  const counting = { readHistory: async () => { work++; return policyHistory(); },
    loadPolicy: () => { work++; return { mode: 'shadow' as const, hash: 'pinned-hash', artifact: parsedArtifact }; } };
  const shadow = policyPorts({ ...counting });
  assert.equal((await selectPolicyAction(SELECTION_FACTS, shadow.ports)).action, null);
  assert.equal(work, 0, 'shadow never evaluates a selection');
  assert.deepEqual(shadow.records, []);
});

test('the pilot recommends only an unfinished check, never one that passed on the same change (TASK-2859.19)', async () => {
  const checks = ['agent', 'human', 'tests'] as const;
  const selections: string[] = [];
  for (let mask = 0; mask < 8; mask++) {
    const passed = checks.filter((_check, index) => mask & (1 << index));
    const fixture = policyPorts({ configuration: pilotConfiguration, readHistory: async () =>
      policyHistory(passed.map(check => ({ kind: 'verdict' as const, check, passed: true })), 'passed') });
    const selected = (await selectPolicyAction(SELECTION_FACTS, { ...fixture.ports, writer: { ...fixture.ports.writer,
      resolveReviewEntryPin: async input => reviewEntryPin({ ...input, artifactSha256: 'pinned-hash' }) } })).action;
    if (passed.length === checks.length) {
      assert.equal(selected, null, 'nothing is left to recommend once all three passed');
      assert.equal(fixture.failures[0]?.kind, 'no-recommendation');
    } else if (selected !== null) {
      assert.equal(passed.includes(selected), false, `${selected} already passed`);
      selections.push(selected);
    }
  }
  assert.ok(selections.length > 0, 'the fixture policy selected at least one check');
});

test('every unusable policy conclusion leaves the fixed policy in charge with a typed reason (TASK-2859.19)', async () => {
  const cases: Array<[string, Partial<ReviewStartPolicyPorts>]> = [
    ['artifact-missing', { loadPolicy: () => ({ mode: 'fixed', reason: 'missing' }) }],
    ['artifact-invalid', { loadPolicy: () => ({ mode: 'fixed', reason: 'invalid' }) }],
    ['artifact-hash-mismatch', { loadPolicy: () => ({ mode: 'fixed', reason: 'hash-mismatch' }) }],
    ['history-unavailable', { readHistory: async () => ({ ok: false, failure: { kind: 'unavailable', message: 'gone' } }) }],
    ['history-contradiction', { readHistory: async () => ({ ok: false, failure: { kind: 'contradiction', message: 'x' } }) }],
    ['history-unmodelled-history', { readHistory: async () => ({ ok: false, failure: { kind: 'unmodelled-history', message: 'x' } }) }],
    ['belief-unmodelled-history', { readHistory: async () => policyHistory([{ kind: 'verdict', check: 'agent', passed: false }], 'passed') }],
    ['policy-exception', { readHistory: async () => { throw new Error('boom'); } }],
    ['human-turn-unavailable', {}],
  ];
  for (const [kind, overrides] of cases) {
    const fixture = policyPorts({ configuration: pilotConfiguration, ...overrides });
    assert.equal((await selectPolicyAction(SELECTION_FACTS, fixture.ports)).action, null, kind);
    assert.equal(fixture.failures[0]?.kind, kind, kind);
  }
  const contradiction = policyPorts({ configuration: pilotConfiguration, readHistory: async () => policyHistory([
    { kind: 'verdict', check: 'agent', passed: true }, { kind: 'verdict', check: 'agent', passed: false }], 'passed') });
  assert.equal((await selectPolicyAction(SELECTION_FACTS, contradiction.ports)).action, null, 'a contradictory verdict is a bug detector, not a recommendation');
  assert.ok(contradiction.failures.length > 0);
  const slow = policyPorts({ configuration: pilotConfiguration, readHistory: () => new Promise<never>(() => {}) });
  assert.equal((await selectPolicyAction(SELECTION_FACTS, slow.ports)).action, null);
  assert.equal(slow.failures.at(-1)?.kind, 'observation-timeout');
});

test('a transient selection failure is carried to the action-start record instead of a re-derived reason (TASK-2859.19)', async () => {
  const slow = policyPorts({ configuration: pilotConfiguration, readHistory: () => new Promise<never>(() => {}) });
  const selection = await selectPolicyAction(SELECTION_FACTS, slow.ports);
  assert.equal(selection.failure?.kind, 'observation-timeout');
  const healthy = policyPorts({ configuration: pilotConfiguration });
  assert.equal(await observePolicyReviewStart(startFacts({ selectionFailure: selection.failure }), healthy.ports), 'recorded');
  assert.equal(healthy.records[0]?.failureReason?.kind, 'observation-timeout', 'the record names the failure the selection met');
  assert.equal(healthy.records[0]?.artifactSha256, 'pinned-hash', 'the pinned artifact hash is kept on a carried fallback');
  assert.equal(healthy.records[0]?.changeIdentity, 'patch-123', 'the change identity is kept too');
  assert.equal(healthy.records[0]?.effectiveMode, 'fixed');
  assert.equal(healthy.records[0]?.recommendedAction, null);

  const brokenPin = policyPorts({ configuration: pilotConfiguration, writer: {
    recordReviewStartDecision: async () => true, resolveReviewEntryPin: async () => { throw new Error('pin writer down'); },
    settleReviewStartOutcomes: async () => 0 } });
  const pinSelection = await selectPolicyAction({ ...SELECTION_FACTS }, brokenPin.ports);
  assert.equal(pinSelection.failure?.kind, 'writer-failure');
  const deterministic = await selectPolicyAction(SELECTION_FACTS, policyPorts({ configuration: pilotConfiguration }).ports);
  assert.equal(deterministic.failure, null, 'a failure the start record re-derives identically is not carried');
});

test('pilot pin survives restart, artifact replacement and switch changes (TASK-2859.19)', async () => {
  const { entries, repository } = historyRepository();
  const first = policyPorts({
    configuration: { mode: 'pilot', artifact: 'policy.json' },
    writer: new OperationalHistoryService(repository),
  });
  assert.equal(await observePolicyReviewStart(startFacts({ missionId: missionId('task-pinned') }), first.ports), 'recorded');
  const assignmentRow = entries.find(entry => entry.eventType === REVIEW_ENTRY_PIN_EVENT);
  assert.ok(assignmentRow);
  assert.deepEqual(JSON.parse(assignmentRow.eventData), {
    schemaVersion: 1, idempotencyKey: 'review-entry:repository-1:task-pinned:patch-123:1',
    missionId: 'task-pinned', repositoryId: 'repository-1',
    changeIdentity: 'patch-123', configuredMode: 'pilot', actionSequence: 1,
    artifactSha256: 'pinned-hash', failureReason: null,
    recordedAt: JSON.parse(assignmentRow.eventData).recordedAt,
  });

  const expectedHashes: Array<string | undefined> = [];
  const restarted = policyPorts({
    configuration: { mode: 'pilot', artifact: 'replacement.json' },
    writer: new OperationalHistoryService(repository),
    loadPolicy: expected => {
      expectedHashes.push(expected);
      return expected === 'pinned-hash'
        ? { mode: 'fixed', reason: 'hash-mismatch' }
        : { mode: 'shadow', hash: 'replacement-hash', artifact: parsedArtifact };
    },
  });
  assert.equal(await observePolicyReviewStart(startFacts({ missionId: missionId('task-pinned'),
    actualAction: 'human', agentRunId: null, verdictCorrelation: 'review:1:human' }), restarted.ports), 'recorded');
  assert.deepEqual(expectedHashes, [undefined, 'pinned-hash'], 'the pin is resolved first, then the pinned hash is loaded');
  const decisions = entries.filter(entry => entry.eventType === REVIEW_START_DECISION_EVENT)
    .map(entry => JSON.parse(entry.eventData) as ReviewStartDecision);
  assert.equal(decisions.at(-1)?.effectiveMode, 'fixed');
  assert.equal(decisions.at(-1)?.artifactSha256, 'pinned-hash');
  assert.equal(decisions.at(-1)?.failureReason?.kind, 'artifact-hash-mismatch');
  assert.equal(entries.filter(entry => entry.eventType === REVIEW_ENTRY_PIN_EVENT).length, 1);
});

test('a pilot-pinned mission finishes fixed with a recorded reason when the mode changes (TASK-2859.19)', async () => {
  const { entries, repository } = historyRepository();
  const service = new OperationalHistoryService(repository);
  await service.resolveReviewEntryPin(assignment('task-pinned-pilot'));
  let historyReads = 0;
  const switchedToShadow = policyPorts({
    configuration: { mode: 'shadow', artifact: 'policy.json' }, writer: new OperationalHistoryService(repository),
    readHistory: async () => { historyReads++; return policyHistory(); },
  });
  assert.equal(await observePolicyReviewStart(startFacts({ missionId: missionId('task-pinned-pilot') }), switchedToShadow.ports), 'recorded');
  assert.equal(historyReads, 0, 'a mission pinned under pilot does not evaluate policy history after the mode changed');
  const decisions = () => entries.filter(entry => entry.eventType === REVIEW_START_DECISION_EVENT)
    .map(entry => JSON.parse(entry.eventData) as ReviewStartDecision);
  assert.equal(decisions().at(-1)?.effectiveMode, 'fixed');
  assert.equal(decisions().at(-1)?.artifactSha256, 'pinned-hash');
  assert.equal(decisions().at(-1)?.failureReason?.kind, 'mode-changed-in-flight');

  await service.recordReviewStartDecision(decision({ missionId: missionId('task-before-pilot') }));
  const switchedOn = policyPorts({
    configuration: { mode: 'pilot', artifact: 'policy.json' }, writer: new OperationalHistoryService(repository),
  });
  assert.equal(await observePolicyReviewStart(startFacts({ missionId: missionId('task-before-pilot'),
    actualAction: 'human', agentRunId: null, verdictCorrelation: 'review:1:human' }), switchedOn.ports), 'recorded');
  assert.equal(decisions().at(-1)?.effectiveMode, 'fixed');
  assert.equal(decisions().at(-1)?.failureReason?.kind, 'mode-changed-in-flight');
  assert.equal(entries.filter(entry => entry.eventType === REVIEW_ENTRY_PIN_EVENT
    && (JSON.parse(entry.eventData) as { missionId: string }).missionId === 'task-before-pilot').length, 0);
});

test('a pilot mission whose first pin write failed is pinned at the next evaluation, not demoted (TASK-2859.19 F13)', async () => {
  const { entries, repository } = historyRepository();
  const real = new OperationalHistoryService(repository);
  let failures = 1;
  const flaky = { recordReviewStartDecision: (input: ReviewStartDecisionInput) => real.recordReviewStartDecision(input),
    resolveReviewEntryPin: async (input: ReviewEntryPinInput) => {
      if (failures-- > 0) { throw new Error('pin writer down'); }
      return await real.resolveReviewEntryPin(input);
    },
    settleReviewStartOutcomes: async () => 0 };
  const fixture = policyPorts({ configuration: pilotConfiguration, writer: flaky });
  const facts = { missionId: missionId('task-flaky-pin'), revision: 'abc1234' };
  const first = await selectPolicyAction(facts, fixture.ports);
  assert.equal(first.failure?.kind, 'writer-failure');
  const second = await selectPolicyAction(facts, fixture.ports);
  assert.equal(second.failure, null, 'the retry pinned the mission and the policy evaluated normally');
  assert.equal(entries.filter(entry => entry.eventType === REVIEW_ENTRY_PIN_EVENT).length, 1);
});

test('pilot pin writer failure records a fixed fallback instead of stalling (TASK-2859.19)', async () => {
  const records: ReviewStartDecisionInput[] = [];
  const fixture = policyPorts({ configuration: { mode: 'pilot', artifact: 'policy.json' }, writer: {
    resolveReviewEntryPin: async () => { throw new Error('pin writer unavailable'); },
    recordReviewStartDecision: async input => { records.push(input); return true; },
    settleReviewStartOutcomes: async () => 0,
  } });
  assert.equal(await observePolicyReviewStart(startFacts({ missionId: missionId('task-contended') }), fixture.ports),
    'recorded');
  assert.equal(records[0]?.effectiveMode, 'fixed');
  assert.equal(records[0]?.failureReason?.kind, 'writer-failure');
  assert.equal(records[0]?.failureReason?.message, 'pin writer unavailable');
});

test('pilot entry and evaluation failures persist fixed reasons without unknown coercion (TASK-2859.18)', async () => {
  for (const reason of ['missing', 'invalid'] as const) {
    const { entries, repository } = historyRepository();
    const fixture = policyPorts({
      configuration: { mode: 'pilot', artifact: 'policy.json' }, writer: new OperationalHistoryService(repository),
      loadPolicy: () => ({ mode: 'fixed', reason }),
    });
    assert.equal(await observePolicyReviewStart(startFacts({ missionId: missionId(`task-${reason}`) }), fixture.ports), 'recorded');
    const assignmentRecord = entries.find(entry => entry.eventType === REVIEW_ENTRY_PIN_EVENT);
    assert.ok(assignmentRecord);
    assert.equal((JSON.parse(assignmentRecord.eventData) as { failureReason: ReviewStartFailure }).failureReason.kind,
      `artifact-${reason}`);
    const recorded = entries.find(entry => entry.eventType === REVIEW_START_DECISION_EVENT);
    assert.ok(recorded);
    const row = JSON.parse(recorded.eventData) as ReviewStartDecision;
    assert.equal(row.effectiveMode, 'fixed');
    assert.equal(row.failureReason?.kind, `artifact-${reason}`);
    assert.deepEqual(row.predictedPassProbability, { agent: null, human: null, tests: null });
  }

  const { entries, repository } = historyRepository();
  const failed = policyPorts({
    configuration: { mode: 'pilot', artifact: 'policy.json' }, writer: new OperationalHistoryService(repository),
    readHistory: async () => { throw new Error('evaluation failed'); },
  });
  assert.equal(await observePolicyReviewStart(startFacts({ missionId: missionId('task-evaluation-failed') }), failed.ports), 'recorded');
  const failedDecision = entries.filter(entry => entry.eventType === REVIEW_START_DECISION_EVENT)
    .map(entry => JSON.parse(entry.eventData) as ReviewStartDecision).at(-1);
  assert.equal(failedDecision?.effectiveMode, 'fixed');
  assert.equal(failedDecision?.failureReason?.kind, 'policy-exception');
  assert.equal(failedDecision?.artifactSha256, 'pinned-hash');
});

test('a writer that outlives the deadline gets no second, contradictory decision row (TASK-2859.19 F14)', async () => {
  assert.equal(await observeReviewStartDecision(async () => decision(), { recordReviewStartDecision: () => new Promise<boolean>(() => {}) },
    () => {}, { deadlineMs: 5 }), 'write-timed-out');
  const writes: ReviewStartDecisionInput[] = [];
  const slow = policyPorts({ writer: { resolveReviewEntryPin: async () => null, settleReviewStartOutcomes: async () => 0,
    recordReviewStartDecision: async input => { writes.push(input); await new Promise(resolve => setTimeout(resolve, 280)); return true; } } });
  assert.equal(await observePolicyReviewStart(startFacts(), slow.ports), 'write-timed-out');
  assert.equal(writes.length, 1, 'the original write is the only one; it keeps its known change identity');
  assert.equal(writes[0]?.changeIdentity, 'patch-123');
});

// The next-action owner's answer for each lane a passing order passes through (PX-0074.02). The six orders
// themselves are driven through persisted transitions in the review-loop contract suite; this suite owns only the
// pure decision: given a recorded lane, round phase and the exact-current facts, which single action follows, and
// which of them projects a human-review wait.
test('each lane a passing order passes through yields one next action, and only a human turn is an explicit wait (PX-0074.02)', () => {
  const slug = 'task-passing-orders';
  type Step = readonly [lane: string, mission: Mission, facts: Partial<Parameters<typeof fixedVerificationNextAction>[0]>, expected: string];
  const reviewing = fixtureMission(slug, { status: 'review', review: reviewFor('reviewing', false) });
  const agentApproved = fixtureMission(slug, { status: 'review', review: approvedReview(slug) });
  const landing = { ...agentApproved, status: 'integration' as const, closedAt: null };
  const selected = { policySelection: 'tests' as const };
  const testsOwed = { testsConfigured: true, testsCurrent: false };
  const lanes: readonly Step[] = [
    ['review/reviewing', reviewing, {}, 'agent-review'],
    ['review/reviewing tests selected', reviewing, selected, 'tests:policy-selected'],
    ['review/approved', agentApproved, {}, 'human-review:agent-review-approved'],
    ['review/approved tests selected', agentApproved, selected, 'tests:policy-selected'],
    ['review/approved tests passed', agentApproved, { agentReviewCurrent: true, testsCurrent: true }, 'human-review:integrate-shortcut-eligible'],
    ['integration/approved', landing, {}, 'integration-handoff'],
    ['integration/approved tests owed', landing, testsOwed, 'tests:tests-not-current'],
    ['integration/approved tests passed', landing, { testsConfigured: true, testsCurrent: true }, 'integration-handoff'],
  ];
  const label = (action: ReturnType<typeof fixedVerificationNextAction>) => `${action.kind}${action.kind === 'agent-review' ? '' : `:${action.reason}`}`.replace(/^(agent-review|integration-handoff):.*/, '$1');
  for (const [lane, mission, facts, expected] of lanes) {
    const action = fixedVerificationNextAction({ mission, ...facts });
    assert.equal(label(action), expected, `${lane}`);
    // Only the human turn projects a due review; every other next action is automatic work or a plain wait.
    assert.equal(humanReviewDue(action) !== null, action.kind === 'human-review', `${lane}: human-review-due projection`);
  }
  // After the human verdict the round decision stands: no agent review is owed again on the same change, whatever the evidence says.
  for (const testsConfigured of [undefined, null, true, false] as const) for (const testsCurrent of [undefined, null, true, false] as const) {
    for (const agentReviewCurrent of [undefined, null, true, false] as const) {
      assert.notEqual(fixedVerificationNextAction({ mission: landing, testsConfigured, testsCurrent, agentReviewCurrent }).kind, 'agent-review',
        `integration/approved ${testsConfigured}/${testsCurrent}/${agentReviewCurrent}`);
    }
  }
  // The wait is explicit and idle: a human turn names its reason and an owned or escalated state dispatches nothing automatic.
  assert.deepEqual(humanReviewDue(fixedVerificationNextAction({ mission: agentApproved })),
    { reason: 'agent-review-approved', detail: 'Human review is due because agent review approved the current change.' });
  const escalated = fixtureMission(slug, { status: 'review', review: { ...repeatReview(), intervention: { requestedAt: '2026-11-19T10:00:00Z', requestedBy: 'reviewer', reason: 'needs a human' } } });
  assert.deepEqual(fixedVerificationNextAction({ mission: escalated }), { kind: 'human-handoff', reason: 'human-intervention' });
  assert.equal(humanReviewDue(fixedVerificationNextAction({ mission: escalated })), null, 'an escalation is a handoff, not a human-review-due turn');
});
