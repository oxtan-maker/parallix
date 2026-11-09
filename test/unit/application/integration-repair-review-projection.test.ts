import { workflowEligible } from '../../../src/domain/workflow-command-policy.js';
import { replaceCurrentRound } from '../../../src/domain/review.js';
import { fixtureMission as typedMissionFixture } from '../../fixtures/mission-builders.js';
/**
 * TASK-2620 — `integrationRepairNeedsReview` lane-by-review-status-by-repair
 * history domain table.
 *
 * Pure domain, injected doubles only: no agents, no git, no Forgejo, no SQLite.
 * This is the fast unit test that criterion 14 pairs with the composed
 * `px integrate` reproduction. It proves the typed lifecycle fact the kernel
 * and the integrate workflow read to decide whether a repaired mission must go
 * back through review before it can land (criterion 10).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  currentIntegrationRepair,
  integrationRepairNeedsReview,
  integrationGateWithdrawals,
  integrationRepairPrComment,
  integrationRepairReviewBrief,
  integrationRepairSummary,
  latestIntegrationRepair,
} from '../../../src/application/integration-repair-review.js';
import {
  applyReviewerCommand,
  applyImplementerCommand,
  beginNextReviewRound,
  currentReviewRound,
  changeRevision,
  ConfiguredReviewerEligibility,
  reviewStatus,
  reviewFindingId,
  revokeApprovedDecision,
  startReview,
  type Review,
  type ReviewRevocationCause,
} from '../../../src/domain/review.js';
import { agentFamily } from '../../../src/domain/agents.js';
import { missionId, type Mission } from '../../../src/domain/mission.js';
import { repositoryId } from '../../../src/domain/repository.js';

const REVIEWER = agentFamily('codex');
const IMPLEMENTER = agentFamily('custom');
const ELIGIBILITY = ConfiguredReviewerEligibility.fromReviewStep({ eligible: [REVIEWER], strategy: 'random' });
const SUBJECT = { change: { kind: 'local-branch' as const, sourceBranch: 'mission/task-2620', targetBranch: 'main' }, revision: changeRevision('a1b2c3') };

/** A review whose approval was revoked by the workflow for a red gate, so it carries repair history. */
function reviewWithRepairHistory(): Review {
  let review = startReview(SUBJECT, REVIEWER, IMPLEMENTER, '2026-09-20T10:00:00.000Z', ELIGIBILITY);
  review = applyReviewerCommand(review, { type: 'approve', revision: SUBJECT.revision, decidedAt: '2026-09-20T11:00:00.000Z', comment: 'looks right', source: { kind: 'provider', provider: 'forgejo' } });
  review = revokeApprovedDecision(review, currentReviewRound(review).number, {
    revokedAt: '2026-09-20T11:05:00.000Z',
    revokedBy: 'workflow',
    reason: 'Integration gates failed; the mission returned to implementation for repair.',
    cause: { kind: 'integration-gate-failure', gate: 'unit', command: 'npm test', log: 'AssertionError: boom' },
  });
  return review;
}

/** The same reason text under an operator cause: only the typed cause counts. */
function operatorRevokedWithIntegrationWording(): Review {
  const review = approvedNoRepair();
  return revokeApprovedDecision(review, currentReviewRound(review).number, {
    revokedAt: '2026-09-20T11:05:00.000Z',
    revokedBy: 'workflow',
    reason: 'Integration gates failed; the mission returned to implementation for repair.',
    cause: { kind: 'operator' },
  });
}

function awaitingReviewNoRepair(): Review {
  return startReview(SUBJECT, REVIEWER, IMPLEMENTER, '2026-09-20T10:00:00.000Z', ELIGIBILITY);
}

function approvedNoRepair(): Review {
  let review = startReview(SUBJECT, REVIEWER, IMPLEMENTER, '2026-09-20T10:00:00.000Z', ELIGIBILITY);
  return applyReviewerCommand(review, { type: 'approve', revision: SUBJECT.revision, decidedAt: '2026-09-20T11:00:00.000Z', comment: 'looks right', source: { kind: 'provider', provider: 'forgejo' } });
}

/** Build a mission with a given lane and review as an untyped aggregate. */
function mission(status: Mission['status'], review: Review | null): Mission {
  return typedMissionFixture(String(missionId('task-2620')), {
    repositoryId: repositoryId('parallix'),
    title: 'Mission task-2620',
    labels: [],
    status,
    rawStatus: status,
    checkpoints: [],
    brief: { goal: 'g', why: 'w', scope: 's', outOfScope: [] },
    declaredGates: [],
    successCriteria: [],
    dependencies: [],
    predictedNelBucket: 'Small',
    assignee: IMPLEMENTER,
    externalTaskRef: null,
    review,
    netEngineeringLines: null,
    closedAt: null});
}

test('task-2620: repair classification never matches reason text', () => {
  const current = mission('active', operatorRevokedWithIntegrationWording());
  assert.deepEqual(integrationGateWithdrawals(current), [], 'reason text is never matched');
  assert.equal(integrationRepairNeedsReview(current), false);
});

// Lane-by-review-status-by-repair-history table.
const table: Array<{ status: Mission['status']; review: Review; expected: boolean }> = [
  { status: 'active', review: reviewWithRepairHistory(), expected: true },
  { status: 'review', review: reviewWithRepairHistory(), expected: true },
  { status: 'active', review: awaitingReviewNoRepair(), expected: false },
  { status: 'active', review: approvedNoRepair(), expected: false },
  { status: 'integration', review: reviewWithRepairHistory(), expected: false },
  { status: 'done', review: reviewWithRepairHistory(), expected: false },
  { status: 'refined', review: reviewWithRepairHistory(), expected: false },
];

for (const row of table) {
  test(`task-2620: needsReview status=${row.status} review=${reviewStatus(row.review)} repair=${integrationGateWithdrawals(mission(row.status, row.review)).length > 0}`, () => {
    const current = mission(row.status, row.review);
    assert.equal(integrationRepairNeedsReview(current), row.expected);
    assert.equal(currentIntegrationRepair(current)?.kind ?? null, row.expected ? 'review-required' : null);
  });
}

