import type { MissionStore } from '../../application/domain-ports.js';
import { isStaleWrite } from '../../application/domain-ports.js';
import { missionId, type Mission } from '../../domain/mission.js';
import type { Review, ReviewEventRecord, ReviewEventType, ReviewRound } from '../../domain/review.js';
import { integrationGateWithdrawals } from '../../domain/integration-repair-policy.js';
import { isRoundReviewer, reviewerRequirementRevision } from '../../domain/reviewer-policy.js';

const PREFIX = 'parallix-publication;';

export type ReviewPublicationState = 'pending' | 'publishing' | 'failed' | 'completed';
export type ReviewPublicationTarget = 'comment' | 'review';

export interface ReviewPublicationIdentity {
  slug: string;
  round: number;
  actor: string;
  revision: string;
  eventType: ReviewEventType;
  target: ReviewPublicationTarget;
  /** Native agent/run identity. Recovery of the same attempt retains this value. */
  attempt?: string;
}

export interface ReviewPublication extends ReviewPublicationIdentity {
  key: string;
  state: ReviewPublicationState;
  error: string | null;
  claim?: string;
  claimedAt?: string;
}

export type ReviewPublicationProvenance = Omit<ReviewPublicationIdentity, 'target'>;

export type ReviewEventDraft = Omit<ReviewEventRecord, 'position' | 'createdAt'> & { readonly createdAt?: string };

function encode(value: string): string { return encodeURIComponent(value); }
function decode(value: string | null): string { return decodeURIComponent(value ?? ''); }

function parseReviewPublicationKey(key: string | null): ReviewPublicationProvenance | null {
  const parts = key?.split(':').map(decode) ?? [];
  const round = Number(parts[1]);
  if (!key || ![5, 6].includes(parts.length) || !Number.isInteger(round) || round < 1
    || parts.some(part => !part)) { return null; }
  return parts.length === 6
    ? { slug: parts[0]!, round, actor: parts[2]!, revision: parts[3]!, attempt: parts[4]!, eventType: parts[5] as ReviewEventType }
    : { slug: parts[0]!, round, actor: parts[2]!, revision: parts[3]!, eventType: parts[4] as ReviewEventType };
}

export function reviewPublicationKey(identity: ReviewPublicationIdentity): string {
  return [identity.slug, identity.round, identity.actor, identity.revision, identity.attempt, identity.eventType]
    .filter((part): part is string | number => part !== undefined)
    .map(part => encode(String(part))).join(':');
}

