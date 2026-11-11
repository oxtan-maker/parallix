import { observeProviderReview, pollProviderReview, settleRecordedChanges } from './provider-observations.js';
import { tryClassifyReview } from '../review-classification/classify-review.js';
/**
 * The reviewing half of a round: open the round, run the pre-review
 * prerequisites, launch the reviewer, consume and recover its output, and turn
 * the outcome into the next step — approval stops the loop, anything else moves
 * the round to fixing.
 */
import { integrationRepairReviewBrief, latestIntegrationRepair } from '../integration-repair-review.js';
import { missionId } from '../../domain/mission.js';
import { DEFAULT_REBOUND_ATTEMPTS, rebound } from '../rebound-kernel.js';
import { isArtifactInfraFailure, isPollTimeout, POLL_TIMEOUT, type ReviewerArtifactFacts } from '../ports/review-round.js';
import { pinReviewBaseline } from './pin-baseline.js';
import { establishReviewerPolicy, nextOutstandingReviewer, reconcileReroutedReviewer, recordedPendingApproval, replaceFailedReviewer } from './reviewer-policy.js';
import { runDeclaredPreReviewGate, runPreReviewRebase } from './pre-review.js';
import { adoptLaunchedAgent, elapsedSince, reboundCollaborators, stopIfControllerSuperseded, type LoopContext, type ReviewRound, type RoundStep } from './round.js';
import { selectReviewer } from './reviewer-selection.js';

type ReviewOutcome = { outcome: 'stop' } | { reviewState: unknown };

/** Re-evaluate separation only at a judgment boundary, using the actual roles. */
function routeCollidingReviewer(context: LoopContext): boolean {
  const { identities, state } = context;
  if (identities.reviewer !== identities.implementer) { return true; }
  // Provider-disabled autonomous review consumes workflow-owned artifacts and
  // launches neither role, so there is no agent-family collision to reroute.
  if (identities.reviewer === 'autonomous' && !context.ports.provider) { return true; }
  const selected = selectReviewer({
    implementer: identities.implementer,
    isContinue: true,
    persisted: state,
    maxAttempts: context.maxAttempts,
    dryRun: context.dryRun,
    providerEnabled: Boolean(context.ports.provider),
    slug: context.slug,
  }, context.ports.routing, context);
  if (!selected) {
    context.exit(1);
    return false;
  }
  identities.reviewer = selected.reviewer;
  state.reviewer = selected.reviewer;
  return true;
}

/** The recorded integration repair the reviewer is told about. */
async function integrationRepairBrief(context: LoopContext): Promise<string> {
  const store = context.ports.missionStore;
  if (!store) { return ''; }
  const loaded = await store.load(missionId(context.slug));
  return loaded.kind === 'found' ? integrationRepairReviewBrief(latestIntegrationRepair(loaded.mission)) : '';
}

/** A continuation re-enters its first round with a check for an existing review. */
async function existingReviewOnContinue(context: LoopContext, round: ReviewRound): Promise<unknown> {
  const { ports, state, identities } = context;
  if (!(context.isContinue && round.attempt === context.initialRound)) { return undefined; }
  if (!context.dryRun) { await ports.task.mirror('review'); }
  if (!ports.provider) {
    if (context.verbose) {
      context.emit({ kind: 'local-review', attempt: round.attempt });
    }
    return null;
  }
  context.emit({ kind: 'review-probe', attempt: round.attempt, reviewer: identities.reviewer, startedAt: state.startedAt });
  const existing = await pollProviderReview(context, round, { label: `round ${round.attempt} skip-check`, quick: true, retryCount: 0 });
  return isPollTimeout(existing) ? null : existing;
}

