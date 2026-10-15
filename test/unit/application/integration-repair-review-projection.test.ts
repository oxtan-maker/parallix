import { fakeReviewLoopPorts, fakeLoopContext } from '../../helpers/review-loop-ports.js';
import { missionVersion } from '../../../src/application/domain-ports.js';
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
  integrationRepairNeedsReview,
  hasIntegrationRepairHistory,
  integrationRepairPrComment,
  integrationRepairReviewBrief,
  integrationRepairSummary,
  latestIntegrationRepair,
} from '../../../src/application/integration-repair-review.js';
import {
  applyReviewerCommand,
  currentReviewRound,
  changeRevision,
  ConfiguredReviewerEligibility,
  reviewStatus,
  revokeApprovedDecision,
  startReview,
  type Review,
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

// hasIntegrationRepairHistory is the typed lifecycle fact the kernel reads.
test('task-2620: a workflow-revoked approval records repair history; a plain approval does not', () => {
  assert.equal(hasIntegrationRepairHistory(mission('active', reviewWithRepairHistory())), true);
  assert.equal(hasIntegrationRepairHistory(mission('active', awaitingReviewNoRepair())), false);
  assert.equal(hasIntegrationRepairHistory(mission('active', approvedNoRepair())), false);
  assert.equal(hasIntegrationRepairHistory(mission('active', operatorRevokedWithIntegrationWording())), false, 'reason text is never matched');
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
  test(`task-2620: needsReview status=${row.status} review=${reviewStatus(row.review)} repair=${hasIntegrationRepairHistory(mission(row.status, row.review))}`, () => {
    assert.equal(integrationRepairNeedsReview(mission(row.status, row.review)), row.expected);
  });
}

// A stale human-intervention flag does not resurrect an approved repair.
test('task-2620: an approved repair that is not overdue does not demand review', () => {
  const approved = approvedNoRepair();
  assert.equal(reviewStatus(approved), 'approved');
  assert.equal(integrationRepairNeedsReview(mission('active', approved)), false);
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
  review = applyReviewerCommand(review, { type: 'approve', revision: changeRevision('d4e5f6'), decidedAt: '2026-09-20T12:00:00.000Z', comment: 'repair verified', source: { kind: 'local' } });
  const approved = latestIntegrationRepair(mission('integration', review))!;
  assert.equal(approved.reReview, 'approved');
  assert.match(integrationRepairSummary(approved), /repair range a1b2c3\.\.d4e5f6; re-review approved/);
  assert.match(integrationRepairPrComment(approved), /AssertionError: boom/);
  assert.match(integrationRepairPrComment(approved), /nothing lands until a human runs `px integrate`/);
  const brief = integrationRepairReviewBrief(approved);
  assert.match(brief, /a1b2c3\.\.d4e5f6/);
  assert.match(brief, /withdrew and dismissed that prior approval/);
  assert.match(brief, /review scope is yours/i);
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

import { tryRestoreIntegrationApproval } from '../../../src/application/review-loop/restore-integration-approval.js';
import { type LoopContext, ReviewRound as LoopRound } from '../../../src/application/review-loop/round.js';
import { projectReviewHistory } from '../../../src/application/projections/mission-board.js';

test('restoration dispatch falls back on changed patches, missing evidence, baseline loss and Git errors (TASK-2734)', async () => {
  for (const reason of ['mission-change-differs', 'gate-evidence-missing', 'gate-failed', 'comparison-error', 'missing-baseline']) {
    let review = reviewWithRepairHistory();
    const [first, ...rest] = review.rounds;
    const addBaseline = (round: Review['rounds'][number]) => ({ ...round, subject: { ...round.subject,
      ...(reason === 'missing-baseline' ? {} : { baseline: changeRevision('base') }) } });
    review = { ...review, rounds: [addBaseline(first), ...rest.map(addBaseline)] };
    let persisted = mission('review', review), transitions = 0;
    const base = fakeLoopContext(fakeReviewLoopPorts());
    const context: LoopContext = { ...base, slug: 'task-2620', state: { ...base.state, round: 2 }, ports: { ...base.ports,
      missionStore: { load: async () => ({ kind: 'found' as const, mission: persisted, version: missionVersion(1) }), save: async (m: Mission) => { persisted = m; return missionVersion(2); } },
      preReview: { ...base.ports.preReview, head: () => 'candidate' }, output: { ...base.ports.output, log() {} },
      lifecycle: { transition: async () => { transitions++; throw new Error('fallback cannot approve'); } },
      restoration: { now: () => '2026-09-20T12:00:00Z',
        samePatch: async () => { if (reason === 'comparison-error') { throw new Error('git'); } return reason !== 'mission-change-differs'; },
        validation: async () => reason === 'gate-evidence-missing' ? null : { missionId: 'task-2620', sha: 'candidate', baseline: 'base', hooks: ['unit'],
          createdAt: '2026-09-20T11:10:00Z', reference: 'operational_history:1', failed: reason === 'gate-failed' },
      },
    } };
    const round = new LoopRound(2, context);
    round.verifiedRevision = 'candidate';
    assert.equal(await tryRestoreIntegrationApproval(context, round), null);
    assert.equal(transitions, 0);
    assert.equal(persisted.review!.rounds.at(-1)?.integrationRepairAssessment?.outcome,
      reason === 'missing-baseline' ? 'comparison-error' : reason);
  }
});

test('mechanical approval history keeps provenance when a human revokes it (TASK-2734)', () => {
  const source = { kind: 'mechanical-restoration' as const, approvedRevision: 'a', candidateRevision: 'a1b2c3', failedGate: 'unit',
    validationRevision: 'a1b2c3', validationReference: 'operational_history:7', validatedAt: '2026-09-20T11:10:00Z' };
  let review = reviewWithRepairHistory();
  const current = currentReviewRound(review);
  review = { ...review, rounds: replaceCurrentRound(review, { ...current, integrationRepairAssessment: {
    assessedAt: '2026-09-20T12:00:00Z', approvedRevision: 'a', candidateRevision: 'a1b2c3', failedGate: 'unit', outcome: 'restored', source } }) };
  review = applyReviewerCommand(review, { type: 'approve', revision: SUBJECT.revision, decidedAt: '2026-09-20T12:00:00Z', comment: 'Restored', source });
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
  assert.equal(projectReviewHistory(legacy)[0].decidedRevision, null);
});