export function reviewPublicationReference(
  identity: ReviewPublicationIdentity,
  state: ReviewPublicationState = 'pending',
  error: string | null = null,
  claim: { token: string; claimedAt: string } | null = null,
): string {
  const fields = new URLSearchParams({
    key: reviewPublicationKey(identity),
    target: identity.target,
    revision: identity.revision,
    state,
  });
  if (error) { fields.set('error', error); }
  if (claim) { fields.set('claim', claim.token); fields.set('claimedAt', claim.claimedAt); }
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
    || !revision || !['pending', 'publishing', 'failed', 'completed'].includes(state ?? '')) {
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
    ...(fields.get('claim') ? { claim: fields.get('claim')! } : {}),
    ...(fields.get('claimedAt') ? { claimedAt: fields.get('claimedAt')! } : {}),
    ...(provenance.attempt ? { attempt: provenance.attempt } : {}),
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
  return publication.slug === slug && publication.round === round.number
    && event.roundNumber === round.number && publication.eventType === event.eventType
    && publication.actor === event.actor && actorMatchesRound
    && (reviewerEvent || implementerEvent);
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

function changedReference(
  event: ReviewEventRecord,
  state: ReviewPublicationState,
  error: string | null,
  claim: { token: string; claimedAt: string } | null = null,
  identity?: ReviewPublicationIdentity,
): ReviewEventRecord {
  const publication = parseReviewPublication(event.followUpReference);
  if (!publication) { return event; }
  return {
    ...event,
    followUpReference: reviewPublicationReference(identity ?? publication, state, error, claim),
  };
}

function reviewerIdentity(round: ReviewRound, requested: ReviewPublicationIdentity): ReviewPublicationIdentity | null {
  return isRoundReviewer(round, requested.actor)
    ? { ...requested, revision: String(reviewerRequirementRevision(round)) }
    : null;
}

function implementerIdentity(round: ReviewRound, requested: ReviewPublicationIdentity): ReviewPublicationIdentity | null {
  return requested.actor === round.implementer
    ? { ...requested, revision: String(round.response?.resultingRevision ?? reviewerRequirementRevision(round)) }
    : null;
}

function withdrawalIdentity(
  mission: Mission,
  round: ReviewRound,
  requested: ReviewPublicationIdentity,
): ReviewPublicationIdentity | null {
  const withdrawal = integrationGateWithdrawals(mission).find(candidate => candidate.number === round.number);
  const approvedRevision = withdrawal?.decision.revision
    ?? (round.decision?.kind === 'approved' ? round.decision.revision : null);
  return approvedRevision ? { ...requested, revision: String(approvedRevision) } : null;
}

function canonicalIdentity(
  mission: Mission,
  requested: ReviewPublicationIdentity,
  event: ReviewEventRecord,
): ReviewPublicationIdentity | null {
  const round = mission.review?.rounds.find(candidate => candidate.number === requested.round);
  const matchingEvent = round && [
    requested.slug === mission.id,
    event.roundNumber === round.number,
    event.eventType === requested.eventType,
    event.actor === requested.actor,
  ].every(Boolean);
  if (!round || !matchingEvent) { return null; }
  if (event.eventType === 'reviewer_findings' || event.eventType === 'reviewer_outcome') {
    return reviewerIdentity(round, requested);
  }
  if (event.eventType === 'implementer_round_summary' || event.eventType === 'implementer_disposition') {
    return implementerIdentity(round, requested);
  }
  if (event.eventType === 'blocked_publication') {
    return withdrawalIdentity(mission, round, requested);
  }
  return null;
}

function sameCoordinates(publication: ReviewPublication, requested: ReviewPublicationIdentity): boolean {
  return publication.slug === requested.slug && publication.round === requested.round
    && publication.actor === requested.actor && publication.eventType === requested.eventType
    && publication.attempt === requested.attempt;
}

function publicationObligation(
  events: readonly ReviewEventRecord[],
  requested: ReviewPublicationIdentity,
): { event: ReviewEventRecord; index: number; publication: ReviewPublication | null } | undefined {
  const requestedKey = reviewPublicationKey(requested);
  const indexed = events
    .map((event, index) => ({ event, index, publication: parseReviewPublication(event.followUpReference) }));
  return indexed.find(entry => entry.publication?.key === requestedKey)
    ?? indexed.find(entry => entry.publication?.state !== 'completed'
      && Boolean(entry.publication && sameCoordinates(entry.publication, requested)))
    ?? indexed.find(entry => Boolean(entry.publication
      && sameCoordinates(entry.publication, requested)));
}

/** Bind a caller-supplied identity to the aggregate's authoritative revision before provider I/O. */
export async function governReviewPublication(
  store: MissionStore,
  slug: string,
  requested: ReviewPublicationIdentity,
): Promise<{ ok: true; identity: ReviewPublicationIdentity } | { ok: false; error: string }> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const loaded = await store.load(missionId(slug));
    if (loaded.kind !== 'found' || !loaded.mission.review) {
      return { ok: false, error: 'Mission review unavailable for publication identity binding.' };
    }
    const indexed = publicationObligation(loaded.mission.review.reviewEvents, requested);
    if (!indexed?.publication) {
      return { ok: false, error: 'Durable review publication obligation is unavailable.' };
    }
    const identity = canonicalIdentity(loaded.mission, requested, indexed.event);
    if (!identity) { return { ok: false, error: 'Review publication does not match the governed round, actor, or event.' }; }
    if (indexed.publication.key === reviewPublicationKey(identity)
      && indexed.publication.target === identity.target) { return { ok: true, identity }; }
    const reviewEvents = [...loaded.mission.review.reviewEvents];
    reviewEvents[indexed.index] = changedReference(indexed.event, indexed.publication.state,
      indexed.publication.error, indexed.publication.claim && indexed.publication.claimedAt
        ? { token: indexed.publication.claim, claimedAt: indexed.publication.claimedAt } : null, identity);
    try {
      await store.save({ ...loaded.mission, review: { ...loaded.mission.review, reviewEvents } }, loaded.version);
      return { ok: true, identity };
    } catch (error) {
      if (!isStaleWrite(error) || attempt === 2) { throw error; }
    }
  }
  return { ok: false, error: 'Review publication identity binding did not converge.' };
}