function dryRunReviewerPrompt(context: LoopContext, round: ReviewRound): void {
  const reviewer = context.identities.reviewer;
  if (reviewer === 'autonomous') {
    context.emit({ kind: 'autonomous-reviewer-dry-run', attempt: round.attempt });
    return;
  }
  context.emit({ kind: 'reviewer-dry-run-header', reviewer: reviewer });
  context.emit({ kind: 'reviewer-dry-run-prompt', prompt: context.ports.agents.dryRunPrompt('reviewer', round.promptFacts()) });
}

/** A workflow rejection cannot be repaired by waiting for provider output. */
async function stopForVerdictBlock(context: LoopContext): Promise<boolean> {
  const block = await context.ports.state.verdictBlock?.();
  if (!block) { return false; }
  context.ports.output.error(block.diagnostic);
  context.exit(1);
  return true;
}

/** Launch the reviewer (skipped for an autonomous local round); `replaced` means another selected reviewer takes over. */
async function launchReviewer(context: LoopContext, round: ReviewRound): Promise<RoundStep | 'replaced' | 'approved'> {
  const { ports, identities } = context;
  if (await stopForVerdictBlock(context)) { return 'stop'; }
  if (identities.reviewer === 'autonomous' && !ports.provider) {
    context.emit({ kind: 'autonomous-reviewer', attempt: round.attempt });
    return null;
  }
  context.emit({ kind: 'reviewer-launching', attempt: round.attempt, reviewer: identities.reviewer });
  let launch;
  try {
    launch = await ports.agents.launch({
      role: 'reviewer',
      agent: identities.reviewer,
      exclude: [identities.implementer],
      prompt: round.promptFacts(),
      sessionPolicy: 'fresh-ephemeral',
    });
  } catch (err: unknown) {
    context.emit({ kind: 'agent-selection', outcome: 'launch-failed', fields: { agent: identities.reviewer, step: 'review', error: (err as Error).message } });
    context.emit({ kind: 'reviewer-launch-failed', reviewer: identities.reviewer, message: (err as Error).message });
    const replacement = await replaceFailedReviewer(context, round, identities.reviewer, (err as Error).message);
    if (replacement) { return replacement === 'retry' ? 'replaced' : 'approved'; }
    await context.escalateToHumanReview('REVIEWER_LAUNCH_FAILURE');
    return 'stop';
  }
  // The launch is an await boundary: a concurrent controller may have advanced
  // the round, so re-read before any identity or telemetry write.
  if (await stopIfControllerSuperseded(context, 'reviewer-launch fallback')) { return 'stop'; }
  round.reviewerLaunch = launch;
  await reconcileReroutedReviewer(context, round, identities.reviewer, launch?.agent);
  const authoritative = await ports.state.read();
  if (persistedReviewerOutcome(context.state, authoritative)) {
    const actual = launch?.agent;
    if (actual && actual !== identities.reviewer) {
      context.emit({ kind: 'agent-fallback', role: 'reviewer', original: identities.reviewer, fallback: actual });
      identities.reviewer = actual;
      // Keep the controller snapshot aligned as well as the freshly-read
      // authoritative state. A request-changes verdict continues into the
      // implementer phase, whose later bookkeeping persists `context.state`;
      // leaving the preferred family here would overwrite the actual reviewer.
      context.state.reviewer = actual;
      if (authoritative) {
        authoritative.reviewer = actual;
        await ports.state.persist(authoritative);
      }
    }
    await ports.agents.recordStage('reviewer', authoritative ?? context.state, identities, launch);
    return null;
  }
  await adoptLaunchedAgent(context, 'reviewer', identities.reviewer, launch);
  await ports.agents.recordStage('reviewer', context.state, identities, launch);
  return null;
}

function reviewerArtifactDiagnostic(context: LoopContext, artifacts: ReviewerArtifactFacts): string {
  return artifacts.diagnostic || `Reviewer ${context.identities.reviewer} produced incomplete or invalid review artifacts`;
}

