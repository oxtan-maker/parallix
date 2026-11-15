import type { MissionStore } from '../../application/domain-ports.js';
import { isStaleWrite } from '../../application/domain-ports.js';
import { missionId } from '../../domain/mission.js';
import type { Review, ReviewEventRecord, ReviewEventType, ReviewRound } from '../../domain/review.js';
import { isRoundReviewer, reviewerRequirementRevision } from '../../domain/reviewer-policy.js';

const PREFIX = 'parallix-publication;';

export type ReviewPublicationState = 'pending' | 'failed' | 'completed';
export type ReviewPublicationTarget = 'comment' | 'review';

export interface ReviewPublicationIdentity {
  slug: string;
  round: number;
  actor: string;
  revision: string;
  eventType: ReviewEventType;
  target: ReviewPublicationTarget;
}

export interface ReviewPublication extends ReviewPublicationIdentity {
  key: string;
  state: ReviewPublicationState;
  error: string | null;
}

export type ReviewPublicationProvenance = Omit<ReviewPublicationIdentity, 'target'>;

export type ReviewEventDraft = Omit<ReviewEventRecord, 'position' | 'createdAt'> & { readonly createdAt?: string };

function encode(value: string): string { return encodeURIComponent(value); }
function decode(value: string | null): string { return decodeURIComponent(value ?? ''); }

function parseReviewPublicationKey(key: string | null): ReviewPublicationProvenance | null {
  const parts = key?.split(':').map(decode) ?? [];
  const round = Number(parts[1]);
  if (!key || parts.length !== 5 || !Number.isInteger(round) || round < 1
    || !parts[0] || !parts[2] || !parts[3] || !parts[4]) { return null; }
  return { slug: parts[0], round, actor: parts[2], revision: parts[3], eventType: parts[4] as ReviewEventType };
}

export function reviewPublicationKey(identity: ReviewPublicationIdentity): string {
  return [identity.slug, identity.round, identity.actor, identity.revision, identity.eventType]
    .map(part => encode(String(part))).join(':');
}

export function reviewPublicationReference(
  identity: ReviewPublicationIdentity,
  state: ReviewPublicationState = 'pending',
  error: string | null = null,
): string {
  const fields = new URLSearchParams({
    key: reviewPublicationKey(identity),
    target: identity.target,
    revision: identity.revision,
    state,
  });
  if (error) { fields.set('error', error); }
  return `${PREFIX}${fields.toString()}`;
}

export function parseReviewPublication(reference: string | null | undefined): ReviewPublication | null {
  if (!reference?.startsWith(PREFIX)) { return null; }
  const fields = new URLSearchParams(reference.slice(PREFIX.length));
  const key = fields.get('key');
  const target = fields.get('target');
  const revision = fields.get('revision');
  const state = fields.get('state');
  const provenance = parseReviewPublicationKey(key);
  if (!key || !provenance
    || (target !== 'comment' && target !== 'review')
    || !revision || !['pending', 'failed', 'completed'].includes(state ?? '')) {
    return null;
  }
  return {
    key,
    slug: provenance.slug,
    round: provenance.round,
    actor: provenance.actor,
    revision,
    eventType: provenance.eventType,
    target,
    state: state as ReviewPublicationState,
    error: fields.get('error'),
  };
}

export function reviewPublicationMarker(key: string): string {
  return `<!-- parallix-publication:${key} -->`;
}

export function hasReviewPublicationMarker(body: string): boolean {
  return /(?:^|\n)<!-- parallix-publication:[^>\s]+ -->\s*$/.test(body);
}

/** Read and cross-check the visible identity and durable marker on a published body. */
export function parseReviewPublicationBody(body: string): ReviewPublicationProvenance | null {
  const trailer = body.match(/(?:^|\n\n)Review provenance: round (\d+); actor ([^;\r\n]+); revision ([^\r\n]+)\r?\n<!-- parallix-publication:([^>\s]+) -->\s*$/);
  if (!trailer) { return null; }
  const provenance = parseReviewPublicationKey(trailer[4] ?? null);
  const round = Number(trailer[1]);
  if (!provenance || provenance.round !== round || provenance.actor !== trailer[2]
    || provenance.revision !== trailer[3]) { return null; }
  return provenance;
}

