import { pendingIntegrationApproval } from '../../domain/integration-repair-policy.js';
import { currentReviewRound, type Review } from '../../domain/review.js';
import type { MissionLoadResult } from '../domain-ports.js';
import type { IntegrationApproval } from '../ports/integration-records.js';
import type { IntegrationMissionServices } from '../ports/integration-records.js';
import type { IntegrationContext } from './context.js';
/**
 * Integration approval policy: which authority lets a Mission integrate, and
 * what recovery would establish for a run that has not recovered yet. Pure
 * apart from the injected lifecycle state-name mapping.
 */
import { reviewStatus } from '../../domain/review.js';
import type { IntegrateStateMapPort, IntegrateWorkflowPorts } from '../ports/integrate-workflow.js';
import { fixedVerificationNextAction } from '../verification-policy/fixed-next-action.js';
import { completeCurrentTestsPass } from './tests-action.js';
import { abortWith } from './support.js';

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
export function resolveAuthoritativeApprovalAt(approval: IntegrationApproval | null | undefined): string | undefined {
  if (!approval || approval.ok !== true) {return undefined;}
  if (approval.defaultUserApproved) {return approval.defaultUserApprovedAt;}
  if (approval.operatorApproved) {return approval.operatorApprovedAt;}
  if (approval.reviewerApproved) {return approval.reviewerApprovedAt;}
  return undefined;
}

function rejectedRecovery(reason: string): RecoveryDecision {
  return { established: false, via: null, reason };
}

function activeRecovery(review: Review | null | undefined, overrideAt: string | undefined): RecoveryDecision {
  if (!review && overrideAt === undefined) {
    return rejectedRecovery('active with no authoritative Review and no default-user override; run px review <slug> before integration');
  }
  if (!review) { return { established: true, via: 'human-override', decidedAt: overrideAt, reason: '' }; }
  const roundStatus = reviewStatus(review);
  if (overrideAt !== undefined && (roundStatus === 'awaiting-review' || roundStatus === 'ready-for-next-round')) {
    return { established: true, via: 'human-override', decidedAt: overrideAt, reason: '' };
  }
  return rejectedRecovery(`existing Review is ${roundStatus}; resolve the round before overriding`);
}

