/**
 * Lifecycle recovery before integration: repair interrupted orchestration
 * through workflow operations (never by assigning Mission.status), record a
 * late-observed provider approval as a real ReviewerDecision, and promote the
 * Backlog task only after the durable lifecycle transition.
 */
import * as fmt from '../presentation/cli-format.js';
import { missionId } from '../../domain/mission.js';
import { applyReviewerCommand, ConfiguredReviewerEligibility, reviewStatus } from '../../domain/review.js';
import { agentFamily } from '../../domain/agents.js';
import { evaluateTaskStatusForIntegration, resolveAuthoritativeApprovalAt } from './approval.js';
import { abortWith, resolveIntegrationTaskPath } from './support.js';
import type { IntegrateReviewPort, IntegrateWorkflowPorts } from '../ports/integrate-workflow.js';

export interface MissionRecoveryOptions {
  missionServices: any;
  missionLoad?: any;
  submitForReviewFn?: IntegrateReviewPort['submitForReview'];
}

export function createMissionRecovery(ports: IntegrateWorkflowPorts) {
  const { backlog, landing } = ports;
  const lastRound = (review: any) => review.rounds[review.rounds.length - 1];

  /**
   * Persist an explicit human override as a real `ReviewerDecision` through the
   * Review domain, returning the reloaded mission (TASK-2379 Part E). The
   * override is authoritative Review data — never an integrate-local boolean —
   * and it keeps its own timestamp: the approval happened on the provider at
   * `overrideApprovedAt`, recovery merely observes it late.
   *
   * Returns null when the Review is not awaiting a decision (the domain refuses
   * to rewrite an already-decided round) or when persistence fails.
   */
  async function recordHumanOverrideDecision(context: any, missionServices: any, missionLoad: any, overrideApprovedAt: string): Promise<any | null> {
    const review = missionLoad.mission.review;
    if (reviewStatus(review) !== 'awaiting-review') {
      fmt.log.fail(`Human override cannot be recorded for ${context.slug}: the Review is ${reviewStatus(review)}, not awaiting a decision. Resolve the current round (or start a new one with px review ${context.slug} --start) before overriding.`);
      return null;
    }
    const decidedReview = applyReviewerCommand(review, {
      type: 'approve',
      decidedAt: overrideApprovedAt,
      comment: null,
      source: { kind: 'provider', provider: 'forgejo' },
    });
    try {
      await missionServices.store.save({ ...missionLoad.mission, review: decidedReview }, missionLoad.version);
    } catch (error) {
      fmt.log.fail(`Could not persist the human override decision for ${context.slug}: ${(error as Error).message}`);
      return null;
    }
    const reloaded = await missionServices.store.load(missionId(context.slug));
    return reloaded.kind === 'found' ? reloaded : null;
  }

  /**
   * Move an active Mission to review at an authoritative review-entry time.
   *
   * Review round 1 (F1): recovery must not stamp the recovered
   * active → review transition with its own wall clock — a wall-clock
   * entry postdates the stored approval and the projection silently drops
   * the resulting negative review dwell. The entry time comes from an
   * authoritative source: the Review round's own startedAt, or, when
   * recovery creates the Review through the handoff operation, the PR
   * creation time of the PR the provider approval was recorded on.
   */
  async function recoverActiveMission(context: any, missionServices: any, missionLoad: any, overrideApprovedAt: string | undefined, submitForReviewFn: IntegrateReviewPort['submitForReview']) {
    const slugId = missionId(context.slug);
    if (!missionLoad.mission.review && overrideApprovedAt === undefined) {
      throw abortWith(landing, `Mission ${slugId} is active with no authoritative Review. Run px review ${context.slug} --start (or record a human decision through px review) before integration.`);
    }
    const entryRound = missionLoad.mission.review?.rounds?.length ? lastRound(missionLoad.mission.review) : null;
    // A stored approval alone is not authority while a review provider exists:
    // the provider approval must corroborate it. When no review provider is
    // configured (`review.provider !== 'forgejo'`), there is no provider state
    // to refresh and the stored ReviewerDecision is the only approval
    // authority there can be — requiring a provider approval would make such a
    // repository permanently unintegratable.
    const providerlessStoredApproval = context.approval?.ok === true && context.approval.providerDisabled === true;
    if (entryRound?.decision?.kind === 'approved' && overrideApprovedAt === undefined && !providerlessStoredApproval) {
      throw abortWith(landing, `Mission ${slugId} has a stored approval without the required provider approval. Refresh provider review state before integration.`);
    }
    let reviewEntryAt = entryRound?.startedAt;
    if (!reviewEntryAt && typeof context.pr?.createdAt === 'string' && context.pr.createdAt) {
      reviewEntryAt = context.pr.createdAt;
    }
    if (!reviewEntryAt) {
      throw abortWith(landing, `Cannot derive an authoritative review-entry timestamp for ${context.slug}: no Review round startedAt and no PR creation time. Re-run px review ${context.slug} --start to record the review entry, or record the decision through px review, before integration.`);
    }
    const approvalAt = (entryRound?.decision?.kind === 'approved' ? entryRound.decision.decidedAt : undefined) ?? overrideApprovedAt;
    const entryMs = Date.parse(reviewEntryAt);
    const approvalMs = approvalAt !== undefined ? Date.parse(approvalAt) : NaN;
    if (Number.isNaN(entryMs) || (approvalAt !== undefined && (Number.isNaN(approvalMs) || entryMs > approvalMs))) {
      throw abortWith(landing, `Authoritative timestamps for ${context.slug} are inverted or unparseable: review entry ${reviewEntryAt} vs approval ${approvalAt ?? 'none'}. Resolve the Review before integrating.`);
    }
    // An already-approved round is a decided review, not a fresh handoff:
    // replaying submit-for-review would return the round unchanged and the
    // workflow guard would reject it ("A submitted review must be awaiting a
    // reviewer decision"). Skip the handoff replay (AC #2) and move the lane to
    // review via a direct submit-for-review that passes the existing round
    // through unchanged; the workflow guard recognises the decided round and
    // moves active → review without rewriting it, so the approve transition
    // below runs at the stored decidedAt. A genuinely fresh round still goes
    // through the handoff operation unchanged (AC #3).
    if (entryRound?.decision?.kind === 'approved') {
      await missionServices.lifecycle.transition({
        operationId: `integrate-active-review:${context.slug}`,
        missionId: slugId,
        expectedVersion: missionLoad.version,
        capabilities: new Set(['mission:transition']),
        // The round is already decided, so the workflow guard moves the lane
        // before it ever inspects reviewer eligibility; this is a stand-in for
        // that check, not a real review assignment.
        command: {
          type: 'submit-for-review',
          gatesPassed: true,
          review: missionLoad.mission.review,
          reviewerEligibility: ConfiguredReviewerEligibility.fromReviewStep({
            eligible: [agentFamily('configured-reviewer')],
            strategy: 'random',
          }),
        },
        actor: missionLoad.mission.assignee ?? 'custom',
        occurredAt: reviewEntryAt,
        idempotencyKey: `active-review:${context.slug}:${reviewEntryAt}`,
      });
      return missionServices.store.load(slugId);
    }
    // Submit through the existing handoff operation; it alone owns the
    // active → review rules and persists the Review aggregate. The
    // authoritative entry timestamp rides along so the persisted lane event
    // and the Review round both carry it instead of the recovery wall clock.
    await submitForReviewFn(context.slug, false, {
      missionServicesFn: async () => missionServices,
      exit: (code: number) => { throw new Error(`submit-for-review exited ${code}`); },
      occurredAt: reviewEntryAt,
    });
    const reloaded = await missionServices.store.load(slugId);
    if (reloaded.kind !== 'found' || reloaded.mission.status !== 'review') {
      throw abortWith(landing, `Mission ${slugId} did not reach review through submit-for-review; resolve the Review handoff before integration.`);
    }
    return reloaded;
  }

  /**
   * Repair interrupted lifecycle orchestration using workflow operations, never
   * by assigning Mission.status. A Review decision remains the sole approval
   * authority: an explicit human override becomes one, an active Mission
   * without Review facts must be handed off first, and a missing decision stops
   * recovery.
   */
  async function recoverMissionForIntegration(
    context: any,
    { missionServices, missionLoad: suppliedLoad, submitForReviewFn = ports.review.submitForReview }: MissionRecoveryOptions,
  ) {
    const slugId = missionId(context.slug);
    let missionLoad = suppliedLoad ?? await missionServices.store.load(slugId);
    if (missionLoad.kind !== 'found') {
      throw abortWith(landing, `Mission ${slugId} is unavailable for lifecycle recovery.`);
    }

    if (missionLoad.mission.status === 'done') {
      // The existing landed-integration closeout path is idempotent and owns a
      // resumed done Mission. Do not create another lifecycle event here.
      return { recovered: false, status: 'done' };
    }

    // The authoritative provider approval (repo default user OR the
    // assigned/configured reviewer already approved on the provider) is the one
    // input recovery may turn into an authoritative ReviewerDecision. It carries
    // the approval's own timestamp and is never a bare boolean shortcut
    // (TASK-2379 Part E; TASK-2420 extends the qualifier to the assigned reviewer).
    const overrideApprovedAt = resolveAuthoritativeApprovalAt(context.approval);

    if (missionLoad.mission.status === 'active') {
      missionLoad = await recoverActiveMission(context, missionServices, missionLoad, overrideApprovedAt, submitForReviewFn);
    }

    if (missionLoad.mission.status === 'integration') {
      return { recovered: false, status: 'integration' };
    }
    if (missionLoad.mission.status !== 'review' || !missionLoad.mission.review) {
      throw abortWith(landing, `Mission ${slugId} is ${missionLoad.mission.status}; integration requires an authoritative approved Review.`);
    }

    let reviewRound = lastRound(missionLoad.mission.review);
    if (reviewRound.decision?.kind !== 'approved' && overrideApprovedAt !== undefined) {
      // Observe the previously happened approval late: persist it at its own
      // timestamp, then let the existing approve transition below run at that
      // same time. Recovery never stamps the approval with its own start time.
      const reloaded = await recordHumanOverrideDecision(context, missionServices, missionLoad, overrideApprovedAt);
      if (!reloaded || reloaded.mission.status !== 'review' || !reloaded.mission.review) {
        throw landing.createAbort();
      }
      missionLoad = reloaded;
      reviewRound = lastRound(missionLoad.mission.review);
    }
    if (reviewRound.decision?.kind !== 'approved') {
      throw abortWith(landing, `Mission ${slugId} is in review without an authoritative approval. Record a ReviewerDecision through px review before integration.`);
    }
    const approval = await missionServices.lifecycle.transition({
      operationId: `integrate-approve:${context.slug}`,
      missionId: slugId,
      expectedVersion: missionLoad.version,
      capabilities: new Set(['mission:transition']),
      command: { type: 'approve', review: missionLoad.mission.review },
      actor: missionLoad.mission.assignee ?? 'custom',
      occurredAt: reviewRound.decision.decidedAt,
      idempotencyKey: `approve:${context.slug}:round-${reviewRound.number}`,
    });
    if (approval.status !== 'completed') {
      throw abortWith(landing, `Mission approval failed before integration: ${approval.error?.message || 'unknown'}.`);
    }
    context.missionStatus = 'integration';
    return { recovered: true, status: 'integration', occurredAt: reviewRound.decision.decidedAt };
  }

  async function promoteTaskForIntegrationIfNeeded(
    context: any,
    { dryRun = false, missionServicesFn }: { dryRun?: boolean, missionServicesFn?: Function } = {},
  ) {
    const taskStatusCheck = evaluateTaskStatusForIntegration(context, ports.stateMap);
    const needsPromotion = context.task?.ok
      // Runtime integration always has Mission authority. taskStatus supports
      // direct callers that supply an older, pre-store context.
      && (context.missionStatus === 'review' || context.promoteBacklogOnCloseout === true
        || (context.missionStatus === undefined && context.taskStatus === 'review'))
      && taskStatusCheck.ok;

    if (!needsPromotion) {
      return { changed: false, dryRun: false };
    }

    if (dryRun) {
      fmt.log.info('Dry run: integration would promote Backlog status from review to approved because review is already fulfilled.');
      return { changed: false, dryRun: true };
    }

    // Approval owns `review -> integration`; landing alone owns
    // `integration -> done`. Read the authority first so the Backlog promotion
    // cannot get ahead of the durable lifecycle transition.
    if (typeof missionServicesFn !== 'function') { throw new Error('integration promotion requires injected mission services'); }
    const missionServices = await missionServicesFn(context.baseWorktree || process.cwd());
    const missionLoad = await missionServices.store.load(missionId(context.slug));
    if (missionLoad.kind === 'unavailable') {
      throw abortWith(landing, `Mission store unavailable: ${missionLoad.reason}. Refusing to promote the Backlog task.`);
    }
    if (missionLoad.kind === 'missing') {
      throw abortWith(landing, `Mission ${missionId(context.slug)} not found in SQLite. Refusing to promote the Backlog task — file-only lifecycle state is not permitted after cutover.`);
    }

    await recoverMissionForIntegration(context, { missionServices, missionLoad });

    // External boundary effect after the durable lifecycle transition.
    const approvedStatus = ports.stateMap.toActual('approved', { rootDir: context.baseWorktree }) || 'approved';
    const taskPath = context.task?.taskFile
      ? resolveIntegrationTaskPath(context.task.taskFile, context.missionWorktree, context.baseWorktree)
        // buildIntegrationContext always supplies a worktree; direct callers may not.
        || (!context.missionWorktree && context.baseWorktree ? backlog.resolveTaskFile(context.slug, context.baseWorktree).taskFile : null)
      : '';
    const baseTask = taskPath ? { ok: true, taskFile: taskPath } : context.task?.taskFile ? { ok: false } : context.task;
    if (!baseTask?.ok || !backlog.setTaskStatus(baseTask.taskFile || '', approvedStatus)) {
      throw abortWith(landing, 'Could not promote the Backlog task to approved before integration.');
    }

    fmt.log.info('Promoted Backlog status from review to approved because review is already fulfilled.');

    return { changed: true, dryRun: false };
  }

  return { recoverMissionForIntegration, promoteTaskForIntegrationIfNeeded };
}
