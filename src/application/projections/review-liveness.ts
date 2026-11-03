/** Absence is confirmed only when every owner and execution probe agrees. */
export interface ReviewLivenessFacts {
  readonly workflow: boolean | null;
  readonly coordinator: boolean | null;
  readonly execution: boolean | null;
  readonly reviewer: boolean | null;
}
export type ReviewLiveness = 'live' | 'orphaned' | 'unconfirmed';
export type ReviewLivenessReader = (_slug: string) => Promise<ReviewLivenessFacts>;

export function reviewRoundLiveness(phase: string | null | undefined, facts?: ReviewLivenessFacts): ReviewLiveness | null {
  if (phase !== 'reviewing' && phase !== 'fixing') { return null; }
  if (!facts) { return 'unconfirmed'; }
  const values = Object.values(facts);
  return values.includes(true) ? 'live' : values.includes(null) ? 'unconfirmed' : 'orphaned';
}

export function describeReviewLiveness(slug: string, liveness: ReviewLiveness | null | undefined): string | null {
  if (liveness === 'orphaned') { return `Review round is orphaned: no live workflow, coordinator, execution or reviewer. Recover with px stop ${slug}, then px review ${slug}.`; }
  return liveness === 'unconfirmed' ? 'Review round liveness is unconfirmed; absence has not been established.' : null;
}
