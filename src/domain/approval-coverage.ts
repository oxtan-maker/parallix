import {
  changeRevision,
  currentReviewRound,
  reviewStatus,
  type ChangeRevision,
  type Review,
  type ReviewDecisionSupersession,
} from './review.js';

/**
 * Git trailer that marks a commit Parallix made for its own bookkeeping on a
 * mission branch (TASK-2620).  Only these commits may follow an approved
 * revision without a new review: an approval of A covers A plus recognised
 * bookkeeping, and nothing else.
 */
export const BOOKKEEPING_TRAILER = 'Parallix-Bookkeeping';

/** The bookkeeping Parallix commits: the Backlog mirror and the integrate pre-commit hook. */
export type BookkeepingKind = 'backlog-mirror' | 'pre-commit-hook';

const BOOKKEEPING_KINDS: ReadonlySet<string> = new Set<BookkeepingKind>(['backlog-mirror', 'pre-commit-hook']);

/** A commit message that carries the bookkeeping trailer. */
export function bookkeepingCommitMessage(subject: string, kind: BookkeepingKind): string {
  return `${subject}\n\n${BOOKKEEPING_TRAILER}: ${kind}`;
}

/** Whether a commit's bookkeeping trailer value names a recognised kind. */
export function isBookkeepingKind(value: string): value is BookkeepingKind {
  return BOOKKEEPING_KINDS.has(value.trim());
}

/**
 * Whether the current effective approval still covers what the branch would
 * land (TASK-2555).
 *
 * An approval is given to a reviewed change.  When the branch later moves — a
 * rebase whose conflicts were resolved differently, a re-scope, a repair — the
 * approval is not unfounded, it is simply about different code.  This is a
 * mechanical fact about recorded revisions, so it is computed, never asked of
 * an operator, and it is never a request for changes: nothing is owed a
 * resolution, the new revision simply has to be reviewed.
 *
 * `unverifiable` is reported rather than guessed: an approval recorded against
 * a placeholder revision, or a branch that cannot be read, is neither proven
 * current nor proven stale.
 */
export type ApprovalCoverage =
  | { readonly kind: 'covers'; readonly round: number; readonly approvedRevision: ChangeRevision }
  | {
    readonly kind: 'stale';
    readonly round: number;
    readonly approvedRevision: ChangeRevision;
    readonly landedRevision: ChangeRevision;
    /** The branch move that recorded the staleness, or null when only computed. */
    readonly recorded: ReviewDecisionSupersession | null;
  }
  | { readonly kind: 'unverifiable'; readonly round: number; readonly approvedRevision: ChangeRevision; readonly reason: string };

/**
 * What the branch would land now, compared with the approved revision by an
 * adapter that can read the repository.  `sameChange` is `null` when either
 * side has no readable change identity.
 */
export interface LandedChangeObservation {
  readonly landedRevision: ChangeRevision | null;
  readonly sameChange: boolean | null;
}

/** The current round's approval while it is still the effective decision. */
function effectiveApproval(review: Review | null) {
  if (!review || reviewStatus(review) !== 'approved') { return null; }
  const round = currentReviewRound(review);
  // A legacy round that recorded no reviewed subject has nothing to compare.
  if (!round.subject?.revision) { return null; }
  return round.decision?.kind === 'approved' ? { round, decision: round.decision } : null;
}

/**
 * Assess the current effective approval against the observed branch.  Returns
 * `null` when there is no effective approval to cover anything.  A recorded
 * supersession is authoritative: once the branch moved away from the approved
 * change, moving back does not silently restore an approval that was reported
 * as no longer covering the work.
 */
export function assessApprovalCoverage(
  review: Review | null,
  observation: LandedChangeObservation | null,
): ApprovalCoverage | null {
  const effective = effectiveApproval(review);
  if (!effective) { return null; }
  const round = effective.round.number;
  const approvedRevision = effective.round.subject.revision;
  const recorded = effective.decision.supersession ?? null;
  if (recorded) {
    return { kind: 'stale', round, approvedRevision, landedRevision: recorded.supersedingRevision, recorded };
  }
  if (!observation?.landedRevision) {
    return { kind: 'unverifiable', round, approvedRevision, reason: 'the branch revision cannot be read' };
  }
  if (observation.landedRevision === approvedRevision || observation.sameChange === true) {
    return { kind: 'covers', round, approvedRevision };
  }
  if (observation.sameChange === null) {
    return { kind: 'unverifiable', round, approvedRevision, reason: `approved revision ${approvedRevision} is not a readable commit` };
  }
  return { kind: 'stale', round, approvedRevision, landedRevision: observation.landedRevision, recorded: null };
}

/**
 * Record that a branch move superseded the current effective approval.  The
 * approval stays effective and in history; only an operator's stand-down
 * (`px revoke-review`) opens the new round.  Recording twice keeps the
 * first move: that is the moment the approval stopped covering the work.
 */
export function recordApprovalSuperseded(
  review: Review,
  supersession: { readonly supersededAt: string; readonly supersedingRevision: string; readonly recordedBy: string },
): Review {
  const effective = effectiveApproval(review);
  if (!effective) { throw new Error('Only a current effective approval can be superseded'); }
  if (effective.decision.supersession) { return review; }
  if (!supersession.supersededAt.trim() || !supersession.recordedBy.trim()) {
    throw new Error('A supersession requires a time and the operation that moved the branch');
  }
  const round = {
    ...effective.round,
    decision: {
      ...effective.decision,
      supersession: {
        supersededAt: supersession.supersededAt,
        supersedingRevision: changeRevision(supersession.supersedingRevision),
        recordedBy: supersession.recordedBy,
      },
    },
  };
  return { ...review, rounds: [...review.rounds.slice(0, -1), round] as unknown as Review['rounds'] };
}

/** Operator-facing sentence for a stale approval; never phrased as requested changes. */
export function staleApprovalSentence(coverage: Extract<ApprovalCoverage, { kind: 'stale' }>): string {
  const how = coverage.recorded ? ` (recorded by ${coverage.recorded.recordedBy} at ${coverage.recorded.supersededAt})` : '';
  return `Approval from round ${coverage.round} covers revision ${coverage.approvedRevision}, `
    + `no longer what the branch would land (${coverage.landedRevision})${how}. `
    + 'No changes were requested; the new revision needs a fresh review.';
}
