import { integrationRepairNeedsReview } from '../../domain/integration-repair-policy.js';
/**
 * The application-owned autonomous review loop.
 *
 * Start preparation (implementer identity, the start review preparation, reviewer
 * selection, the round state), the round sequence, and the lifetime action
 * escalation are decided here. Each round runs the reviewing half
 * (`reviewer-phase.ts`) and, unless the reviewer approved, the implementer half
 * (`implementer-phase.ts`). Mechanisms are reached only through the typed ports
 * in `../ports/review-round.ts`.
 */
import { recordHumanCorrection } from './human-correction.js';
import { backlogMirrorOwnership, missionId } from '../../domain/mission.js';
import { currentReviewRound, reviewStatus, type PullRequestReference } from '../../domain/review.js';
import { transitionReviewRepair } from '../review-repair-lifecycle.js';
import { DECLARED_GATES_RETURN_STAGE } from '../../domain/board-event.js';
import { rebaseImplementer, recordImplementerLaunch } from '../rebase-identity.js';
import type { ReviewPreparationFacts, HumanReviewFeedback, ReviewLoopPorts, ReviewLoopRequest, ReviewLoopState } from '../ports/review-round.js';
import { pendingRetainedRepair, resumeRetainedRepair } from './retained-repair.js';
import { selectReviewer } from './reviewer-selection.js';
import { runReviewerPhase } from './reviewer-phase.js';
import { runImplementerPhase } from './implementer-phase.js';
import { reconciledHumanFeedback, runPolicyTestsAction } from './policy-action.js';
import { beginHumanTurn } from './reviewer-outcome.js';
import { DEFAULT_REBOUNDS_PER_ROUND, ReviewRound, stopIfControllerSuperseded, type LoopContext } from './round.js';
import { fixedVerificationNextAction } from '../verification-policy/fixed-next-action.js';
import { retainedGateRepairIsActionable } from '../../domain/repair-coverage.js';
import { abortConcurrentPolicyRound, settleConcurrentPolicyRound, type ConcurrentAgentVerdict } from './concurrent-policy-round.js';
import { isReviewActionLimitReached, loadReviewActionCount } from './action-limit.js';
import { DEFAULT_REVIEW_ACTION_LIMIT } from '../ports/review-action-history.js';

type Output = Pick<LoopContext, 'emit' | 'exit'>;
type Start = Required<Pick<ReviewLoopRequest, 'dryRun' | 'isContinue' | 'verbose'>> & { slug: string };
type RoundResult = 'stop' | 'next-round' | 'revoked' | 'replan' | 'approved';

/** Explicit operator selection updates the lifecycle authority; otherwise resume its assignment. */
async function resolveImplementer(slug: string, requested: string | undefined, persisted: ReviewLoopState | null, ports: ReviewLoopPorts, out: Output, dryRun: boolean): Promise<string> {
  if (ports.missionStore) {
    const actual = await rebaseImplementer(ports.missionStore, slug);
    if (!actual) { throw new Error(`Mission ${slug} has no database-assigned implementer`); }
    if (requested && requested !== actual) {
      if (!dryRun) { await recordImplementerLaunch(slug, requested, ports.missionStore, ports.lifecycle); }
      return requested;
    }
    out.emit({ kind: 'implementer-derived', implementer: actual });
    return actual;
  }
  let implementer = requested;
  if (!implementer && persisted?.implementer) {
    implementer = persisted.implementer;
    out.emit({ kind: 'implementer-resumed', implementer: implementer });
  }
  if (!implementer && ports.task.task.ok) {
    implementer = ports.task.implementer() || undefined;
    if (implementer) { out.emit({ kind: 'implementer-derived', implementer: implementer }); }
  }
  if (!implementer) {
    implementer = 'autonomous';
    out.emit({ kind: 'implementer-unresolved', slug: slug });
  }
  return implementer;
}

/**
 * A missing Backlog task file stops the loop, except for a DB-owned Mission
 * whose lifecycle is DB-authoritative.
 */
