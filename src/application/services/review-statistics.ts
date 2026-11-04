import type { Review, ReviewRound, ReviewEventRecord } from '../../domain/review.js';
import { normalizeImplementer } from './statistics-row.js';

/** A return read from workflow history (pre-review gates, rebounds) rather than the Review. */
export interface WorkflowReturn {
  /** Stable identity of one return; duplicates of it count once. */
  readonly identity: string;
  /** Last agent launched into implementation before the return, or null when none was recorded. */
  readonly author: string | null;
  /** When that launch was recorded; a Review round assigned after it is the later evidence. */
  readonly authorSince?: string;
  /** When workflow history recorded the return to implementation. */
  readonly at: string;
  /** End of the incident a rebound opened: the next lane move, absent while it is still open. */
  readonly until?: string;
  /**
   * What recorded it: a reviewer/human lane move (`judgment`), an integration or
   * gate rebound (`rebound`), or a gate repair that moved no lane (`repair`).
   * Only the first two can be the same transition as a Review decision.
   */
  readonly source: 'judgment' | 'rebound' | 'repair';
  /** Explicit sending provenance when the workflow owner observed it. Never inferred from the repair executor. */
  readonly origin?: ReviewReturnOrigin;
}
/** A reviewer lane move and its Review decision are written in the same transition. */
const JUDGMENT_SKEW_MS = 60_000;
export interface ReviewStatisticsEvidence {
  /** Exact judged revisions whose mission patches match recorded submissions. */
  readonly equivalentSubmissions: Readonly<Record<string, readonly string[]>>;
  /** Present only when workflow history was read; undefined means it was unavailable. */
  readonly workflowReturns?: readonly WorkflowReturn[];
  /** Explicit retained human-review handoffs; never inferred from a return. */
  readonly reviewEpisodes?: readonly ReviewEpisode[];
}
export interface ReviewStatistics {
  readonly implementer: string;
  /** Distinct reimplementation rounds of every cause, or null when no return evidence was read. */
  readonly total: number | null;
  /** Returns per author of the rejected work (replacement keeps earlier authors). */
  readonly byImplementer: Readonly<Record<string, number>>;
  /** Each distinct return with its author and when it happened, so reports can attribute it to the model that wrote the work. */
  readonly returns: readonly { readonly identity: string; readonly author: string | null; readonly at: string | null;
    readonly origin: ReviewReturnOrigin }[];
  /** Stable eligible decision/handoff episodes. Agent rounds are never substituted for human episodes. */
  readonly episodes: readonly ReviewEpisode[];
  readonly sendBacks: Readonly<Record<'agent' | 'human', ReviewSendBackMetric>>;
  readonly source: 'review-aggregate' | 'no-review';
}

export type ReviewSendingActor = 'agent' | 'human' | 'workflow' | null;
export interface ReviewReturnOrigin {
  readonly actor: ReviewSendingActor;
  readonly stage: 'agent-review' | 'human-review' | 'workflow';
  readonly decisionIdentity: string | null;
  readonly revision: string | null;
  readonly sender: string | null;
  /** Provider change identity when the observation came from a pull request. */
  readonly pullRequest?: string | null;
  /** Distinct final-owner cause; absent when retained evidence cannot establish one. */
  readonly cause?: string | null;
}
export interface ReviewEpisode {
  readonly identity: string;
  readonly actor: 'agent' | 'human';
  readonly stage: 'agent-review' | 'human-review';
  readonly startedAt: string;
  readonly endedAt: string;
  readonly revision: string | null;
  readonly sender: string;
}
export interface ReviewSendBackMetric {
  readonly numerator: number | null;
  readonly eligibleEpisodes: number | null;
  /** Share of actor-specific returns and episodes carrying explicit provenance. */
  readonly coverage: number;
  readonly rate: { readonly state: 'measured' | 'no-eligible-population' | 'missing-provenance'; readonly value: number | null };
}

const EMPTY_REVIEW_STATISTICS_EVIDENCE: ReviewStatisticsEvidence = { equivalentSubmissions: {} };

