/**
 * The reviewing half of a round: open the round, run the pre-review
 * prerequisites, launch the reviewer, consume and recover its output, and turn
 * the outcome into the next step — approval stops the loop, anything else moves
 * the round to fixing.
 */
import { integrationRepairReviewBrief, latestIntegrationRepair } from '../integration-repair-review.js';
import { missionId } from '../../domain/mission.js';
import { DEFAULT_REBOUND_ATTEMPTS, rebound } from '../rebound-kernel.js';
import { isArtifactInfraDiagnostic, isPollTimeout, POLL_TIMEOUT, type ReviewerArtifactFacts } from '../ports/review-round.js';
import { runDeclaredPreReviewGate, runPreReviewRebase } from './pre-review.js';
import { adoptLaunchedAgent, elapsedSince, reboundCollaborators, stopIfControllerSuperseded, type LoopContext, type ReviewRound, type RoundStep } from './round.js';

type ReviewOutcome = { outcome: 'stop' } | { reviewState: unknown };

/** The recorded integration repair the reviewer is told about. */
async function integrationRepairBrief(context: LoopContext): Promise<string> {
  const store = context.ports.missionStore;
  if (!store) { return ''; }
  const loaded = await store.load(missionId(context.slug));
  return loaded.kind === 'found' ? integrationRepairReviewBrief(latestIntegrationRepair(loaded.mission)) : '';
}

/** A --continue re-enters its first round with a check for an existing review. */
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
  const existing = await ports.provider.pollReview(identities.reviewer, state.startedAt, { label: `round ${round.attempt} skip-check`, quick: true, retryCount: 0 });
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

/** Launch the reviewer (skipped for an autonomous local round). */
async function launchReviewer(context: LoopContext, round: ReviewRound): Promise<RoundStep> {
  const { ports, identities } = context;
  if (identities.reviewer === 'autonomous' && !ports.provider) {
    context.emit({ kind: 'autonomous-reviewer', attempt: round.attempt });
    return null;
  }
  context.emit({ kind: 'reviewer-launching', attempt: round.attempt, reviewer: identities.reviewer });
  let launch;
  try {
    launch = await ports.agents.launch({ role: 'reviewer', agent: identities.reviewer, exclude: [identities.implementer], prompt: round.promptFacts() });
  } catch (err: unknown) {
    context.emit({ kind: 'agent-selection', outcome: 'launch-failed', fields: { agent: identities.reviewer, step: 'review', error: (err as Error).message } });
    context.emit({ kind: 'reviewer-launch-failed', reviewer: identities.reviewer, message: (err as Error).message });
    await context.escalateToHumanReview('REVIEWER_LAUNCH_FAILURE');
    return 'stop';
  }
  // The launch is an await boundary: a concurrent controller may have advanced
  // the round, so re-read before any identity or telemetry write.
  if (await stopIfControllerSuperseded(context, 'reviewer-launch fallback')) { return 'stop'; }
  await adoptLaunchedAgent(context, 'reviewer', identities.reviewer, launch);
  await ports.agents.recordStage('reviewer', context.state, identities, launch);
  return null;
}

function reviewerArtifactDiagnostic(context: LoopContext, artifacts: ReviewerArtifactFacts): string {
  return artifacts.diagnostic || `Reviewer ${context.identities.reviewer} produced incomplete or invalid review artifacts`;
}

/**
 * Consume the reviewer's output. Incomplete output is relaunched through one
 * rebound occurrence; an infrastructure failure or a spent budget escalates.
 * Falls back to the provider poll when nothing was consumed.
 */