async function stopsOnMissingTaskFile(slug: string, ports: ReviewLoopPorts, out: Output): Promise<boolean> {
  if (ports.task.task.ok) { return false; }
  const stored = ports.missionStore ? await ports.missionStore.load(missionId(slug)) : null;
  const ownership = stored?.kind === 'found'
    ? backlogMirrorOwnership(stored.mission)
    : backlogMirrorOwnership({ id: missionId(slug), waveParentId: null });
  if (ownership.kind === 'none') {
    out.emit({ kind: 'adhoc-without-task', slug: slug });
    return false;
  }
  ports.task.reportUnresolved();
  out.exit(1);
  return true;
}

/**
 * A declared-gate validation failure is the mission author's to fix, so the
 * Mission bounces back to active with the reason recorded. Every other failure
 * reports the route back to the operator.
 */
async function reportFailedStartReviewPreparation(start: Start, implementer: string, reviewPreparation: ReviewPreparationFacts, ports: ReviewLoopPorts, out: Output): Promise<void> {
  const { slug } = start;
  if (reviewPreparation.reason === 'validation-failed' && !reviewPreparation.recoveryAttempted) {
    if (ports.missionStore) { await transitionReviewRepair(slug,
      { destination: 'active', sourceStage: DECLARED_GATES_RETURN_STAGE }, implementer, ports.missionStore, ports.lifecycle); }
    await ports.task.mirror('active');
    out.emit({ kind: "review-preparation-validation-failed", slug: slug });
    const recorded = (await ports.state.read()) ?? ports.state.create({});
    recorded.metadata = { ...recorded.metadata, gateFailureReason: 'validation-failed', gateFailureError: reviewPreparation.error };
    await ports.state.persist(recorded);
    return;
  }
  out.emit({ kind: "review-preparation-failed", branch: ports.branch, error: reviewPreparation.error });
  out.emit({ kind: 'start-guidance', slug: slug });
}

/**
 * Run the start review preparation (the transition `px review` used to own). A provider
 * start then requires the open review PR the review preparation created. Null once a
 * diagnostic was emitted and the exit code set.
 */
async function performStartReviewPreparation(start: Start, implementer: string, ports: ReviewLoopPorts, out: Output): Promise<{ pullRequest: PullRequestReference | null } | null> {
  const { slug } = start;
  if (!ports.reviewPreparation) {
    out.emit({ kind: "review-preparation-unbound", slug: slug });
    out.exit(1);
    return null;
  }
  const taskStatus = ports.task.task.ok ? ports.task.status() : null;
  out.emit({ kind: "review-preparation-starting", branch: ports.branch, taskStatus: taskStatus, slug: slug });
  const reviewPreparation = await ports.reviewPreparation.reviewPreparation(implementer);
  if (reviewPreparation?.gatekeeperPushedBack) {
    out.emit({ kind: "review-preparation-blocked", branch: ports.branch, taskStatus: taskStatus });
    out.exit(1);
    return null;
  }
  if (!reviewPreparation?.ok) {
    await reportFailedStartReviewPreparation(start, implementer, reviewPreparation || {}, ports, out);
    out.exit(1);
    return null;
  }
  if (!ports.provider) { return { pullRequest: null }; }
  const healed = ports.provider.openPullRequest();
  if (!healed) {
    out.emit({ kind: 'missing-review-pr', branch: ports.branch });
    out.emit({ kind: 'start-guidance', slug: slug });
    out.exit(1);
    return null;
  }
  out.emit({ kind: "review-preparation-healed", id: healed.id, branch: ports.branch });
  return { pullRequest: healed };
}

/**
 * Decide whether this start runs the review preparation. An open PR alone does not prove
 * the review preparation finished writing the Review; a continuation re-runs it only when
 * the Mission has a resolved round or unfinished review preparation.
 */