/**
 * One authority for reimplementation rounds. Every distinct return of delivered
 * work counts once whatever its cause; a publication, duplicate or mechanical
 * re-review is not a return.
 */
export function reviewStatistics(review: Review | null,
  evidence: ReviewStatisticsEvidence = EMPTY_REVIEW_STATISTICS_EVIDENCE): ReviewStatistics {
  const implementer = normalizeImplementer(review?.rounds.at(-1)?.implementer) || 'unknown';
  const returns = new Map<string, string | null>();
  const times = new Map<string, string | null>();
  const origins = new Map<string, ReviewReturnOrigin>();
  const judged: Judgment[] = [];
  const put: PutReturn = (identity, round, at, rebound = false, origin = originOfRound(identity, round)) => {
    if (returns.has(identity) || !review) { return; }
    times.set(identity, at ?? null);
    origins.set(identity, origin);
    returns.set(identity, authorOf(review, round, evidence) ?? (at ? workflowAuthor(review, { identity, author: null, at, source: 'judgment' }) : null));
    if (at) { judged.push({ at: Date.parse(at), identity, rebound }); }
  };
  if (review) {
    for (const round of review.rounds) { reconcileRound(round, put); }
    for (const event of review.reviewEvents) { reconcileEvent(review, event, put); }
  }
  const reviewMeasured = hasMeasuredReview(review);
  mergeWorkflowReturns(review, evidence.workflowReturns ?? [], evidence.equivalentSubmissions,
    judged, returns, times, origins);
  const reviewObservedEpisodes = reviewEpisodes(review);
  const episodes = mergeReviewEpisodes(reviewObservedEpisodes, evidence.reviewEpisodes ?? []);
  if (!reviewMeasured && evidence.workflowReturns === undefined) {
    return { implementer, total: null, byImplementer: {}, returns: [], episodes,
      sendBacks: sendBackMetrics([], episodes, false), source: review ? 'review-aggregate' : 'no-review' };
  }
  const byImplementer = countByAuthor(review, returns);
  const observations = [...returns].map(([identity, author]) => ({ identity, author,
    at: times.get(identity) ?? null, origin: origins.get(identity) ?? unknownOrigin }));
  return { implementer, total: returns.size, byImplementer, returns: observations, episodes,
    sendBacks: sendBackMetrics(observations, episodes, true), source: review ? 'review-aggregate' : 'no-review' };
}

function hasMeasuredReview(review: Review | null): boolean {
  return review !== null && (review.rounds.some(round => round.decision !== null)
    || review.reviewEvents.some(event => event.eventType === 'reviewer_outcome' || isCorrection(event)));
}

function deduplicateEpisodes(episodes: readonly ReviewEpisode[]): ReviewEpisode[] {
  return [...new Map(episodes.map(episode => [`${episode.actor}:${episode.identity}`, episode])).values()]
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt) || left.identity.localeCompare(right.identity));
}

function mergeReviewEpisodes(observed: readonly ReviewEpisode[], retained: readonly ReviewEpisode[]): ReviewEpisode[] {
  const handoffs = retained.filter(episode => episode.actor === 'human' && episode.stage === 'human-review');
  const uncovered = observed.filter(episode => episode.actor !== 'human' || !handoffs.some(handoff => {
    const decisionAt = Date.parse(episode.endedAt);
    const startedAt = Date.parse(handoff.startedAt);
    const endedAt = Date.parse(handoff.endedAt);
    // The Review record is the terminal decision of a durable handoff, not a
    // second eligible episode. Decisions outside retained handoffs stay distinct.
    return Number.isFinite(decisionAt) && Number.isFinite(startedAt) && Number.isFinite(endedAt)
      && startedAt <= decisionAt && decisionAt <= endedAt;
  }));
  return deduplicateEpisodes([...uncovered, ...retained]);
}

const unknownOrigin: ReviewReturnOrigin = { actor: null, stage: 'workflow', decisionIdentity: null, revision: null, sender: null, cause: null };

