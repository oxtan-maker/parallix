import { reconcileReviewerPublications } from '../../domain/reviewer-policy.js';
import { changeRevision, currentReviewRound, type Review, type ReviewFinding, type ReviewerResultAttribution } from '../../domain/review.js';
import { attachReviewerResult } from './reviewer-result-attribution.js';

/**
 * An attributed agent approval that does not yet complete the round's required
 * approval count is recorded as that reviewer's result and nothing more: the
 * round stays awaiting review, so one approval can never stand in for a
 * missing second one. Returns null when the approval is decisive (or carries
 * no agent attribution, as an operator-directed approval does).
 */
export type ReviewerPublicationOutcome =
  | { readonly outcome: 'held'; readonly review: Review; readonly awaitingApprovals: number }
  | { readonly outcome: 'approved'; readonly review: Review; readonly decidedAt: string }
  | { readonly outcome: 'changes-requested'; readonly review: Review; readonly decidedAt: string; readonly findings: readonly ReviewFinding[] };

export function recordReviewerPublication(
  review: Review,
  decision: 'approved' | 'changes-requested',
  input: { revision?: string | null; decidedAt: string; result?: ReviewerResultAttribution },
  findings: readonly ReviewFinding[],
): ReviewerPublicationOutcome | null {
  if (!input.result || typeof input.revision !== 'string') { return null; }
  const round = currentReviewRound(review);
  if (!round.reviewerPolicy || round.decision) { return null; }
  const attached = attachReviewerResult(review, decision, input, findings);
  const revision = changeRevision(input.revision);
  const resolution = reconcileReviewerPublications(attached, revision);
  if (!resolution || resolution.kind === 'pending') {
    return { outcome: 'held', review: attached, awaitingApprovals: resolution?.awaiting ?? 1 };
  }
  return resolution.kind === 'approved'
    ? { outcome: 'approved', review: attached, decidedAt: resolution.decidedAt }
    : { outcome: 'changes-requested', review: attached, decidedAt: resolution.decidedAt, findings: resolution.findings };
}

/** Preserve a selected reviewer's late/duplicate publication without reopening a decided round. */
export function recordLateReviewerPublication(
  review: Review,
  decision: 'approved' | 'changes-requested',
  input: { revision?: string | null; decidedAt: string; result?: ReviewerResultAttribution },
  findings: readonly ReviewFinding[],
): Review | null {
  if (!input.result || typeof input.revision !== 'string') { return null; }
  const round = currentReviewRound(review);
  if (!round.reviewerPolicy || !round.decision || round.reviewerPolicy.revision !== input.revision) { return null; }
  return attachReviewerResult(review, decision, input, findings);
}