async function prepareStart(start: Start, skipReviewPreparation: boolean, implementer: string, ports: ReviewLoopPorts, out: Output): Promise<{ reviewPreparationRan: boolean; pullRequest: PullRequestReference | null } | null> {
  const { dryRun, isContinue } = start;
  let pullRequest: PullRequestReference | null = null;
  const providerStart = await prepareProviderStart(start, ports, out);
  if (providerStart === null) { return null; }
  pullRequest = providerStart.pullRequest;
  if (pullRequest) { skipReviewPreparation = true; }
  skipReviewPreparation = await recordedReviewPreparationCanBeSkipped(start, skipReviewPreparation, ports);
  const continueReviewPreparation = await continuesReviewPreparation(start, ports);
  if (continueReviewPreparation) { skipReviewPreparation = false; }
  if (dryRun || skipReviewPreparation || (isContinue && !continueReviewPreparation)) { return { reviewPreparationRan: false, pullRequest }; }
  const handedOff = await performStartReviewPreparation(start, implementer, ports, out);
  return handedOff && { reviewPreparationRan: true, pullRequest: handedOff.pullRequest ?? pullRequest };
}

/** The round state a start resumes or creates. */
async function startState(persisted: ReviewLoopState | null, identity: { reviewer: string; implementer: string }, pullRequest: PullRequestReference | null, dryRun: boolean, ports: ReviewLoopPorts, out: Output): Promise<ReviewLoopState> {
  let state: ReviewLoopState;
  if (persisted) {
    state = ports.state.resume(persisted);
    state.reviewer = identity.reviewer;
    state.implementer = identity.implementer;
    if (!dryRun) {
      await settleResumedApproval(state, ports);
      await ports.state.persist(state);
    }
  } else {
    state = ports.state.create(identity);
  }
  if (pullRequest) { state.pullRequest = pullRequest; }
  if (persisted && state.round > 1 && !dryRun) {
    out.emit({ kind: 'review-resumed', round: state.round, phase: state.phase });
  }
  return state;
}

/** Replay a recorded judgment before bookkeeping checks its completed lane. */
async function settleResumedApproval(state: ReviewLoopState, ports: ReviewLoopPorts): Promise<void> {
  if (state.phase !== 'approved' || !ports.missionStore) { return; }
  const loaded = await ports.missionStore.load(missionId(state.slug));
  if (loaded.kind !== 'found' || !loaded.mission.review) { return; }
  const round = currentReviewRound(loaded.mission.review);
  if (round.number !== state.round || round.startedAt !== state.startedAt || round.decision?.kind !== 'approved') { return; }
  const decision = round.decision;
  await ports.state.recordApproval(state, { disposition: 'APPROVED', revision: decision.revision ?? null,
    decidedAt: decision.decidedAt, comment: decision.comment });
}

/**
 * An approval is terminal in the round state machine.  The human who requested
 * changes is the operator of record for revoking it; on success the Review
 * reopens and the loop restarts to open the next round, which finds the
 * correction unconsumed.  Otherwise stop with guidance; reconciliation left
 * the correction unconsumed for a retry.
 */
async function handleApprovedRoundCorrection(context: LoopContext, feedback: HumanReviewFeedback): Promise<'stop' | 'revoked'> {
  const revoked = await context.ports.approvalRevocation?.revoke({
    round: context.state.round, operator: feedback.author,
    reason: `Human change request ${feedback.source}: ${feedback.reason || 'changes requested'}`,
  });
  if (revoked?.ok) {
    context.emit({ kind: 'approved-round-revoked', slug: context.slug, round: context.state.round, operator: feedback.author });
    return 'revoked';
  }
  context.emit({ kind: 'approved-round-correction', slug: context.slug, round: context.state.round, ...(revoked?.ok === false ? { diagnostic: revoked.diagnostic } : {}) });
  await context.escalateToHumanReview('APPROVED_ROUND_HUMAN_CORRECTION');
  return 'stop';
}

async function handleHumanCorrection(context: LoopContext, round: ReviewRound, feedback: HumanReviewFeedback | null): Promise<RoundResult | null> {
  if (feedback?.disposition !== 'REQUEST_CHANGES' || feedback.state !== 'current') { return null; }
  if (context.state.phase === 'approved') { return await handleApprovedRoundCorrection(context, feedback); }
  round.blockingFindings = [...feedback.findings];
  round.humanFeedback = `${feedback.author} (${feedback.source}): ${feedback.reason}`;
  if (!context.dryRun) {
    const recorded = await recordHumanCorrection(context, round, feedback);
    if (recorded !== 'recorded') { return recorded; }
  }
  if (context.state.phase !== 'fixing') { context.state.transitionTo('fixing'); }
  context.state.disposition = 'REQUEST_CHANGES';
  return await runImplementerPhase(context, round, 'REQUEST_CHANGES');
}