function actorOfRound(round: ReviewRound): 'agent' | 'human' {
  return round.decision?.kind === 'changes-requested' && round.decision.source?.kind === 'operator' ? 'human' : 'agent';
}
function originOfRound(identity: string, round: ReviewRound | undefined): ReviewReturnOrigin {
  if (!round) { return unknownOrigin; }
  const actor = actorOfRound(round);
  return { actor, stage: actor === 'human' ? 'human-review' : 'agent-review', decisionIdentity: identity,
    revision: round.decision?.revision ?? round.subject.revision, sender: actor === 'human'
      ? round.decision?.kind === 'changes-requested' ? round.decision.source?.author ?? null : null
      : String(round.reviewer), cause: round.decision?.kind ?? null };
}
function reviewEpisodes(review: Review | null): ReviewEpisode[] {
  if (!review) { return []; }
  const episodes: ReviewEpisode[] = review.rounds.flatMap<ReviewEpisode>(round => {
    if (!round.decision) { return []; }
    const actor = actorOfRound(round);
    const observed: ReviewEpisode[] = [{ identity: `review:${round.number}`, actor,
      stage: actor === 'human' ? 'human-review' as const : 'agent-review' as const,
      startedAt: round.startedAt, endedAt: round.decision.decidedAt,
      revision: round.decision.revision ?? round.subject.revision,
      sender: actor === 'human' && round.decision.kind === 'changes-requested'
        ? round.decision.source?.author ?? 'unknown' : String(round.reviewer) }];
    const revocation = round.decision.kind === 'approved' ? round.decision.revocation : undefined;
    if (revocation?.cause?.kind === 'operator') {
      observed.push({ identity: revocationIdentity(revocation), actor: 'human', stage: 'human-review',
        startedAt: revocation.revokedAt, endedAt: revocation.revokedAt,
        revision: round.decision.revision ?? round.subject.revision, sender: revocation.revokedBy });
    }
    return observed;
  });
  for (const event of review.reviewEvents.filter(event => event.eventType === 'human_note' && isCorrection(event))) {
    const linked = review.rounds.find(round => round.decision?.kind === 'approved' && event.followUpReference
      && round.decision.revocation?.cause?.kind === 'operator'
      && round.decision.revocation.reason.includes(event.followUpReference.split(';')[0].trim()));
    const identity = linked?.decision?.kind === 'approved' && linked.decision.revocation
      ? revocationIdentity(linked.decision.revocation)
      : event.roundNumber !== null ? `review:${event.roundNumber}` : `human-event:${event.position}`;
    if (episodes.some(item => item.identity === identity && item.actor === 'human')) { continue; }
    episodes.push({ identity, actor: 'human', stage: 'human-review',
      startedAt: event.createdAt, endedAt: event.createdAt,
      revision: review.rounds.find(round => round.number === event.roundNumber)?.subject.revision ?? null,
      sender: event.actor ?? 'unknown' });
  }
  return episodes;
}
function sendBackMetrics(returns: readonly { origin: ReviewReturnOrigin }[], episodes: readonly ReviewEpisode[], measured: boolean): ReviewStatistics['sendBacks'] {
  const build = (actor: 'agent' | 'human'): ReviewSendBackMetric => {
    const eligible = episodes.filter(episode => episode.actor === actor).length;
    const numerator = returns.filter(item => item.origin.actor === actor).length;
    const missing = returns.filter(item => item.origin.actor === null).length;
    if (!measured || missing > 0) {
      return { numerator: null, eligibleEpisodes: measured ? eligible : null,
        coverage: returns.length === 0 ? (measured ? 1 : 0) : (returns.length - missing) / returns.length,
        rate: { state: 'missing-provenance', value: null } };
    }
    return { numerator, eligibleEpisodes: eligible, coverage: 1,
      rate: eligible === 0 ? { state: 'no-eligible-population', value: null }
        : { state: 'measured', value: numerator / eligible } };
  };
  return { agent: build('agent'), human: build('human') };
}