function missingReviewerArtifacts(context: LoopContext, round: ReviewRound): string {
  const stopReason = round.reviewerLaunch?.result?.stopReason;
  const cause = stopReason === 'length' ? 'output-token-limit' : stopReason;
  return `Incomplete reviewer artifact: reviewer ${context.identities.reviewer} exited without a recorded verdict or consumable review artifacts${cause ? ` (${cause})` : ''}`;
}

/** A completed process cannot produce a later verdict without a relaunch. */
function incompleteReviewerDiagnostic(context: LoopContext, round: ReviewRound, artifacts: ReviewerArtifactFacts): string | null {
  if (artifacts.consumed) { return artifacts.ok ? null : reviewerArtifactDiagnostic(context, artifacts); }
  return typeof round.reviewerLaunch?.result?.status === 'number' ? missingReviewerArtifacts(context, round) : null;
}

/**
 * Consume the reviewer's output. Incomplete output is relaunched through one
 * rebound occurrence; an infrastructure failure or a spent budget escalates.
 * An exited reviewer with no output enters the same bounded artifact recovery.
 */
async function consumeReviewerOutput(context: LoopContext, round: ReviewRound): Promise<{ step: RoundStep; reviewState?: unknown }> {
  const { ports, state, identities } = context;
  const persisted = await ports.state.read();
  const persistedOutcome = persistedReviewerOutcome(state, persisted);
  if (persistedOutcome) { return { step: null, reviewState: persistedOutcome }; }
  if (await recordedPendingApproval(context, round)) { return { step: null, reviewState: 'APPROVED' }; }
  if (await stopForVerdictBlock(context)) { return { step: 'stop' }; }
  let artifacts = await ports.artifacts.consumeReviewer(identities.reviewer, state, round.reviewerLaunch);
  let reviewState: unknown = null;
  const diagnostic = incompleteReviewerDiagnostic(context, round, artifacts);
  if (diagnostic) {
    if (isArtifactInfraFailure(artifacts.failureReason)) {
      context.emit({ kind: 'reviewer-artifact-infra', diagnostic: diagnostic });
      await context.escalateToHumanReview('REVIEWER_ARTIFACT_INFRA_FAILURE');
      return { step: 'stop' };
    }
    context.emit({ kind: 'reviewer-artifact-incomplete', diagnostic });
    if (round.capReached()) {
      context.emit({ kind: 'reviewer-recovery-exhausted', maxAttempts: 0, slug: context.slug, diagnostic });
      return { step: await round.stopForCap('reviewer artifact') };
    }
    // `fixed` requires the re-consumed artifacts to be complete: a relaunch
    // alone is no evidence that the reviewer produced anything.
    const maxAttempts = round.occurrenceBudget(DEFAULT_REBOUND_ATTEMPTS);
    const collaborators = reboundCollaborators(context, 'reviewer', () => round.promptFacts());
    const recovery = await rebound({ kind: 'artifact-incomplete', role: 'reviewer', diagnostic, failureReason: artifacts.failureReason }, {
      ...collaborators,
      applyAgentFallback: async options => {
        round.reviewerLaunch = options.launchResult;
        return await collaborators.applyAgentFallback!(options);
      },
      implementer: identities.reviewer, step: 'review', role: 'reviewer', exclude: [identities.implementer], maxAttempts,
      verify: async () => {
        const retry = await reviewerRecoveryOutput(context, round.reviewerLaunch);
        if (retry.workflowBlock) { return { ok: false, workflowBlock: retry.workflowBlock }; }
        artifacts = retry.artifacts;
        if (!artifacts.consumed) { return { ok: false, diagnostic: missingReviewerArtifacts(context, round) }; }
        return artifacts.ok ? { ok: true } : { ok: false, diagnostic: reviewerArtifactDiagnostic(context, artifacts), reason: { kind: 'artifact-incomplete', role: 'reviewer', diagnostic: reviewerArtifactDiagnostic(context, artifacts), failureReason: artifacts.failureReason } };
      },
    });
    round.used += recovery.attempts;
    identities.reviewer = recovery.implementer || identities.reviewer;
    const accepted = persistedReviewerOutcome(state, await ports.state.read());
    if (accepted) { return { step: null, reviewState: accepted }; }
    if (await stopForVerdictBlock(context)) { return { step: 'stop' }; }
    const recoveryStop = await stopForArtifactRecovery(context, round, recovery, maxAttempts);
    if (recoveryStop) { return { step: recoveryStop }; }
    context.emit({ kind: 'reviewer-artifacts-recovered', attempts: recovery.attempts });
  }
  if (artifacts.consumed) {
    reviewState = applyReviewerArtifacts(round, artifacts);
  }
  if (await stopForUnresolvedVerdictBlock(context)) { return { step: 'stop' }; }
  if (!reviewState && ports.provider) {
    reviewState = await pollProviderReview(context, round, { label: `round ${round.attempt} review`, retryCount: 0 });
  }
  return { step: null, reviewState };
}

