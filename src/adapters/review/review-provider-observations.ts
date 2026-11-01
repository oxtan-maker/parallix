import type { ProviderReviewChanges, ProviderResolution, ProviderReviewObservation } from '../../application/ports/review-round.js';
import { parseReviewDisposition, parseResolutionDispositions } from '../../domain/review.js';
import { reviewFindingsFromMessage } from './review-round.js';

/** Translate the provider's review vocabulary at its boundary. */
export function providerReviewOutcome(state: string | null): string | null {
  return state === 'CHANGES_REQUESTED' ? 'REQUEST_CHANGES' : state;
}

export function providerReviewChanges(review: { state: string; submittedAt: string; body: string; revision: string | null } | null): ProviderReviewChanges | null {
  if (!review) { return null; }
  const disposition = parseReviewDisposition(providerReviewOutcome(review.state));
  if (!disposition || disposition === 'APPROVED' || disposition === 'CHANGES_MADE') { return null; }
  if (!review.body.trim()) { throw new Error('Provider change request has no finding or explanation'); }
  return { disposition, findings: reviewFindingsFromMessage(review.body), comment: review.body,
    revision: review.revision, decidedAt: review.submittedAt };
}

export function providerResolution(comment: { disposition: string | null; createdAt: string; body: string } | null): ProviderResolution | null {
  if (!comment || (comment.disposition !== 'CHANGES_MADE' && comment.disposition !== 'PUSHBACK_ALL')) { return null; }
  if (!comment.body.trim()) { throw new Error('Provider resolution has no evidence'); }
  return { disposition: comment.disposition, itemDispositions: parseResolutionDispositions(comment.body),
    evidence: comment.body, respondedAt: comment.createdAt };
}

/** Keep the provider judgment attached to the commit and time it actually names. */
export function providerReviewObservation(review: { state: string; submittedAt: string; body: string; revision: string | null } | null): ProviderReviewObservation | null {
  if (review?.state === 'APPROVED') {
    if (!review.submittedAt?.trim()) { throw new Error('Provider approval has no submission time'); }
    return { disposition: 'APPROVED', revision: review.revision, decidedAt: review.submittedAt, comment: review.body };
  }
  return providerReviewChanges(review);
}
