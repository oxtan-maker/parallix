/**
 * The application-owned autonomous review loop.
 *
 * Start preparation (implementer identity, the start handoff, reviewer
 * selection, the round state), the round sequence, and the max-attempts
 * escalation are decided here. Each round runs the reviewing half
 * (`reviewer-phase.ts`) and, unless the reviewer approved, the implementer half
 * (`implementer-phase.ts`). Mechanisms are reached only through the typed ports
 * in `../ports/review-round.ts`.
 */
import { isDbAdhocIdentity, missionId } from '../../domain/mission.js';
import { reviewStatus, type PullRequestReference } from '../../domain/review.js';
import { transitionReviewRepair } from '../review-repair-lifecycle.js';
import type { HandoffFacts, HumanReviewFeedback, ReviewLoopPorts, ReviewLoopRequest, ReviewLoopState } from '../ports/review-round.js';
import { selectReviewer } from './reviewer-selection.js';
import { runReviewerPhase } from './reviewer-phase.js';
import { runImplementerPhase } from './implementer-phase.js';
import { DEFAULT_REBOUNDS_PER_ROUND, ReviewRound, stopIfControllerSuperseded, type LoopContext } from './round.js';

export const DEFAULT_MAX_ATTEMPTS = 5;

type Output = Pick<LoopContext, 'emit' | 'exit'>;
type Start = Required<Pick<ReviewLoopRequest, 'dryRun' | 'isContinue' | 'verbose'>> & { slug: string };