// A stale human-intervention flag does not resurrect an approved repair.
test('task-2620: an approved repair that is not overdue does not demand review', () => {
  const approved = approvedNoRepair();
  assert.equal(reviewStatus(approved), 'approved');
  assert.equal(integrationRepairNeedsReview(mission('active', approved)), false);
});

for (const cause of [
  { kind: 'operator' }, { kind: 'review-repair' }, { kind: 'rebase-repair' }, undefined,
] satisfies readonly (ReviewRevocationCause | undefined)[]) {
  test(`resolved integration repair stays resolved after ${cause?.kind ?? 'legacy untyped'} revocation (TASK-2819)`, () => {
    const approved = applyReviewerCommand(reviewWithRepairHistory(), {
      type: 'approve', revision: changeRevision('repair-B'), decidedAt: '2026-09-20T12:00:00Z',
      comment: 'Repair reviewed', source: { kind: 'local' },
    });
    const resolved = latestIntegrationRepair(mission('integration', approved));
    const reopened = revokeApprovedDecision(approved, 2, {
      revokedAt: '2026-09-21T10:00:00Z', revokedBy: 'operator', reason: 'A separate correction', cause,
    });
    for (const lane of ['active', 'review'] as const) {
      const current = mission(lane, reopened);
      assert.equal(integrationGateWithdrawals(current).length, 1, 'history remains available');
      assert.equal(integrationRepairNeedsReview(current), false, 'old repair does not route current review');
      assert.deepEqual(latestIntegrationRepair(current), resolved, 'resolved range and outcome remain historical facts');
      assert.equal(integrationRepairReviewBrief(latestIntegrationRepair(current)), '', 'no stale repair prompt');
    }
  });
}

test('integration repair remains pending across requested changes and resolves at approval (TASK-2819)', () => {
  const finding = { id: reviewFindingId('F1'), summary: 'Repair still weakens validation', location: null };
  const rejected = applyReviewerCommand(reviewWithRepairHistory(), {
    type: 'request-changes', revision: SUBJECT.revision, decidedAt: '2026-09-20T12:00:00Z', comment: null, findings: [finding],
  });
  const responded = applyImplementerCommand(rejected, {
    type: 'submit-resolution', respondedAt: '2026-09-20T13:00:00Z', resultingRevision: changeRevision('repair-C'),
    resolutions: [{ findingId: finding.id, kind: 'fixed', evidence: 'Validation retained' }],
  });
  const next = beginNextReviewRound(responded, REVIEWER, IMPLEMENTER, '2026-09-20T13:01:00Z', ELIGIBILITY);
  assert.equal(integrationRepairNeedsReview(mission('active', next)), true);
  assert.equal(latestIntegrationRepair(mission('review', next))?.repairedRevision, 'repair-C');
  assert.match(integrationRepairReviewBrief(latestIntegrationRepair(mission('review', next))), /integration gate `unit`/);
  const approved = applyReviewerCommand(next, { type: 'approve', revision: changeRevision('repair-C'),
    decidedAt: '2026-09-20T14:00:00Z', comment: null, source: { kind: 'local' } });
  assert.equal(integrationRepairNeedsReview(mission('review', approved)), false);
  assert.equal(latestIntegrationRepair(mission('integration', approved))?.reReview, 'approved');
  const failedAgain = revokeApprovedDecision(approved, currentReviewRound(approved).number, {
    revokedAt: '2026-09-20T15:00:00Z', revokedBy: 'workflow', reason: 'Another gate failed',
    cause: { kind: 'integration-gate-failure', gate: 'quality' },
  });
  assert.equal(integrationRepairNeedsReview(mission('review', failedAgain)), true);
  assert.equal(latestIntegrationRepair(mission('review', failedAgain))?.gate, 'quality');
  assert.equal(latestIntegrationRepair(mission('review', failedAgain))?.approvedRevision, 'repair-C');
});

// The facts px status, the PR comment and the re-review prompt all read.
test('task-2620: the latest integration repair reports the gate, range A..B and re-review outcome', () => {
  let review = reviewWithRepairHistory();
  const pending = latestIntegrationRepair(mission('review', review))!;
  assert.deepEqual({ gate: pending.gate, approved: pending.approvedRevision, repaired: pending.repairedRevision, reReview: pending.reReview },
    { gate: 'unit', approved: 'a1b2c3', repaired: null, reReview: 'pending' });
  assert.match(integrationRepairSummary(pending), /integration gate unit \(npm test\); repair range a1b2c3\.\.HEAD; re-review pending/);

  const round = currentReviewRound(review);
  review = { ...review, rounds: replaceCurrentRound(review, { ...round, subject: { ...round.subject, revision: changeRevision('d4e5f6') } }) };
  const candidate = latestIntegrationRepair(mission('review', review))!;
  review = applyReviewerCommand(review, { type: 'approve', revision: changeRevision('d4e5f6'), decidedAt: '2026-09-20T12:00:00.000Z', comment: 'repair verified', source: { kind: 'local' } });
  const approved = latestIntegrationRepair(mission('integration', review))!;
  assert.equal(approved.reReview, 'approved');
  assert.match(integrationRepairSummary(approved), /repair range a1b2c3\.\.d4e5f6; re-review approved/);
  assert.match(integrationRepairPrComment(approved), /AssertionError: boom/);
  assert.match(integrationRepairPrComment(approved), /nothing lands until a human runs `px integrate`/);
  const brief = integrationRepairReviewBrief(candidate);
  assert.match(brief, /a1b2c3\.\.d4e5f6/);
  assert.match(brief, /withdrew and dismissed that prior approval/);
  assert.match(brief, /review scope is yours/i);
  assert.equal(integrationRepairReviewBrief(approved), '');
});

test('task-2620: no integration repair, no repair facts', () => {
  assert.equal(latestIntegrationRepair(mission('integration', approvedNoRepair())), null);
  assert.equal(latestIntegrationRepair(mission('active', operatorRevokedWithIntegrationWording())), null);
  assert.equal(integrationRepairReviewBrief(null), '');
});