function applyReviewerArtifacts(round: ReviewRound, artifacts: ReviewerArtifactFacts): unknown {
  // TASK-2477/F1: recovered findings must accompany the changes-requested summary.
  round.blockingFindings = artifacts.reviewFindings || [];
  return artifacts.reviewState;
}

async function stopForArtifactRecovery(context: LoopContext, round: ReviewRound, recovery: Awaited<ReturnType<typeof rebound>>, maxAttempts: number): Promise<RoundStep> {
  if (recovery.outcome !== 'fixed') {
    if (recovery.outcome === 'human-only') {
      context.emit({ kind: 'reviewer-recovery-human', slug: context.slug });
      await context.escalateToHumanReview('REVIEWER_ARTIFACT_INFRA_FAILURE');
      return 'stop';
    }
    context.emit({ kind: 'reviewer-recovery-exhausted', maxAttempts, slug: context.slug, diagnostic: recovery.diagnostic });
    if (round.capReached()) { return await round.stopForCap('reviewer artifact'); }
    await context.escalateToHumanReview('REVIEWER_ARTIFACT_RETRY_EXHAUSTED');
    return 'stop';
  }
  return null;
}

function persistedReviewerOutcome(state: LoopContext['state'], persisted: Awaited<ReturnType<LoopContext['ports']['state']['read']>>): string | null {
  if (!persisted || persisted.round !== state.round) { return null; }
  if (persisted.phase === 'approved' && persisted.disposition === 'APPROVED') { return 'APPROVED'; }
  if (persisted.phase === 'fixing' && persisted.disposition === 'REQUEST_CHANGES') { return 'REQUEST_CHANGES'; }
  return null;
}

/** A retried child can close readiness by submitting its accepted verdict. */
async function reviewerRecoveryOutput(context: LoopContext, launch?: import('../ports/agent-launch-result.js').AgentLaunchResult | null) {
  const accepted = persistedReviewerOutcome(context.state, await context.ports.state.read());
  if (accepted) {
    return { artifacts: { consumed: true, ok: true, reviewState: accepted } satisfies ReviewerArtifactFacts };
  }
  const workflowBlock = await context.ports.state.verdictBlock?.();
  if (workflowBlock) { return { workflowBlock }; }
  return { artifacts: await context.ports.artifacts.consumeReviewer(context.identities.reviewer, undefined, launch) };
}

async function stopForUnresolvedVerdictBlock(context: LoopContext): Promise<boolean> {
  if (persistedReviewerOutcome(context.state, await context.ports.state.read())) { return false; }
  return stopForVerdictBlock(context);
}

/**
 * A round with no usable review outcome (poll timeout or nothing at all)
 * relaunches the reviewer through the kernel; a spent budget needs a human.
 */
