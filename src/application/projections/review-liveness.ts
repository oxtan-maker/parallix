/** Absence is confirmed only when every owner and execution probe agrees. */
export interface ReviewLivenessFacts {
  readonly workflow: boolean | null;
  readonly coordinator: boolean | null;
  readonly execution: boolean | null;
  readonly reviewer: boolean | null;
}
export type ReviewLiveness = 'live' | 'orphaned' | 'unconfirmed';

/** The mission's open workflow operation as recorded by its admission owner. */
export interface ReviewWorkflowFact {
  readonly id: string;
  readonly phase: string;
  readonly reason: string | null;
}

/** One read of workflow ownership and liveness probes, without recovery writes. */
export interface ReviewExecutionObservation {
  /** The open workflow operation, or null when none is open. */
  readonly workflow: ReviewWorkflowFact | null;
  readonly liveness: ReviewLivenessFacts;
}
export type ReviewLivenessReader = (_slug: string) => Promise<ReviewExecutionObservation>;

export function reviewRoundLiveness(phase: string | null | undefined, facts?: ReviewLivenessFacts): ReviewLiveness | null {
  if (phase !== 'reviewing' && phase !== 'fixing') { return null; }
  if (!facts) { return 'unconfirmed'; }
  const values = [facts.workflow, facts.coordinator, facts.execution, facts.reviewer];
  return values.includes(true) ? 'live' : values.includes(null) ? 'unconfirmed' : 'orphaned';
}