// TASK-2704: the agent brief, the PR comment and px status show one repair range which excludes main.
test('task-2704: a rebased repair shows the same mission interdiff to the agent, the PR comment and the summary', () => {
  let review = reviewWithRepairHistory();
  const [withdrawn, current] = review.rounds;
  review = { ...review, rounds: [{ ...withdrawn, subject: { ...withdrawn.subject, baseline: changeRevision('0ld0ba5e') } },
    { ...current, subject: { ...current.subject, revision: changeRevision('d4e5f6'), baseline: changeRevision('4ewba5e') } }] };
  const facts = latestIntegrationRepair(mission('review', review))!;
  assert.deepEqual([facts.approvedBaseline, facts.repairedBaseline], ['0ld0ba5e', '4ewba5e']);
  const brief = integrationRepairReviewBrief(facts);
  const comment = integrationRepairPrComment(facts);
  const summary = integrationRepairSummary(facts);
  const interdiff = 'diff <(git diff 0ld0ba5e a1b2c3) <(git diff 4ewba5e d4e5f6)';
  for (const text of [brief, comment]) {
    assert.ok(text.includes(interdiff), text);
    assert.doesNotMatch(text, /git diff a1b2c3\.\.d4e5f6/, 'the polluted two-dot range is never offered');
    assert.match(text, /Changes landed on main are excluded/);
    assert.match(text, /rebase-induced and conflict-resolution changes appear in this range/);
  }
  assert.match(summary, /mission interdiff 0ld0ba5e\.\.a1b2c3 -> 4ewba5e\.\.d4e5f6/);
});

test('task-2704: a repair with no recorded baseline declares that its range may include main', () => {
  const facts = latestIntegrationRepair(mission('review', reviewWithRepairHistory()))!;
  assert.match(integrationRepairReviewBrief(facts), /may include changes landed on main/);
  assert.match(integrationRepairPrComment(facts), /may include changes landed on main/);
});

import { projectReviewHistory } from '../../../src/application/projections/mission-board.js';

test('mechanical approval history keeps provenance when a human revokes it (TASK-2734)', () => {
  const source = { kind: 'mechanical-restoration' as const, approvedRevision: 'a', candidateRevision: 'a1b2c3', failedGate: 'unit',
    validationRevision: 'a1b2c3', validationReference: 'operational_history:7', validatedAt: '2026-09-20T11:10:00Z' };
  let review = reviewWithRepairHistory();
  const current = currentReviewRound(review);
  review = { ...review, rounds: replaceCurrentRound(review, { ...current, integrationRepairAssessment: {
    assessedAt: '2026-09-20T12:00:00Z', approvedRevision: 'a', candidateRevision: 'a1b2c3', failedGate: 'unit', outcome: 'restored', source } }) };
  const restoredRound = currentReviewRound(review);
  review = { ...review, rounds: replaceCurrentRound(review, { ...restoredRound, decision: { kind: 'approved',
    revision: SUBJECT.revision, decidedAt: '2026-09-20T12:00:00Z', comment: 'Historical restoration', source } }) };
  review = revokeApprovedDecision(review, 2, { revokedAt: '2026-09-20T13:00:00Z', revokedBy: 'human', reason: 'wrong', cause: { kind: 'operator' } });
  assert.equal(projectReviewHistory(review)[1].integrationRepairAssessment?.source?.validationReference, 'operational_history:7');
  assert.equal(projectReviewHistory(review)[1].revocation?.by, 'human');
});

test('repair facts and history name decided code and retain unknown legacy heads (TASK-2752)', () => {
  const review = reviewWithRepairHistory();
  const [prior, current] = review.rounds;
  const changed = { ...review, rounds: [{ ...prior, subject: { ...prior.subject, revision: changeRevision('start-A') } }, current] } as Review;
  assert.equal(latestIntegrationRepair(mission('review', changed))?.approvedRevision, SUBJECT.revision);
  const history = projectReviewHistory(changed);
  assert.equal(history[0].startRevision, 'start-A');
  assert.equal(history[0].decidedRevision, SUBJECT.revision);
  const legacy = { ...changed, rounds: [{ ...changed.rounds[0], decision: { ...prior.decision!, revision: null } }, current] } as Review;
  assert.equal(latestIntegrationRepair(mission('review', legacy)), null);
  assert.equal(integrationRepairNeedsReview(mission('review', legacy)), true, 'unknown decided heads still require review (TASK-2819)');
  assert.equal(projectReviewHistory(legacy)[0].decidedRevision, null);
});

import { inMemoryTransitionStore } from '../../fixtures/mission-builders.js';
import { integrationServices } from '../../helpers/stub-integration-services.js';
import { MissionLifecycleService } from '../../../src/application/mission-lifecycle-service.js';
import { decideMission } from '../../../src/domain/mission-workflow.js';
import { retainIntegrationApproval } from '../../../src/application/integrate/approval-retention.js';
import { pendingIntegrationApproval } from '../../../src/domain/integration-repair-policy.js';
import { parseIntegrationRepairAssessment } from '../../../src/domain/integration-repair-record.js';
import type { IntegrationApprovalEvidencePort } from '../../../src/application/ports/integration-approval-evidence.js';

function retentionScenario() {
  const original = approvedNoRepair();
  const current = currentReviewRound(original);
  const review = { ...original, rounds: replaceCurrentRound(original, { ...current, subject: { ...current.subject, baseline: changeRevision('base') } }) };
  const approved = mission('integration', review);
  const active = decideMission(approved, { type: 'rebound-to-active', agent: IMPLEMENTER,
    cause: { kind: 'integration-gate-failure', gate: 'unit', command: 'npm test', log: 'broken' }, occurredAt: '2026-09-20T11:05:00Z' });
  const store = inMemoryTransitionStore(active);
  const services = integrationServices({ store, lifecycle: new MissionLifecycleService(store) });
  const evidence: IntegrationApprovalEvidencePort = {
    reconcileHumanFeedback: async () => true, samePatch: async () => true, now: () => '2026-09-20T12:00:00Z',
    validation: async () => ({ missionId: 'task-2620', sha: 'candidate', baseline: 'base', hooks: ['unit'],
      createdAt: '2026-09-20T11:10:00Z', reference: 'operational_history:1' }),
  };
  const input = { slug: 'task-2620', services, evidence, candidate: { revision: 'candidate', baseline: 'base' }, head: () => 'candidate' };
  return { approved, active, store, services, evidence, input };
}

