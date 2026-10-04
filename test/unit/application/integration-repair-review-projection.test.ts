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
const ELIGIBILITY = ConfiguredReviewerEligibility.fromReviewStep({ eligible: [REVIEWER] } as never);
const SUBJECT = { change: { kind: 'local-branch' as const, sourceBranch: 'mission/task-2620', targetBranch: 'main' }, revision: changeRevision('a1b2c3') };

/** A review whose approval was revoked by the workflow for a red gate, so it carries repair history. */
function reviewWithRepairHistory(): Review {
  let review = startReview(SUBJECT, REVIEWER, IMPLEMENTER, '2026-09-20T10:00:00.000Z', ELIGIBILITY);
  review = applyReviewerCommand(review, { type: 'approve', decidedAt: '2026-09-20T11:00:00.000Z', comment: 'looks right', source: { kind: 'provider', provider: 'forgejo' } });
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
  return applyReviewerCommand(review, { type: 'approve', decidedAt: '2026-09-20T11:00:00.000Z', comment: 'looks right', source: { kind: 'provider', provider: 'forgejo' } });
}

/** Build a mission with a given lane and review as an untyped aggregate. */
function mission(status: Mission['status'], review: Review | null): Mission {
  return {
    id: missionId('task-2620'),
    repositoryId: repositoryId('parallix'),
    title: 'Mission task-2620',
    labels: [],
    status,
    rawStatus: status,
    checkpoints: [],
    brief: {},
    declaredGates: [],
    successCriteria: [],
    dependencies: [],
    predictedNelBucket: 'Small',
    assignee: IMPLEMENTER,
    externalTaskRef: null,
    intakeTrace: null,
    review,
    netEngineeringLines: null,
    closedAt: null,
  } as unknown as Mission;
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
  review = { ...review, rounds: [...review.rounds.slice(0, -1), { ...round, subject: { ...round.subject, revision: changeRevision('d4e5f6') } }] as unknown as Review['rounds'] };
  review = applyReviewerCommand(review, { type: 'approve', decidedAt: '2026-09-20T12:00:00.000Z', comment: 'repair verified', source: { kind: 'local' } });
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