/** Persisted implementer first, then the Backlog assignee, then "autonomous". */
function resolveImplementer(slug: string, requested: string | undefined, persisted: ReviewLoopState | null, ports: ReviewLoopPorts, out: Output): string {
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
 * A missing Backlog task file stops the loop, except for a DB-owned adhoc
 * identity whose lifecycle is DB-authoritative.
 */
function stopsOnMissingTaskFile(slug: string, ports: ReviewLoopPorts, out: Output): boolean {
  if (ports.task.task.ok) { return false; }
  if (isDbAdhocIdentity(slug)) {
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
async function reportFailedStartHandoff(start: Start, implementer: string, handoff: HandoffFacts, ports: ReviewLoopPorts, out: Output): Promise<void> {
  const { slug } = start;
  if (handoff.reason === 'validation-failed' && !handoff.recoveryAttempted) {
    if (ports.missionStore) { await transitionReviewRepair(slug, 'active', implementer, ports.missionStore, ports.lifecycle); }
    await ports.task.mirror('active');
    out.emit({ kind: 'handoff-validation-failed', slug: slug });
    const recorded = (await ports.state.read()) ?? ports.state.create({});
    recorded.metadata = { ...recorded.metadata, gateFailureReason: 'validation-failed', gateFailureError: handoff.error };
    await ports.state.persist(recorded);
    return;
  }
  if (ports.provider && !ports.provider.openPullRequest()) {
    out.emit({ kind: 'missing-review-pr', branch: ports.branch });
    if (handoff.error) { out.emit({ kind: 'handoff-diagnostic', error: handoff.error }); }
    out.emit({ kind: 'push-guidance', slug: slug });
    return;
  }
  out.emit({ kind: 'handoff-failed', branch: ports.branch, error: handoff.error });
  out.emit({ kind: 'start-guidance', slug: slug });
}

/**
 * Run the start handoff (the transition `px handoff` used to own). A provider
 * start then requires the open review PR the handoff created. Null once a
 * diagnostic was emitted and the exit code set.
 */
async function performStartHandoff(start: Start, implementer: string, ports: ReviewLoopPorts, out: Output): Promise<{ pullRequest: PullRequestReference | null } | null> {
  const { slug } = start;
  if (!ports.handoff) {
    out.emit({ kind: 'handoff-unbound', slug: slug });
    out.exit(1);
    return null;
  }
  const taskStatus = ports.task.task.ok ? ports.task.status() : null;
  out.emit({ kind: 'handoff-starting', branch: ports.branch, taskStatus: taskStatus, slug: slug });
  const handoff = await ports.handoff.handoff(implementer);
  if (handoff?.gatekeeperPushedBack) {
    out.emit({ kind: 'handoff-blocked', branch: ports.branch, taskStatus: taskStatus });
    out.exit(1);
    return null;
  }
  if (!handoff?.ok) {
    await reportFailedStartHandoff(start, implementer, handoff || {}, ports, out);
    out.exit(1);
    return null;
  }
  if (!ports.provider) { return { pullRequest: null }; }
  const healed = ports.provider.openPullRequest();
  if (!healed) {
    out.emit({ kind: 'missing-review-pr', branch: ports.branch });
    out.emit({ kind: 'push-guidance', slug: slug });
    out.exit(1);
    return null;
  }
  out.emit({ kind: 'handoff-healed', id: healed.id, branch: ports.branch });
  return { pullRequest: healed };
}

/**
 * Decide whether this start runs the handoff. An open PR alone does not prove
 * the handoff finished writing the Review; a --continue re-runs it only when
 * the Mission is still active with a review awaiting its next round.
 */
async function prepareStart(start: Start, skipHandoff: boolean, implementer: string, ports: ReviewLoopPorts, out: Output): Promise<{ handoffRan: boolean; pullRequest: PullRequestReference | null } | null> {
  const { slug, dryRun, isContinue } = start;
  let pullRequest: PullRequestReference | null = null;
  if (!dryRun && ports.provider) {
    if (!await ports.provider.ensureReachable()) {
      out.exit(1);
      return null;
    }
    pullRequest = ports.provider.openPullRequest();
    if (pullRequest) {
      out.emit({ kind: 'review-pr-confirmed', id: pullRequest.id, branch: ports.branch });
      skipHandoff = true;
    }
  } else if (start.verbose && !dryRun && !ports.provider) {
    out.emit({ kind: 'local-provider' });
  }
  const store = ports.missionStore;
  if (store && skipHandoff && !isContinue && !dryRun) {
    const recorded = await ports.state.read();
    const taskStatus = ports.task.task.ok ? ports.task.status() : null;
    if (!recorded || (taskStatus && taskStatus !== 'review')) { skipHandoff = false; }
  }
  let continueHandoff = false;
  if (store && isContinue && !dryRun) {
    const loaded = await store.load(missionId(slug));
    continueHandoff = loaded.kind === 'found' && loaded.mission.status === 'active'
      && Boolean(loaded.mission.review && ['awaiting-review', 'ready-for-next-round'].includes(reviewStatus(loaded.mission.review)));
    if (continueHandoff) { skipHandoff = false; }
  }
  if (dryRun || skipHandoff || (isContinue && !continueHandoff)) { return { handoffRan: false, pullRequest }; }
  const handedOff = await performStartHandoff(start, implementer, ports, out);
  return handedOff && { handoffRan: true, pullRequest: handedOff.pullRequest ?? pullRequest };
}

/** The round state a start resumes or creates. */
async function startState(persisted: ReviewLoopState | null, identity: { reviewer: string; implementer: string }, pullRequest: PullRequestReference | null, dryRun: boolean, ports: ReviewLoopPorts, out: Output): Promise<ReviewLoopState> {
  let state: ReviewLoopState;
  if (persisted) {
    state = ports.state.resume(persisted);
    state.reviewer = identity.reviewer;
    state.implementer = identity.implementer;
    await ports.state.persist(state);
  } else {
    state = ports.state.create(identity);
  }
  if (pullRequest) { state.pullRequest = pullRequest; }
  await ports.state.repairInvalidPhase(state);
  if (persisted && state.round > 1 && !dryRun) {
    out.emit({ kind: 'review-resumed', round: state.round, phase: state.phase });
  }
  return state;
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

/** One round: the reviewing half, then the implementer's answer to it. */
async function runRound(context: LoopContext, attempt: number): Promise<'stop' | 'next-round' | 'revoked'> {
  if (await stopIfControllerSuperseded(context, `round ${attempt}`)) { return 'stop'; }
  context.emit({ kind: 'round-started', attempt: attempt, maxAttempts: context.maxAttempts });
  if (attempt > context.state.round) { context.state.advanceRound(); }
  const round = new ReviewRound(attempt, context);
  const humanFeedback = await context.ports.humanFeedback.reconcile(context.state);
  if (humanFeedback?.state === 'dismissed' && humanFeedback.approval) {
    // A dismissed provider decision is not approval evidence.  Stop before a
    // reviewer can turn the stale provider result into a no-findings approval;
    // a human must provide a current decision or correction.
    await context.escalateToHumanReview('DISMISSED_PROVIDER_APPROVAL');
    return 'stop';
  }
  if (humanFeedback?.disposition === 'REQUEST_CHANGES' && humanFeedback.state === 'current') {
    // An explicit human correction is newer authority than a stored provider
    // approval.  Enter the existing fixing path directly, rather than launch a
    // reviewer which could repeat the stale no-findings approval.
    if (context.state.phase === 'approved') { return await handleApprovedRoundCorrection(context, humanFeedback); }
    round.blockingFindings = [...humanFeedback.findings];
    round.humanFeedback = `${humanFeedback.author} (${humanFeedback.source}): ${humanFeedback.reason}`;
    // A resumed round may already be fixing; only a reviewing round enters it.
    if (context.state.phase !== 'fixing') { context.state.transitionTo('fixing'); }
    context.state.disposition = 'REQUEST_CHANGES';
    return await runImplementerPhase(context, round, 'REQUEST_CHANGES');
  }
  const reviewed = await runReviewerPhase(context, round);
  if ('outcome' in reviewed) { return reviewed.outcome; }
  return await runImplementerPhase(context, round, reviewed.reviewState);
}

async function runOwnedReviewLoop(request: ReviewLoopRequest, ports: ReviewLoopPorts, restarted = false): Promise<void> {
  const { slug } = request;
  const out: Output = { emit: event => ports.output.emit(event), exit: code => ports.output.exit(code) };
  const start: Start = { slug, dryRun: request.dryRun ?? false, isContinue: request.isContinue ?? false, verbose: request.verbose ?? false };
  const maxAttempts = request.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  if (request.reset && await ports.state.reset()) { out.emit({ kind: 'review-reset', slug: slug }); }
  let persisted = await ports.state.read();
  const implementer = resolveImplementer(slug, request.implementer, persisted, ports, out);
  if (stopsOnMissingTaskFile(slug, ports, out)) { return; }
  const prepared = await prepareStart(start, request.skipHandoff ?? false, implementer, ports, out);
  if (!prepared) { return; }
  // A fresh handoff created the authoritative Review with its reviewer and
  // round; resume those instead of selecting a new reviewer.
  if (prepared.handoffRan) { persisted = await ports.state.read(); }
  const selected = selectReviewer({
    reviewer: request.reviewer, implementer, isContinue: start.isContinue, persisted, maxAttempts,
    dryRun: start.dryRun, providerEnabled: Boolean(ports.provider), slug,
  }, ports.routing, out);
  if (!selected) {
    out.exit(1);
    return;
  }
  const identities = { implementer, reviewer: selected.reviewer };
  const state = await startState(persisted, identities, prepared.pullRequest, start.dryRun, ports, out);
  const context: LoopContext = {
    ...out, ...start, ports, state, identities, maxAttempts,
    focus: request.focus ?? 'all',
    reboundsPerRound: request.reboundsPerRound ?? DEFAULT_REBOUNDS_PER_ROUND,
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
  context.emit({ kind: 'review-started', slug, implementer, reviewer: identities.reviewer, branch: ports.branch, focus: context.focus, maxAttempts, intervalMs: ports.polling.intervalMs, timeoutMs: ports.polling.timeoutMs, verbose: start.verbose, dryRun: start.dryRun });
  for (let attempt = context.initialRound; attempt <= maxAttempts; attempt++) {
    const outcome = await runRound(context, attempt);
    if (outcome === 'stop') { return; }
    // A revoked approval reopened the Review: start again as a continuation
    // so the handoff opens the next round.  One restart per run bounds it.
    if (outcome === 'revoked') {
      if (restarted) {
        await context.escalateToHumanReview('APPROVED_ROUND_HUMAN_CORRECTION');
        return;
      }
      await runOwnedReviewLoop({ ...request, isContinue: true, reset: false }, ports, true);
      return;
    }
  }
  state.disposition = 'MAX_ATTEMPTS';
  state.metadata = { ...state.metadata, humanEscalationReason: 'MAX_ATTEMPTS', humanEscalatedAt: new Date().toISOString() };
  await ports.state.persist(state);
  out.emit({ kind: 'attempts-exhausted', maxAttempts: maxAttempts });
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
  } finally {
    ports.lock.release();
  }
}