test('gate failure retains original judgment while pending repair blocks recovery (TASK-2820)', async () => {
  const s = retentionScenario();
  assert.deepEqual(s.active.review, { ...s.approved.review, rounds: s.active.review!.rounds });
  assert.equal(s.active.review!.rounds.length, 1);
  assert.deepEqual(currentReviewRound(s.active.review!).decision, currentReviewRound(s.approved.review!).decision);
  assert.ok(pendingIntegrationApproval(s.active));
  assert.equal(currentIntegrationRepair(s.active)?.kind, 'approval-retention');
  const assessment = currentReviewRound(s.active.review!).integrationRepairAssessment!;
  assert.deepEqual(parseIntegrationRepairAssessment(JSON.stringify(assessment)), assessment, 'restart preserves incident');
  assert.throws(() => decideMission(s.active, { type: 'approve', review: s.active.review! }), /proven evidence/);
  assert.throws(() => decideMission(s.active, { type: 'submit-for-review', gatesPassed: true, review: s.active.review!, reviewerEligibility: ELIGIBILITY }), /prove approval retention/);
  assert.equal(await retainIntegrationApproval(s.input), 'retained');
  const retained = s.store.mission();
  assert.equal(retained.status, 'integration');
  assert.equal(retained.review!.rounds.length, 1);
  assert.deepEqual(currentReviewRound(retained.review!).decision, currentReviewRound(s.approved.review!).decision);
  assert.equal(currentReviewRound(retained.review!).integrationRepairAssessment?.candidateRevision, 'candidate');
  assert.equal(currentReviewRound(retained.review!).decision?.revision, 'a1b2c3', 'approval remains bound to judged revision');
});

test('changed integration repair withdraws the original judgment and enters existing review (TASK-2820)', async () => {
  const s = retentionScenario();
  s.evidence.samePatch = async () => false;
  s.evidence.validation = async () => null;
  assert.equal(await retainIntegrationApproval(s.input), 'changed');
  const changed = s.store.mission();
  assert.equal(changed.status, 'active');
  assert.equal(reviewStatus(changed.review!), 'awaiting-review');
  assert.equal(changed.review!.rounds.length, 2);
  assert.equal(changed.review!.rounds[0].decision?.kind, 'approved');
  assert.equal(changed.review!.rounds[0].decision?.revocation?.cause?.kind, 'integration-gate-failure');
  assert.ok(integrationRepairNeedsReview(changed));
});

for (const fault of ['missing', 'failed', 'other-mission', 'other-gate', 'old', 'future', 'invalid-time', 'other-sha', 'no-reference', 'comparison', 'baseline', 'other-baseline', 'missing-baseline', 'head', 'dirty', 'human'] as const) {
  test(`retention blocks landing with ${fault} evidence or concurrent changes (TASK-2820)`, async () => {
    const s = retentionScenario();
    const marker = (await s.evidence.validation('task-2620'))!;
    s.evidence.validation = async () => fault === 'missing' ? null : { ...marker,
      ...(fault === 'failed' ? { failed: true } : {}), ...(fault === 'other-mission' ? { missionId: 'another' } : {}),
      ...(fault === 'other-gate' ? { hooks: ['other'] } : {}), ...(fault === 'old' ? { createdAt: '2026-09-20T11:00:00Z' } : {}),
      ...(fault === 'future' ? { createdAt: '2026-09-20T12:01:00Z' } : {}), ...(fault === 'invalid-time' ? { createdAt: 'bad' } : {}),
      ...(fault === 'other-baseline' ? { baseline: 'older-base' } : {}),
      ...(fault === 'missing-baseline' ? { baseline: null } : {}),
      ...(fault === 'other-sha' ? { sha: 'old' } : {}), ...(fault === 'no-reference' ? { reference: '' } : {}) };
    if (fault === 'comparison') { s.evidence.samePatch = async () => { throw new Error('unreadable'); }; }
    if (fault === 'baseline') { s.input.candidate.baseline = ''; }
    if (fault === 'head' || fault === 'dirty') { s.input.head = () => fault === 'dirty' ? null! : 'moved'; }
    if (fault === 'human') {
      s.evidence.samePatch = async () => {
        await s.store.save({ ...s.store.mission(), review: revokeApprovedDecision(s.store.mission().review!, 1, {
          revokedAt: '2026-09-20T11:30:00Z', revokedBy: 'human', reason: 'new correction', cause: { kind: 'operator' },
        }) });
        return true;
      };
    }
    assert.equal(await retainIntegrationApproval(s.input), 'blocked');
    assert.equal(s.store.mission().status, 'active');
    assert.equal(s.store.events.length, 0);
    if (fault === 'human') {
      const decision = s.store.mission().review!.rounds[0].decision;
      assert.ok(decision?.kind === 'approved');
      assert.equal(decision.revocation?.revokedBy, 'human');
    }
    else { assert.deepEqual(currentReviewRound(s.store.mission().review!).decision, currentReviewRound(s.approved.review!).decision); }
  });
}

import { resumePendingIntegrationRepair } from '../../../src/application/integrate/repair-resumption.js';
import { stubIntegrateWorkflowPorts } from '../../helpers/stub-integrate-workflow-ports.js';
import { integrationBounceSeams } from '../../helpers/integration-bounce-seams.js';

