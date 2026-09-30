import {
  assessApprovalCoverage,
  recordApprovalSuperseded,
  type ApprovalCoverage,
  staleApprovalSentence,
  type LandedChangeObservation,
} from '../domain/approval-coverage.js';
import { changeRevision, currentReviewRound, type Review } from '../domain/review.js';
import { missionId } from '../domain/mission.js';
import type { MissionStore } from './domain-ports.js';

/**
 * Repository reads the staleness rule needs.  A change identity names what a
 * revision would land relative to its target branch, so a clean rebase that
 * replays the identical change keeps its identity while a rebase that resolves
 * conflicts differently, a re-scope, or a repair does not.
 */
export interface ChangeIdentityPort {
  /** The commit the branch points at, or null when it cannot be read. */
  branchHead(_branch: string): string | null;
  /** Identity of the change `revision` would land onto `target`, or null when `revision` is not a readable commit. */
  changeIdentity(_revision: string, _target: string): string | null;
  /**
   * Whether `to` is `from` plus only recognised Parallix bookkeeping commits
   * (TASK-2620); null when either side is not a readable commit.
   */
  onlyBookkeepingSince?(_from: string, _to: string): boolean | null;
}

/**
 * Observe what the approved branch would land now.  `movedFrom` is the branch
 * revision an operation started from; it stands in for an approval recorded
 * against a placeholder revision, which names no commit to compare with.
 */
export function observeLandedChange(
  review: Review | null,
  identity: ChangeIdentityPort,
  move: { readonly landedRevision?: string | null; readonly movedFrom?: string | null } = {},
): LandedChangeObservation | null {
  const subject = review ? currentReviewRound(review).subject : null;
  if (!subject?.revision) { return null; }
  const { change, revision } = subject;
  const landed = move.landedRevision ?? identity.branchHead(change.sourceBranch);
  if (!landed) { return { landedRevision: null, sameChange: null }; }
  if (landed === revision || identity.onlyBookkeepingSince?.(revision, landed) === true) {
    return { landedRevision: changeRevision(landed), sameChange: true };
  }
  const approvedId = identity.changeIdentity(revision, change.targetBranch)
    ?? (move.movedFrom ? identity.changeIdentity(move.movedFrom, change.targetBranch) : null);
  const landedId = approvedId === null ? null : identity.changeIdentity(landed, change.targetBranch);
  return {
    landedRevision: changeRevision(landed),
    sameChange: approvedId === null || landedId === null ? null : approvedId === landedId,
  };
}

/** Coverage of a mission's current effective approval, computed with no operator input. */
export function missionApprovalCoverage(review: Review | null, identity: ChangeIdentityPort): ApprovalCoverage | null {
  return assessApprovalCoverage(review, observeLandedChange(review, identity));
}

/** Coverage known without reading the repository: only a recorded branch move. */
export function recordedApprovalCoverage(review: Review | null): ApprovalCoverage | null {
  const coverage = assessApprovalCoverage(review, null);
  return coverage?.kind === 'stale' ? coverage : null;
}

/** The staleness already reported for the effective approval, as an operator sentence, or null. */
export function reportedApprovalStaleness(review: Review | null): string | null {
  const coverage = recordedApprovalCoverage(review);
  return coverage?.kind === 'stale' ? staleApprovalSentence(coverage) : null;
}

export type BranchMoveRecording =
  | { readonly outcome: 'no-approval' }
  | { readonly outcome: 'covers' }
  | { readonly outcome: 'unverifiable'; readonly reason: string }
  | { readonly outcome: 'recorded'; readonly coverage: Extract<ApprovalCoverage, { kind: 'stale' }> };

/**
 * Record, at the moment an operation moved the branch, that the current
 * effective approval no longer covers it.  This writes an audit fact only: the
 * approval stays in history and stays effective, no round is opened, no lane
 * moves and nothing is approved.  Standing the approval down is the operator's
 * `px revoke-review`, never this path, so an automated caller (the review
 * loop's pre-review rebase) cannot clear its own way to integration.
 */
export async function recordBranchMove(request: {
  readonly store: MissionStore;
  readonly slug: string;
  readonly identity: ChangeIdentityPort;
  readonly landedRevision: string;
  readonly movedFrom: string | null;
  readonly recordedBy: string;
  readonly occurredAt: string;
}): Promise<BranchMoveRecording> {
  const loaded = await request.store.load(missionId(request.slug));
  if (loaded.kind !== 'found' || loaded.mission.status === 'done') { return { outcome: 'no-approval' }; }
  const review = loaded.mission.review;
  const coverage = assessApprovalCoverage(review, observeLandedChange(review, request.identity, { landedRevision: request.landedRevision, movedFrom: request.movedFrom }));
  if (!coverage || !review) { return { outcome: 'no-approval' }; }
  if (coverage.kind === 'covers') { return { outcome: 'covers' }; }
  if (coverage.kind === 'unverifiable') { return { outcome: 'unverifiable', reason: coverage.reason }; }
  if (coverage.recorded) { return { outcome: 'recorded', coverage }; }
  const superseded = recordApprovalSuperseded(review, {
    supersededAt: request.occurredAt,
    supersedingRevision: coverage.landedRevision,
    recordedBy: request.recordedBy,
  });
  await request.store.save({ ...loaded.mission, review: superseded }, loaded.version);
  const recorded = assessApprovalCoverage(superseded, null);
  return { outcome: 'recorded', coverage: recorded as Extract<ApprovalCoverage, { kind: 'stale' }> };
}

/** Operator-facing line for a recorded branch move, or null when nothing changed for the approval. */
export function describeBranchMove(slug: string, recording: BranchMoveRecording): string | null {
  if (recording.outcome === 'recorded') {
    return `${staleApprovalSentence(recording.coverage)} A human operator, never an agent, stands it down for re-review with `
      + `px revoke-review --slug ${slug} --decision ${recording.coverage.round} --reason <text> --operator <name> --expected-version <n>.`;
  }
  if (recording.outcome === 'unverifiable') {
    return `The rebase moved ${slug} under an approval whose coverage cannot be checked: ${recording.reason}.`;
  }
  return null;
}