function reviewRecovery(review: Review | null | undefined, overrideAt: string | undefined): RecoveryDecision {
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
function activeApprovalNeedsProvider(context: IntegrationContext, lastRound: NonNullable<IntegrationContext['missionReview']>['rounds'][number] | null | undefined, overrideAt: string | undefined) {
  const status = context.missionStatus;
  return ( status === 'active'
    && lastRound?.decision?.kind === 'approved'
    && overrideAt === undefined
    && context.approval?.providerDisabled !== true);
}

export function recoveryEstablishesApproval(context: IntegrationContext): RecoveryDecision {
  const status = context.missionStatus;
  if (status && pendingIntegrationApproval({ status, review: context.missionReview ?? null })) {
    return rejectedRecovery('Integration repair is pending; historical approval does not establish landing eligibility');
  }
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
  const activeStoredApprovalWithoutProvider = activeApprovalNeedsProvider(context, lastRound, overrideAt);
  if (lastRound?.decision?.kind === 'approved' && !activeStoredApprovalWithoutProvider) {
    return { established: true, via: 'mission-review', decidedAt: lastRound.decision.decidedAt, reason: '' };
  }

  if (status === 'active') { return activeRecovery(review, overrideAt); }
  if (status === 'review') { return reviewRecovery(review, overrideAt); }
  return rejectedRecovery(`status ${status} is not recoverable to integration`);
}

/** Whether the Mission (or a pre-store task) status lets integration proceed. */
function storedApprovalWithoutProvider(context: IntegrationContext) {
  const missionStatus = context.missionStatus ?? context.taskStatus;
  const latestRound = context.missionReview?.rounds?.at(-1);
  return missionStatus === 'active' && latestRound?.decision?.kind === 'approved' && resolveAuthoritativeApprovalAt(context.approval) === undefined;
}

function providerApprovedStatus(context: IntegrationContext, missionStatus: string | undefined): TaskStatusCheck | null {
  const reviewApproved = context.approval?.ok && context.approval.reviewState === 'APPROVED';
  const localApproved = context.approval?.source === 'local-review-state';
  if (missionStatus === 'review' && (reviewApproved || localApproved)) {
    const reason = localApproved
      ? 'local review-state: approved'
      : `latest formal review state is ${context.approval.reviewState}`;
    return { ok: true, level: 'warn', message: `Mission status: review accepted for integration because ${reason}` };
  }

  return null;
}

function approvedReviewRequiresShortcut(context: IntegrationContext): boolean {
  const missionStatus = context.missionStatus ?? context.taskStatus;
  const latestDecision = context.missionReview ? currentReviewRound(context.missionReview).decision : null;
  return missionStatus === 'review' && latestDecision?.kind === 'approved'
    && !recordedHumanProviderApproval(context.approval);
}

export function evaluateTaskStatusForIntegration(context: IntegrationContext, stateMap: IntegrateStateMapPort): TaskStatusCheck {
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

  if (approvedReviewRequiresShortcut(context)) {
    return {
      ok: true,
      level: 'warn',
      message: `Mission status: ${stateMap.toVirtual(missionStatus, stateMapOptions)} has an approved Review; px integrate will verify that the agent approval and complete passing integration-test action are current before recording the human approval`,
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

  if (storedApprovalWithoutProvider(context)) {
    return {
      ok: false,
      level: 'fail',
      message: 'Mission status: active has a stored approval without the required qualifying provider approval; refresh provider review state before integration.',
    };
  }

  const providerStatus = providerApprovedStatus(context, missionStatus);
  if (providerStatus !== null) { return providerStatus; }

  return {
    ok: false,
    level: 'fail',
    message: `Mission status: expected approved, or review with an approved Forgejo PR; found ${stateMap.toVirtual(missionStatus, stateMapOptions)}`,
  };
}

function recordedHumanProviderApproval(approval: IntegrationApproval): boolean {
  return approval.defaultUserApproved === true || approval.operatorApproved === true
    || approval.reviewerApproved === true;
}

interface CapturedIntegrationShortcutEvidence {
  readonly ok: true;
  readonly head: string | null;
  readonly reviewedRevision: string | null;
  readonly agentReviewCurrent: boolean;
  readonly testsConfigured: boolean;
  readonly testsCurrent: boolean;
  readonly action: ReturnType<typeof fixedVerificationNextAction>;
}

interface FailedIntegrationShortcutEvidence {
  readonly ok: false;
  readonly error: string;
}

type IntegrationShortcutEvidence = CapturedIntegrationShortcutEvidence | FailedIntegrationShortcutEvidence;

function agentApprovalCoversHead(mission: Extract<MissionLoadResult, { kind: 'found' }>['mission'],
  checkout: string, head: string | null, ports: IntegrateWorkflowPorts): boolean {
  if (head === null || !mission.review?.rounds.length) { return false; }
  const round = currentReviewRound(mission.review);
  if (round.decision?.kind !== 'approved') { return false; }
  if (round.decision.revision === head) { return true; }
  return ports.gates.approvalCoverage?.(checkout, mission.review)?.kind === 'covers';
}

function integrationShortcutEvidence(context: IntegrationContext,
  mission: Extract<MissionLoadResult, { kind: 'found' }>['mission'], ports: IntegrateWorkflowPorts): IntegrationShortcutEvidence {
  const checkout = ports.gates.resolveIntegrationVerificationWorktree(context.slug, { baseWorktree: context.baseWorktree });
  const tree = ports.gates.captureFinalIntegrationTree(checkout);
  if (!tree.ok) {
    return { ok: false, error: tree.error ?? `Unable to capture the finalized integration tree at ${checkout}` };
  }
  const head = tree.commit ?? null;
  const round = mission.review?.rounds.length ? currentReviewRound(mission.review) : null;
  const reviewedRevision = round?.decision?.kind === 'approved' ? round.decision.revision ?? null : null;
  const agentReviewCurrent = agentApprovalCoversHead(mission, checkout, head, ports);
  const configuredTests = ports.gates.loadPhaseGates(checkout, 'preIntegration');
  const testsCurrent = completeCurrentTestsPass(ports.gates.readGateRun?.(checkout) ?? null, head,
    configuredTests);
  return { ok: true, head, reviewedRevision, agentReviewCurrent, testsConfigured: configuredTests.length > 0, testsCurrent,
    action: fixedVerificationNextAction({ mission, agentReviewCurrent, testsCurrent }) };
}

function eligibleIntegrationShortcut(evidence: CapturedIntegrationShortcutEvidence): evidence is CapturedIntegrationShortcutEvidence & {
  head: string;
  reviewedRevision: string;
} {
  return evidence.action.kind === 'human-review' && evidence.action.reason === 'integrate-shortcut-eligible'
    && evidence.head !== null && evidence.reviewedRevision !== null;
}

async function submitIntegrationShortcutApproval(context: IntegrationContext, missionServices: IntegrationMissionServices,
  ports: IntegrateWorkflowPorts, revision: string, reviewedRevision: string): Promise<Awaited<ReturnType<IntegrateWorkflowPorts['review']['submitApproval']>>> {
  try {
    return await ports.review.submitApproval(context.slug,
      'Approved by the operator through px integrate after current agent review and integration tests passed.',
      { executionContext: context.executionContext, missionServices, revision, reviewedRevision });
  } catch (error) {
    throw abortWith(ports.landing, `Human approval submission failed for ${context.slug}: ${error instanceof Error ? error.message : String(error)}. Integration was not authorized.`);
  }
}

function shortcutRefusal(slug: string, head: string | null, agentReviewCurrent: boolean,
  testsConfigured: boolean, testsCurrent: boolean, action: ReturnType<typeof fixedVerificationNextAction>): string {
  const revision = head ?? 'unknown';
  if (!agentReviewCurrent) {
    return `px integrate cannot count as the human approval for ${slug}: agent review does not approve the current revision ${revision}. Run px review ${slug} for the current change, then retry.`;
  }
  if (!testsCurrent) {
    if (!testsConfigured) {
      return `px integrate cannot count as the human approval for ${slug}: no preIntegration gates are configured, so no passing integration-test action can be recorded. Configure at least one preIntegration gate, run px integrate ${slug} --dry-run, then retry.`;
    }
    return `px integrate cannot count as the human approval for ${slug}: current revision ${revision} has no complete current passing integration-test action. Run px integrate ${slug} --dry-run to produce current test evidence, then retry.`;
  }
  return `px integrate cannot count as the human approval for ${slug}: fixed verification requires ${action.kind} (${action.reason}). Resolve that action, then retry.`;
}

/**
 * Admit exactly the operator-approved shortcut. Ordinary integration and a
 * standing human provider approval keep using lifecycle recovery. Otherwise
 * the current agent decision and the gate owner's complete current run must
 * make the sole next-action owner return the shortcut reason before the
 * existing review-submission owner may write anything.
 */
export async function approveEligibleIntegrationShortcut(context: IntegrationContext,
  missionLoad: Extract<MissionLoadResult, { kind: 'found' }>, missionServices: IntegrationMissionServices,
  ports: IntegrateWorkflowPorts): Promise<void> {
  const mission = missionLoad.mission;
  if (mission.status !== 'review' || recordedHumanProviderApproval(context.approval)) { return; }
  const evidence = integrationShortcutEvidence(context, mission, ports);
  if (!evidence.ok) {
    throw abortWith(ports.landing, evidence.error);
  }
  if (!eligibleIntegrationShortcut(evidence)) {
    throw abortWith(ports.landing, shortcutRefusal(context.slug, evidence.head,
      evidence.agentReviewCurrent, evidence.testsConfigured, evidence.testsCurrent, evidence.action));
  }
  const submitted = await submitIntegrationShortcutApproval(context, missionServices, ports,
    evidence.head, evidence.reviewedRevision);
  if (!submitted.ok) {
    throw abortWith(ports.landing, `Human approval submission failed for ${context.slug}: ${submitted.diagnostic ?? 'review provider refused the approval'}. Integration was not authorized.`);
  }
  const reloaded = await missionServices.store.load(missionLoad.mission.id);
  if (reloaded.kind !== 'found' || reloaded.mission.status !== 'integration') {
    throw abortWith(ports.landing, `Human approval for ${context.slug} did not commit the integration lifecycle transition. Retry px integrate ${context.slug}; the approval owner will replay without duplicating the verdict.`);
  }
  context.promoteBacklogOnCloseout ||= mission.status === 'review';
  context.missionStatus = 'integration';
  context.missionReview = reloaded.mission.review;
  context.missionVersion = reloaded.version;
}