export function reviewPublicationBody(body: string, publication: ReviewPublicationIdentity): string {
  const key = reviewPublicationKey(publication);
  return `${body}\n\nReview provenance: round ${publication.round}; actor ${publication.actor}; revision ${publication.revision}\n${reviewPublicationMarker(key)}`;
}

/** Require a retry obligation to still describe its authoritative round event. */
export function currentReviewPublication(
  slug: string,
  publication: ReviewPublication,
  event: ReviewEventRecord,
  round: ReviewRound,
): boolean {
  const reviewerEvent = event.eventType === 'reviewer_findings' || event.eventType === 'reviewer_outcome';
  const implementerEvent = event.eventType === 'implementer_round_summary' || event.eventType === 'implementer_disposition';
  const actorMatchesRound = reviewerEvent ? isRoundReviewer(round, publication.actor)
    : implementerEvent ? publication.actor === round.implementer : false;
  const revisionMatchesRound = reviewerEvent ? publication.revision === reviewerRequirementRevision(round)
    : implementerEvent ? !round.response || publication.revision === round.response.resultingRevision : false;
  return publication.slug === slug && publication.round === round.number
    && event.roundNumber === round.number && publication.eventType === event.eventType
    && publication.actor === event.actor && actorMatchesRound
    && revisionMatchesRound;
}

export function eventNeedsPublication(event: ReviewEventRecord): boolean {
  return parseReviewPublication(event.followUpReference)?.state !== 'completed'
    && parseReviewPublication(event.followUpReference) !== null;
}

export function sameReviewPublication(left: string | null | undefined, right: string | null | undefined): boolean {
  const a = parseReviewPublication(left);
  const b = parseReviewPublication(right);
  return Boolean(a && b && a.key === b.key);
}

/** Append publication obligations inside the aggregate write that accepts their local state. */
export function appendReviewPublicationEvents(review: Review, drafts: readonly ReviewEventDraft[] | undefined): Review {
  if (!drafts?.length) { return review; }
  const reviewEvents = [...review.reviewEvents];
  for (const draft of drafts) {
    if (reviewEvents.some(event => sameReviewPublication(event.followUpReference, draft.followUpReference))) { continue; }
    reviewEvents.push({ ...draft, position: reviewEvents.length, createdAt: draft.createdAt ?? new Date().toISOString() });
  }
  return reviewEvents.length === review.reviewEvents.length ? review : { ...review, reviewEvents };
}

function changedReference(event: ReviewEventRecord, state: ReviewPublicationState, error: string | null): ReviewEventRecord {
  const publication = parseReviewPublication(event.followUpReference);
  if (!publication) { return event; }
  return {
    ...event,
    followUpReference: reviewPublicationReference(publication, state, error),
  };
}

export async function markReviewPublication(
  store: MissionStore,
  slug: string,
  key: string,
  state: ReviewPublicationState,
  error: string | null = null,
): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const loaded = await store.load(missionId(slug));
    if (loaded.kind !== 'found' || !loaded.mission.review) { return false; }
    let found = false;
    const reviewEvents = loaded.mission.review.reviewEvents.map(event => {
      if (parseReviewPublication(event.followUpReference)?.key !== key) { return event; }
      found = true;
      return changedReference(event, state, error);
    });
    if (!found) { return false; }
    try {
      await store.save({ ...loaded.mission, review: { ...loaded.mission.review, reviewEvents } }, loaded.version);
      return true;
    } catch (writeError) {
      if (!isStaleWrite(writeError) || attempt === 1) { throw writeError; }
    }
  }
  return false;
}
