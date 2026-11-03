import type { Review, ReviewRound, ReviewEventRecord } from '../../domain/review.js';
import { normalizeImplementer } from './statistics-row.js';

export type RepairCause = 'review' | 'human' | 'integration' | 'infrastructure' | 'pushback' | 'mechanical' | 'unknown';
export interface RepairObligation {
  readonly identity: string;
  readonly round: number | null;
  readonly cause: RepairCause;
  readonly implementer: string | null;
}
export interface ReviewStatisticsEvidence {
  /** Exact judged revisions whose mission patches match recorded submissions. */
  readonly equivalentSubmissions: Readonly<Record<string, readonly string[]>>;
}
export interface ReviewStatistics {
  readonly implementer: string;
  readonly prFixRounds: number | null;
  readonly byImplementer: Readonly<Record<string, number | null>>;
  readonly obligations: readonly RepairObligation[];
  readonly source: 'review-aggregate' | 'no-review';
}

/** Reconcile judgments and their audit publications; a publication is not a repair. */
export function reviewStatistics(review: Review | null, evidence: ReviewStatisticsEvidence = { equivalentSubmissions: {} }): ReviewStatistics {
  const implementer = normalizeImplementer(review?.rounds.at(-1)?.implementer) || 'unknown';
  if (!review) { return { implementer, prFixRounds: null, byImplementer: {}, obligations: [], source: 'no-review' }; }
  const obligations = new Map<string, RepairObligation>();
  const put = (identity: string, round: ReviewRound | undefined, cause: RepairCause) => {
    if (obligations.has(identity)) { return; }
    obligations.set(identity, { identity, round: round?.number ?? null, cause, implementer: authorOf(review, round, evidence) });
  };
  for (const round of review.rounds) { reconcileRound(review, round, put, evidence); }
  for (const event of review.reviewEvents) { reconcileEvent(review, event, put); }
  const values = [...obligations.values()];
  const measured = review.rounds.some(round => round.decision !== null) || review.reviewEvents.some(event => event.eventType === 'reviewer_outcome');
  const unknown = values.some(value => value.cause === 'unknown');
  return { implementer, prFixRounds: measured && !unknown ? values.filter(isCodingRepair).length : null,
    byImplementer: attributedCounts(review, values, measured), obligations: values, source: 'review-aggregate' };
}

type PutObligation = (_identity: string, _round: ReviewRound | undefined, _cause: RepairCause) => void;
const isCodingRepair = (value: RepairObligation) => ['review', 'human', 'integration'].includes(value.cause);