async function recoverReviewerTimeout(context: LoopContext, round: ReviewRound, reviewState: unknown): Promise<{ step: RoundStep; reviewState?: unknown }> {
  const { ports, state, identities } = context;
  // An accepted child verdict closes verdict readiness as part of its normal
  // transition. Reconcile that outcome before deciding whether output recovery
  // is blocked; request-changes must proceed to the implementer.
  const accepted = persistedReviewerOutcome(state, await ports.state.read());
  if (accepted) { return { step: null, reviewState: accepted }; }
  if (await stopForVerdictBlock(context)) { return { step: 'stop' }; }
  if (!isPollTimeout(reviewState) && reviewState) { return { step: null, reviewState }; }
  if (!reviewState) {
    context.emit({ kind: 'missing-review-outcome', reviewer: identities.reviewer, providerEnabled: Boolean(ports.provider), branch: ports.branch });
  }
  let recovered: unknown = POLL_TIMEOUT;
  const collaborators = reboundCollaborators(context, 'reviewer', () => round.promptFacts());
  const recovery = await rebound({
    kind: 'agent-timeout', role: 'reviewer',
    diagnostic: `No usable review outcome for ${ports.branch} after ${elapsedSince(state.startedAt)}.`,
    expectedOutput: ports.provider ? 'a formal review outcome' : 'a review verdict through px',
  }, {
    ...collaborators,
    applyAgentFallback: async options => {
      round.reviewerLaunch = options.launchResult;
      return await collaborators.applyAgentFallback!(options);
    },
    implementer: identities.reviewer, step: 'review', role: 'reviewer', exclude: [identities.implementer],
    maxAttempts: round.occurrenceBudget(DEFAULT_REBOUND_ATTEMPTS),
    verify: async () => {
      const output = await reviewerRecoveryOutput(context, round.reviewerLaunch);
      if (output.workflowBlock) { return { ok: false, workflowBlock: output.workflowBlock }; }
      const retry = output.artifacts;
      const diagnostic = retry.diagnostic || `Reviewer output still missing for ${ports.branch}`;
      recovered = retry.consumed && retry.ok ? retry.reviewState : null;
      if (!recovered && ports.provider) {
        recovered = await pollProviderReview(context, round, { label: `round ${round.attempt} review recovery`, retryCount: 0 });
      }
      return recovered && !isPollTimeout(recovered)
        ? { ok: true }
        : { ok: false, diagnostic, reason: { kind: 'artifact-incomplete', role: 'reviewer', diagnostic } };
    },
  });
  round.used += recovery.attempts;
  identities.reviewer = recovery.implementer || identities.reviewer;
  const acceptedAfterRetry = persistedReviewerOutcome(state, await ports.state.read());
  if (acceptedAfterRetry) { return { step: null, reviewState: acceptedAfterRetry }; }
  if (await stopForVerdictBlock(context)) { return { step: 'stop' }; }
  if (recovery.outcome === 'fixed') { return { step: null, reviewState: recovered }; }
  if (round.capReached()) { return { step: await round.stopForCap('reviewer timeout recovery') }; }
  context.emit({ kind: 'reviewer-timeout-exhausted', dossier: recovery.dossier, reviewer: identities.reviewer, attempts: recovery.attempts });
  context.emit({ kind: 'human-review-guidance' });
  await context.escalateToHumanReview('REVIEWER_NON_APPROVAL');
  return { step: 'stop' };
}