for (const fault of ['missing', 'other-baseline', 'missing-baseline'] as const) {
  test(`restart reruns ${fault} evidence with the operator agent selection and stops before landing (TASK-2820)`, async () => {
    const s = retentionScenario();
    const marker = (await s.evidence.validation('task-2620'))!;
    s.evidence.validation = async () => fault === 'missing' ? null
      : { ...marker, baseline: fault === 'other-baseline' ? 'older-base' : null };
    let runs = 0, mirrors = 0;
    const ports = stubIntegrateWorkflowPorts({
      process: { cwd: () => '/fixture' },
      missionPaths: { resolveWorktree: () => '/fixture', resolveMissionBaseBranch: () => 'main',
        resolveBaseWorktree: () => '/fixture', missionBranchName: () => 'mission/task-2620' },
      git: { git: () => ({ status: 0, stdout: 'base', stderr: '' }) },
      gates: { approvalEvidence: () => s.evidence, captureFinalIntegrationTree: () => ({ ok: true, commit: 'candidate' }),
        loadPhaseGates: () => [{ key: 'unit', command: 'verify', order: 1 }], runPhaseGates: async (_phase, options) => {
          assert.equal(options.realAgent, 'codex'); assert.equal(options.realAgentModel, 'operator-model'); runs++;
          return { ok: true };
        } },
    });
    const services = { ...s.services, operationalHistory: {
      loadLatestByTypeForMission: async () => null, recordIntegrationValidation: async () => { s.evidence.validation = async () => marker; },
    } };
    const seams = { ...integrationBounceSeams({ transitionTaskFn: () => { mirrors++; } }),
      routeIntegrationGateFailureFn: async () => { throw new Error('unexpected repair launch'); } };
    await assert.rejects(resumePendingIntegrationRepair('task-2620', services, ports, seams,
      { realAgent: 'codex', realAgentModel: 'operator-model' }), { name: 'IntegrationStopsForHuman' });
    assert.equal(runs, 1); assert.equal(mirrors, 1); assert.equal(s.store.mission().status, 'integration');
  });
}

for (const lineage of ['carried', 'unsupported', 'failed'] as const) {
  test(`retention after a completed rebase with ${lineage} validation keeps executed evidence truthful (PX-0048)`, async () => {
    const s = retentionScenario();
    const marker = (await s.evidence.validation('task-2620'))!;
    s.evidence.validation = async () => ({ ...marker, sha: 'validated', baseline: 'old-base', ...(lineage === 'failed' ? { failed: true } : {}) });
    s.evidence.completedRebaseLineage = (from, to) => lineage !== 'unsupported' && from === 'validated' && to === 'candidate'
      ? [{ from: 'validated', to: 'candidate' }] : null;
    assert.equal(await retainIntegrationApproval(s.input), lineage === 'carried' ? 'retained' : 'blocked');
    const assessment = currentReviewRound(s.store.mission().review!).integrationRepairAssessment!;
    if (lineage !== 'carried') { assert.equal(assessment.validation, undefined, 'no fabricated success'); return; }
    assert.deepEqual(assessment.validation, { ...marker, sha: 'validated', baseline: 'old-base',
      carried: { revision: 'candidate', baseline: 'base', lineage: [{ from: 'validated', to: 'candidate' }] } }, 'original sha, time and reference with carried candidate');
    assert.deepEqual(parseIntegrationRepairAssessment(JSON.stringify(assessment)), assessment, 'carried evidence survives persistence');
  });
}

test('restart resumes rebased validated repair without rerunning its gates (PX-0048)', async () => {
  const s = retentionScenario();
  const marker = (await s.evidence.validation('task-2620'))!;
  s.evidence.validation = async () => ({ ...marker, sha: 'validated', baseline: 'old-base' });
  s.evidence.completedRebaseLineage = (from, to) => from === 'validated' && to === 'candidate' ? [{ from, to }] : null;
  let runs = 0, recorded = 0, mirrors = 0;
  const ports = stubIntegrateWorkflowPorts({
    process: { cwd: () => '/fixture' },
    missionPaths: { resolveWorktree: () => '/fixture', resolveMissionBaseBranch: () => 'main',
      resolveBaseWorktree: () => '/fixture', missionBranchName: () => 'mission/task-2620' },
    git: { git: () => ({ status: 0, stdout: 'base', stderr: '' }) },
    gates: { approvalEvidence: () => s.evidence, captureFinalIntegrationTree: () => ({ ok: true, commit: 'candidate' }),
      loadPhaseGates: () => [{ key: 'unit', command: 'verify', order: 1 }], runPhaseGates: async () => { runs++; return { ok: true }; } },
  });
  const services = { ...s.services, operationalHistory: { loadLatestByTypeForMission: async () => null, recordIntegrationValidation: async () => { recorded++; } } };
  const seams = { ...integrationBounceSeams({ transitionTaskFn: () => { mirrors++; } }),
    routeIntegrationGateFailureFn: async () => { throw new Error('unexpected repair launch'); } };
  await assert.rejects(resumePendingIntegrationRepair('task-2620', services, ports, seams,
    { realAgent: null, realAgentModel: null }), { name: 'IntegrationStopsForHuman' });
  assert.deepEqual({ runs, recorded, mirrors }, { runs: 0, recorded: 0, mirrors: 1 }, 'reuse is neither a gate execution nor a new validation record');
  assert.equal(s.store.mission().status, 'integration');
});

test('retention defers a provider human correction even when the local version is unchanged (TASK-2820)', async () => {
  const s = retentionScenario();
  Object.assign(s.evidence, { reconcileHumanFeedback: async () => false });
  assert.equal(await retainIntegrationApproval(s.input), 'blocked');
  assert.equal(s.store.mission().status, 'active');
  assert.equal(s.store.events.length, 0);
});

