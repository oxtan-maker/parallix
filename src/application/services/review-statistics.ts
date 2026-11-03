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
}
/** A reviewer lane move and its Review decision are written in the same transition. */
const JUDGMENT_SKEW_MS = 60_000;
export interface ReviewStatisticsEvidence {
  /** Exact judged revisions whose mission patches match recorded submissions. */
  readonly equivalentSubmissions: Readonly<Record<string, readonly string[]>>;
  /** Present only when workflow history was read; undefined means it was unavailable. */
  readonly workflowReturns?: readonly WorkflowReturn[];
}
export interface ReviewStatistics {
  readonly implementer: string;
  /** Distinct reimplementation rounds of every cause, or null when no return evidence was read. */
  readonly total: number | null;
  /** Returns per author of the rejected work (replacement keeps earlier authors). */
  readonly byImplementer: Readonly<Record<string, number>>;
  /** Each distinct return with its author and when it happened, so reports can attribute it to the model that wrote the work. */
  readonly returns: readonly { readonly identity: string; readonly author: string | null; readonly at: string | null }[];
  readonly source: 'review-aggregate' | 'no-review';
}

/**
 * One authority for reimplementation rounds. Every distinct return of delivered
 * work counts once whatever its cause; a publication, duplicate or mechanical
 * re-review is not a return.
 */
export function reviewStatistics(review: Review | null, evidence: ReviewStatisticsEvidence = { equivalentSubmissions: {} }): ReviewStatistics {
  const implementer = normalizeImplementer(review?.rounds.at(-1)?.implementer) || 'unknown';
  const returns = new Map<string, string | null>();
  const times = new Map<string, string | null>();
  const judged: Judgment[] = [];
  const put: PutReturn = (identity, round, at, rebound = false) => {
    if (returns.has(identity) || !review) { return; }
    times.set(identity, at ?? null);
    returns.set(identity, authorOf(review, round, evidence) ?? (at ? workflowAuthor(review, { identity, author: null, at, source: 'judgment' }) : null));
    if (at) { judged.push({ at: Date.parse(at), identity, rebound }); }
  };
  if (review) {
    for (const round of review.rounds) { reconcileRound(round, put); }
    for (const event of review.reviewEvents) { reconcileEvent(review, event, put); }
  }
  const reviewMeasured = review !== null && (review.rounds.some(round => round.decision !== null)
    || review.reviewEvents.some(event => event.eventType === 'reviewer_outcome' || isCorrection(event)));
  mergeWorkflowReturns(review, evidence.workflowReturns ?? [], judged, returns, times);
  if (!reviewMeasured && evidence.workflowReturns === undefined) {
    return { implementer, total: null, byImplementer: {}, returns: [], source: review ? 'review-aggregate' : 'no-review' };
  }
  const byImplementer = countByAuthor(review, returns);
  return { implementer, total: returns.size, byImplementer, returns: [...returns].map(([identity, author]) => ({ identity, author, at: times.get(identity) ?? null })), source: review ? 'review-aggregate' : 'no-review' };
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
  judged: Judgment[], returns: Map<string, string | null>, times: Map<string, string | null>): void {
  const sorted = [...new Map(workflowReturns.map(item => [item.identity, item])).values()]
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  for (const item of sorted) {
    const at = Date.parse(item.at);
    const until = item.until ? Date.parse(item.until) : Number.POSITIVE_INFINITY;
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
  }
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

type PutReturn = (_identity: string, _round: ReviewRound | undefined, _at?: string, _rebound?: boolean) => void;

function reconcileRound(round: ReviewRound, put: PutReturn): void {
  if (round.decision?.kind === 'changes-requested') { put(`review:${round.number}`, round, round.decision.decidedAt); }
  const revocation = round.decision?.kind === 'approved' ? round.decision.revocation : undefined;
  if (revocation) { put(revocationIdentity(revocation), round, revocation.revokedAt, revocation.cause?.kind !== 'operator'); }
}
/** Every approval/revocation cycle is its own return; identical work and gates do not make two cycles one. */
function revocationIdentity(revocation: { readonly revokedAt: string }): string { return `revoke:${revocation.revokedAt}`; }
function reconcileEvent(review: Review, event: ReviewEventRecord, put: PutReturn): void {
  if (!isCorrection(event)) { return; }
  // A provider note is often published on the repair round. Its retained
  // provider identity links it back to the approval correction it publishes.
  const linked = review.rounds.find(round => round.decision?.kind === 'approved'
    && event.followUpReference && round.decision.revocation?.reason.includes(event.followUpReference.split(';')[0].trim()));
  const round = linked ?? review.rounds.find(round => round.number === event.roundNumber);
  const number = round?.number ?? event.roundNumber;
  // A correction on a round whose approval an operator or non-gate rebound revoked is that revocation.
  const revocation = round?.decision?.kind === 'approved' && round.decision.revocation?.cause?.kind !== 'integration-gate-failure' ? round.decision.revocation : undefined;
  put(revocation ? revocationIdentity(revocation) : number !== null ? `review:${number}` : `unlinked:${event.followUpReference ?? event.position}`, round, event.createdAt);
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