async function runAutomatedReview(context: LoopContext, round: ReviewRound,
  dismissedApproval: boolean): Promise<RoundResult> {
  let reviewed: Awaited<ReturnType<typeof runReviewerPhase>>;
  try { reviewed = await runReviewerPhase(context, round, dismissedApproval); }
  catch (error) { await abortConcurrentPolicyRound(context, round); throw error; }
  const agent: ConcurrentAgentVerdict = 'outcome' in reviewed
    ? reviewed.outcome === 'approved' ? 'passed' : 'stopped'
    : reviewed.reviewState === 'APPROVED' ? 'passed' : 'failed';
  const concurrent = await settleConcurrentPolicyRound(context, round, agent);
  if (concurrent === 'repair-routed' || concurrent === 'stop') { return 'stop'; }
  if ('outcome' in reviewed) { return reviewed.outcome; }
  return await runImplementerPhase(context, round, reviewed.reviewState);
}

/** One round: the reviewing half, then the implementer's answer to it. */
async function runRound(context: LoopContext, attempt: number): Promise<RoundResult> {
  if (await stopIfControllerSuperseded(context, `round ${attempt}`)) { return 'stop'; }
  context.emit({ kind: 'round-started', attempt: attempt, actionLimit: context.actionLimit });
  if (attempt > context.state.round) { context.state.advanceRound(); }
  const round = new ReviewRound(attempt, context);
  const humanFeedback = await reconciledHumanFeedback(context);
  // Human correction is newer authority than a provider approval; enter fixing directly.
  const corrected = await handleHumanCorrection(context, round, humanFeedback);
  return corrected ?? await runAutomatedReview(context, round,
    Boolean(humanFeedback?.state === 'dismissed' && humanFeedback.approval));
}

async function resetAtEntry(request: ReviewLoopRequest, persisted: ReviewLoopState | null, ports: ReviewLoopPorts, out: Output): Promise<ReviewLoopState | null> {
  if (!request.reset || request.dryRun || !await ports.state.reset()) { return persisted; }
  out.emit({ kind: 'review-reset', slug: request.slug });
  return await ports.state.read();
}

function entryHasHumanEscalation(persisted: ReviewLoopState | null): persisted is ReviewLoopState {
  return Boolean(persisted?.phase !== 'approved' && persisted?.metadata.humanEscalationReason);
}

async function currentVerificationAction(slug: string, ports: ReviewLoopPorts) {
  if (!ports.missionStore) { return null; }
  const loaded = await ports.missionStore.load(missionId(slug));
  return loaded.kind === 'found' ? fixedVerificationNextAction({ mission: loaded.mission }) : null;
}

async function routeVerificationAction(request: ReviewLoopRequest, start: Start, persisted: ReviewLoopState | null,
  implementer: string, ports: ReviewLoopPorts, out: Output): Promise<boolean> {
  const next = await currentVerificationAction(start.slug, ports);
  const repairEntry = next?.kind === 'repair'
    || (next?.kind === 'human-handoff' && next.reason === 'recorded-blocker');
  if (repairEntry && await resumePendingRepair(request, start, persisted, implementer, ports)) { return true; }
  if (next?.kind !== 'human-handoff') { return false; }
  ports.output.error(`Review entry for ${start.slug} requires human intervention.`);
  out.exit(1);
  return true;
}