for (const fault of ['unverified', 'missing-evidence', 'blocker'] as const) {
  test(`green integration evidence cannot bypass ${fault} repair certification (TASK-2820)`, async () => {
    const s = retentionScenario();
    const checkpoint = { missionId: s.active.id, name: 'CP-2', nextActionText: 'repair',
      goalCheck: [{ criterion: 'feature', evidence: 'feature.txt', recordedRound: 1 }],
      repair: { incidentId: 'repair', command: 'verify', authorizedGates: [], authorizedCriteria: [], attempt: 1,
        verified: fault !== 'unverified', evidenceRecorded: fault !== 'missing-evidence',
        ...(fault === 'blocker' ? { blocker: { command: 'verify', diagnostic: 'locked contract needs correction', authorityReason: 'operator owns the contract', proposedCorrection: 'operator corrects the contract' } } : {}) } };
    await s.store.save({ ...s.active, checkpoints: [checkpoint] });
    assert.equal(await retainIntegrationApproval(s.input), 'blocked');
    assert.equal(s.store.mission().status, 'active');
    assert.equal(s.store.events.length, 0);
  });
}

import { retainedApprovalFeedbackAllowsLanding } from '../../../src/application/integrate/approval-retention.js';

test('retained approval cannot land after a later provider change request or unavailable feedback (TASK-2820)', async () => {
  const s = retentionScenario();
  assert.equal(await retainIntegrationApproval(s.input), 'retained');
  s.evidence.reconcileHumanFeedback = async () => false;
  assert.equal(await retainedApprovalFeedbackAllowsLanding('task-2620', s.services, () => s.evidence), false);
  s.evidence.reconcileHumanFeedback = async () => { throw new Error('provider unavailable'); };
  assert.equal(await retainedApprovalFeedbackAllowsLanding('task-2620', s.services, () => s.evidence), false);
});

for (const fault of ['missing-evidence', 'blocker'] as const) {
  test(`restart rejects ${fault} before rebase or gate execution (TASK-2820)`, async () => {
    const s = retentionScenario();
    await s.store.save({ ...s.active, checkpoints: [{ missionId: s.active.id, name: 'CP-2', nextActionText: 'repair',
      goalCheck: [{ criterion: 'feature', evidence: 'feature.txt' }], repair: { incidentId: 'repair', command: 'verify',
        authorizedGates: [], authorizedCriteria: [], attempt: 1, verified: false, evidenceRecorded: fault !== 'missing-evidence',
        ...(fault === 'blocker' ? { blocker: { command: 'verify', diagnostic: 'locked contract needs correction', authorityReason: 'operator owns the contract', proposedCorrection: 'operator corrects the contract' } } : {}) } }] });
    const seams = { ...integrationBounceSeams(), routeIntegrationGateFailureFn: async () => { throw new Error('unexpected repair'); } };
    await assert.rejects(resumePendingIntegrationRepair('task-2620', s.services, stubIntegrateWorkflowPorts(), seams,
      { realAgent: null, realAgentModel: null }), fault === 'blocker' ? /locked contract/ : /checkpoint evidence is missing/);
    assert.equal(s.store.events.length, 0);
  });
}

import { verifyRestartedRepair } from '../../../src/application/integrate/repair-certification.js';

test('restart verification cannot certify checkpoint authority changed while gates ran (TASK-2820)', async () => {
  const s = retentionScenario();
  await s.store.save({ ...s.active, checkpoints: [{ missionId: s.active.id, name: 'CP-2', nextActionText: 'repair',
    goalCheck: [{ criterion: 'feature', evidence: 'feature.txt' }], repair: { incidentId: 'repair', command: 'verify',
      authorizedGates: [], authorizedCriteria: [], attempt: 1, verified: false, evidenceRecorded: true } }] });
  const passed = await verifyRestartedRepair({ slug: 'task-2620', services: s.services, worktree: '/fixture', revision: 'candidate',
    gates: [{ key: 'unit', command: 'verify', order: 1 }], head: () => 'candidate', run: async () => {
      await s.store.save({ ...s.store.mission(), title: 'Concurrent operator correction' });
      return { ok: true };
    } });
  assert.equal(passed, false);
  assert.equal(s.store.mission().checkpoints[0].repair?.verified, false);
});

import { createIntegrationGateStep } from '../../../src/application/integrate/gates.js';
import { routeIntegrationGateFailure } from '../../../src/adapters/cli/commands/integrate-gate-rebound.js';
import { integrationContext } from '../../fixtures/integration-context.js';
import { phaseGateResult } from '../../helpers/phase-gate-result.js';

test('live repair compares and records the candidate baseline when the base advances during repair (TASK-2820)', async () => {
  const s = retentionScenario();
  await s.store.save(s.approved);
  let advanced = false, head = 'a1b2c3', recordedBaseline: string | undefined;
  let validation: Awaited<ReturnType<IntegrationApprovalEvidencePort['validation']>> = null;
  s.evidence.now = () => new Date().toISOString();
  s.evidence.validation = async () => validation;
  s.evidence.samePatch = async (_before, candidate) => {
    assert.equal(advanced, true);
    return candidate.baseline === 'base';
  };
  const services = integrationServices({ ...s.services, operationalHistory: {
    loadLatestByTypeForMission: async () => null, recordIntegrationValidation: async input => {
      if (input.failed) { return; }
      recordedBaseline = input.baseline;
      validation = { ...input, baseline: input.baseline ?? null, createdAt: new Date().toISOString(), reference: 'history:1' };
    },
  } });
  const failedGate = { key: 'unit', command: 'verify', exitCode: 1, stdout: '', stderr: 'transient failure' };
  const capture = () => ({ ok: true as const, rootDir: '/repo', tree: head, commit: head });
  const runGates = async () => phaseGateResult(advanced ? { ok: true } : { ok: false, failedGate, error: 'red' });
  const ports = stubIntegrateWorkflowPorts({
    git: { git: args => ({ status: 0, stdout: args.includes('merge-base') ? 'base' : advanced ? 'advanced-base' : 'base', stderr: '' }) },
    gates: { approvalEvidence: () => s.evidence, captureFinalIntegrationTree: capture,
      resolveIntegrationVerificationWorktree: () => '/fixture', loadPhaseGates: () => [{ key: 'unit', command: 'verify', order: 1 }],
      loadRequirePreIntegration: () => true, runPhaseGates: runGates },
    verification: { formatVerificationCommand: () => 'verify' },
    landing: { createAbort: () => Object.assign(new Error('aborted'), { name: 'IntegrationAbort' }) },
  });
  const step = createIntegrationGateStep(ports);
  await assert.rejects(step.runRequiredLocalGates({ slug: 'task-2620', missionLoad: await s.store.load(), missionServices: services,
    context: integrationContext({ slug: 'task-2620', taskAssignee: IMPLEMENTER, missionHeadSha: head, baseBranch: 'main' }),
    dryRun: false, noIntegrationGates: false, realAgent: null, realAgentModel: null,
    seams: { ...integrationBounceSeams({ transitionTaskFn: () => true }),
      reReviewFn: async () => { throw new Error('Equivalent repair must not enter re-review'); },
      routeIntegrationGateFailureFn: options => routeIntegrationGateFailure({ ...options, captureFinalTreeFn: capture, runPhaseGatesFn: runGates,
        invalidateApprovalFn: async () => { throw new Error('Equivalent repair must not withdraw provider approval'); },
        reboundFn: async (_reason, context) => {
          await context.transitionToImplementer!('task-2620'); advanced = true; head = 'candidate';
          assert.equal((await context.verify(1)).ok, true);
          return { outcome: 'fixed', implementer: IMPLEMENTER, attempts: 1, diagnostic: '',
            classification: { failureClass: 'GateFailure', dispatchAction: 'AutoRepair', isRelaunchable: true, label: 'gate' } };
        } }),
    },
  }), { name: 'IntegrationStopsForHuman' });
  assert.equal(recordedBaseline, 'base');
  assert.equal(s.store.mission().status, 'integration');
  assert.equal(s.store.mission().review!.rounds.length, 1);
  assert.deepEqual(s.store.mission().review!.rounds[0].decision, s.approved.review!.rounds[0].decision);
});