/** Every round implementer is listed; a return nothing can attribute stays under `unknown`, never a guessed agent. */
function countByAuthor(review: Review | null, returns: ReadonlyMap<string, string | null>): Record<string, number> {
  const byImplementer: Record<string, number> = {};
  for (const round of review?.rounds ?? []) {
    const agent = normalizeImplementer(round.implementer);
    if (agent) { byImplementer[agent] = 0; }
  }
  for (const author of returns.values()) { byImplementer[author ?? 'unknown'] = (byImplementer[author ?? 'unknown'] ?? 0) + 1; }
  return byImplementer;
}

interface Judgment { at: number; identity: string; rebound: boolean }

/**
 * A reviewer lane move is the Review decision recorded at the same moment; a
 * rebound is the approval revocation the Review recorded during the incident
 * it opened, whatever the cause. Nothing else is the same transition, so an
 * older judgment never absorbs a later return and a gate repair is never
 * matched here.
 */
function mergeWorkflowReturns(review: Review | null, workflowReturns: readonly WorkflowReturn[],
  equivalentSubmissions: ReviewStatisticsEvidence['equivalentSubmissions'],
  judged: Judgment[], returns: Map<string, string | null>, times: Map<string, string | null>, origins: Map<string, ReviewReturnOrigin>): void {
  const sorted = [...new Map(workflowReturns.map(item => [item.identity, item])).values()]
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const coveredProviders = coveredProviderDecisions(review, sorted, equivalentSubmissions, times, origins);
  for (const item of sorted) {
    const at = Date.parse(item.at);
    const until = item.until ? Date.parse(item.until) : Number.POSITIVE_INFINITY;
    if (coveredProviders.has(item.identity)) { continue; }
    const matched = judged.filter(entry => item.source === 'rebound'
      ? entry.rebound && entry.at >= at - JUDGMENT_SKEW_MS && entry.at < until + JUDGMENT_SKEW_MS
      : item.source === 'judgment' && Math.abs(entry.at - at) <= JUDGMENT_SKEW_MS)
      .sort((x, y) => Math.abs(x.at - at) - Math.abs(y.at - at))[0];
    if (matched) {
      judged.splice(judged.indexOf(matched), 1);
      // The lane names the submitter when Git proof could not name the author.
      if (!returns.get(matched.identity)) { returns.set(matched.identity, workflowAuthor(review, item)); }
      continue;
    }
    returns.set(item.identity, workflowAuthor(review, item));
    times.set(item.identity, item.at);
    origins.set(item.identity, normalizedWorkflowOrigin(review, item));
  }
}

interface LocalReturnCycle {
  readonly identity: string;
  /** Multiple durable representations of one return share one matching capacity. */
  readonly claimIdentity: string;
  readonly pullRequest: string | null;
  readonly revision: string | null;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly publicationWindow: boolean;
}

/** Forgejo stores whole-second timestamps, while local transitions retain milliseconds. */
const PROVIDER_TIMESTAMP_PRECISION_MS = 1_000;

function coveredProviderDecisions(review: Review | null, workflowReturns: readonly WorkflowReturn[],
  equivalentSubmissions: ReviewStatisticsEvidence['equivalentSubmissions'],
  times: ReadonlyMap<string, string | null>, origins: ReadonlyMap<string, ReviewReturnOrigin>): Set<string> {
  const cycles = localReturnCycles(review, workflowReturns, times, origins);
  const covered = new Set<string>();
  const retainedProviderClaims = new Map<string, string>((review?.reviewEvents ?? []).flatMap(event => {
    const match = event.followUpReference?.match(/^forgejo:review:(\d+)(?::|;|$)/);
    if (!match || !isCorrection(event)) { return []; }
    const eventCycle = cycles.find(cycle => cycle.identity === `event:${event.position}`);
    return eventCycle ? [[`forgejo-review:${match[1]}`, eventCycle.claimIdentity] as const] : [];
  }));
  const providers = workflowReturns.filter(item => item.origin?.decisionIdentity?.startsWith('forgejo-review:'));
  for (const provider of providers) {
    const retainedClaim = provider.origin?.decisionIdentity
      ? retainedProviderClaims.get(provider.origin.decisionIdentity) : undefined;
    if (retainedClaim) {
      covered.add(provider.identity);
      continue;
    }
    const match = cycles.map(cycle => ({ cycle, score: providerCycleScore(provider, cycle, equivalentSubmissions) }))
      .filter((candidate): candidate is { cycle: LocalReturnCycle; score: readonly [number, number] } => candidate.score !== null)
      .sort((left, right) => left.score[0] - right.score[0] || left.score[1] - right.score[1])[0];
    if (!match) { continue; }
    covered.add(provider.identity);
  }
  return covered;
}