/** Approval ends autonomous review; every other outcome moves the round to fixing. */
async function applyReviewerOutcome(context: LoopContext, round: ReviewRound, reviewState: unknown): Promise<RoundStep> {
  const { ports, state, slug } = context;
  if (reviewState !== 'APPROVED') {
    state.transitionTo('fixing');
    state.disposition = reviewState as string;
    return null;
  }
  const authoritative = await ports.state.read();
  if (persistedReviewerOutcome(state, authoritative) === 'APPROVED') {
    state.phase = 'approved';
    state.disposition = 'APPROVED';
    if (authoritative?.reviewer) {
      state.reviewer = authoritative.reviewer;
      context.identities.reviewer = authoritative.reviewer;
    }
    context.emit({ kind: 'review-verdict', disposition: state.disposition, findings: [], verbose: context.verbose, round: state.round });
    context.emit({ kind: 'reviewer-approved' });
    await ports.task.mirrorApproved();
    return 'stop';
  }
  state.transitionTo('approved');
  state.disposition = reviewState;
  try {
    await ports.state.recordApproval(state, round.providerApproval);
  } catch (err) {
    // The review → integration boundary failed: leave the Backlog task in
    // review; px integrate recovers it.
    context.emit({ kind: 'approval-transition-failed', slug: slug, diagnostic: err instanceof Error ? err.message : String(err) });
    context.emit({ kind: 'integrate-guidance', slug: slug });
    context.exit(1);
    return 'stop';
  }
  context.emit({ kind: 'review-verdict', disposition: state.disposition, findings: [], verbose: context.verbose, round: state.round });
  context.emit({ kind: 'reviewer-approved' });
  await ports.task.mirrorApproved();
  return 'stop';
}

/** A round resumed in fixing reads the recorded outcome (provider or local). */
async function resumeFixingPhaseReview(context: LoopContext, round: ReviewRound): Promise<unknown> {
  const { ports, state, identities } = context;
  if (!context.dryRun && ports.missionStore) { await settleRecordedChanges(context, round); }
  let reviewState: unknown = ports.provider
    ? await observeProviderReview(context, round, await ports.provider.latestReview(identities.reviewer, state.startedAt))
    : state.disposition || null;
  if (!reviewState) {
    context.emit({ kind: 'missing-resumed-review', providerEnabled: Boolean(ports.provider), reviewer: identities.reviewer, startedAt: state.startedAt });
    reviewState = 'REQUEST_CHANGES';
  }
  context.emit({ kind: 'fixing-resumed', attempt: round.attempt, reviewState: reviewState });
  return reviewState;
}

/** Resolve reviewer separation, then persist the reviewing-round boundary. */
async function openReviewerRound(context: LoopContext): Promise<boolean> {
  if (!routeCollidingReviewer(context)) { return false; }
  if (context.dryRun) { return true; }
  if (await context.ports.state.openRound(context.state)) { return true; }
  context.exit(1);
  return false;
}

/** Run the reviewing half; the outcome the implementer answers, or 'stop'. */
export async function runReviewerPhase(context: LoopContext, round: ReviewRound, dismissedApproval = false): Promise<ReviewOutcome> {
  const { state } = context;
  round.integrationRepair = await integrationRepairBrief(context);
  if (state.phase === 'approved') {
    if (!context.dryRun) { await context.ports.task.mirrorApproved(); }
    return { outcome: 'stop' };
  }
  if (state.phase !== 'reviewing') { return { reviewState: await resumeFixingPhaseReview(context, round) }; }
  // TASK-2582: the round-open boundary persists the authoritative active →
  // review transition before any destination-state work starts.
  if (!(await openReviewerRound(context))) { return { outcome: 'stop' }; }
  // A dismissed approval requires a fresh reviewer, never the continuation skip-check.
  let reviewState = dismissedApproval ? null : await existingReviewOnContinue(context, round);
  const resumedApproval = reviewState === 'APPROVED';
  if (context.dryRun) {
    if (!reviewState) { dryRunReviewerPrompt(context, round); }
    return { outcome: 'stop' };
  }
  if (!reviewState) {
    const fresh = await runFreshReviewer(context, round);
    if (fresh.action === 'return') { return fresh.value; }
    reviewState = fresh.reviewState;
  }
  if (resumedApproval) {
    // Provider polling may rediscover the persisted reviewer's approval while
    // the Review authority still owes another selected family. Re-enter the
    // existing serialized policy owner before treating that approval as the
    // round outcome, so only an authoritative decision reaches task mirroring.
    const continued = await continueResumedApproval(context, round);
    if (continued.action === 'return') { return continued.value; }
    reviewState = continued.reviewState;
  }
  if (await applyReviewerOutcome(context, round, reviewState)) { return { outcome: 'stop' }; }
  return { reviewState };
}