import { log } from '../../../src/application/presentation/cli-format.js';

test('production repair with lifecycle-only approval stops for fresh review instead of looping integrate (TASK-2820)', async t => {
  const s = retentionScenario();
  await s.store.save({ ...s.approved, review: null });
  const messages: string[] = [];
  t.mock.method(log, 'fail', (message: string) => { messages.push(message); });
  const markers: { hooks: readonly string[]; failed?: boolean }[] = [];
  const services = integrationServices({ ...s.services, operationalHistory: {
    loadLatestByTypeForMission: async () => null,
    recordIntegrationValidation: async marker => { markers.push(marker); },
  } });
  const ports = stubIntegrateWorkflowPorts({
    gates: { resolveIntegrationVerificationWorktree: () => '/fixture',
      captureFinalIntegrationTree: () => ({ ok: true, rootDir: '/fixture', tree: 'candidate', commit: 'candidate' }),
      loadPhaseGates: () => [{ key: 'unit', command: 'verify', order: 1 }, { key: 'lint', command: 'lint', order: 2 }],
      loadRequirePreIntegration: () => true, approvalEvidence: () => s.evidence,
      runPhaseGates: async () => phaseGateResult({ ok: false, error: 'failed without named hook' }) },
    git: { git: () => ({ status: 0, stdout: 'base', stderr: '' }) },
    verification: { formatVerificationCommand: () => 'verify' },
    landing: { createAbort: () => new Error('stop before landing') },
  });
  await assert.rejects(createIntegrationGateStep(ports).runRequiredLocalGates({ slug: 'task-2620',
    missionLoad: await s.store.load(), missionServices: services,
    context: integrationContext({ slug: 'task-2620', taskAssignee: IMPLEMENTER }),
    dryRun: false, noIntegrationGates: false, realAgent: null, realAgentModel: null,
    seams: { ...integrationBounceSeams({ transitionTaskFn: () => true }),
      routeIntegrationGateFailureFn: async options => {
        await options.reactivateMissionFn!('task-2620');
        assert.equal(await options.assessRepairFn!(), 'blocked', 'production assessment cannot retain an unrecorded judgment');
        return { route: 'blocked', rebounds: 1 };
      } },
  }), /stop before landing/);
  assert.ok(messages.some(message => message.includes('Run px review task-2620')));
  assert.equal(s.store.mission().status, 'active');
  assert.equal(s.store.mission().review, null);
  assert.deepEqual(markers, [{ missionId: 'task-2620', sha: 'candidate', hooks: ['unit', 'lint'], failed: true }]);
});

import type { CheckpointData } from '../../../src/domain/checkpoint.js';
import { integrationRepairCertified } from '../../../src/application/integrate/repair-certification.js';

test('retention certification cannot reuse exact repair coverage from another worktree (TASK-2820)', async () => {
  const s = retentionScenario();
  const occurrence = { openedMissionRevision: 1, worktree: '/other', failureRevision: 'old', failureEvidenceId: 'failure' };
  const target: CheckpointData = { missionId: s.active.id, name: 'CP-1', nextActionText: 'repair',
    goalCheck: [{ criterion: 'feature', evidence: 'feature.ts' }], repair: { incidentId: 'old', command: 'verify',
      authorizedGates: [], authorizedCriteria: [], attempt: 1, verified: false, evidenceRecorded: true, occurrence } };
  const source: CheckpointData = { ...target, name: 'CP-2',
    recording: { recordedAt: '2026-09-20T11:00:00Z', recordedRound: null, missionRevision: 2 },
    repair: { ...target.repair!, incidentId: 'new', verified: true,
      exactSuccessCoverage: { producer: 'harness-exact-check', missionId: s.active.id, worktree: '/other', command: 'verify',
        authorizedGates: [], authorizedCriteria: [], executionRevision: 'candidate', executionMissionRevision: 2,
        checkpointEvidenceRevision: 2, verifiedMissionRevision: 3,
        execution: { id: 'receipt', producer: 'rebound-exact-verifier', exitCode: 0,
          startedAt: '2026-09-20T11:00:00Z', completedAt: '2026-09-20T11:01:00Z' },
        verifiedOccurrence: { ...occurrence, checkpoint: 'CP-2', incidentId: 'new', attempt: 1 },
        coveredOccurrences: [{ ...occurrence, checkpoint: 'CP-1', incidentId: 'old', attempt: 1 }] } } };
  await s.store.save({ ...s.active, checkpoints: [target, source] });
  assert.equal(integrationRepairCertified(s.store.mission(), '/other'), true);
  assert.equal(integrationRepairCertified(s.store.mission(), '/fixture'), false);
  assert.equal(await retainIntegrationApproval({ ...s.input, worktree: '/fixture' }), 'blocked');
  assert.equal(s.store.mission().status, 'active');
});