function localReturnCycles(review: Review | null, workflowReturns: readonly WorkflowReturn[],
  times: ReadonlyMap<string, string | null>, origins: ReadonlyMap<string, ReviewReturnOrigin>): LocalReturnCycle[] {
  const cycles = (review?.rounds ?? []).flatMap(roundReturnCycles);
  if (review) { cycles.push(...review.reviewEvents.flatMap(event => eventReturnCycles(review, event, cycles))); }
  cycles.push(...originReturnCycles(origins, times, cycles));
  cycles.push(...workflowReturnCycles(workflowReturns, cycles));
  return cycles;
}

function roundReturnCycles(round: ReviewRound): LocalReturnCycle[] {
  const pullRequest = round.subject.change.kind === 'pull-request' ? String(round.subject.change.id) : null;
  if (round.decision?.kind === 'changes-requested') {
    const identity = `review:${round.number}`;
    return [{ identity, claimIdentity: identity, pullRequest, revision: round.decision.revision ?? round.subject.revision,
      startedAt: Date.parse(round.startedAt), endedAt: Date.parse(round.decision.decidedAt), publicationWindow: false }];
  }
  if (round.decision?.kind !== 'approved' || !round.decision.revocation) { return []; }
  const identity = revocationIdentity(round.decision.revocation);
  return [{ identity, claimIdentity: identity, pullRequest, revision: round.decision.revision ?? round.subject.revision,
    startedAt: Date.parse(round.decision.decidedAt), endedAt: Date.parse(round.decision.revocation.revokedAt),
    publicationWindow: false }];
}

function eventReturnCycles(review: Review, event: ReviewEventRecord,
  cycles: readonly LocalReturnCycle[]): LocalReturnCycle[] {
  if (!isCorrection(event)) { return []; }
  const round = linkedCorrectionRound(review, event)
    ?? review.rounds.find(candidate => candidate.number === event.roundNumber);
  const identity = correctionIdentity(round, event);
  const represented = cycles.find(cycle => cycle.identity === identity);
  const pullRequest = round?.subject.change.kind === 'pull-request' ? String(round.subject.change.id) : null;
  return [{ identity: `event:${event.position}`, claimIdentity: represented?.claimIdentity ?? identity,
    pullRequest, revision: round?.decision?.revision ?? round?.subject.revision ?? null,
    startedAt: Date.parse(event.createdAt), endedAt: Date.parse(event.createdAt), publicationWindow: false }];
}

function originReturnCycles(origins: ReadonlyMap<string, ReviewReturnOrigin>,
  times: ReadonlyMap<string, string | null>, cycles: readonly LocalReturnCycle[]): LocalReturnCycle[] {
  return [...origins].flatMap(([identity, origin]) => {
    if (cycles.some(cycle => cycle.identity === identity)) { return []; }
    const at = times.get(identity);
    return at ? [{ identity, claimIdentity: identity, pullRequest: origin.pullRequest ?? null, revision: origin.revision,
      startedAt: Date.parse(at), endedAt: Date.parse(at), publicationWindow: false }] : [];
  });
}

