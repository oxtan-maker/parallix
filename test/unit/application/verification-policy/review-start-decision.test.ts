import test from 'node:test';
import assert from 'node:assert/strict';
import type { IdempotentOperationalHistoryRepository, OperationalHistoryEntry } from '../../../../src/application/ports/operation-history.js';
import { OperationalHistoryService } from '../../../../src/application/services/operational-history-service.js';
import {
  REVIEW_START_DECISION_EVENT,
  fixedVerificationNextAction,
  observePolicyReviewStart,
  observePolicyTestsStart,
  observeReviewStartDecision,
  reviewStartDecision,
  reviewStartDecisionKey,
} from '../../../../src/application/verification-policy/review-start-decision.js';
import type { ReviewStartDecision, ReviewStartDecisionInput, ReviewStartFailure,
  ReviewStartPolicyPorts } from '../../../../src/application/ports/verification-policy.js';
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
import { policyArtifactFixture } from './policy-artifact.fixture.js';

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

test('only a policy selection reaches the tests action; the fixed sequence never does (TASK-2859.14)', () => {
  const decide = (status: MissionStatus, reviewPhase: ReviewPhase | null, extra: Partial<Parameters<typeof fixedVerificationNextAction>[0]> = {}) =>
    fixedVerificationNextAction({ status, reviewPhase, pendingRepair: false, reviewRequired: false, ownedAction: false,
      humanOnlyReason: null, humanIntervention: false, ...extra } as Parameters<typeof fixedVerificationNextAction>[0]);
  for (const status of MISSION_STATUSES) for (const reviewPhase of [null, ...REVIEW_PHASES]) {
    for (const pendingRepair of [false, true]) for (const reviewRequired of [false, true]) {
      for (const policySelection of [undefined, null] as const) {
        assert.notEqual(decide(status, reviewPhase, { pendingRepair, reviewRequired, policySelection }).kind, 'tests',
          `${status}/${reviewPhase ?? 'none'}/repair=${pendingRepair}/review=${reviewRequired}/selection=${policySelection}`);
      }
    }
  }
  const selected = { policySelection: 'tests' as const };
  const rows = [
    ['review-undecided', decide('review', 'reviewing', selected), { kind: 'tests', reason: 'policy-selected' }],
    ['review-approved-before-human', decide('review', 'approved', selected), { kind: 'tests', reason: 'policy-selected' }],
    ['active-without-review', decide('active', null, selected), { kind: 'tests', reason: 'policy-selected' }],
    ['fixing-repairs-first', decide('review', 'fixing', selected), { kind: 'repair', reason: 'findings-pending' }],
    ['pending-repair-first', decide('active', 'approved', { ...selected, pendingRepair: true }), { kind: 'repair', reason: 'repair-pending' }],
    ['withdrawn-approval-reviews-first', decide('review', 'reviewing', { ...selected, reviewRequired: true }), { kind: 'agent-review', reason: 'review-unfinished' }],
    ['integration-lane-is-landing', decide('integration', 'approved', selected), { kind: 'integration-handoff', reason: 'fixed-sequence-complete' }],
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

test('review-start decision keeps every identity and unknown explicit (TASK-2859.09)', () => {
  const record = reviewStartDecision(decision({
    artifactSha256: null,
    recommendedAction: null,
    predictedPassProbability: { agent: null, human: null, tests: null },
    agentRunId: null,
    operationId: null,
    failureReason: { kind: 'artifact-missing', message: 'configured artifact is absent' },
  }), 3);
  assert.deepEqual(record, {
    schemaVersion: 1,
    idempotencyKey: 'review-start:task-2859.09:patch-123:3',
    missionId: 'task-2859.09', repositoryId: 'repository-1', changeIdentity: 'patch-123',
    configuredMode: 'shadow', effectiveMode: 'shadow', artifactSha256: null,
    recommendedAction: null, predictedPassProbability: { agent: null, human: null, tests: null },
    actualAction: 'agent', operatorOverride: true, verdictCorrelation: 'review:round-2',
    agentRunId: null, gateRunId: null, operationId: null, actionSequence: 3,
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
  const expected = reviewStartDecision(input, 1);
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

function policyPorts(overrides: Partial<ReviewStartPolicyPorts> = {}) {
  const records: ReviewStartDecisionInput[] = [];
  const failures: ReviewStartFailure[] = [];
  const ports: ReviewStartPolicyPorts = {
    configuration: { mode: 'shadow', artifact: 'policy.json' },
    repositoryId: repositoryId('repository-1'), targetBranch: 'main', operationId: 'operation-9',
    loadPolicy: () => ({ mode: 'shadow', hash: 'pinned-hash', artifact: parsedArtifact }),
    readHistory: async () => ({ ok: true, entries: [], tests: 'unobserved' }),
    identity: { branchHead: () => 'abc1234', changeIdentity: () => 'patch-123', onlyBookkeepingSince: () => false },
    writer: { recordReviewStartDecision: async input => { records.push(input); return true; } },
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
  assert.equal(pilot.records[0]?.effectiveMode, 'shadow');
  assert.equal(pilot.records[0]?.operatorOverride, false);

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

test('unmodelled belief and absent recommendation remain typed observations (TASK-2859.09)', async () => {
  const pending = policyPorts({ readHistory: async () => ({ ok: true,
    entries: [{ kind: 'verdict', check: 'tests', passed: false }], tests: 'observed' }) });
  assert.equal(await observePolicyReviewStart(startFacts(), pending.ports), 'recorded');
  assert.equal(pending.records[0]?.failureReason?.kind, 'belief-unmodelled-history');
  assert.equal(pending.records[0]?.effectiveMode, 'fixed');

  const complete = policyPorts({ readHistory: async () => ({ ok: true, entries: [
    { kind: 'verdict', check: 'tests', passed: true },
    { kind: 'verdict', check: 'agent', passed: true },
    { kind: 'verdict', check: 'human', passed: true },
  ], tests: 'observed' }) });
  assert.equal(await observePolicyReviewStart(startFacts(), complete.ports), 'recorded');
  assert.equal(complete.records[0]?.failureReason?.kind, 'no-recommendation');
  assert.equal(complete.records[0]?.effectiveMode, 'shadow');
});