function repeatedRejection(review: Review, round: ReviewRound): boolean {
  const decision = round.decision;
  if (decision?.kind !== 'changes-requested' || !decision.revision) { return false; }
  return review.rounds.some(prior => prior.number < round.number && prior.decision?.kind === 'changes-requested'
    && prior.decision.revision === decision.revision && JSON.stringify(prior.decision.findings) === JSON.stringify(decision.findings));
}
function mechanicalApproval(review: Review, round: ReviewRound): boolean {
  const decision = round.decision;
  if (decision?.kind !== 'approved' || decision.revocation) { return false; }
  return decision.source.kind === 'mechanical-restoration' || review.rounds.some(prior => prior.number < round.number
    && prior.decision?.kind === 'approved' && Boolean(prior.decision.revision) && prior.decision.revision === decision.revision);
}
function reconcileRound(review: Review, round: ReviewRound, put: PutObligation, evidence: ReviewStatisticsEvidence): void {
  if (round.decision?.kind === 'changes-requested') {
    put(`review:${round.number}`, round, repeatedRejection(review, round) ? 'mechanical' : rejectedCause(round));
  }
  if (mechanicalApproval(review, round)) { put(`mechanical:${round.number}`, round, 'mechanical'); }
  if (round.decision?.kind !== 'approved' || !round.decision.revocation) { return; }
  const revocation = round.decision.revocation;
  const cause = revocation.cause;
  if (cause?.kind === 'integration-gate-failure') {
    put(`gate:${judgedWork(round, evidence)}:${cause.gate ?? 'unknown'}`, round, gateCause(cause.log));
  } else {
    const human = cause?.kind === 'review-repair' || revocation.reason.startsWith('Human change request ');
    put(`review:${round.number}`, round, correctionCause(review, round, human));
  }
}
function judgedWork(round: ReviewRound, evidence: ReviewStatisticsEvidence): string {
  const revision = round.decision?.revision;
  if (!revision) { return `unproven-round:${round.number}`; }
  return evidence.equivalentSubmissions[revision]?.[0] ?? revision;
}
function correctionCause(review: Review, round: ReviewRound, human: boolean): RepairCause {
  if (correctionPushedBack(review, round)) { return 'pushback'; }
  return human ? 'human' : 'unknown';
}
function correctionPushedBack(review: Review, round: ReviewRound): boolean {
  const repair = review.rounds.find(candidate => candidate.number > round.number);
  if (!repair) { return false; }
  return repair.disposition === 'PUSHBACK_ALL' || review.reviewEvents.some(event => event.roundNumber === repair.number
    && event.eventType === 'implementer_disposition' && event.disposition === 'PUSHBACK_ALL');
}
function reconcileEvent(review: Review, event: ReviewEventRecord, put: PutObligation): void {
  if (!isCorrection(event)) { return; }
  // A provider note is often published on the repair round. Its retained
  // provider identity links it back to the approval correction it publishes.
  const linked = review.rounds.find(round => round.decision?.kind === 'approved'
    && event.followUpReference && round.decision.revocation?.reason.includes(event.followUpReference.split(';')[0].trim()));
  const round = linked ?? review.rounds.find(round => round.number === event.roundNumber);
  const number = round?.number ?? event.roundNumber;
  const identity = number !== null ? `review:${number}` : `unlinked:${event.followUpReference ?? event.position}`;
  put(identity, round, eventCause(event, round));
}
function eventCause(event: ReviewEventRecord, round: ReviewRound | undefined): RepairCause {
  if (event.disposition === 'PUSHBACK_ALL') { return 'pushback'; }
  if (event.eventType === 'human_note') { return 'human'; }
  if (round) { return rejectedCause(round); }
  return event.roundNumber !== null ? 'review' : 'unknown';
}
function attributedCounts(review: Review, values: readonly RepairObligation[], measured: boolean): Record<string, number | null> {
  const counts: Record<string, number | null> = {};
  for (const round of review.rounds) {
    const agent = normalizeImplementer(round.implementer);
    if (agent) { counts[agent] = measured ? 0 : null; }
  }
  for (const value of values) {
    if (!isCodingRepair(value) && value.cause !== 'unknown') { continue; }
    if (!value.implementer) {
      for (const agent of Object.keys(counts)) { counts[agent] = null; }
    } else if (value.cause === 'unknown') { counts[value.implementer] = null; }
    else if (counts[value.implementer] !== null) { counts[value.implementer] = (counts[value.implementer] ?? 0) + 1; }
  }
  return counts;
}

function isCorrection(event: ReviewEventRecord): boolean {
  return (event.eventType === 'reviewer_outcome' || event.eventType === 'human_note')
    && (event.verdict === 'request-changes' || event.disposition === 'REQUEST_CHANGES' || event.disposition === 'PUSHBACK_ALL');
}
function rejectedCause(round: ReviewRound): RepairCause {
  if (round.disposition === 'PUSHBACK_ALL' || (round.itemDispositions?.length && round.itemDispositions.every(item => item.kind === 'pushed_back')) || (round.response?.resolutions.length
    && round.response.resolutions.every(resolution => resolution.kind === 'disputed'))) { return 'pushback'; }
  if (round.disposition === 'BLOCKED' || round.disposition === 'PARKED') { return 'unknown'; }
  return round.decision?.kind === 'changes-requested' && round.decision.source?.kind === 'operator' ? 'human' : 'review';
}
function gateCause(log: string | null | undefined): RepairCause {
  if (!log) { return 'unknown'; }
  if (/ENOSPC|EAI_AGAIN|ECONNREFUSED|Cannot connect to the Docker daemon|No space left on device/.test(log)) { return 'infrastructure'; }
  if (/ETIMEDOUT|ERR_TEST_TIMEOUT|test timed out|CPU budget|budget exceeded/i.test(log)) { return 'unknown'; }
  if (/AssertionError|ERR_ASSERTION|error TS\d+|Lint errors/.test(log)) { return 'integration'; }
  return 'unknown';
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