async function consumeReviewerOutput(context: LoopContext, round: ReviewRound): Promise<{ step: RoundStep; reviewState?: unknown }> {
  const { ports, state, identities } = context;
  const persisted = await ports.state.read();
  if (state.phase === 'reviewing' && persisted?.phase === 'approved' && persisted.disposition === 'APPROVED') { return { step: null, reviewState: 'APPROVED' }; }
  if (state.phase === 'reviewing' && persisted?.phase === 'fixing' && persisted.disposition === 'REQUEST_CHANGES') { return { step: null, reviewState: 'REQUEST_CHANGES' }; }
  let artifacts = await ports.artifacts.consumeReviewer(identities.reviewer, state);
  let reviewState: unknown = null;
  if (artifacts.consumed && !artifacts.ok) {
    const diagnostic = reviewerArtifactDiagnostic(context, artifacts);
    if (isArtifactInfraDiagnostic(diagnostic)) {
      context.emit({ kind: 'reviewer-artifact-infra', diagnostic: diagnostic });
      await context.escalateToHumanReview('REVIEWER_ARTIFACT_INFRA_FAILURE');
      return { step: 'stop' };
    }
    if (round.capReached()) { return { step: await round.stopForCap('reviewer artifact') }; }
    // `fixed` requires the re-consumed artifacts to be complete: a relaunch
    // alone is no evidence that the reviewer produced anything.
    const maxAttempts = round.occurrenceBudget(DEFAULT_REBOUND_ATTEMPTS);
    const recovery = await rebound({ kind: 'artifact-incomplete', role: 'reviewer', diagnostic }, {
      ...reboundCollaborators(context, 'reviewer', () => round.promptFacts()),
      implementer: identities.reviewer, step: 'review', role: 'reviewer', exclude: [identities.implementer], maxAttempts,
      verify: async () => {
        artifacts = await ports.artifacts.consumeReviewer(identities.reviewer);
        if (!artifacts.consumed) { return { ok: false, diagnostic: `Reviewer ${identities.reviewer} produced no review artifacts after the relaunch` }; }
        return artifacts.ok ? { ok: true } : { ok: false, diagnostic: reviewerArtifactDiagnostic(context, artifacts) };
      },
    });
    round.used += recovery.attempts ?? 0;
    identities.reviewer = recovery.implementer || identities.reviewer;
    if (recovery.outcome !== 'fixed') {
      if (recovery.outcome === 'human-only') {
        context.emit({ kind: 'reviewer-recovery-human', slug: context.slug });
        await context.escalateToHumanReview('REVIEWER_ARTIFACT_INFRA_FAILURE');
        return { step: 'stop' };
      }
      if (round.capReached()) { return { step: await round.stopForCap('reviewer artifact') }; }
      context.emit({ kind: 'reviewer-recovery-exhausted', maxAttempts: maxAttempts, slug: context.slug });
      await context.escalateToHumanReview('REVIEWER_ARTIFACT_RETRY_EXHAUSTED');
      return { step: 'stop' };
    }
    context.emit({ kind: 'reviewer-artifacts-recovered', attempts: recovery.attempts });
  }
  if (artifacts.consumed) {
    reviewState = artifacts.reviewState;
    // TASK-2477/F1: recovery carries the findings too, so the CHANGES
    // REQUESTED summary is never empty on the recovery path.
    round.blockingFindings = artifacts.reviewFindings || [];
  }
  if (!reviewState && ports.provider) {
    reviewState = await ports.provider.pollReview(identities.reviewer, state.startedAt, { label: `round ${round.attempt} review`, retryCount: 0 });
  }
  return { step: null, reviewState };
}

/**
 * A round with no usable review outcome (poll timeout or nothing at all)
 * relaunches the reviewer through the kernel; a spent budget needs a human.
 */
async function recoverReviewerTimeout(context: LoopContext, round: ReviewRound, reviewState: unknown): Promise<{ step: RoundStep; reviewState?: unknown }> {
  const { ports, state, identities } = context;
  if (!isPollTimeout(reviewState) && reviewState) { return { step: null, reviewState }; }
  if (!reviewState) {
    context.emit({ kind: 'missing-review-outcome', reviewer: identities.reviewer, providerEnabled: Boolean(ports.provider), branch: ports.branch });
  }
  let recovered: unknown = POLL_TIMEOUT;
  const recovery = await rebound({
    kind: 'agent-timeout', role: 'reviewer',
    diagnostic: `No usable review outcome for ${ports.branch} after ${elapsedSince(state.startedAt)}.`,
    expectedOutput: ports.provider ? 'a formal review outcome' : 'a review verdict through px',
  }, {
    ...reboundCollaborators(context, 'reviewer', () => round.promptFacts()),
    implementer: identities.reviewer, step: 'review', role: 'reviewer', exclude: [identities.implementer],
    maxAttempts: round.occurrenceBudget(DEFAULT_REBOUND_ATTEMPTS),
    verify: async () => {
      const retry = await ports.artifacts.consumeReviewer(identities.reviewer);
      const diagnostic = retry.diagnostic || `Reviewer output still missing for ${ports.branch}`;
      recovered = retry.consumed && retry.ok ? retry.reviewState : null;
      if (!recovered && ports.provider) {
        recovered = await ports.provider.pollReview(identities.reviewer, state.startedAt, { label: `round ${round.attempt} review recovery`, retryCount: 0 });
      }
      return recovered && !isPollTimeout(recovered)
        ? { ok: true }
        : { ok: false, diagnostic, reason: { kind: 'artifact-incomplete', role: 'reviewer', diagnostic } };
    },
  });
  round.used += recovery.attempts;
  identities.reviewer = recovery.implementer || identities.reviewer;
  if (recovery.outcome === 'fixed') { return { step: null, reviewState: recovered }; }
  if (round.capReached()) { return { step: await round.stopForCap('reviewer timeout recovery') }; }
  context.emit({ kind: 'reviewer-timeout-exhausted', dossier: recovery.dossier, reviewer: identities.reviewer, attempts: recovery.attempts });
  context.emit({ kind: 'human-review-guidance' });
  await context.escalateToHumanReview('REVIEWER_NON_APPROVAL');
  return { step: 'stop' };
}

