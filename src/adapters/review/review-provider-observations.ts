import type { ProviderReviewChanges, ProviderResolution, ProviderReviewObservation } from '../../application/ports/review-round.js';
import { parseReviewDisposition, parseResolutionDispositions } from '../../domain/review.js';
import { reviewFindingsFromMessage } from './review-round.js';
import { hasReviewPublicationMarker, parseReviewPublicationBody } from './review-publication.js';

type ProviderReviewRecord = {
  state: string;
  submittedAt: string;
  body: string;
  revision: string | null;
  actor?: string | null;
};

function translatedProvenance(review: ProviderReviewRecord) {
  if (!hasReviewPublicationMarker(review.body)) { return undefined; }
  const provenance = parseReviewPublicationBody(review.body);
  // A marker-like trailer without the exact visible identity is ordinary
  // provider feedback. Only a complete workflow trailer asserts provenance.
  if (!provenance) { return undefined; }
  if (!review.actor || review.actor !== provenance.actor || review.revision !== provenance.revision) { return null; }
  return { slug: provenance.slug, round: provenance.round, actor: provenance.actor, revision: provenance.revision };
}

/** Translate the provider's review vocabulary at its boundary. */
export function providerReviewOutcome(state: string | null): string | null {
  return state === 'CHANGES_REQUESTED' ? 'REQUEST_CHANGES' : state;
}

export function providerReviewChanges(review: ProviderReviewRecord | null): ProviderReviewChanges | null {
  if (!review) { return null; }
  const disposition = parseReviewDisposition(providerReviewOutcome(review.state));
  if (!disposition || disposition === 'APPROVED' || disposition === 'CHANGES_MADE') { return null; }
  if (!review.body.trim()) { throw new Error('Provider change request has no finding or explanation'); }
  const provenance = translatedProvenance(review);
  if (provenance === null) { return null; }
  return { disposition, findings: reviewFindingsFromMessage(review.body), comment: review.body,
    revision: review.revision, decidedAt: review.submittedAt, actor: review.actor ?? null,
    ...(provenance ? { provenance } : {}) };
}

export function providerResolution(comment: { disposition: string | null; createdAt: string; body: string } | null): ProviderResolution | null {
  if (!comment || (comment.disposition !== 'CHANGES_MADE' && comment.disposition !== 'PUSHBACK_ALL')) { return null; }
  if (!comment.body.trim()) { throw new Error('Provider resolution has no evidence'); }
  return { disposition: comment.disposition, itemDispositions: parseResolutionDispositions(comment.body),
    evidence: comment.body, respondedAt: comment.createdAt };
}

/** Keep the provider judgment attached to the commit and time it actually names. */
export function providerReviewObservation(review: ProviderReviewRecord | null): ProviderReviewObservation | null {
  if (review?.state === 'APPROVED') {
    if (!review.submittedAt?.trim()) { throw new Error('Provider approval has no submission time'); }
    const provenance = translatedProvenance(review);
    if (provenance === null) { return null; }
    return { disposition: 'APPROVED', revision: review.revision, decidedAt: review.submittedAt, comment: review.body,
      actor: review.actor ?? null, ...(provenance ? { provenance } : {}) };
  }
  return providerReviewChanges(review);
}