type FreshReviewerResult = { action: 'return'; value: ReviewOutcome } | { action: 'continue'; reviewState: unknown };

async function continueResumedApproval(context: LoopContext, round: ReviewRound): Promise<FreshReviewerResult> {
  const next = await nextOutstandingReviewer(context, round, new Set([context.identities.reviewer]));
  if (next === 'next') { return await runSelectedReviewers(context, round); }
  if (next === 'exhausted') {
    await context.escalateToHumanReview('REVIEWER_NON_APPROVAL');
    return { action: 'return', value: { outcome: 'stop' } };
  }
  return { action: 'continue', reviewState: 'APPROVED' };
}

async function runFreshReviewer(context: LoopContext, round: ReviewRound): Promise<FreshReviewerResult> {
  if (await freshReviewSetup(context, round)) { return { action: 'return', value: { outcome: 'stop' } }; }
  // Record the round's reviewer requirement before anything can decide it, so a
  // classifier verdict is measured against the same authority the reviewers answer (PX-0046.03).
  await establishReviewerPolicy(context, round);
  round.integrationRepair = await integrationRepairBrief(context);
  const cycleStarted = context.ports.classification?.clock();
  const classified = await tryClassifyReview(context, round, cycleStarted);
  if (classified === 'stop') { return { action: 'return', value: { outcome: 'stop' } }; }
  if (classified) {
    if (await applyReviewerOutcome(context, round, classified)) { return { action: 'return', value: { outcome: 'stop' } }; }
    return { action: 'return', value: { reviewState: classified } };
  }
  return await runSelectedReviewers(context, round);
}

/** Launch the selected reviewers one after another until the Review authority has what the revision owes. */
async function runSelectedReviewers(context: LoopContext, round: ReviewRound): Promise<FreshReviewerResult> {
  const stop: FreshReviewerResult = { action: 'return', value: { outcome: 'stop' } };
  const policyApplies = await establishReviewerPolicy(context, round);
  const launched = new Set<string>();
  for (;;) {
    launched.add(context.identities.reviewer);
    const launch = await launchReviewer(context, round);
    if (launch === 'approved') { return { action: 'continue', reviewState: 'APPROVED' }; }
    if (launch === 'replaced') { continue; }
    if (launch) { return stop; }
    launched.add(context.identities.reviewer);
    const consumed = await consumeReviewerOutput(context, round);
    if (consumed.step) { return stop; }
    const recovered = await recoverReviewerTimeout(context, round, consumed.reviewState);
    if (recovered.step) { return stop; }
    // Only an approval can leave a revision owing another reviewer; a negative verdict is decisive.
    const next = policyApplies && recovered.reviewState === 'APPROVED' ? await nextOutstandingReviewer(context, round, launched) : 'done';
    if (next === 'next') { round.reviewerLaunch = undefined; continue; }
    if (next === 'exhausted') {
      await context.escalateToHumanReview('REVIEWER_NON_APPROVAL');
      return stop;
    }
    return { action: 'continue', reviewState: recovered.reviewState };
  }
}

async function freshReviewSetup(context: LoopContext, round: ReviewRound): Promise<boolean> {
  if (await runPreReviewRebase(context, round)) { return true; }
  if (await runDeclaredPreReviewGate(context, round)) { return true; }
  round.preReviewSetupVerified = false;
  // TASK-2478/criterion 7: a passing re-round gate is the post-fix
  // verification the operator sees before the second review runs.
  if (round.attempt > 1) {
    context.emit({ kind: 'revision-verified', attempt: round.attempt });
  }
  // The task mirror can commit Backlog bookkeeping after the round was
  // opened. Pin routing to the revision that passed the complete setup.
  round.verifiedRevision = context.ports.preReview.head() ?? undefined;
  await pinReviewBaseline(context, round);

  return false;
}
