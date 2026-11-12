import type { AgentFamily } from './agents.js';
import type { ChangeRevision, Review, ReviewFinding } from './review.js';

export type ReviewerResultDecision = 'approved' | 'changes-requested' | 'unknown';
export type ReviewerResultOutcome = 'completed' | 'missing-output';

/** One immutable reviewer publication attributed to its native run and judged head. */
export interface ReviewerResult {
  readonly publicationId: string;
  readonly reviewerId: string;
  readonly agentFamily: AgentFamily;
  readonly revision: ChangeRevision;
  readonly decision: ReviewerResultDecision;
  readonly findings: readonly ReviewFinding[];
  readonly outcome: ReviewerResultOutcome;
  readonly status: number | null;
  readonly publishedAt: string;
  readonly revokedAt?: string | null;
}

export interface ReviewerResultAttribution {
  readonly publicationId?: string;
  readonly reviewerId?: string;
  readonly agentFamily?: AgentFamily;
  readonly outcome?: ReviewerResultOutcome;
  readonly status?: number | null;
}

/** Append once by publication identity and keep a canonical order across racing writers. */
export function recordReviewerResult(review: Review, result: ReviewerResult): Review {
  validateReviewerResult(result);
  const round = review.rounds[review.rounds.length - 1];
  const existing = round.reviewerResults?.find(entry => entry.publicationId === result.publicationId);
  if (existing) { return review; }
  const reviewerResults = [...(round.reviewerResults ?? []), cloneResult(result)]
    .sort((left, right) => left.publishedAt.localeCompare(right.publishedAt)
      || left.publicationId.localeCompare(right.publicationId));
  const [first, ...rest] = review.rounds;
  const updated = { ...round, reviewerResults };
  return { ...review, rounds: rest.length === 0 ? [updated] : [first, ...rest.slice(0, -1), updated] };
}

/** First valid decision per agent family; invalid or later retries never erase it. */
export function validReviewerApprovals(review: Review): readonly ReviewerResult[] {
  return effectiveReviewerResults(review).filter(result => result.decision === 'approved');
}

/**
 * First valid publication per family, in canonical publication order.
 *
 * A later retry or contradictory duplicate remains durable evidence but never
 * replaces the identity's first completed judgment or contributes a second
 * vote. This makes the effective result independent of arrival order while
 * retaining every separately identified native run for diagnosis.
 */
export function effectiveReviewerResults(review: Review): readonly ReviewerResult[] {
  return effectiveResults(review.rounds.at(-1)?.reviewerResults ?? []);
}

/** First valid publication per family for one exact judged revision. */
export function currentRevisionReviewerResults(review: Review, revision: ChangeRevision): readonly ReviewerResult[] {
  return effectiveResults((review.rounds.at(-1)?.reviewerResults ?? []).filter(result => result.revision === revision));
}

function effectiveResults(results: readonly ReviewerResult[]): readonly ReviewerResult[] {
  const effective = new Map<AgentFamily, ReviewerResult>();
  for (const result of results) {
    if (result.outcome !== 'completed' || result.status !== 0 || result.revokedAt || result.decision === 'unknown') { continue; }
    if (!effective.has(result.agentFamily)) { effective.set(result.agentFamily, result); }
  }
  return [...effective.values()];
}

/** Valid, independently attributable approvals recorded for the exact current revision. */
export function currentRevisionApprovals(review: Review, revision: ChangeRevision): readonly ReviewerResult[] {
  return currentRevisionReviewerResults(review, revision).filter(result => result.decision === 'approved');
}

function validateReviewerResult(result: ReviewerResult): void {
  for (const [field, value] of [['publication id', result.publicationId], ['reviewer identity', result.reviewerId],
    ['revision', result.revision], ['publication time', result.publishedAt]] as const) {
    if (!value.trim()) { throw new Error(`Reviewer result requires ${field}`); }
  }
  if (result.status !== null && !Number.isSafeInteger(result.status)) { throw new Error('Reviewer result status must be an integer or null'); }
  if (result.revokedAt !== undefined && result.revokedAt !== null && !result.revokedAt.trim()) {
    throw new Error('Reviewer result revocation requires a time');
  }
}

function cloneResult(result: ReviewerResult): ReviewerResult {
  return { ...result, findings: result.findings.map(finding => ({ ...finding })) };
}