function workflowReturnCycles(workflowReturns: readonly WorkflowReturn[],
  cycles: readonly LocalReturnCycle[]): LocalReturnCycle[] {
  return workflowReturns.filter(item => !item.origin?.decisionIdentity?.startsWith('forgejo-review:'))
    .flatMap(item => workflowReturnCycle(item, cycles));
}

function workflowReturnCycle(item: WorkflowReturn, cycles: readonly LocalReturnCycle[]): LocalReturnCycle[] {
  const at = Date.parse(item.at);
  const represented = cycles.filter(cycle => Math.abs(cycle.endedAt - at) <= JUDGMENT_SKEW_MS)
    .sort((left, right) => Math.abs(left.endedAt - at) - Math.abs(right.endedAt - at))[0];
  // Provider publications can precede or follow the durable lane/repair write.
  return [{ identity: item.identity, claimIdentity: represented?.claimIdentity ?? item.identity,
    pullRequest: item.origin?.pullRequest ?? null, revision: item.origin?.revision ?? represented?.revision ?? null,
    startedAt: represented?.endedAt ?? at, endedAt: at, publicationWindow: true }];
}

function providerCycleScore(provider: WorkflowReturn, cycle: LocalReturnCycle,
  equivalentSubmissions: ReviewStatisticsEvidence['equivalentSubmissions']): readonly [number, number] | null {
  const origin = provider.origin;
  if (!origin) { return null; }
  const providerPull = origin.pullRequest ?? null;
  if (providerPull && cycle.pullRequest && providerPull !== cycle.pullRequest) { return null; }
  const at = Date.parse(provider.at);
  const distance = Math.abs(cycle.endedAt - at);
  const sameRevisionWindow = Boolean(origin.revision && cycle.revision
    && revisionsEquivalent(origin.revision, cycle.revision, equivalentSubmissions)
    && at >= cycle.startedAt - PROVIDER_TIMESTAMP_PRECISION_MS
    && at <= cycle.endedAt + PROVIDER_TIMESTAMP_PRECISION_MS);
  if (sameRevisionWindow) { return [0, distance]; }
  if (cycle.publicationWindow && at >= cycle.startedAt - JUDGMENT_SKEW_MS
    && at <= cycle.endedAt + JUDGMENT_SKEW_MS) { return [1, distance]; }
  return distance <= PROVIDER_TIMESTAMP_PRECISION_MS ? [2, distance] : null;
}

function revisionsEquivalent(left: string, right: string,
  equivalentSubmissions: ReviewStatisticsEvidence['equivalentSubmissions']): boolean {
  return left === right || equivalentSubmissions[left]?.includes(right) === true
    || equivalentSubmissions[right]?.includes(left) === true;
}

function normalizedWorkflowOrigin(review: Review | null, item: WorkflowReturn): ReviewReturnOrigin {
  const origin = item.origin;
  if (origin?.decisionIdentity?.startsWith('forgejo-review:')) {
    const sender = normalizeImplementer(origin.sender);
    const agent = Boolean(sender && review?.rounds.some(round => normalizeImplementer(round.reviewer) === sender));
    return { ...origin, actor: agent ? 'agent' : 'human', stage: agent ? 'agent-review' : 'human-review',
      cause: origin.cause ?? 'changes-requested' };
  }
  if (origin) { return origin; }
  return item.source === 'repair' || item.source === 'rebound'
    ? { actor: 'workflow', stage: 'workflow', decisionIdentity: item.identity, revision: null,
      sender: 'parallix', cause: item.source }
    : unknownOrigin;
}

/**
 * The agent responsible for the rejected work is whoever was most recently put
 * on it before the return: the latest Review round started before the return
 * (a round that starts at the return is its response) or a later implementation
 * launch the workflow recorded. Assignments made after the return establish
 * nothing about earlier work.
 */
function workflowAuthor(review: Review | null, item: WorkflowReturn): string | null {
  const at = Date.parse(item.at);
  const under = review?.rounds.findLast(round => Date.parse(round.startedAt) < at);
  const launchedLater = item.author && item.authorSince && (!under || Date.parse(item.authorSince) > Date.parse(under.startedAt));
  return (launchedLater ? normalizeImplementer(item.author) : normalizeImplementer(under?.implementer)) || normalizeImplementer(item.author) || null;
}

