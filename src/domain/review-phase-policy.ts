export const REVIEW_PHASES = ['reviewing', 'fixing', 'pending-approval', 'approved'] as const;
export type ReviewPhase = (typeof REVIEW_PHASES)[number];

export const REVIEW_PHASE_TRANSITIONS: Readonly<Record<ReviewPhase, readonly ReviewPhase[]>> = {
  reviewing: ['fixing', 'approved'],
  fixing: ['reviewing', 'pending-approval'],
  'pending-approval': ['reviewing'],
  approved: [],
};

export class ReviewPhaseViolation extends Error {
  readonly kind = 'validation';
  constructor(message: string) {
    super(message);
    this.name = 'ReviewPhaseViolation';
  }
}

/** Accept only a canonical phase at an external data boundary. */
export function parseReviewPhase(value: unknown): ReviewPhase | null {
  return REVIEW_PHASES.find(phase => phase === value) ?? null;
}

export function requireReviewPhase(value: unknown): ReviewPhase {
  const phase = parseReviewPhase(value);
  if (phase === null) {
    throw new ReviewPhaseViolation(`Invalid review phase: "${String(value)}". Valid: ${REVIEW_PHASES.join(', ')}`);
  }
  return phase;
}

/** The phase transition authority shared by the aggregate and loop projection. */
export function assertReviewPhaseTransition(current: ReviewPhase, next: ReviewPhase): void {
  requireReviewPhase(current);
  requireReviewPhase(next);
  const allowed = REVIEW_PHASE_TRANSITIONS[current];
  if (!allowed.includes(next)) {
    throw new ReviewPhaseViolation(`Review phase "${current}" cannot move to "${next}". Allowed: ${allowed.join(', ') || 'none'}`);
  }
}

export type ReviewRepairPhasePlan =
  | { readonly ok: true; readonly phases: readonly ReviewPhase[] }
  | { readonly ok: false; readonly failure: {
    readonly kind: 'invalid-phase' | 'approval-revocation-required';
    readonly message: string;
  } };

/**
 * Plan only legal phase moves into repair. An effective approval must first be
 * revoked through the review aggregate, which opens a fresh reviewing round.
 */
export function planReviewRepairPhases(current: unknown): ReviewRepairPhasePlan {
  const phase = parseReviewPhase(current);
  if (phase === null) {
    return { ok: false, failure: { kind: 'invalid-phase', message: `Cannot repair from invalid review phase: ${String(current)}` } };
  }
  if (phase === 'approved') {
    return { ok: false, failure: { kind: 'approval-revocation-required',
      message: 'An effective approval must be revoked before repair can begin' } };
  }
  const phases: readonly ReviewPhase[] = phase === 'fixing' ? []
    : phase === 'pending-approval' ? ['reviewing', 'fixing'] : ['fixing'];
  let prior: ReviewPhase = phase;
  for (const next of phases) { assertReviewPhaseTransition(prior, next); prior = next; }
  return { ok: true, phases };
}