test('pending retention rejection crosses the lifecycle port with structured identity (TASK-2829)', async () => {
  const s = retentionScenario();
  const result = await s.services.lifecycle.transition({
    operationId: 'pending-retention', missionId: s.active.id, capabilities: new Set(['mission:transition']),
    actor: String(REVIEWER), occurredAt: '2026-09-20T12:00:00Z',
    command: { type: 'submit-for-review', gatesPassed: true, review: s.active.review!, reviewerEligibility: ELIGIBILITY },
  });
  assert.notEqual(result.status, 'completed');
  if (result.status === 'completed') { assert.fail('pending retention cannot submit'); }
  assert.equal(result.error?.failureReason?.code, 'approval-retention-pending');
  assert.equal(result.error?.failureReason?.source, 'lifecycle');
  assert.equal(result.error?.failureReason?.context?.operation, 'lifecycle-recovery');
  assert.match(result.error!.message, /Integration repair must prove approval retention/);
  assert.deepEqual(s.store.mission(), s.active, 'the failed transition changes no approval or lane');
});

import { certifyPendingIntegrationRepair } from '../../../src/application/integrate/repair-resumption.js';
import { ExecuteMissionService } from '../../../src/application/execute-mission-service.js';
import { ExecuteReviewPreparationService } from '../../../src/application/execute-review-preparation-service.js';
import { makeExecutePorts } from '../../fixtures/execute-mission-ports.js';
import { projectMissionCard } from '../../../src/application/projections/mission-board.js';
import { attentionAction, attentionReason } from '../../../src/application/projections/board.js';

for (const status of ['active', 'review'] as const) {
  test(`execute resumes ${status} retained repair certification before any agent or review entry (TASK-2814, TASK-2829)`, async () => {
    const s = retentionScenario();
    await s.store.save({ ...s.active, status, closedAt: null });
    const marker = (await s.evidence.validation('task-2620'))!;
    s.evidence.validation = async () => null;
    let verifications = 0;
    const ports = stubIntegrateWorkflowPorts({
      process: { cwd: () => '/fixture' },
      missionPaths: { resolveWorktree: () => '/fixture', resolveMissionBaseBranch: () => 'main', resolveBaseWorktree: () => '/fixture', missionBranchName: () => 'mission/task-2620' },
      git: { git: () => ({ status: 0, stdout: 'base', stderr: '' }) },
      gates: { approvalEvidence: () => s.evidence, captureFinalIntegrationTree: () => ({ ok: true, commit: 'candidate' }),
        loadPhaseGates: () => [{ key: 'unit', command: 'verify', order: 1 }], runPhaseGates: async () => { verifications++; return { ok: true }; } },
    });
    const services = { ...s.services, operationalHistory: { loadLatestByTypeForMission: async () => null,
      recordIntegrationValidation: async () => { s.evidence.validation = async () => marker; } } };
    const unexpected = async () => assert.fail('pending retained approval must not launch, select, prepare review or land');
    const { ports: execution } = makeExecutePorts({ missionTransitions: s.store,
      agentExecution: { select: unexpected, prepare: unexpected, launch: unexpected },
      reviewPreparationExecution: { run: unexpected, repairHygiene: unexpected }, autonomousReview: { start: unexpected },
      integrationRepair: { resume: async slug => { const result = await certifyPendingIntegrationRepair(slug, services, ports); return result?.outcome === 'retained' ? 'retained' : 'blocked'; } },
    });
    const before = s.store.mission();
    const card = projectMissionCard(before, { latestGate: 'unconfigured', reviewApproval: null, currentWork: null, blockingReason: null, flags: [] });
    assert.equal(card.pendingApprovalRetention, true);
    assert.equal(attentionAction(card, attentionReason(card))?.kind, 'active:execute', 'board and lead admit safe certification');
    assert.equal(card.commands.find(command => command.command === 'review')?.enabled, true);
    assert.equal(workflowEligible('review:submit', before, 'enter'), true, 'direct continuation is admitted');
    assert.equal(workflowEligible('review:submit', before, 'submit'), false, 'submission cannot bypass certification');
    const result = await new ExecuteMissionService(execution).execute({ operationId: 'retained-repair', slug: 'task-2620', capabilities: new Set(['active:execute']) });
    assert.equal(result.status, 'completed', JSON.stringify(result));
    assert.equal(verifications, 1);
    const after = projectMissionCard(s.store.mission(), { latestGate: 'passed', reviewApproval: null, currentWork: null, blockingReason: null, flags: [] });
    assert.equal(after.pendingApprovalRetention, false);
    assert.equal(attentionAction(after, attentionReason(after))?.kind, 'integrate:merge', 'board and lead leave landing to the human');
    assert.equal(s.store.mission().status, 'integration');
    assert.deepEqual(currentReviewRound(s.store.mission().review!).decision, currentReviewRound(before.review!).decision);
    assert.equal(s.store.mission().review!.rounds.length, 1);
  });
}

test('post-execute continuation settles retained approval before begin-review-preparation (TASK-2829)', async () => {
  const unexpected = async () => assert.fail('retention continuation precedes every review preparation effect');
  const { ports } = makeExecutePorts();
  const result = await new ExecuteReviewPreparationService({ checkpoints: { validateBeforeReviewPreparation: unexpected },
    reviewPreparation: { run: unexpected, repairHygiene: unexpected }, review: { start: unexpected }, repairLaunch: ports.repairLaunch, output: ports.output,
  }).run({ slug: 'task-2620', worktree: '/fixture', agent: 'codex', taskFile: null,
    continueIntegrationRepair: async () => true, beginReviewPreparation: unexpected });
  assert.equal(result, true);
});