type PutReturn = (_identity: string, _round: ReviewRound | undefined, _at?: string, _rebound?: boolean,
  _origin?: ReviewReturnOrigin) => void;

function reconcileRound(round: ReviewRound, put: PutReturn): void {
  if (round.decision?.kind === 'changes-requested') { put(`review:${round.number}`, round, round.decision.decidedAt); }
  const approved = round.decision?.kind === 'approved' ? round.decision : undefined;
  const revocation = approved?.revocation;
  if (revocation) {
    const identity = revocationIdentity(revocation);
    const actor = revocation.cause?.kind === 'operator' ? 'human' as const : 'workflow' as const;
    put(identity, round, revocation.revokedAt, actor === 'workflow', { actor,
      stage: actor === 'human' ? 'human-review' : 'workflow', decisionIdentity: identity,
      revision: approved?.revision ?? round.subject.revision, sender: revocation.revokedBy,
      cause: revocation.cause?.kind ?? 'approval-revocation' });
  }
}
/** Every approval/revocation cycle is its own return; identical work and gates do not make two cycles one. */
function revocationIdentity(revocation: { readonly revokedAt: string }): string { return `revoke:${revocation.revokedAt}`; }
function reconcileEvent(review: Review, event: ReviewEventRecord, put: PutReturn): void {
  if (!isCorrection(event)) { return; }
  // A provider note is often published on the repair round. Its retained
  // provider identity links it back to the approval correction it publishes.
  const linked = linkedCorrectionRound(review, event);
  const round = linked ?? review.rounds.find(round => round.number === event.roundNumber);
  // A correction on a round whose approval an operator or non-gate rebound revoked is that revocation.
  const identity = correctionIdentity(round, event);
  const actor = event.eventType === 'human_note' ? 'human' as const : 'agent' as const;
  put(identity, round, event.createdAt, false, { actor, stage: actor === 'human' ? 'human-review' : 'agent-review',
    decisionIdentity: identity, revision: round?.decision?.revision ?? round?.subject.revision ?? null,
    sender: event.actor, cause: 'changes-requested' });
}

function linkedCorrectionRound(review: Review, event: ReviewEventRecord): ReviewRound | undefined {
  if (!event.followUpReference) { return undefined; }
  const reference = event.followUpReference.split(';')[0].trim();
  return review.rounds.find(round => round.decision?.kind === 'approved'
    && round.decision.revocation?.reason.includes(reference));
}

function correctionIdentity(round: ReviewRound | undefined, event: ReviewEventRecord): string {
  const revocation = round?.decision?.kind === 'approved'
    && round.decision.revocation?.cause?.kind !== 'integration-gate-failure' ? round.decision.revocation : undefined;
  if (revocation) { return revocationIdentity(revocation); }
  const number = round?.number ?? event.roundNumber;
  return number !== null ? `review:${number}` : `unlinked:${event.followUpReference ?? event.position}`;
}

function isCorrection(event: ReviewEventRecord): boolean {
  return (event.eventType === 'reviewer_outcome' || event.eventType === 'human_note')
    && (event.verdict === 'request-changes' || event.disposition === 'REQUEST_CHANGES' || event.disposition === 'PUSHBACK_ALL');
}

/** The judged revision can predate the agent assigned to its later review. */
function authorOf(review: Review, round: ReviewRound | undefined, evidence: ReviewStatisticsEvidence): string | null {
  const revision = round?.decision?.revision;
  if (!round || !revision) { return null; }
  const equivalent = evidence.equivalentSubmissions[revision] ?? [];
  const first = review.rounds.find(candidate => candidate.number <= round.number
    && (candidate.subject.revision === revision || equivalent.includes(candidate.subject.revision)));
  return normalizeImplementer(first?.implementer) || null;
}