/** Approval ends autonomous review; every other outcome moves the round to fixing. */
async function applyReviewerOutcome(context: LoopContext, reviewState: unknown): Promise<RoundStep> {
  const { ports, state, slug } = context;
  if (reviewState !== 'APPROVED') {
    state.transitionTo('fixing');
    state.disposition = reviewState as string;
    return null;
  }
  state.transitionTo('approved');
  state.disposition = reviewState;
  try {
    await ports.state.persist(state);
  } catch (err) {
    // The review → integration boundary failed: leave the Backlog task in
    // review; px integrate recovers it.
    context.emit({ kind: 'approval-transition-failed', slug: slug, diagnostic: err instanceof Error ? err.message : String(err) });
    context.emit({ kind: 'integrate-guidance', slug: slug });
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
  let reviewState: unknown = ports.provider
    ? await ports.provider.latestReview(identities.reviewer, state.startedAt)
    : state.disposition || null;
  if (!reviewState) {
    context.emit({ kind: 'missing-resumed-review', providerEnabled: Boolean(ports.provider), reviewer: identities.reviewer, startedAt: state.startedAt });
    reviewState = 'request-changes';
  }
  context.emit({ kind: 'fixing-resumed', attempt: round.attempt, reviewState: reviewState });
  return reviewState;
}

/** Run the reviewing half; the outcome the implementer answers, or 'stop'. */
export async function runReviewerPhase(context: LoopContext, round: ReviewRound): Promise<ReviewOutcome> {
  const { state } = context;
  round.integrationRepair = await integrationRepairBrief(context);
  if (state.phase !== 'reviewing') { return { reviewState: await resumeFixingPhaseReview(context, round) }; }
  // TASK-2582: the round-open boundary persists the authoritative active →
  // review transition before any destination-state work starts.
  if (!context.dryRun && !(await context.ports.state.openRound(state))) {
    context.exit(1);
    return { outcome: 'stop' };
  }
  let reviewState = await existingReviewOnContinue(context, round);
  if (context.dryRun) {
    if (!reviewState) { dryRunReviewerPrompt(context, round); }
    return { outcome: 'stop' };
  }
  if (!reviewState) {
    if (await runPreReviewRebase(context, round)) { return { outcome: 'stop' }; }
    if (await runDeclaredPreReviewGate(context, round)) { return { outcome: 'stop' }; }
    round.preReviewSetupVerified = false;
    // TASK-2478/criterion 7: a passing re-round gate is the post-fix
    // verification the operator sees before the second review runs.
    if (round.attempt > 1) {
      context.emit({ kind: 'revision-verified', attempt: round.attempt });
    }
    // The graph is reviewer context, not a correctness gate: refresh it once
    // only after the final rebase and declared verification have succeeded.
    await context.ports.preReview.refreshKnowledgeGraph();
    if (await launchReviewer(context, round)) { return { outcome: 'stop' }; }
    const consumed = await consumeReviewerOutput(context, round);
    if (consumed.step) { return { outcome: 'stop' }; }
    const recovered = await recoverReviewerTimeout(context, round, consumed.reviewState);
    if (recovered.step) { return { outcome: 'stop' }; }
    reviewState = recovered.reviewState;
  }
  if (await applyReviewerOutcome(context, reviewState)) { return { outcome: 'stop' }; }
  return { reviewState };
}