async function runOwnedReviewLoop(request: ReviewLoopRequest, ports: ReviewLoopPorts, restarted = false): Promise<void> {
  const { slug } = request;
  const out: Output = { emit: event => ports.output.emit(event), exit: code => ports.output.exit(code) };
  const start = reviewStart(request);
  const actionLimit = request.actionLimit ?? DEFAULT_REVIEW_ACTION_LIMIT;
  let persisted = await ports.state.read();
  if (entryHasHumanEscalation(persisted)) {
    ports.output.error(`Review entry blocked for ${slug}: ${persisted.metadata.humanEscalationReason}. Operator recovery: px review ${slug}.`);
    out.exit(1);
    return;
  }
  persisted = await resetAtEntry(request, persisted, ports, out);
  const implementer = await resolveImplementer(slug, request.implementer, persisted, ports, out, start.dryRun);
  if (await stopsOnMissingTaskFile(slug, ports, out)) { return; }
  if (await routeVerificationAction(request, start, persisted, implementer, ports, out)) { return; }
  persisted = await ports.state.read();
  const prepared = await prepareStart(start, request.skipReviewPreparation ?? false, implementer, ports, out);
  if (!prepared) { return; }
  // A fresh review preparation created the authoritative Review with its reviewer and
  // round; resume those instead of selecting a new reviewer.
  if (prepared.reviewPreparationRan) { persisted = await ports.state.read(); }
  const selected = selectReviewer({
    preferredReviewer: request.reviewer, implementer, isContinue: start.isContinue, persisted,
    dryRun: start.dryRun, providerEnabled: Boolean(ports.provider), slug,
  }, ports.routing, out);
  if (!selected) {
    out.exit(1);
    return;
  }
  const identities = { implementer, reviewer: selected.reviewer };
  const state = await startState(persisted, identities, prepared.pullRequest, start.dryRun, ports, out);
  const context: LoopContext = {
    ...out, ...start, ports, state, identities, actionLimit, actionCount: 0,
    operatorInvocation: request.operatorInvocation ?? false,
    ...loopSettings(request),
    initialRound: state.round,
    escalateToHumanReview: async reason => {
      state.disposition = state.disposition || reason;
      state.metadata = { ...state.metadata, humanEscalationReason: reason, humanEscalatedAt: new Date().toISOString() };
      await ports.state.persist(state);
      // The mission now waits on a human; publish why (TASK-2373 SC10).
      await ports.output.onAutonomousStop?.(reason);
      out.emit({ kind: 'reviewer-escalated', reason: reason });
    },
  };
  if (!await loadReviewActionCount(context)) { return; }
  context.emit({ kind: 'review-started', slug, implementer, reviewer: identities.reviewer, branch: ports.branch, focus: context.focus, actionLimit, intervalMs: ports.polling.intervalMs, timeoutMs: ports.polling.timeoutMs, verbose: start.verbose, dryRun: start.dryRun });
  await runReviewRounds(context, request, restarted);
}

async function runReviewRounds(context: LoopContext, request: ReviewLoopRequest, restarted: boolean): Promise<void> {
  const { ports } = context;
  for (let attempt = context.initialRound;;) {
    const tests = await runPolicyTestsAction(context);
    if (tests === 'stop') { return; }
    if (tests === 'repaired') {
      await runOwnedReviewLoop({ ...request, isContinue: true, reset: false }, ports, restarted);
      return;
    }
    if (tests === 'ran') { continue; }
    const outcome = await runRound(context, attempt);
    // Policy evaluation and re-planning are not review-step actions.
    if (outcome === 'replan') { continue; }
    attempt += 1;
    if (outcome === 'stop') { return; }
    // An approval is durable but is not the end of the decision: the policy chooses again on the approved state.
    if (outcome === 'approved') {
      await settleApproval(context, request, restarted);
      return;
    }
    // A revoked approval reopened the Review: start again as a continuation
    // so the review preparation opens the next round.  One restart per run bounds it.
    if (outcome === 'revoked') {
      if (restarted) {
        await context.escalateToHumanReview('APPROVED_ROUND_HUMAN_CORRECTION');
        return;
      }
      await runOwnedReviewLoop({ ...request, isContinue: true, reset: false }, ports, true);
      return;
    }
  }
}

/** Return an approved round to the next-action owner before opening its human turn. */
async function settleApproval(context: LoopContext, request: ReviewLoopRequest, restarted: boolean): Promise<void> {
  for (;;) {
    const tests = await runPolicyTestsAction(context);
    if (tests === 'repaired') {
      await runOwnedReviewLoop({ ...request, isContinue: true, reset: false }, context.ports, restarted);
      return;
    }
    if (tests === 'stop' && context.actionCount >= context.actionLimit) { return; }
    await beginHumanTurn(context);
    return;
  }
}

