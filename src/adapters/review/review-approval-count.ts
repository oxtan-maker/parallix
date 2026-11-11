import { approvalRequirementMet, outstandingReviewers } from '../../domain/reviewer-policy.js';
import { changeRevision, currentReviewRound, type Review, type ReviewerResultAttribution } from '../../domain/review.js';
import { attachReviewerResult } from './reviewer-result-attribution.js';

/**
 * An attributed agent approval that does not yet complete the round's required
 * approval count is recorded as that reviewer's result and nothing more: the
 * round stays awaiting review, so one approval can never stand in for a
 * missing second one. Returns null when the approval is decisive (or carries
 * no agent attribution, as an operator-directed approval does).
 */
export function recordHeldApproval(
  review: Review,
  input: { revision?: string | null; decidedAt: string; result?: ReviewerResultAttribution },
): { review: Review; awaitingApprovals: number } | null {
  if (!input.result || typeof input.revision !== 'string') { return null; }
  const round = currentReviewRound(review);
  if (!round.reviewerPolicy || round.decision) { return null; }
  const attached = attachReviewerResult(review, 'approved', input, []);
  const revision = changeRevision(input.revision);
  return approvalRequirementMet(attached, revision)
    ? null
    : { review: attached, awaitingApprovals: outstandingReviewers(attached, revision).length };
}
