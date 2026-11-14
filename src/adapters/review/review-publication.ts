import type { MissionStore } from '../../application/domain-ports.js';
import { isStaleWrite } from '../../application/domain-ports.js';
import { missionId } from '../../domain/mission.js';
import type { Review, ReviewEventRecord, ReviewEventType } from '../../domain/review.js';

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

export type ReviewEventDraft = Omit<ReviewEventRecord, 'position' | 'createdAt'> & { readonly createdAt?: string };

function encode(value: string): string { return encodeURIComponent(value); }
function decode(value: string | null): string { return decodeURIComponent(value ?? ''); }

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
  const parts = key?.split(':').map(decode) ?? [];
  const round = Number(parts[1]);
  if (!key || parts.length !== 5 || !Number.isInteger(round) || round < 1
    || (target !== 'comment' && target !== 'review')
    || !revision || !['pending', 'failed', 'completed'].includes(state ?? '')) {
    return null;
  }
  return {
    key,
    slug: parts[0],
    round,
    actor: parts[2],
    revision,
    eventType: parts[4] as ReviewEventType,
    target,
    state: state as ReviewPublicationState,
    error: fields.get('error'),
  };
}

export function reviewPublicationMarker(key: string): string {
  return `<!-- parallix-publication:${key} -->`;
}

export function hasReviewPublicationMarker(body: string): boolean {
  return /<!-- parallix-publication:[^>]+ -->/.test(body);
}

export function reviewPublicationBody(body: string, publication: ReviewPublicationIdentity): string {
  const key = reviewPublicationKey(publication);
  return `${body}\n\nReview provenance: round ${publication.round}; actor ${publication.actor}; revision ${publication.revision}\n${reviewPublicationMarker(key)}`;
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