/**
 * Run the autonomous review loop for one Mission. A second in-process
 * controller for the same worktree is told how to resume instead of racing the
 * active one; a cross-process loser is stopped at each authoritative boundary.
 */
export async function runReviewLoop(request: ReviewLoopRequest, ports: ReviewLoopPorts): Promise<void> {
  if (!ports.lock.tryAcquire()) {
    ports.output.emit({ kind: 'controller-active', slug: request.slug });
    return;
  }
  try {
    await runOwnedReviewLoop(request, ports);
  } catch (error) {
    if (!isReviewActionLimitReached(error)) { throw error; }
  } finally {
    ports.lock.release();
  }
}

async function prepareProviderStart(start: Start, ports: ReviewLoopPorts, out: Output): Promise<{ pullRequest: PullRequestReference | null } | null> {
  const { dryRun } = start;
  let pullRequest: PullRequestReference | null = null;
  if (!dryRun && ports.provider) {
    if (!await ports.provider.ensureReachable()) {
      out.exit(1);
      return null;
    }
    pullRequest = ports.provider.openPullRequest();
    if (pullRequest) {
      out.emit({ kind: 'review-pr-confirmed', id: pullRequest.id, branch: ports.branch });
    }
  } else if (start.verbose && !dryRun && !ports.provider) {
    out.emit({ kind: 'local-provider' });
  }
  return { pullRequest };
}

async function continuesReviewPreparation(start: Start, ports: ReviewLoopPorts): Promise<boolean> {
  const { slug, dryRun, isContinue } = start;
  const store = ports.missionStore;
  if (!store || !isContinue || dryRun) { return false; }
  const loaded = await store.load(missionId(slug));
  if (loaded.kind !== 'found' || !['active', 'review'].includes(loaded.mission.status)) { return false; }
  const mission = loaded.mission, review = mission.review;
  if (!review) { return false; }
  const status = reviewStatus(review);
  // A recorded response needs the next round even if preparation already entered review.
  if (status === 'ready-for-next-round') { return true; }
  return status === 'awaiting-review' && (mission.status === 'active' || mission.reviewPreparationPending === true
    // Retention opens the candidate-bound round before review preparation. A
    // continuation still owes preparation even when that candidate is HEAD.
    || integrationRepairNeedsReview(mission));
}

async function resumePendingRepair(request: ReviewLoopRequest, start: Start, persisted: ReviewLoopState | null, implementer: string, ports: ReviewLoopPorts): Promise<boolean> {
  if (!ports.missionStore) { return false; }
  const loaded = await ports.missionStore.load(missionId(start.slug));
  if (loaded.kind !== 'found' || !retainedGateRepairIsActionable(loaded.mission)
    || !pendingRetainedRepair(loaded.mission, ports.worktree)) { return false; }
  // Successful exact-check recovery rejoins the historical start/review preparation path.
  return !await resumeRetainedRepair(request, loaded.mission, implementer, ports, persisted?.reviewer);
}

function reviewStart(request: ReviewLoopRequest): Start {
  return { slug: request.slug, dryRun: request.dryRun ?? false, isContinue: request.isContinue ?? false, verbose: request.verbose ?? false };
}

async function recordedReviewPreparationCanBeSkipped(start: Start, skipReviewPreparation: boolean, ports: ReviewLoopPorts): Promise<boolean> {
  const { isContinue, dryRun } = start;
  const store = ports.missionStore;
  if (store && skipReviewPreparation && !isContinue && !dryRun) {
    const recorded = await ports.state.read();
    const taskStatus = ports.task.task.ok ? ports.task.status() : null;
    if (!recorded || (taskStatus && taskStatus !== 'review')) { return false; }
  }
  return skipReviewPreparation;
}

function loopSettings(request: ReviewLoopRequest) {
  return { focus: request.focus ?? 'all', reboundsPerRound: request.reboundsPerRound ?? DEFAULT_REBOUNDS_PER_ROUND };
}
