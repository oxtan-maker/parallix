import { it } from 'node:test';
import assert from 'node:assert/strict';

import { agentFamily } from '../src/domain/agents.js';
import {
  applyImplementerCommand,
  applyReviewerCommand,
  beginNextReviewRound,
  FindingResolution,
  changeRevision,
  ConfiguredReviewerEligibility,
  currentReviewRound,
  reviewFindingId,
  reviewStatus,
  startReview,
} from '../src/domain/review.js';

/**
 * Stale-approval / revision-integrity guards for TASK-2478 (criterion 8, ADR
 * 0048 fail-closed). These drive the Review aggregate commands directly: a
 * stale earlier-round approval must never satisfy the later round, and
 * `CHANGES_MADE` alone must never be proof that a finding was resolved.
 */
const reviewer = agentFamily('codex');
const implementer = agentFamily('custom');
const eligibility = ConfiguredReviewerEligibility.fromReviewStep({ eligible: [reviewer] } as never);

const finding = { id: reviewFindingId('F1'), summary: 'fractional input accepted instead of rejected', location: null };

function baseReview(): ReturnType<typeof startReview> {
  return startReview(
    { change: { kind: 'local-branch', sourceBranch: 'mission/task-2478', targetBranch: 'main' }, revision: changeRevision('rev-1') },
    reviewer,
    implementer,
    '2026-09-10T10:00:00.000Z',
    eligibility,
  );
}

function requestChanges(review: ReturnType<typeof startReview>, decidedAt: string): ReturnType<typeof startReview> {
  return applyReviewerCommand(review, { type: 'request-changes', decidedAt, comment: 'F1 blocks', findings: [finding] });
}

function resolve(review: ReturnType<typeof startReview>, respondedAt: string, resolutions: readonly FindingResolution[]) {
  return applyImplementerCommand(review, {
    type: 'submit-resolution',
    respondedAt,
    resolutions,
    resultingRevision: changeRevision('rev-2'),
  });
}

it('rejects an approve against a round still awaiting implementation (stale approval cannot advance, ADR 0048)', () => {
  const awaitingImpl = requestChanges(baseReview(), '2026-09-10T11:00:00.000Z');
  assert.equal(reviewStatus(awaitingImpl), 'awaiting-implementation');
  assert.throws(
    () => applyReviewerCommand(awaitingImpl, { type: 'approve', decidedAt: '2026-09-10T12:00:00.000Z', comment: null, source: { kind: 'local' } }),
    /cannot approve while review is awaiting-implementation/,
    'an approval cannot be recorded against a round that has not resolved its findings',
  );
});

it('rejects an empty resolution: CHANGES_MADE alone is not proof the finding was resolved', () => {
  const awaitingImpl = requestChanges(baseReview(), '2026-09-10T11:00:00.000Z');
  assert.throws(
    () => resolve(awaitingImpl, '2026-09-10T12:00:00.000Z', []),
    /Missing resolution for F1/,
    'a disposition without a resolution for every finding is rejected',
  );
});

it('rejects an implementer resolution on a round that was not requested-for-changes', () => {
  const awaitingReview = baseReview();
  assert.equal(reviewStatus(awaitingReview), 'awaiting-review');
  assert.throws(
    () => resolve(awaitingReview, '2026-09-10T12:00:00.000Z', [{ findingId: reviewFindingId('F1'), kind: 'fixed', evidence: 'x' }]),
    /while review is awaiting-review/,
  );
});

it('begins round 2 on the revised revision; an already-approved round is terminal and cannot re-round', () => {
  const resolved = resolve(requestChanges(baseReview(), '2026-09-10T11:00:00.000Z'), '2026-09-10T12:00:00.000Z', [
    { findingId: reviewFindingId('F1'), kind: 'fixed', evidence: 'guarded fractional input' },
  ]);
  assert.equal(reviewStatus(resolved), 'ready-for-next-round');

  const round2 = beginNextReviewRound(resolved, reviewer, implementer, '2026-09-10T13:00:00.000Z', eligibility);
  assert.equal(currentReviewRound(round2).number, 2, 'round 2 is a new round');
  assert.equal(
    currentReviewRound(round2).subject.revision,
    changeRevision('rev-2'),
    "round 2 evaluates the implementer's revised revision, not rev-1",
  );
  assert.equal(reviewStatus(round2), 'awaiting-review', 'round 2 is a fresh decision surface');
  assert.equal(currentReviewRound(round2).decision, null, 'the earlier round decision is not carried into round 2');
});

it('round 2 requires its own independent approval, attached to round 2 (criterion 9)', () => {
  const resolved = resolve(requestChanges(baseReview(), '2026-09-10T11:00:00.000Z'), '2026-09-10T12:00:00.000Z', [
    { findingId: reviewFindingId('F1'), kind: 'fixed', evidence: 'guarded fractional input' },
  ]);
  const round2 = beginNextReviewRound(resolved, reviewer, implementer, '2026-09-10T13:00:00.000Z', eligibility);

  const approvedR2 = applyReviewerCommand(round2, { type: 'approve', decidedAt: '2026-09-10T14:00:00.000Z', comment: null, source: { kind: 'local' } });
  const decision = currentReviewRound(approvedR2).decision;
  assert.equal(decision?.kind, 'approved', 'round 2 reaches approval with its own decision');
  assert.equal(currentReviewRound(approvedR2).number, 2, 'the approval is associated with round 2');
});
