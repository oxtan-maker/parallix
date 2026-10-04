import type { Review, ReviewRound } from '../../domain/review.js';
import { normalizeImplementer } from './statistics-row.js';

export interface ReviewStatistics {
  readonly implementer: string;
  readonly prFixRounds: number | null;
  readonly source: 'review-aggregate' | 'no-review';
}

/** Preserve event authority and the pre-cutover round-decision fallback. */
export function reviewStatistics(review: Review | null): ReviewStatistics {
  const rounds: readonly ReviewRound[] = review?.rounds ?? [];
  const implementer = normalizeImplementer(rounds.at(-1)?.implementer);
  if (!implementer) { return { implementer: 'unknown', prFixRounds: null, source: 'no-review' }; }
  const events = review?.reviewEvents ?? [];
  const hasOutcomes = events.some(e => e.eventType === 'reviewer_outcome');
  const eventCount = events.filter(e => e.eventType === 'reviewer_outcome' && e.verdict === 'request-changes').length;
  const decisionCount = rounds.filter(round =>
    round.decision?.kind === 'changes-requested' && round.implementer === implementer,
  ).length;
  return {
    implementer,
    prFixRounds: eventCount > 0 ? eventCount : decisionCount > 0 ? decisionCount : hasOutcomes ? 0 : null,
    source: 'review-aggregate',
  };
}
