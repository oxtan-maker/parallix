import type { ChangeRevision } from './review.js';

export type ReviewApprovalSource =
  | { readonly kind: 'provider'; readonly provider: string }
  | { readonly kind: 'local' };

/**
 * Why an approval was withdrawn, as a typed fact rather than reason text.
 * `integration-gate-failure` names the red gate so the repaired mission can
 * show the human what failed last time (TASK-2620).
 */
export type ReviewRevocationCause =
  | { readonly kind: 'operator' }
  | {
    readonly kind: 'integration-gate-failure';
    readonly gate: string | null;
    readonly command?: string | null;
    /** Tail of the failed gate's output, kept so the repair can be reviewed with it. */
    readonly log?: string | null;
  }
  | { readonly kind: 'review-repair' }
  | { readonly kind: 'rebase-repair' };

/** An operator correction of an approval that must remain auditable. */
export interface ReviewDecisionRevocation {
  readonly revokedAt: string;
  readonly revokedBy: string;
  readonly reason: string;
  /** Absent only on revocations recorded before causes were typed. */
  readonly cause?: ReviewRevocationCause;
}

/**
 * A branch move recorded against an approval: the approved change is no longer
 * what the branch would land.  Unlike a revocation this is a mechanical fact,
 * not a judgement; the approval stays effective until an operator stands it
 * down, and nothing is owed a resolution.
 */
export interface ReviewDecisionSupersession {
  readonly supersededAt: string;
  /** The branch revision whose change the approval no longer covers. */
  readonly supersedingRevision: ChangeRevision;
  /** The operation that moved the branch, for example `px rebase`. */
  readonly recordedBy: string;
}

export interface OperatorReviewSource { readonly kind: 'operator'; readonly author: string }

/** Preserve checked human attribution without assigning a source to reviewer decisions. */
export function operatorDecisionSource(source?: OperatorReviewSource): { source?: OperatorReviewSource } {
  if (!source) { return {}; }
  if (source.kind !== 'operator' || !source.author.trim()) { throw new Error('Operator correction requires an author'); }
  return { source };
}