const CLAIM_LEASE_MS = 120_000;

function activeForeignClaim(publication: ReviewPublication, token: string, now: Date): boolean {
  const claimedAt = publication.claimedAt ? Date.parse(publication.claimedAt) : Number.NaN;
  return [
    publication.state === 'publishing',
    publication.claim !== token,
    Number.isFinite(claimedAt),
    now.getTime() - claimedAt < CLAIM_LEASE_MS,
  ].every(Boolean);
}

/** Compare-and-swap one durable provider mutation claim. */
export async function claimReviewPublication(
  store: MissionStore,
  slug: string,
  identity: ReviewPublicationIdentity,
  token: string,
  now = new Date(),
): Promise<'acquired' | 'busy' | 'completed' | 'missing'> {
  const key = reviewPublicationKey(identity);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const loaded = await store.load(missionId(slug));
    if (loaded.kind !== 'found' || !loaded.mission.review) { return 'missing'; }
    const index = loaded.mission.review.reviewEvents.findIndex(event => parseReviewPublication(event.followUpReference)?.key === key);
    if (index < 0) { return 'missing'; }
    const event = loaded.mission.review.reviewEvents[index]!;
    const publication = parseReviewPublication(event.followUpReference)!;
    if (publication.state === 'completed') { return 'completed'; }
    if (publication.state === 'publishing' && publication.claim === token) { return 'acquired'; }
    if (activeForeignClaim(publication, token, now)) { return 'busy'; }
    const reviewEvents = [...loaded.mission.review.reviewEvents];
    reviewEvents[index] = changedReference(event, 'publishing', null, { token, claimedAt: now.toISOString() }, identity);
    try {
      await store.save({ ...loaded.mission, review: { ...loaded.mission.review, reviewEvents } }, loaded.version);
      return 'acquired';
    } catch (error) {
      if (!isStaleWrite(error) || attempt === 2) { throw error; }
    }
  }
  return 'busy';
}

export async function markReviewPublication(
  store: MissionStore,
  slug: string,
  key: string,
  state: ReviewPublicationState,
  error: string | null = null,
  claimToken?: string,
  retainClaim = false,
): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const loaded = await store.load(missionId(slug));
    if (loaded.kind !== 'found' || !loaded.mission.review) { return false; }
    let found = false;
    const reviewEvents = loaded.mission.review.reviewEvents.map(event => {
      const publication = parseReviewPublication(event.followUpReference);
      const foreignLiveClaim = publication?.state === 'publishing'
        && Boolean(publication.claim) && publication.claim !== claimToken;
      if (publication?.key !== key || foreignLiveClaim
        || (claimToken && publication.claim !== claimToken)) { return event; }
      found = true;
      const claim = retainClaim && publication.claim && publication.claimedAt
        ? { token: publication.claim, claimedAt: publication.claimedAt } : null;
      return changedReference(event, state, error, claim);
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
