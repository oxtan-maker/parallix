/**
 * Integration approval policy: which authority lets a Mission integrate, and
 * what recovery would establish for a run that has not recovered yet. Pure
 * apart from the injected lifecycle state-name mapping.
 */
import { reviewStatus } from '../../domain/review.js';
import type { IntegrateStateMapPort } from '../ports/integrate-workflow.js';

export interface RecoveryDecision {
  established: boolean;
  via: 'lifecycle' | 'mission-review' | 'human-override' | null;
  decidedAt?: string;
  reason: string;
}

export interface TaskStatusCheck {
  ok: boolean;
  level: 'pass' | 'warn' | 'fail';
  message: string;
}

/**
 * Resolve the authoritative provider-approval timestamp recovery may turn into a
 * ReviewerDecision. TASK-2420: an APPROVED by the assigned/configured reviewer
 * (reviewerApproved/reviewerApprovedAt) qualifies on the same footing as the repo
 * default user's approval (defaultUserApproved/defaultUserApprovedAt). The
 * default-user approval wins only when both are present; the qualifier is the
 * approval's own provider timestamp, never the recovery wall clock (SC5).
 */
export function resolveAuthoritativeApprovalAt(approval: any): string | undefined {
  if (!approval || approval.ok !== true) {return undefined;}
  if (approval.defaultUserApproved) {return approval.defaultUserApprovedAt;}
  if (approval.operatorApproved) {return approval.operatorApprovedAt;}
  if (approval.reviewerApproved) {return approval.reviewerApprovedAt;}
  return undefined;
}

function rejectedRecovery(reason: string): RecoveryDecision {
  return { established: false, via: null, reason };
}

function activeRecovery(review: any, overrideAt: string | undefined): RecoveryDecision {
  if (!review && overrideAt === undefined) {
    return rejectedRecovery('active with no authoritative Review and no default-user override; run px review <slug> --start before integration');
  }
  if (!review) { return { established: true, via: 'human-override', decidedAt: overrideAt, reason: '' }; }
  const roundStatus = reviewStatus(review);
  if (overrideAt !== undefined && (roundStatus === 'awaiting-review' || roundStatus === 'ready-for-next-round')) {
    return { established: true, via: 'human-override', decidedAt: overrideAt, reason: '' };
  }
  return rejectedRecovery(`existing Review is ${roundStatus}; resolve the round before overriding`);
}

function reviewRecovery(review: any, overrideAt: string | undefined): RecoveryDecision {
  if (review && overrideAt !== undefined && reviewStatus(review) === 'awaiting-review') {
    return { established: true, via: 'human-override', decidedAt: overrideAt, reason: '' };
  }
  return rejectedRecovery('review without an authoritative approval; record a ReviewerDecision through px review');
}

/**
 * Review round 1 (F3): pure prediction of the authority the real
 * `px integrate` run would establish through recovery. The real run persists
 * it; a dry run skips recovery, so it reports the same decision without
 * persisting. Both consume this one function, so `--dry-run` can never fail
 * for the case the real run accepts.
 */
export function recoveryEstablishesApproval(context: any): RecoveryDecision {
  const status = context.missionStatus;
  if (status === 'integration' || status === 'done') {
    return { established: true, via: 'lifecycle', reason: '' };
  }
  const review = context.missionReview;
  const rounds = review?.rounds;
  const lastRound = rounds && rounds.length > 0 ? rounds[rounds.length - 1] : null;
  const overrideAt = resolveAuthoritativeApprovalAt(context.approval);

  // An active Mission's persisted decision still needs current provider
  // corroboration (unless the provider is disabled), matching recovery's
  // active→review guard. Without this, dry-run reports READY while the real
  // run refuses the same stale approval.
  const activeStoredApprovalWithoutProvider = status === 'active'
    && lastRound?.decision?.kind === 'approved'
    && overrideAt === undefined
    && context.approval?.providerDisabled !== true;
  if (lastRound?.decision?.kind === 'approved' && !activeStoredApprovalWithoutProvider) {
    return { established: true, via: 'mission-review', decidedAt: lastRound.decision.decidedAt, reason: '' };
  }

  if (status === 'active') { return activeRecovery(review, overrideAt); }
  if (status === 'review') { return reviewRecovery(review, overrideAt); }
  return rejectedRecovery(`status ${status} is not recoverable to integration`);
}

/** Whether the Mission (or a pre-store task) status lets integration proceed. */
export function evaluateTaskStatusForIntegration(context: any, stateMap: IntegrateStateMapPort): TaskStatusCheck {
  const missionStatus = context.missionStatus ?? context.taskStatus;
  // The state map treats this argument as its map; the shape is preserved from
  // the pre-extraction command so lifecycle names resolve exactly as before.
  const stateMapOptions = { rootDir: context.baseWorktree };
  if (stateMap.toVirtual(missionStatus, stateMapOptions) === 'approved') {
    return { ok: true, level: 'pass', message: `Backlog status: approved` };
  }

  // The Mission lifecycle is the approval authority (TASK-2379). Backlog
  // status is only a closeout representation and never an integration gate.
  if (missionStatus === 'integration' || missionStatus === 'done') {
    return {
      ok: true,
      level: 'pass',
      message: `Backlog status follows the Mission lifecycle (${context.missionStatus}); promotion happens at closeout`,
    };
  }

  // Review round 1 (F3): a dry run has not run recovery yet, so
  // missionStatus still reflects the stale store state. Predict the same
  // authority the real run would establish and report it; the real run
  // persists it instead.
  const recovery = recoveryEstablishesApproval(context);
  if (recovery.established && recovery.via !== 'lifecycle') {
    const how = recovery.via === 'human-override'
      ? `the provider approval (${recovery.decidedAt}) would be recorded as an authoritative ReviewerDecision`
      : `the Mission Review already records an authoritative approval (${recovery.decidedAt})`;
    return {
      ok: true,
      level: 'warn',
      message: `Mission status: ${stateMap.toVirtual(missionStatus, stateMapOptions)} accepted for integration because ${how} and recovery would move the Mission to integration`,
    };
  }

  const latestRound = context.missionReview?.rounds?.at(-1);
  if (missionStatus === 'active' && latestRound?.decision?.kind === 'approved' && resolveAuthoritativeApprovalAt(context.approval) === undefined) {
    return {
      ok: false,
      level: 'fail',
      message: 'Mission status: active has a stored approval without the required qualifying provider approval; refresh provider review state before integration.',
    };
  }

  const reviewApproved = context.approval?.ok && context.approval.reviewState === 'APPROVED';
  const localApproved = context.approval?.source === 'local-review-state';
  if (missionStatus === 'review' && (reviewApproved || localApproved)) {
    const reason = localApproved
      ? 'local review-state: approved'
      : `latest formal review state is ${context.approval.reviewState}`;
    return { ok: true, level: 'warn', message: `Mission status: review accepted for integration because ${reason}` };
  }

  return {
    ok: false,
    level: 'fail',
    message: `Mission status: expected approved, or review with an approved Forgejo PR; found ${stateMap.toVirtual(missionStatus, stateMapOptions)}`,
  };
}
