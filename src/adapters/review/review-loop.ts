/**
 * Review Loop Module
 * Orchestrates autonomous reviewer and implementer rounds.
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import * as fmt from '../../application/presentation/cli-format.js';
import { git, run } from '../git/git.js';
import { findMissionDir, resolveWorktree, missionBranchName, getPrimaryBranch } from '../filesystem/mission-utils.js';
import { isDbAdhocIdentity, missionId } from '../../domain/mission.js';
import { reviewStatus } from '../../domain/review.js';
import { recoverLegacyIntegrationRepairReview } from '../../application/integration-repair-review.js';
import type { PullRequestReference } from '../../domain/review.js';
import { resolveTaskFile, getTaskImplementer, getTaskStatus, enforceTaskAssignee, transitionTask, reportTaskResolution } from '../backlog/backlog.js';
import { toVirtual, transitionVirtual } from '../config/state-map.js';
import { getPrStatus, readToken, getLatestReviewForPr, getLatestDispositionForPr, providerAvailable, getComments, postComment, postReview, resolveReviewUser, isProviderEnabled } from './review-adapter.js';
import { buildAutonomousReviewMatrix, formatMatrixSummary } from '../agents/runtime-matrix.js';
import { buildReviewPrompt, buildActOnReviewPrompt, buildCompactReviewPrompt, buildCompactActOnReviewPrompt } from './review-prompts.js';
import { ReviewState, readReviewState, writeReviewState, resetReviewState, persistReviewStateOrThrow, assertReviewStatePersisted } from './review-state.js';
import type { MissionStore } from '../../application/domain-ports.js';
import type { MissionLifecycleService } from '../../application/mission-lifecycle-service.js';
import type { AgentSelectionSnapshotPort } from '../../application/domain-ports.js';
import { PreparedAgentSelection } from '../../application/services/agent-selection.js';
import { recordAgentSelectionOutcome } from '../../application/services/agent-selection-telemetry.js';
import { workflowLauncherStatus, startAgent, eligibleAgentsForStep, selectAgent } from '../agents/agents.js';
import { commitSafeMissionArtifacts, rebaseBeforeReviewRound } from './rebase.js';
import { packageRoot } from '../filesystem/package-root.js';
import { resolveAgentModel } from '../config/product-config.js';
import { POLL_TIMEOUT, delay, resolvePollIntervalMs, resolvePollTimeoutMs, formatElapsed, isPollTimeout, pollForReview, pollForDisposition } from './review-polling.js';
import { buildMetadataFooter, resolveArtifactDir, consumeReviewerArtifacts, consumeImplementerArtifacts, dispatchArtifactFailure, isArtifactInfraDiagnostic, ARTIFACT_REBOUND_ATTEMPTS } from './review-artifacts.js';
import { DEFAULT_REBOUND_ATTEMPTS, rebound } from '../../application/rebound-kernel.js';
import { pushReviewRef, isStaleInfoPushRejection, fetchReviewBranch } from '../forgejo/forgejo.js';
import {
  DEFAULT_MAX_ATTEMPTS,
  CONTINUE_SKIP_CHECK_TIMEOUT_MS,
  strictlyLaterIso,
  runPreReviewGate,
  reboundPreReviewFailure,
  gateFailureReason,
  hookFailureReason,
} from './review-gate-handling.js';
import {
  applyAgentFallback,
  persistNormalizedPhaseRepair,
  selectPreparedReviewer,
  resolveReviewerIdentity,
  stageLaunchSinceMs,
  maybeUpdateGraphifyBeforeReview,
} from './review-agent-fallback.js';
import { openReviewRound } from './review-round-open.js';
import { transitionReviewRepair } from '../../application/review-repair-lifecycle.js';
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
/**
 * Per-round relaunch cap (TASK-2377.04): bounds the total bounce launch
 * attempts in one review round — every launch consumed by a rebound-kernel
 * occurrence (gate, hook, artifact) plus every timeout-recovery relaunch.
 * In-memory and round-local: it persists nothing and resets each round.
 */
export const DEFAULT_REBOUNDS_PER_ROUND = 6;

/** Named escalation reason: the per-round relaunch cap is exhausted. */
export const REBOUNDS_PER_ROUND_EXHAUSTED = 'REBOUNDS_PER_ROUND_EXHAUSTED';

/** The review relationship is expressed using configured agent-family IDs. */
export function reviewIndependence(implementer: string, reviewer: string): string {
  return implementer === reviewer
    ? 'same-family fallback / self-review'
    : 'different-family review';
}

/** Render only a persisted, authoritative review state as the operator verdict. */
export function renderReviewVerdict(reviewState: string | null, findings: readonly { id: string; summary: string }[], log: (_msg: string) => void, verbose = false, round?: number): void {
  if (reviewState === 'APPROVED') {
    log(fmt.status('PASS', `========== APPROVED${round && round > 1 ? ` · round ${round}` : ''} ==========`));
    return;
  }
  if (reviewState === 'REQUEST_CHANGES') {
    log(fmt.status('WARN', '====== CHANGES REQUESTED ======'));
    for (const finding of findings) {
      log(fmt.status('WARN', `Blocking finding: ${finding.id} — ${finding.summary}`));
    }
    return;
  }
  // A non-binary outcome (e.g. COMMENT) used to be reported as `Round N:
  // reviewer outcome = X`; demote it to verbose rather than delete it so a
  // silent non-binary verdict is not a regression (TASK-2477/F2).
  if (verbose && reviewState) {
    log(fmt.status('INFO', `Reviewer outcome = ${reviewState}`));
  }
}

/** Values the provider prelude resolves for the rest of the loop. */
interface ProviderPrelude {
  prNumber: number | null;
  confirmedPullRequest: PullRequestReference | null;
  skipHandoff: boolean;
}

/**
 * The review provider has to answer before a round can start. An unreachable
 * provider gets one bootstrap attempt; a failed bootstrap is a hard stop, since
 * every later PR read would be a guess. Returns false once exit has been called.
 */
async function ensureProviderReachable(deps: {
  resolvedProviderAvailableFn: (_url: string) => Promise<boolean> | boolean;
  runFn: unknown;
  log: (_msg: string) => void;
  error: (_msg: string) => void;
  exit: (_code: number) => void;
}): Promise<boolean> {
  const { resolvedProviderAvailableFn, runFn, log, error, exit } = deps;
  const forgejoUrl = process.env.FORGEJO_URL || 'http://localhost:3300';
  log(fmt.status('INFO', `Checking review-provider availability at ${forgejoUrl}...`));
  if (await resolvedProviderAvailableFn(forgejoUrl)) {
    log(fmt.status('INFO', `Review provider is running and reachable at ${forgejoUrl}.`));
    return true;
  }
  error(fmt.status('FAIL', `Review provider not reachable at ${forgejoUrl}`));
  error('       Attempting to bootstrap provider containers...');
  const bootstrapScript = path.join(packageRoot(MODULE_DIR), 'scripts', 'bootstrap.sh');
  if ((runFn as any)('bash', [bootstrapScript], { stdio: 'inherit' }).status === 0) {
    log(fmt.status('INFO', 'Bootstrap succeeded. Continuing with review loop.'));
    return true;
  }
  error(fmt.status('FAIL', 'Bootstrap failed. Please run \'scripts/bootstrap.sh\' manually and retry.'));
  exit(1);
  return false;
}

/** Remember an open PR; the Review aggregate separately proves handoff. */
function confirmOpenReviewPr(state: ProviderPrelude, deps: {
  branch: string;
  worktree: string;
  getPrStatusFn: Function;
  pullRequestReference: (_number: unknown, _url: unknown) => PullRequestReference | null;
  log: (_msg: string) => void;
}): void {
  const pr = deps.getPrStatusFn(deps.branch, deps.worktree) as Record<string, unknown>;
  if (!pr.exists || pr.state !== 'open') { return; }
  deps.log(fmt.status('INFO', `Review PR #${pr.number} confirmed open for ${deps.branch}.`));
  state.prNumber = pr.number as number | null;
  state.confirmedPullRequest = deps.pullRequestReference(pr.number, pr.url);
  state.skipHandoff = true;
}

/**
 * The transition `px handoff` used to own (SC1). It runs for every non-dry start
 * with no open review PR: a provider-disabled start always, and a Forgejo start
 * only when no PR exists — which heals a missing PR. Returns ok:false once a
 * diagnostic has been emitted and the exit code set.
 */
async function performStartHandoff(slug: string, state: ProviderPrelude, deps: any): Promise<{ ok: boolean; ran: boolean }> {
  const {
    performHandoffFn, implementer, worktree, branch, forgejoEnabled, taskResolution,
    getTaskStatusFn, getPrStatusFn, transitionTaskFn, readReviewStateFn, writeReviewStateFn,
    missionStore, pullRequestReference, log, error, exit,
  } = deps;
  if (!performHandoffFn) {
    error(fmt.status('FAIL', `Cannot start ${slug}: no handoff transition wired into the review loop.`));
    exit(1);
    return { ok: false, ran: false };
  }
  const taskStatus = taskResolution.ok ? getTaskStatusFn(taskResolution.taskFile!) : null;
  // An active task is the normal --start condition, not a reason to bail.
  log(fmt.status('INFO', `No completed handoff for ${branch} (task in ${taskStatus}) — performing handoff (attempting automatic handoff) via px review ${slug} --start...`));
  const handoff = await performHandoffFn(slug, { forgejoUser: implementer, worktree, recoverGateFailure: true });

  if (handoff?.gatekeeperPushedBack) {
    error(fmt.status('FAIL', `Handoff blocked for ${branch}: mandatory mission artifacts are missing. Task stays in ${taskStatus}; supply the required artifacts and retry.`));
    exit(1);
    return { ok: false, ran: true };
  }
  if (!handoff?.ok) {
    await reportFailedStartHandoff(slug, handoff || {}, { ...deps, forgejoEnabled, branch, worktree, transitionTaskFn, readReviewStateFn, writeReviewStateFn, missionStore, getPrStatusFn, log, error });
    exit(1);
    return { ok: false, ran: true };
  }
  if (forgejoEnabled) {
    const healedPr = getPrStatusFn(branch, worktree) as Record<string, unknown>;
    if (!healedPr.exists || healedPr.state !== 'open') {
      error(fmt.status('FAIL', `No open review PR found for ${branch}. Create the PR before starting the review loop.`));
      error(`       Run: px review ${slug} --push`);
      exit(1);
      return { ok: false, ran: true };
    }
    log(fmt.status('INFO', `Self-heal succeeded: review PR #${healedPr.number} confirmed open for ${branch}. Continuing review loop.`));
    state.prNumber = healedPr.number as number | null;
    state.confirmedPullRequest = pullRequestReference(healedPr.number, healedPr.url);
  }
  return { ok: true, ran: true };
}

/**
 * A declared-gate validation failure is the mission author's to fix, so the task
 * bounces back to active with the reason recorded. Every other failure reports
 * the route back: Forgejo keeps the PR-specific guidance (a PR is required to
 * review the provider), a provider-disabled start reports the handoff error.
 */
async function reportFailedStartHandoff(slug: string, handoff: any, deps: any): Promise<void> {
  const { forgejoEnabled, branch, worktree, transitionTaskFn, readReviewStateFn, writeReviewStateFn, missionStore, getPrStatusFn, log, error } = deps;
  if (handoff.reason === 'validation-failed' && !handoff.recoveryAttempted) {
    if (missionStore) { await transitionReviewRepair(slug, 'active', deps.implementer, missionStore, deps.lifecycleService ?? null); }
    await transitionTaskFn(slug, 'active', { rootDir: worktree, log });
    log(fmt.status('INFO', `Auto-bounced ${slug} to active: declared-gate validation failure. Fix the gate in MISSION.md and retry.`));
    const persisted = await Promise.resolve(readReviewStateFn(slug, worktree));
    const metadata = persisted?.metadata && typeof persisted.metadata === 'object' ? { ...persisted.metadata } : {};
    metadata.gateFailureReason = 'validation-failed';
    metadata.gateFailureError = handoff.error;
    await persistReviewStateOrThrow(writeReviewStateFn, slug, { ...(persisted || {}), metadata } as any, worktree, missionStore);
    return;
  }
  const pr = forgejoEnabled ? getPrStatusFn(branch, worktree) : null;
  if (forgejoEnabled && (!pr?.exists || pr.state !== 'open')) {
    error(fmt.status('FAIL', `No open review PR found for ${branch}. Create the PR before starting the review loop.`));
    if (handoff.error) { error(`       Handoff failure: ${String(handoff.error)}`); }
    error(`       Run: px review ${slug} --push`);
    return;
  }
  error(fmt.status('FAIL', `Handoff failed for ${branch}: ${handoff.error ? String(handoff.error) : 'see above'}.`));
  error(`       Run: px review ${slug} --start after resolving the error.`);
}

/**
 * One review round: reviewer launch, artifact consumption, the disposition, and
 * the implementer's answer to it. Returns 'stop' where the loop used to return
 * outright and 'next-round' where it continued, so the caller keeps ownership of
 * the round counter and the max-attempts escalation.
 *
 * A fallback inside a round replaces the reviewer or implementer for every later
 * round too, so both identities are read from `identities` on entry and written
 * back on every exit path.
 */
/** Scratch shared by a round's two halves; nothing here is persisted. */
interface RoundScratch {
  reboundsUsedThisRound: number;
  reboundsRemainingThisRound: () => number;
  roundReboundCapReached: () => boolean;
  stopForRoundReboundCap: (_context: string) => Promise<void>;
  verifyPreReviewSetup: () => Promise<{ ok: boolean; diagnostic: string; reason?: any }>;
  reboundCollaborators: () => Record<string, unknown>;
  captureReviewBaseline: () => string | undefined;
  reviewBaseline: string | undefined;
  preReviewSetupVerified: boolean;
  reviewerTimeoutRetries: number;
  blockingFindings: { id: string; summary: string }[];
}

/** The round-open handoff boundary (TASK-2582). Returns true when the round must stop. */
async function runRoundOpenBoundary(deps: ReviewerPhaseDeps): Promise<boolean> {
  const { ctx, state } = deps;
  const { slug, worktree, log, error, writeReviewStateFn, missionStore, lifecycleService, exit } = ctx;
  const boundary = await openReviewRound(slug, state, {
    worktree,
    log,
    error,
    writeReviewStateFn,
    missionStore,
    lifecycleService: lifecycleService ?? null,
  });
  if (boundary.ok) { return false; }
  // The boundary already emitted the diagnostic; stop the round so no
  // reviewer runs against an unopened round and no success is reported.
  exit(1);
  return true;
}

/**
 * The reviewing half of a round: the pre-review rebase and gate with their hook
 * bounces, the reviewer launch, artifact consumption, and the provider poll.
 * Returns the review outcome the implementer half answers, or the outcome that
 * ends the loop.
 */

type ReviewerPhaseScratch = {
  implementer: string | undefined;
  reviewer: string | undefined;
  reviewState: unknown;
};

type ReviewerPhaseDeps = {
  ctx: any;
  state: ReviewState;
  round: RoundScratch;
  attempt: number;
  scratch: ReviewerPhaseScratch;
};

/** A --continue re-enters at the round that already carries an existing-review check. */
async function checkExistingReviewOnContinue(deps: ReviewerPhaseDeps): Promise<void> {
  const { ctx, state, round, attempt, scratch } = deps;
  const { isContinue, initialRound, dryRun, forgejoEnabled, verbose, pollForReviewFn, prNumber, token, getLatestReviewForPrFn, sleepFn, transitionTaskFn, worktree, slug, log } = ctx;
  if (!(isContinue && attempt === initialRound)) { return; }
  if (!dryRun) { await transitionTaskFn(slug, 'review', { rootDir: worktree, log }); }
  if (forgejoEnabled) {
    log(fmt.status('INFO', `Round ${attempt}: checking for existing review by ${scratch.reviewer} since ${state.startedAt}...`));
    scratch.reviewState = await pollForReviewFn(prNumber as number, scratch.reviewer!, state.startedAt, token!, {
      getLatestReviewForPrFn, sleepFn, intervalMs: 1000, timeoutMs: 2000, retryCount: round.reviewerTimeoutRetries, verbose, label: `round ${attempt} skip-check`, log
    });
    if (isPollTimeout(scratch.reviewState)) {
      scratch.reviewState = null;
    }
  } else {
    // Provider plumbing: verbose-only so it does not compete with the
    // reviewer launch on the provider=none happy path.
    if (verbose) {
      log(fmt.status('INFO', `Round ${attempt}: review provider disabled; using workflow-owned review state.`));
    }
    scratch.reviewState = null;
  }
}

/** Log the reviewer prompt for a dry run (or note the autonomous skip). */
function dryRunReviewerPrompt(deps: ReviewerPhaseDeps): void {
  const { ctx, round, attempt, scratch } = deps;
  const { buildReviewPromptFn, branch, focus, effectiveMissionPath, worktree, log } = ctx;
  if (scratch.reviewState) { return; }
  if (scratch.reviewer === 'autonomous') {
    log(fmt.status('INFO', `Round ${attempt}: reviewer identity is autonomous; skipping dry-run reviewer prompt and using local review artifacts only.`));
  } else {
    log(`\n--- DRY-RUN: reviewer (${scratch.reviewer}) prompt ---`);
    log((buildReviewPromptFn as any)({ reviewer: scratch.reviewer!, branch, implementer: scratch.implementer!, focus, attempt, repoRoot: worktree, missionPath: effectiveMissionPath || undefined, actualReviewer: scratch.reviewer!, reviewBaseline: round.reviewBaseline }));
  }
}

/**
 * Run the pre-review rebase and ride out its gate/hook bounces through the
 * rebound kernel. Returns 'stop' when the round must end.
 */
async function runPreReviewRebase(deps: ReviewerPhaseDeps): Promise<'stop' | null> {
  const { ctx, round, scratch } = deps;
  const {
    dryRun, rebaseBeforeReviewRoundFn, slug, worktree, log, error, verbose, taskResolution, gitFn,
    forgejoEnabledFn, reboundPreReviewFailureFn, transitionTaskFn, exit,
  } = ctx;
  const rebaseResult = await rebaseBeforeReviewRoundFn(slug, {
    worktree, log, error, verbose,
    taskFile: taskResolution.taskFile,
    gitFn,
    isReviewProviderEnabledFn: forgejoEnabledFn,
    ...(ctx.rebaseWorkflowOptions ? { rebaseWorkflowOptions: ctx.rebaseWorkflowOptions } : {})
  });
  if (!rebaseResult.ok) {
    const rebaseFailure = rebaseResult.failure;
    if (rebaseFailure?.kind === 'gate') {
      // TASK-2377.02: the push-time verification gate is a gate failure,
      // even when its captured output mentions the enclosing pre-push
      // hook. It never consumes the hook budget or the hook fix prompt.
      error(fmt.status('FAIL', `Pre-review rebase gate failed for area "${rebaseFailure.gate.area}" (exit ${rebaseFailure.gate.exitCode}) during the ${rebaseFailure.operation} step.`));
      error(fmt.status('INFO', `Gate command: ${rebaseFailure.gate.command}`));
      if (round.roundReboundCapReached()) {
        await round.stopForRoundReboundCap('pre-review gate');
        return 'stop';
      }
      const bounceResult = await reboundPreReviewFailureFn(
        slug,
        worktree,
        gateFailureReason({
          ok: false,
          area: rebaseFailure.gate.area,
          command: rebaseFailure.gate.command,
          exitCode: rebaseFailure.gate.exitCode,
          stdout: rebaseFailure.gate.stdout,
          stderr: rebaseFailure.gate.stderr,
          error: rebaseFailure.gate.error,
        }),
        scratch.implementer!,
        {
          ...round.reboundCollaborators(),
          verifyFn: round.verifyPreReviewSetup,
          maxAttempts: Math.min(DEFAULT_REBOUND_ATTEMPTS, round.reboundsRemainingThisRound()),
        },
      );
      round.reboundsUsedThisRound += bounceResult.attempts ?? 0;
      scratch.implementer = bounceResult.implementer || scratch.implementer;
      if (!bounceResult.bounced) {
        if (round.roundReboundCapReached()) {
          await round.stopForRoundReboundCap('pre-review gate');
          return 'stop';
        }
        error(fmt.status('FAIL', `Pre-review rebase gate failure stranded mission ${slug} (${bounceResult.outcome}). Exiting review loop.`));
        exit(1); return 'stop';
      }
      log(fmt.status('PASS', `Pre-review rebase gate repair verified for ${slug}; continuing this review round.`));
      round.preReviewSetupVerified = true;
    }
    if (rebaseResult.hookFailure) {
      // TASK-2377.02 typed hook evidence (hook identity from git state)
      // is preferred; the legacy hookOutput field stays as fallback so
      // callers that do not populate `failure` keep working.
      const hookOutput = rebaseFailure?.kind === 'hook' ? rebaseFailure.hook.output : (rebaseResult.hookOutput || '');
      if (round.roundReboundCapReached()) {
        await round.stopForRoundReboundCap('pre-review hook');
        return 'stop';
      }
      const bounceResult = await reboundPreReviewFailureFn(
        slug,
        worktree,
        hookFailureReason(
          hookOutput,
          rebaseFailure?.kind === 'hook' && rebaseFailure.operation !== 'commit'
            ? `git ${rebaseFailure.operation} (pre-review rebase, ${rebaseFailure.hook.hook})`
            : 'git commit (pre-review safety commit)',
        ),
        scratch.implementer!,
        {
          ...round.reboundCollaborators(),
          verifyFn: round.verifyPreReviewSetup,
          // TASK-2377.04: the per-occurrence budget is clamped to the
          // remaining per-round relaunch cap before the launch.
          maxAttempts: Math.min(DEFAULT_REBOUND_ATTEMPTS, round.reboundsRemainingThisRound()),
        },
      );
      round.reboundsUsedThisRound += bounceResult.attempts ?? 0;
      scratch.implementer = bounceResult.implementer || scratch.implementer;
      if (bounceResult.bounced) {
        // The kernel's verify re-ran the pre-review rebase and the
        // verification gate, and both passed: the hook fix is proven,
        // so this round continues instead of stranding on an
        // unverified "implementer relaunched" claim.
        log(fmt.status('PASS', `Pre-review Git hook failure repaired and re-verified for ${slug}; continuing this review round.`));
        round.preReviewSetupVerified = true;
      } else {
        if (round.roundReboundCapReached()) {
          await round.stopForRoundReboundCap('pre-review hook');
          return 'stop';
        }
        error(fmt.status('FAIL', `Pre-review Git hook failure ${bounceResult.outcome === 'human-only' ? 'requires human intervention' : 'exhausted its repair budget'} for ${slug}.`));
        exit(1); return 'stop';
      }
    } else if (!round.preReviewSetupVerified) {
      // TASK-2415: the catch-all exit serves unclassified or unrepaired
      // failures only. A gate-only failure the kernel already repaired
      // and verified continues to the reviewer launch in the same round.
      exit(1); return 'stop';
    }
  }
  round.reviewBaseline = round.captureReviewBaseline();
  // The Backlog mirror follows the rebase outcome: a failed rebase never
  // transitions the task to review (the database lane was already settled by
  // the round-open boundary, TASK-2582).
  if (!dryRun) { await transitionTaskFn(slug, 'review', { rootDir: worktree, log }); }
  return null;
}

/** Run the declared pre-review gate, bouncing a failure through the kernel. Returns 'stop' when the round must end. */
async function runDeclaredPreReviewGate(deps: ReviewerPhaseDeps): Promise<'stop' | null> {
  const { ctx, round, scratch } = deps;
  const { dryRun, runPreReviewGateFn, runFn, slug, worktree, log, error, reboundPreReviewFailureFn, transitionTaskFn, exit } = ctx;
  if (dryRun || round.preReviewSetupVerified) { return null; }
  const preReviewGateResult = await runPreReviewGateFn(slug, worktree, {
    runFn: runFn as any,
    log,
    error,
  });
  if (!preReviewGateResult.ok) {
    log(fmt.status('WARN', `Pre-review gate failed for area "${preReviewGateResult.area}" (exit ${preReviewGateResult.exitCode}). Bouncing to implementer.`));
    if (round.roundReboundCapReached()) {
      await round.stopForRoundReboundCap('pre-review gate');
      return 'stop';
    }
    const bounceResult = await reboundPreReviewFailureFn(
      slug,
      worktree,
      gateFailureReason(preReviewGateResult),
      scratch.implementer!,
      {
        ...round.reboundCollaborators(),
        verifyFn: round.verifyPreReviewSetup,
        // TASK-2377.04: the per-occurrence budget is clamped to the
        // remaining per-round relaunch cap before the launch.
        maxAttempts: Math.min(DEFAULT_REBOUND_ATTEMPTS, round.reboundsRemainingThisRound()),
      },
    );
    round.reboundsUsedThisRound += bounceResult.attempts ?? 0;
    scratch.implementer = bounceResult.implementer || scratch.implementer;
    if (!bounceResult.bounced) {
      if (round.roundReboundCapReached()) {
        await round.stopForRoundReboundCap('pre-review gate');
        return 'stop';
      }
      error(fmt.status('FAIL', `Pre-review gate failure stranded mission ${slug} (${bounceResult.outcome}). Exiting review loop.`));
      exit(1); return 'stop';
    }
    // The kernel verified the repair by re-running the pre-review
    // rebase and the gate, so this round resumes with the verified
    // tree rather than restarting the whole review setup.
    log(fmt.status('PASS', `Declared gate repair verified for ${slug}; resuming this review round.`));
    round.reviewBaseline = round.captureReviewBaseline();
    await transitionTaskFn(slug, 'review', { rootDir: worktree, log });
  }
  return null;
}

/** Launch the reviewer agent (skipped for autonomous local rounds). Returns 'stop' when the round must end. */
async function launchReviewer(deps: ReviewerPhaseDeps): Promise<'stop' | null> {
  const { ctx, state, round, attempt, scratch } = deps;
  const {
    forgejoEnabled, buildCompactReviewPromptFn, branch, focus, effectiveMissionPath,
    startAgentFn, applyAgentFallbackFn, enforceTaskAssigneeFn, taskResolution,
    onAgentLaunched, recordStageStatsSafeFn, worktree, slug, log, error,
    writeReviewStateFn, missionStore, escalateToHumanReview,
  } = ctx;
  if (scratch.reviewer === 'autonomous' && !forgejoEnabled) {
    log(fmt.status('INFO', `Round ${attempt}: reviewer identity is autonomous; skipping reviewer launch and using local review artifacts only.`));
    return null;
  }
  log(fmt.status('INFO', `Round ${attempt}: launching reviewer (${scratch.reviewer})...`));
  let reviewerLaunchResult: any;
  try {
    reviewerLaunchResult = await startAgentFn('review', {
      agent: scratch.reviewer,
      prompt: (actualReviewer: string) => (buildCompactReviewPromptFn as any)({ reviewer: scratch.reviewer!, branch, implementer: scratch.implementer!, focus, attempt, repoRoot: worktree, missionPath: effectiveMissionPath || undefined, actualReviewer, reviewBaseline: round.reviewBaseline }),
      worktree, slug, role: 'reviewer', exclude: [scratch.implementer], onLaunch: ({ agent }: { agent: string }) => onAgentLaunched?.(agent, 'review')
    });
  } catch (err: unknown) {
    recordAgentSelectionOutcome(log, 'launch-failed', { agent: scratch.reviewer, step: 'review', error: (err as Error).message });
    error(fmt.status('FAIL', `Could not launch reviewer agent (${scratch.reviewer}): ${(err as Error).message}`));
    await escalateToHumanReview('REVIEWER_LAUNCH_FAILURE');
    return 'stop';
  }
  scratch.reviewer = await applyAgentFallbackFn({
    role: 'reviewer', original: scratch.reviewer!, launchResult: reviewerLaunchResult,
    state: state as unknown as Record<string, any>, slug, worktree, taskResolution, log, writeReviewStateFn, enforceTaskAssigneeFn, missionStore
  });
  const reviewSinceMs = stageLaunchSinceMs(reviewerLaunchResult?.result);
  await recordStageStatsSafeFn('review', {
    stage: 'review', slug, rootDir: worktree, worktree, reviewer: scratch.reviewer, implementer: scratch.implementer,
    result: reviewerLaunchResult?.result,
    sinceMs: reviewSinceMs || 0, log, error, state, writeReviewStateFn,
    model: resolveAgentModel(scratch.reviewer!, worktree),
    missionStore,
  });
  return null;
}

/**
 * Consume the reviewer artifacts; on incomplete artifacts run the one
 * rebound-kernel occurrence, then classify the outcome and escalate where the
 * kernel says so. Falls back to the provider poll when nothing was consumed.
 * Returns 'stop' when the round must end.
 */
async function consumeAndRecoverReviewerArtifacts(deps: ReviewerPhaseDeps): Promise<'stop' | null> {
  const { ctx, state, round, attempt, scratch } = deps;
  const {
    artifactDir, branch, buildCompactReviewPromptFn, consumeReviewerArtifactsFn,
    effectiveMissionPath, forgejoEnabled, getCommentsFn, onAgentLaunched, postCommentFn,
    postReviewFn, readTokenFn, startAgentFn, applyAgentFallbackFn, enforceTaskAssigneeFn,
    taskResolution, verbose, pollForReviewFn, prNumber, token, getLatestReviewForPrFn,
    sleepFn, pollIntervalMs, pollTimeoutMs, worktree, slug,
    log, error,
  } = ctx;
  const persisted = await Promise.resolve(ctx.readReviewStateFn(slug, worktree, ctx.missionStore));
  if (state.phase === 'reviewing' && persisted?.phase === 'approved' && persisted.disposition === 'APPROVED') {
    scratch.reviewState = 'APPROVED';
    return null;
  }
  if (state.phase === 'reviewing' && persisted?.phase === 'fixing' && persisted.disposition === 'REQUEST_CHANGES') {
    scratch.reviewState = 'REQUEST_CHANGES';
    return null;
  }
  const reviewerArtifacts = await consumeReviewerArtifactsFn(slug, scratch.reviewer!, {
    worktree,
    tmpDir: artifactDir,
    readTokenFn,
    getCommentsFn: getCommentsFn as any,
    postCommentFn,
    postReviewFn,
    buildMetadataFooterFn: buildMetadataFooter,
    forgejoEnabled,
    verbose,
    currentState: deps.state,
    log,
    error,
    missionStore: ctx.missionStore,
  });
  if (reviewerArtifacts.consumed) {
    if (!reviewerArtifacts.ok) {
      const reviewerDiagnostic = reviewerArtifacts.diagnostic || `Reviewer ${scratch.reviewer} produced incomplete or invalid review artifacts`;
      if (isArtifactInfraDiagnostic(reviewerDiagnostic)) {
        error(fmt.status('FAIL', `Reviewer artifact infrastructure failure: ${reviewerDiagnostic}`));
        await ctx.escalateToHumanReview('REVIEWER_ARTIFACT_INFRA_FAILURE');
        return 'stop';
      }
      // TASK-2377.04: the artifact bounce runs through the rebound
      // kernel. `fixed` requires the re-consumed artifacts to be
      // complete — a relaunch alone is no evidence that the reviewer
      // produced anything.
      if (round.roundReboundCapReached()) {
        await round.stopForRoundReboundCap('reviewer artifact');
        return 'stop';
      }
      let recoveredReviewerArtifacts = reviewerArtifacts;
      const reviewerDispatch = await dispatchArtifactFailure('reviewer', reviewerDiagnostic, {
        // TASK-2377.04: the per-occurrence budget is clamped to the
        // remaining per-round relaunch cap before the launch.
        maxAttempts: Math.min(ARTIFACT_REBOUND_ATTEMPTS, round.reboundsRemainingThisRound()),
        slug,
        worktree,
        agent: scratch.reviewer!,
        startAgentFn: async (_step, launchOptions) => await (startAgentFn as any)('review', {
          agent: scratch.reviewer,
          prompt: (actualReviewer: string) => (buildCompactReviewPromptFn as any)({ reviewer: scratch.reviewer!, branch, implementer: scratch.implementer!, focus: ctx.focus, attempt, repoRoot: worktree, missionPath: effectiveMissionPath || undefined, actualReviewer, reviewBaseline: round.reviewBaseline })
            + '\n\n' + String((launchOptions as any).prompt(actualReviewer)),
          worktree, slug, role: 'reviewer', exclude: [scratch.implementer],
          onLaunch: ({ agent }: { agent: string }) => onAgentLaunched?.(agent, 'review'),
        }),
        applyAgentFallbackFn: async ({ launchResult, original }) => {
          scratch.reviewer = await applyAgentFallbackFn({
            role: 'reviewer', original, launchResult: launchResult as any,
            state: deps.state as unknown as Record<string, any>, slug, worktree, taskResolution, log, writeReviewStateFn: ctx.writeReviewStateFn, enforceTaskAssigneeFn, missionStore: ctx.missionStore
          });
          return scratch.reviewer!;
        },
        verifyFn: async () => {
          recoveredReviewerArtifacts = await consumeReviewerArtifactsFn(slug, scratch.reviewer!, {
            worktree,
            tmpDir: artifactDir,
            readTokenFn,
            getCommentsFn: getCommentsFn as any,
            postCommentFn,
            postReviewFn,
            buildMetadataFooterFn: buildMetadataFooter,
            forgejoEnabled,
            verbose,
            log,
            error,
            missionStore: ctx.missionStore,
          });
          if (!recoveredReviewerArtifacts.consumed) {
            return { ok: false, diagnostic: `Reviewer ${scratch.reviewer} produced no review artifacts after the relaunch` };
          }
          if (!recoveredReviewerArtifacts.ok) {
            return { ok: false, diagnostic: recoveredReviewerArtifacts.diagnostic || `Reviewer ${scratch.reviewer} produced incomplete or invalid review artifacts` };
          }
          return { ok: true };
        },
        log, error,
      });
      round.reboundsUsedThisRound += reviewerDispatch.attempts ?? 0;
      scratch.reviewer = reviewerDispatch.agent || scratch.reviewer;
      if (reviewerDispatch.action !== 'fixed') {
        if (reviewerDispatch.action === 'human-only') {
          error(fmt.status('FAIL', `Reviewer artifact recovery requires human intervention for ${slug}.`));
          await ctx.escalateToHumanReview('REVIEWER_ARTIFACT_INFRA_FAILURE');
          return 'stop';
        }
        if (round.roundReboundCapReached()) {
          await round.stopForRoundReboundCap('reviewer artifact');
          return 'stop';
        }
        error(fmt.status('FAIL', `Reviewer artifact recovery exhausted its ${reviewerDispatch.maxAttempts}-attempt budget for ${slug}.`));
        await ctx.escalateToHumanReview('REVIEWER_ARTIFACT_RETRY_EXHAUSTED');
        return 'stop';
      }
      log(fmt.status('PASS', `Reviewer artifacts re-consumed and complete after ${reviewerDispatch.attempts} attempt(s).`));
      scratch.reviewState = recoveredReviewerArtifacts.reviewState;
      // TASK-2477/F1: recovery carries findingSummaries too; restore them
      // so the CHANGES REQUESTED summary is not empty on the recovery path.
      round.blockingFindings = recoveredReviewerArtifacts.reviewFindings || [];
    } else {
      scratch.reviewState = reviewerArtifacts.reviewState;
      round.blockingFindings = reviewerArtifacts.reviewFindings || [];
    }
  }
  if (!scratch.reviewState && forgejoEnabled) {
    scratch.reviewState = await pollForReviewFn(prNumber as number, scratch.reviewer!, deps.state.startedAt, token!, {
      getLatestReviewForPrFn, sleepFn, intervalMs: pollIntervalMs, timeoutMs: pollTimeoutMs, retryCount: 0, verbose, label: `round ${attempt} review`, log
    });
  }
  return null;
}

/**
 * A round with no usable review outcome (poll timeout or nothing at all)
 * rebounds the reviewer through the kernel. Returns 'stop' when the round must end.
 */
async function recoverReviewerTimeout(deps: ReviewerPhaseDeps): Promise<'stop' | null> {
  const { ctx, round, attempt, scratch } = deps;
  const {
    artifactDir, branch, buildCompactReviewPromptFn, consumeReviewerArtifactsFn,
    effectiveMissionPath, forgejoEnabled, getCommentsFn, onAgentLaunched, postCommentFn,
    postReviewFn, readTokenFn, startAgentFn, applyAgentFallbackFn, enforceTaskAssigneeFn,
    taskResolution, verbose, pollForReviewFn, prNumber, token, getLatestReviewForPrFn,
    sleepFn, pollIntervalMs, pollTimeoutMs, worktree, slug,
    log, error,
  } = ctx;
  if (!isPollTimeout(scratch.reviewState) && scratch.reviewState) { return null; }
  if (!scratch.reviewState) {
    const handoff = forgejoEnabled
      ? 'did not submit a formal review outcome'
      : 'did not record a review verdict through px';
    log(fmt.status('WARN', `Reviewer ${scratch.reviewer} ${handoff} for ${branch}; retrying the reviewer.`));
    scratch.reviewState = POLL_TIMEOUT;
  }
  const timeoutRecovery = await rebound({
    kind: 'agent-timeout', role: 'reviewer',
    diagnostic: `No usable review outcome for ${branch} after ${formatElapsed(Date.now() - Date.parse(deps.state.startedAt))}.`,
    expectedOutput: forgejoEnabled ? 'a formal review outcome' : 'a review verdict through px',
  }, {
    slug, worktree, implementer: scratch.reviewer!, step: 'review', role: 'reviewer',
    exclude: [scratch.implementer!],
    maxAttempts: Math.min(DEFAULT_REBOUND_ATTEMPTS, round.reboundsRemainingThisRound()),
    startAgent: async (_step, launchOptions) => await (startAgentFn as any)('review', {
      agent: scratch.reviewer,
      prompt: (actualReviewer: string) => (buildCompactReviewPromptFn as any)({ reviewer: scratch.reviewer!, branch, implementer: scratch.implementer!, focus: ctx.focus, attempt, repoRoot: worktree, missionPath: effectiveMissionPath || undefined, actualReviewer, reviewBaseline: round.reviewBaseline })
        + '\n\n' + String((launchOptions as any).prompt(actualReviewer)),
      worktree, slug, role: 'reviewer', exclude: [scratch.implementer],
      onLaunch: ({ agent }: { agent: string }) => onAgentLaunched?.(agent, 'review'),
    }),
    applyAgentFallback: async ({ launchResult, original }) => {
      scratch.reviewer = await applyAgentFallbackFn({
        role: 'reviewer', original, launchResult: launchResult as any,
        state: deps.state as unknown as Record<string, any>, slug, worktree, taskResolution, log,
        writeReviewStateFn: ctx.writeReviewStateFn, enforceTaskAssigneeFn, missionStore: ctx.missionStore,
      });
      return scratch.reviewer!;
    },
    verify: async () => {
      scratch.reviewState = null;
      const retryArtifacts = await consumeReviewerArtifactsFn(slug, scratch.reviewer!, {
      worktree,
      tmpDir: artifactDir,
      readTokenFn,
      getCommentsFn: getCommentsFn as any,
      postCommentFn,
      postReviewFn,
      buildMetadataFooterFn: buildMetadataFooter,
      forgejoEnabled,
      verbose,
      log,
      error,
      missionStore: ctx.missionStore,
      });
      const retryDiagnostic = retryArtifacts.diagnostic || `Reviewer output still missing for ${branch}`;
      scratch.reviewState = retryArtifacts.consumed && retryArtifacts.ok ? retryArtifacts.reviewState : null;
      if (!scratch.reviewState && forgejoEnabled) {
        scratch.reviewState = await pollForReviewFn(prNumber as number, scratch.reviewer!, deps.state.startedAt, token!, { getLatestReviewForPrFn, sleepFn, intervalMs: pollIntervalMs, timeoutMs: pollTimeoutMs, retryCount: 0, verbose, label: `round ${attempt} review recovery`, log });
      }
      return scratch.reviewState && !isPollTimeout(scratch.reviewState)
        ? { ok: true }
        : { ok: false, diagnostic: retryDiagnostic, reason: { kind: 'artifact-incomplete', role: 'reviewer', diagnostic: retryDiagnostic } };
    }, log, error,
  });
  round.reboundsUsedThisRound += timeoutRecovery.attempts;
  scratch.reviewer = timeoutRecovery.implementer || scratch.reviewer;
  if (timeoutRecovery.outcome !== 'fixed') {
    if (round.roundReboundCapReached()) {
      await round.stopForRoundReboundCap('reviewer timeout recovery');
      return 'stop';
    }
    error(fmt.status('FAIL', timeoutRecovery.dossier || `Reviewer ${scratch.reviewer} did not submit a usable formal review outcome after ${timeoutRecovery.attempts} recovery attempt(s).`));
    log('       Human intervention is required to complete or repair the review.');
    await ctx.escalateToHumanReview('REVIEWER_NON_APPROVAL');
    return 'stop';
  }
  return null;
}

/** Apply the final reviewer outcome: an approval stops, everything else moves to fixing. Returns 'stop' when the round must end. */
async function applyReviewerOutcome(deps: ReviewerPhaseDeps): Promise<'stop' | null> {
  const { ctx, state, scratch } = deps;
  const { slug, worktree, log, error, verbose, writeReviewStateFn, missionStore, transitionVirtualFn, transitionTaskFn } = ctx;
  if (scratch.reviewState === 'APPROVED') {
    state.transitionTo('approved');
    state.disposition = scratch.reviewState as string;
    try {
      await persistReviewStateOrThrow(writeReviewStateFn, slug, state, worktree, missionStore);
    } catch (err) {
      // The review is recorded as approved but the review → integration
      // boundary failed. Do not promote the Backlog task to approved
      // while the Mission is still in review; px integrate recovers it.
      error(fmt.status('FAIL', `Reviewer approved ${slug} but the review → integration transition failed: ${err instanceof Error ? err.message : String(err)}`));
      error(fmt.status('FAIL', `Recovery: px integrate ${slug}`));
      return 'stop';
    }
    renderReviewVerdict(state.disposition, [], log, verbose, state.round);
    log(fmt.status('PASS', 'Autonomous review stopped: reviewer approved the PR. Hand off to human review/integration.'));
    await transitionVirtualFn(transitionTaskFn, slug, 'approved', { log });
    return 'stop';
  }
  state.transitionTo('fixing');
  state.disposition = scratch.reviewState as string;
  return null;
}

/** Resume a round that is already in the fixing phase: read the recorded outcome (provider or local). */
async function resumeFixingPhaseReview(deps: ReviewerPhaseDeps): Promise<void> {
  const { ctx, state, attempt, scratch } = deps;
  const { forgejoEnabled, getLatestReviewForPrFn, prNumber, token, log } = ctx;
  if (forgejoEnabled) {
    const latestReview = await getLatestReviewForPrFn(prNumber as number, scratch.reviewer!, state.startedAt, token!);
    scratch.reviewState = latestReview ? (latestReview as Record<string, unknown>).state : null;
    if (!scratch.reviewState) {
      log(fmt.status('WARN', `No review found for ${scratch.reviewer} since ${state.startedAt}; treating as request-changes and proceeding to fixing phase.`));
      scratch.reviewState = 'request-changes';
    }
  } else {
    scratch.reviewState = state.disposition || null;
    if (!scratch.reviewState) {
      log(fmt.status('WARN', `No local review state found for ${scratch.reviewer}; treating as request-changes and proceeding to fixing phase.`));
      scratch.reviewState = 'request-changes';
    }
  }
  log(fmt.status('INFO', `Round ${attempt}: resuming in fixing phase with review outcome = ${scratch.reviewState}`));
}

async function runReviewerPhase(
  attempt: number,
  ctx: any,
  state: ReviewState,
  identities: RoundIdentities,
  round: RoundScratch,
): Promise<{ outcome: 'stop' | 'next-round' } | { reviewState: unknown }> {
  const { dryRun } = ctx;
  const scratch: ReviewerPhaseScratch = {
    implementer: identities.implementer,
    reviewer: identities.reviewer,
    reviewState: undefined,
  };
  const deps: ReviewerPhaseDeps = { ctx, state, round, attempt, scratch };
  try {
    if (state.phase === 'reviewing') {
      // TASK-2582: the round-open boundary persists the authoritative
      // active → review transition at the accepted boundary, before any
      // destination-state work (existing-review poll, rebase, gates, reviewer
      // launch) starts.
      if (!dryRun && !scratch.reviewState && await runRoundOpenBoundary(deps)) { return { outcome: 'stop' }; }
      await checkExistingReviewOnContinue(deps);
      if (dryRun) {
        dryRunReviewerPrompt(deps);
      } else {
        if (!scratch.reviewState) {
          if (await runPreReviewRebase(deps)) { return { outcome: 'stop' }; }
          if (await runDeclaredPreReviewGate(deps)) { return { outcome: 'stop' }; }
          round.preReviewSetupVerified = false;
          // TASK-2478/criterion 7: the round-2 pre-review gate reruns the
          // verification command against the revised tree. A failure already bounces
          // back to the implementer above (never advancing to the re-review), so a
          // passing re-round gate is the post-fix verification the operator needs to
          // see before the second review runs.
          if (attempt > 1) {
            ctx.log(fmt.status('PASS', `✓ verification passed against the revised tree (round ${attempt})`));
          }
          if (!scratch.reviewState) {
            if (await launchReviewer(deps)) { return { outcome: 'stop' }; }
            if (await consumeAndRecoverReviewerArtifacts(deps)) { return { outcome: 'stop' }; }
            if (await recoverReviewerTimeout(deps)) { return { outcome: 'stop' }; }
          }
        }
      }
      if (dryRun) { return { outcome: 'stop' }; }
      if (await applyReviewerOutcome(deps)) { return { outcome: 'stop' }; }
    } else {
      await resumeFixingPhaseReview(deps);
    }
    return { reviewState: scratch.reviewState };
  } finally {
    identities.implementer = scratch.implementer;
    identities.reviewer = scratch.reviewer;
  }
}

type RoundIdentities = { implementer: string | undefined; reviewer: string | undefined };

/** Mutable per-round implementer-phase state shared by the phase helpers. */
type RoundPhaseScratch = {
  disposition: unknown;
  reLaunch: boolean | null;
  sinceIso: string;
  implementer: string | undefined;
  implementerSkippedResume: boolean;
};

type RoundPhaseDeps = {
  ctx: any;
  state: ReviewState;
  round: RoundScratch;
  attempt: number;
  reviewState: unknown;
  identities: RoundIdentities;
  scratch: RoundPhaseScratch;
};

/**
 * A --continue re-enters at the round that already carries a disposition check:
 * an existing BLOCKED/PARKED re-launches the implementer to assess the blocker;
 * everything else is treated as no disposition.
 */
async function checkContinueDisposition(deps: { ctx: any; state: ReviewState; attempt: number; scratch: RoundPhaseScratch }): Promise<void> {
  const { ctx, state, attempt, scratch } = deps;
  const { isContinue, forgejoEnabled, verbose, pollForDispositionFn, prNumber, token, getLatestDispositionForPrFn, sleepFn, log } = ctx;
  if (!(isContinue && attempt === state.round)) { return; }
  if (forgejoEnabled) {
    log(fmt.status('INFO', `Round ${attempt}: checking for existing disposition by ${scratch.implementer} since ${state.startedAt}...`));
    scratch.disposition = await pollForDispositionFn(prNumber as number, scratch.implementer!, state.startedAt, token!, {
      getLatestDispositionForPrFn, sleepFn, intervalMs: 1000, timeoutMs: CONTINUE_SKIP_CHECK_TIMEOUT_MS, verbose, label: `round ${attempt} skip-check`, log
    });
    if (isPollTimeout(scratch.disposition)) {
      scratch.disposition = null;
    } else if (isContinue && (scratch.disposition === 'BLOCKED' || scratch.disposition === 'PARKED')) {
      log(fmt.status('INFO', `Round ${attempt}: implementer disposition found (${scratch.disposition}). Re-launching implementer to assess whether blocker is resolved...`));
      scratch.reLaunch = true;
      scratch.sinceIso = strictlyLaterIso(state.startedAt);
      scratch.disposition = null;
    }
  } else {
    // Provider plumbing: verbose-only (see provider-disabled demotion).
    if (verbose) {
      log(fmt.status('INFO', `Round ${attempt}: review provider disabled; using workflow-owned disposition state.`));
    }
    scratch.disposition = null;
  }
}

/** Launch the implementer agent for act-on-review (skipped for autonomous local rounds). */
async function launchImplementerActOnReview(deps: RoundPhaseDeps): Promise<'stop' | null> {
  const { ctx, state, round, attempt, reviewState, identities, scratch } = deps;
  const {
    branch, buildActOnReviewPromptFn, buildCompactActOnReviewPromptFn,
    dryRun, effectiveMissionPath, forgejoEnabled, onAgentLaunched, recordStageStatsSafeFn,
    startAgentFn, applyAgentFallbackFn, enforceTaskAssigneeFn, taskResolution,
    transitionTaskFn, verbose, worktree, writeReviewStateFn, missionStore, slug,
    log, error, exit,
  } = ctx;
  if (dryRun) {
    log(`\n--- DRY-RUN: implementer (${scratch.implementer}) act-on-review prompt ---`);
    log((buildActOnReviewPromptFn as any)({ implementer: scratch.implementer!, branch, attempt, repoRoot: worktree, missionPath: effectiveMissionPath || undefined, reviewBaseline: round.reviewBaseline }));
    if (scratch.reLaunch!) {
      log(fmt.status('INFO', `Round ${attempt}: stale BLOCKED/PARKED disposition replaced by fresh implementer action.`));
    }
    return 'stop';
  }
  await persistReviewStateOrThrow(writeReviewStateFn, slug, state, worktree, missionStore);
  renderReviewVerdict(state.disposition, round.blockingFindings, log, verbose);
  if (round.blockingFindings.length > 0) {
    log(fmt.status('INFO', 'ACTING ON REVIEW'));
    for (const finding of round.blockingFindings) {
      log(fmt.status('INFO', `Finding ${finding.id}: ${finding.summary}`));
    }
  }
  await transitionTaskFn(slug, 'active', { implementer: scratch.implementer, rootDir: worktree, log });
  if (scratch.implementer === 'autonomous' && !forgejoEnabled) {
    log(fmt.status('INFO', `Round ${attempt}: implementer identity is autonomous; skipping implementer launch and using local review artifacts only.`));
    return null;
  }
  log(fmt.status('INFO', `Round ${attempt}: launching implementer (${scratch.implementer}) for act-on-review...`));
  let implementerLaunchResult: any;
  try {
    implementerLaunchResult = await startAgentFn('act-on-review', {
      agent: scratch.implementer,
      prompt: (actualImplementer: string) => (buildCompactActOnReviewPromptFn as any)({ implementer: scratch.implementer!, branch, attempt, reviewOutcome: reviewState, repoRoot: worktree, missionPath: effectiveMissionPath || undefined, actualImplementer, reviewBaseline: round.reviewBaseline }),
      worktree, slug, role: 'implementer', exclude: [identities.reviewer], onLaunch: ({ agent }: { agent: string }) => onAgentLaunched?.(agent, 'review-response')
    });
  } catch (err: unknown) {
    error(fmt.status('FAIL', `Could not launch implementer agent (${scratch.implementer}): ${(err as Error).message}`));
    exit(1); return 'stop';
  }
  scratch.implementer = await applyAgentFallbackFn({
    role: 'implementer', original: scratch.implementer!, launchResult: implementerLaunchResult,
    state: state as unknown as Record<string, any>, slug, worktree, taskResolution, log, writeReviewStateFn, enforceTaskAssigneeFn, missionStore
  });
  const followUpSinceMs = stageLaunchSinceMs(implementerLaunchResult?.result);
  await recordStageStatsSafeFn('active', {
    stage: 'follow-up', slug, rootDir: worktree, worktree, implementer: scratch.implementer, reviewer: identities.reviewer,
    result: implementerLaunchResult?.result,
    sinceMs: followUpSinceMs || 0, log, error, state, writeReviewStateFn,
    model: resolveAgentModel(scratch.implementer!, worktree),
    missionStore,
  });
  return null;
}

/**
 * Consume the implementer's round artifacts; on incomplete artifacts run the
 * one rebound-kernel occurrence, then classify the outcome (infra, cap, or
 * exhausted) and escalate to human review where the kernel says so.
 */
async function consumeAndRecoverImplementerArtifacts(deps: RoundPhaseDeps): Promise<'stop' | null> {
  const { ctx, state, round, attempt, reviewState, identities, scratch } = deps;
  const {
    artifactDir, branch, buildCompactActOnReviewPromptFn, consumeImplementerArtifactsFn,
    effectiveMissionPath, forgejoEnabled, escalateToHumanReview, getCommentsFn, onAgentLaunched,
    postCommentFn, readTokenFn, startAgentFn, applyAgentFallbackFn, enforceTaskAssigneeFn,
    taskResolution, writeReviewStateFn, missionStore, slug, worktree,
    log, error,
  } = ctx;
  const implementerArtifacts = await consumeImplementerArtifactsFn(slug, scratch.implementer!, {
    worktree,
    tmpDir: artifactDir,
    readTokenFn,
    getCommentsFn: getCommentsFn as any,
    postCommentFn,
    buildMetadataFooterFn: buildMetadataFooter,
    forgejoEnabled,
    currentState: state,
    log,
    error
  });
  if (!implementerArtifacts.consumed) { return null; }
  if (implementerArtifacts.changedRevision === false) {
    await escalateToHumanReview('IMPLEMENTER_NO_CHANGE');
    return 'stop';
  }
  if (implementerArtifacts.ok) {
    scratch.disposition = implementerArtifacts.disposition;
    return null;
  }
  const implDiagnostic = implementerArtifacts.diagnostic || `Implementer ${scratch.implementer} produced incomplete or invalid artifacts`;
  if (isArtifactInfraDiagnostic(implDiagnostic)) {
    error(fmt.status('FAIL', `Implementer artifact infrastructure failure: ${implDiagnostic}`));
    await escalateToHumanReview('IMPLEMENTER_ARTIFACT_INFRA_FAILURE');
    return 'stop';
  }
  // TASK-2377.04: one rebound-kernel occurrence replaces the inline
  // relaunch-and-re-consume ladder. `fixed` requires the re-consumed
  // implementer artifacts to be complete; the per-occurrence budget
  // is in-memory and starts fresh at every occurrence.
  if (round.roundReboundCapReached()) {
    await round.stopForRoundReboundCap('implementer artifact');
    return 'stop';
  }
  let recoveredImplementerArtifacts = implementerArtifacts;
  const implDispatch = await dispatchArtifactFailure('implementer', implDiagnostic, {
    // TASK-2377.04: the per-occurrence budget is clamped to the
    // remaining per-round relaunch cap before the launch.
    maxAttempts: Math.min(ARTIFACT_REBOUND_ATTEMPTS, round.reboundsRemainingThisRound()),
    slug,
    worktree,
    agent: scratch.implementer!,
    startAgentFn: async (_step, launchOptions) => await (startAgentFn as any)('act-on-review', {
      agent: scratch.implementer,
      prompt: (actualImplementer: string) => (buildCompactActOnReviewPromptFn as any)({ implementer: scratch.implementer!, branch, attempt, reviewOutcome: reviewState, repoRoot: worktree, missionPath: effectiveMissionPath || undefined, actualImplementer, reviewBaseline: round.reviewBaseline })
        + '\n\n' + String((launchOptions as any).prompt(actualImplementer)),
      worktree, slug, role: 'implementer', exclude: [identities.reviewer],
      onLaunch: ({ agent }: { agent: string }) => onAgentLaunched?.(agent, 'review-response'),
    }),
    applyAgentFallbackFn: async ({ launchResult, original }) => {
      scratch.implementer = await applyAgentFallbackFn({
        role: 'implementer', original, launchResult: launchResult as any,
        state: state as unknown as Record<string, any>, slug, worktree, taskResolution, log, writeReviewStateFn, enforceTaskAssigneeFn, missionStore
      });
      return scratch.implementer!;
    },
    verifyFn: async () => {
      recoveredImplementerArtifacts = await consumeImplementerArtifactsFn(slug, scratch.implementer!, {
        worktree,
        tmpDir: artifactDir,
        readTokenFn,
        getCommentsFn: getCommentsFn as any,
        postCommentFn,
        buildMetadataFooterFn: buildMetadataFooter,
        forgejoEnabled,
        log,
        error
      });
      if (!recoveredImplementerArtifacts.consumed) {
        return { ok: false, diagnostic: `Implementer ${scratch.implementer} produced no round artifacts after the relaunch` };
      }
      if (!recoveredImplementerArtifacts.ok) {
        return { ok: false, diagnostic: recoveredImplementerArtifacts.diagnostic || `Implementer ${scratch.implementer} still produced incomplete artifacts after the relaunch` };
      }
      return { ok: true };
    },
    log, error,
  });
  round.reboundsUsedThisRound += implDispatch.attempts ?? 0;
  scratch.implementer = implDispatch.agent || scratch.implementer;
  if (implDispatch.action !== 'fixed') {
    const infraAfterBounce = isArtifactInfraDiagnostic(implDispatch.diagnostic);
    const infra = implDispatch.action === 'human-only' || infraAfterBounce;
    if (infra) {
      error(fmt.status('FAIL', `Implementer artifact recovery requires human intervention for ${slug}.`));
      await escalateToHumanReview('IMPLEMENTER_ARTIFACT_INFRA_FAILURE');
      return 'stop';
    }
    if (round.roundReboundCapReached()) {
      await round.stopForRoundReboundCap('implementer artifact');
      return 'stop';
    }
    error(fmt.status('FAIL', `Implementer artifact recovery exhausted its ${implDispatch.maxAttempts}-attempt budget for ${slug}.`));
    await escalateToHumanReview('IMPLEMENTER_ARTIFACT_RETRY_EXHAUSTED');
    return 'stop';
  }
  log(fmt.status('PASS', `Implementer artifacts re-consumed and complete after ${implDispatch.attempts} attempt(s).`));
  scratch.disposition = recoveredImplementerArtifacts.disposition;
  return null;
}

/**
 * Poll the provider for the disposition, rebounding a poll timeout through the
 * kernel; a round that still has no disposition is a hard failure.
 */
async function pollDispositionWithTimeoutRecovery(deps: RoundPhaseDeps): Promise<'stop' | null> {
  const { ctx, state, round, attempt, reviewState, identities, scratch } = deps;
  const {
    artifactDir, branch, buildCompactActOnReviewPromptFn, consumeImplementerArtifactsFn,
    effectiveMissionPath, forgejoEnabled, getLatestDispositionForPrFn, getCommentsFn,
    onAgentLaunched, pollForDispositionFn, pollIntervalMs,
    pollTimeoutMs, postCommentFn, prNumber, readTokenFn, sleepFn, startAgentFn,
    applyAgentFallbackFn, enforceTaskAssigneeFn, taskResolution, token,
    writeReviewStateFn, missionStore, slug, worktree, verbose,
    log, error, exit,
  } = ctx;
  if (!scratch.disposition && forgejoEnabled) {
    scratch.disposition = await pollForDispositionFn(prNumber as number, scratch.implementer!, scratch.sinceIso, token!, {
      getLatestDispositionForPrFn, sleepFn, intervalMs: pollIntervalMs, timeoutMs: pollTimeoutMs, retryCount: 0, verbose, label: `round ${attempt} disposition`, log
    });
  }
  if (isPollTimeout(scratch.disposition)) {
    const timeoutRecovery = await rebound({
      kind: 'agent-timeout', role: 'implementer',
      diagnostic: `No implementer disposition for ${branch} after ${formatElapsed(Date.now() - Date.parse(state.startedAt))}.`,
      expectedOutput: 'a disposition: PUSHBACK_ALL, BLOCKED, PARKED, or a completed fix response',
    }, {
      slug, worktree, implementer: scratch.implementer!, step: 'act-on-review', role: 'implementer',
      exclude: [identities.reviewer!],
      maxAttempts: Math.min(DEFAULT_REBOUND_ATTEMPTS, round.reboundsRemainingThisRound()),
      startAgent: async (_step, launchOptions) => await (startAgentFn as any)('act-on-review', {
        agent: scratch.implementer,
        prompt: (actualImplementer: string) => (buildCompactActOnReviewPromptFn as any)({ implementer: scratch.implementer!, branch, attempt, reviewOutcome: reviewState, repoRoot: worktree, missionPath: effectiveMissionPath || undefined, actualImplementer, reviewBaseline: round.reviewBaseline })
          + '\n\n' + String((launchOptions as any).prompt(actualImplementer)),
        worktree, slug, role: 'implementer', exclude: [identities.reviewer],
        onLaunch: ({ agent }: { agent: string }) => onAgentLaunched?.(agent, 'review-response'),
      }),
      applyAgentFallback: async ({ launchResult, original }) => {
        scratch.implementer = await applyAgentFallbackFn({
          role: 'implementer', original, launchResult: launchResult as any,
          state: state as unknown as Record<string, any>, slug, worktree, taskResolution, log,
          writeReviewStateFn, enforceTaskAssigneeFn, missionStore,
        });
        return scratch.implementer!;
      },
      verify: async () => {
        const retryArtifacts = await consumeImplementerArtifactsFn(slug, scratch.implementer!, {
          worktree, tmpDir: artifactDir, readTokenFn, getCommentsFn: getCommentsFn as any,
          postCommentFn, buildMetadataFooterFn: buildMetadataFooter, forgejoEnabled, log, error,
        });
        const retryArtifactDiagnostic = retryArtifacts.diagnostic || `Implementer disposition still missing for ${branch}`;
        const retryDiagnostic = isArtifactInfraDiagnostic(retryArtifactDiagnostic)
          ? `Recovery infrastructure failure: ${retryArtifactDiagnostic}`
          : retryArtifactDiagnostic;
        scratch.disposition = retryArtifacts.consumed && retryArtifacts.ok ? retryArtifacts.disposition : null;
        if (!scratch.disposition && forgejoEnabled) {
          scratch.disposition = await pollForDispositionFn(prNumber as number, scratch.implementer!, scratch.sinceIso, token!, { getLatestDispositionForPrFn, sleepFn, intervalMs: pollIntervalMs, timeoutMs: pollTimeoutMs, retryCount: 0, verbose, label: `round ${attempt} disposition recovery`, log });
        }
        return scratch.disposition && !isPollTimeout(scratch.disposition)
          ? { ok: true }
          : { ok: false, diagnostic: retryDiagnostic, reason: { kind: 'artifact-incomplete', role: 'implementer', diagnostic: retryDiagnostic } };
      }, log, error,
    });
    round.reboundsUsedThisRound += timeoutRecovery.attempts;
    scratch.implementer = timeoutRecovery.implementer || scratch.implementer;
    if (timeoutRecovery.outcome !== 'fixed') {
      if (isArtifactInfraDiagnostic(timeoutRecovery.diagnostic)) {
        error(fmt.status('FAIL', `Implementer artifact infrastructure failure during timeout recovery: ${timeoutRecovery.diagnostic}`));
        await ctx.escalateToHumanReview('IMPLEMENTER_ARTIFACT_INFRA_FAILURE');
        return 'stop';
      }
      if (round.roundReboundCapReached()) {
        await round.stopForRoundReboundCap('implementer timeout recovery');
        return 'stop';
      }
      await persistReviewStateOrThrow(writeReviewStateFn, slug, state, worktree, missionStore);
      error(fmt.status('FAIL', timeoutRecovery.dossier || `Implementer timeout recovery exhausted for ${branch}.`));
      await ctx.escalateToHumanReview('IMPLEMENTER_TIMEOUT_EXHAUSTED');
      return 'stop';
    }
  } else if (!scratch.disposition) {
    error(fmt.status('FAIL', `Implementer ${scratch.implementer} did not post an autonomous review disposition comment.`));
    exit(1); return 'stop';
  }
  scratch.reLaunch = null;
  return null;
}

/** Apply the final disposition: advance, stop, or push the fix and advance. */
async function applyImplementerDisposition(deps: {
  ctx: any;
  state: ReviewState;
  attempt: number;
  scratch: RoundPhaseScratch;
  preFixHeadSha: string | null;
  readBranchHeadSha: () => string | null;
}): Promise<'stop' | 'next-round'> {
  const { ctx, state, attempt, scratch, preFixHeadSha, readBranchHeadSha } = deps;
  const {
    branch, forgejoEnabled, hasNewCommittedChangeFn, fetchReviewBranchFn,
    isStaleInfoPushRejectionFn, onAutonomousStop, pushReviewRefFn, token,
    worktree, writeReviewStateFn, missionStore, slug,
    log, error, exit,
  } = ctx;
  if (!scratch.disposition) {
    error(fmt.status('FAIL', `Implementer ${scratch.implementer} did not post an autonomous review disposition comment.`));
    exit(1); return 'stop';
  }
  if (isPollTimeout(scratch.disposition)) {
    await persistReviewStateOrThrow(writeReviewStateFn, slug, state, worktree, missionStore);
    log(fmt.status('INFO', `Autonomous review stopped: excessive implementer timeout retries`));
    return 'stop';
  }
  log(fmt.status('INFO', `Round ${attempt}: implementer disposition = ${scratch.disposition}`));
  if (scratch.disposition === 'PUSHBACK_ALL') {
    state.disposition = scratch.disposition as string;
    try { state.transitionTo('reviewing'); } catch (_) { /* ignore */ }
    await persistReviewStateOrThrow(writeReviewStateFn, slug, state, worktree, missionStore);
    log(fmt.status('INFO', `Round ${attempt}: implementer responded to all findings. Continuing to reviewer re-review round ${attempt + 1}.`));
    return 'next-round';
  }
  if (scratch.disposition === 'BLOCKED' || scratch.disposition === 'PARKED') {
    state.disposition = scratch.disposition as string;
    await persistReviewStateOrThrow(writeReviewStateFn, slug, state, worktree, missionStore);
    await onAutonomousStop?.(`implementer reported ${scratch.disposition}`);
    log(fmt.status('INFO', `Autonomous review stopped: implementer reported ${scratch.disposition}. Hand off to human review.`));
    return 'stop';
  }
  state.disposition = scratch.disposition as string;
  try { state.transitionTo('reviewing'); } catch (_) { /* ignore */ }
  const hasCommittedChange = hasNewCommittedChangeFn
    ? hasNewCommittedChangeFn(branch, worktree)
    : (() => {
        if (scratch.implementerSkippedResume) { return true; }
        const postFixHeadSha = readBranchHeadSha();
        if (preFixHeadSha === null || postFixHeadSha === null) { return true; }
        return postFixHeadSha !== preFixHeadSha;
      })();
  if (!hasCommittedChange) {
    state.disposition = 'IMPLEMENTER_NO_CHANGE';
    state.metadata = { ...state.metadata, humanEscalationReason: 'IMPLEMENTER_NO_CHANGE', humanEscalatedAt: new Date().toISOString() };
    await persistReviewStateOrThrow(writeReviewStateFn, slug, state, worktree, missionStore);
    await onAutonomousStop?.('implementer reported CHANGES_MADE with no new revision');
    log(fmt.status('FAIL', `Round ${attempt}: implementer reported CHANGES_MADE but the branch HEAD is unchanged. No new revision to review; handing off to human review.`));
    return 'stop';
  }
  if (forgejoEnabled && token && hasCommittedChange) {
    let pushResult = pushReviewRefFn(branch, branch, worktree, {
      forceWithLease: true,
      token,
    });
    if (isStaleInfoPushRejectionFn(pushResult)) {
      log(fmt.status('INFO', `Round ${attempt}: push rejected as stale; fetching review/${branch} and retrying.`));
      fetchReviewBranchFn(branch, worktree, { token });
      pushResult = pushReviewRefFn(branch, branch, worktree, {
        forceWithLease: true,
        token,
      });
      if (isStaleInfoPushRejectionFn(pushResult)) {
        log(fmt.status('INFO', `Round ${attempt}: force-with-lease still stale; using force push.`));
        pushResult = pushReviewRefFn(branch, branch, worktree, {
          force: true,
          token,
        });
      }
    }
    if (pushResult.status !== 0) {
      log(fmt.status('WARN', `Round ${attempt}: could not push mission branch to review remote (exit ${pushResult.status}): ${pushResult.stderr || pushResult.stdout || '(no output)'}. Continuing to next round.`));
    } else {
      log(fmt.status('INFO', `Round ${attempt}: pushed mission branch ${branch} to review remote.`));
    }
  }
  await persistReviewStateOrThrow(writeReviewStateFn, slug, state, worktree, missionStore);
  // TASK-2478/criterion 6: surface that the revision actually changed so the
  // operator can see the corrected tree is what the second review evaluates,
  // not the pre-fix tree. beginNextReviewRound records the new revision on the
  // aggregate (src/domain/review.ts) from this branch head.
  const revisedHead = readBranchHeadSha();
  if (revisedHead && preFixHeadSha && revisedHead !== preFixHeadSha) {
    log(fmt.status('INFO', `Round ${attempt}: new revision ${revisedHead.slice(0, 12)} recorded after act-on-review.`));
  }
  log(fmt.status('INFO', `Round ${attempt}: implementer made changes. Continuing to round ${attempt + 1}.`));
  return 'next-round';
}

async function runReviewRound(
  attempt: number,
  ctx: any,
  state: ReviewState,
  identities: RoundIdentities,
): Promise<'stop' | 'next-round'> {
  const {
    applyAgentFallbackFn,
    enforceTaskAssigneeFn,
    error,
    escalateToHumanReview,
    forgejoEnabledFn,
    gitFn,
    log,
    maxAttempts,
    missionStore,
    readReviewStateFn,
    rebaseBeforeReviewRoundFn,
    reboundsPerRound,
    runFn,
    runPreReviewGateFn,
    slug,
    startAgentFn,
    taskResolution,
    transitionTaskFn,
    verbose,
    worktree,
    writeReviewStateFn,
  } = ctx;
  let implementer = identities.implementer;
  let reviewer = identities.reviewer;
  // The per-round relaunch cap is round-local scratch (TASK-2377.04): every
  // round starts with a fresh counter; nothing is persisted.
  let reboundsUsedThisRound = 0;
  try {

    log('\n' + fmt.status('INFO', `========== Round ${attempt} / ${maxAttempts} ==========`));
    const reboundsRemainingThisRound = () => reboundsPerRound < 0
      ? Number.POSITIVE_INFINITY
      : Math.max(0, reboundsPerRound - reboundsUsedThisRound);
    const roundReboundCapReached = () => reboundsPerRound >= 0 && reboundsUsedThisRound >= reboundsPerRound;
    /**
     * Stop the loop when the per-round relaunch cap is exhausted (TASK-2377.04):
     * explicit diagnostic plus the named escalation reason; no further
     * relaunches happen this round.
     */
    const stopForRoundReboundCap = async (context: string) => {
      error(fmt.status('FAIL', `Per-round relaunch cap reached for ${slug}: ${reboundsUsedThisRound}/${reboundsPerRound} relaunches used in round ${attempt}; no further ${context} relaunches.`));
      await escalateToHumanReview(REBOUNDS_PER_ROUND_EXHAUSTED);
    };
    if (attempt > state.round) {
      state.advanceRound();
    }
    const captureReviewBaseline = (): string | undefined => {
      try {
        const primaryBranchName = getPrimaryBranch(worktree, gitFn);
        const reviewBaselineResult = gitFn(['-C', worktree, 'rev-parse', primaryBranchName]);
        return (reviewBaselineResult.stdout || '').trim() || primaryBranchName;
      } catch {
        return undefined;
      }
    };
    /**
     * Re-runs the failing pre-review check for the rebound kernel: the
     * in-process pre-review rebase followed by the verification gate. A gate or
     * hook bounce is reported `fixed` only when this passes.
     */
    const verifyPreReviewSetup = async (): Promise<{ ok: boolean; diagnostic: string; reason?: any }> => {
      const rebaseRetry = await rebaseBeforeReviewRoundFn(slug, {
        worktree, runFn: runFn as any, log, error, verbose,
        taskFile: taskResolution.taskFile,
        gitFn,
        isReviewProviderEnabledFn: forgejoEnabledFn,
        ...(ctx.rebaseWorkflowOptions ? { rebaseWorkflowOptions: ctx.rebaseWorkflowOptions } : {})
      });
      if (!rebaseRetry.ok) {
        return {
          ok: false,
          diagnostic: rebaseRetry.hookOutput || 'pre-review rebase still fails after the repair attempt',
          reason: rebaseRetry.failure?.kind === 'hook'
            ? hookFailureReason(rebaseRetry.failure.hook.output, `git ${rebaseRetry.failure.operation}`)
            : undefined,
        };
      }
      const gateRetry = await runPreReviewGateFn(slug, worktree, { runFn: runFn as any, log, error });
      return gateRetry.ok
        ? { ok: true, diagnostic: '' }
        : {
          ok: false,
          diagnostic: [gateRetry.stdout, gateRetry.stderr, gateRetry.error].filter(Boolean).join('\n'),
          reason: gateFailureReason(gateRetry),
        };
    };
    /** Collaborators the kernel adapter needs; the kernel owns policy. */
    const reboundCollaborators = () => ({
      startAgentFn,
      writeReviewStateFn,
      readReviewStateFn,
      transitionTaskFn,
      applyAgentFallbackFn,
      taskResolution,
      enforceTaskAssigneeFn,
      log,
      error,
      missionStore,
      lifecycleService: ctx.lifecycleService,
    });
    const round: RoundScratch = {
      get reboundsUsedThisRound() { return reboundsUsedThisRound; },
      set reboundsUsedThisRound(value: number) { reboundsUsedThisRound = value; },
      reviewBaseline: captureReviewBaseline(),
      /** True when a kernel verify already re-ran the rebase and gate this round. */
      preReviewSetupVerified: false,
      // The polling retry counter is round-local scratch; timeout recovery
      // attempts themselves are owned by the rebound kernel.
      reviewerTimeoutRetries: 0,
      blockingFindings: [],
      reboundsRemainingThisRound,
      roundReboundCapReached,
      stopForRoundReboundCap,
      verifyPreReviewSetup,
      reboundCollaborators,
      captureReviewBaseline,
    };
    const reviewerPhase = await runReviewerPhase(attempt, ctx, state, identities, round);
    implementer = identities.implementer;
    reviewer = identities.reviewer;
    if ('outcome' in reviewerPhase) { return reviewerPhase.outcome; }
    const reviewState = reviewerPhase.reviewState;
    const readBranchHeadSha = (): string | null => {
      try {
        const headResult = gitFn(['-C', worktree, 'rev-parse', 'HEAD']);
        if (headResult.status !== 0) { return null; }
        return (headResult.stdout || '').trim() || null;
      } catch {
        return null;
      }
    };
    const preFixHeadSha = readBranchHeadSha();
    const scratch: RoundPhaseScratch = {
      disposition: undefined,
      reLaunch: null,
      sinceIso: state.startedAt,
      implementer,
      implementerSkippedResume: false,
    };
    await checkContinueDisposition({ ctx, state, attempt, scratch });
    if (!scratch.disposition) {
      const launched = await launchImplementerActOnReview({ ctx, state, round, attempt, reviewState, identities, scratch });
      if (launched) { return launched; }
      const recovered = await consumeAndRecoverImplementerArtifacts({ ctx, state, round, attempt, reviewState, identities, scratch });
      if (recovered) { return recovered; }
      const polled = await pollDispositionWithTimeoutRecovery({ ctx, state, round, attempt, reviewState, identities, scratch });
      if (polled) { return polled; }
    } else if (scratch.reLaunch!) {
    } else if (scratch.disposition) {
      log(fmt.status('INFO', `Round ${attempt}: implementer disposition found (${scratch.disposition}). Skipping implementer launch.`));
      scratch.implementerSkippedResume = true;
    }
    return applyImplementerDisposition({ ctx, state, attempt, scratch, preFixHeadSha, readBranchHeadSha });
  } finally {
    identities.implementer = implementer;
    identities.reviewer = reviewer;
  }
}

/** Resolve the effective MISSION.md path: explicit --mission override first, slug-derived fallback. */
function resolveEffectiveMissionPath(missionPath: string | undefined, missionDir: string | null, log: (_msg: string) => void): string | null {
  if (missionPath && fs.existsSync(missionPath)) {
    const effective = fs.statSync(missionPath).isDirectory() ? path.join(missionPath, 'MISSION.md') : missionPath;
    log(fmt.status('INFO', `Using mission contract from --mission override: ${effective}`));
    return effective;
  }
  if (missionPath) {
    log(fmt.status('WARN', `--mission path not found: ${missionPath}; falling back to slug-derived mission location${missionDir ? ` (${missionDir})` : ''}.`));
  }
  return null;
}

/** Persist and announce a --reset of the review state. */
async function applyStartReset(reset: boolean, slug: string, worktree: string, deps: { resetReviewStateFn: typeof resetReviewState; log: (_msg: string) => void }): Promise<void> {
  if (!reset) { return; }
  const resetResult = await deps.resetReviewStateFn(slug, worktree);
  assertReviewStatePersisted(resetResult, { slug, phase: 'reset', round: null });
  if (resetResult.outcome === 'committed') {
    deps.log(fmt.status('INFO', `Review state reset for ${slug}.`));
  }
}

/**
 * Resolve the implementer identity for a review start: persisted review state
 * first, then the Backlog task's assignee, then the "autonomous" default.
 */
function resolveStartImplementer(
  slug: string,
  implementer: string | undefined,
  persisted: { implementer?: string } | null,
  taskResolution: { ok: boolean; taskFile?: string | null },
  deps: { getTaskImplementerFn: typeof getTaskImplementer; log: (_msg: string) => void },
): string {
  if (!implementer && persisted) {
    implementer = persisted.implementer;
    if (implementer) { deps.log(fmt.status('INFO', `Resuming persisted implementer: ${implementer}`)); }
  }
  if (!implementer && taskResolution.ok) {
    implementer = deps.getTaskImplementerFn(taskResolution.taskFile!) || undefined;
    if (implementer) { deps.log(fmt.status('INFO', `Auto-derived implementer from backlog task: ${implementer}`)); }
  }
  if (!implementer) {
    implementer = 'autonomous';
    deps.log(fmt.status('WARN', `No implementer identity resolved for ${slug}; defaulting to "autonomous"`));
  }
  return implementer;
}

type TaskFileResolution = { ok: boolean; taskFile?: string; matches: string[]; reason?: string };

/** A missing Backlog task file is a hard failure except for DB-owned adhoc identities. */
function shouldStopOnMissingTaskFile(
  taskResolution: TaskFileResolution,
  slug: string,
  deps: { log: (_msg: string) => void; error: (_msg: string) => void; exit: (_code: number) => never },
): boolean {
  if (taskResolution.ok) { return false; }
  // A DB-owned adhoc identity has no Backlog task file to resolve; its identity
  // and lifecycle are DB-authoritative. The implementer defaulted above (from
  // persisted review state, or "autonomous"). Backlog-backed missions keep the
  // hard failure.
  if (isDbAdhocIdentity(slug)) {
    deps.log(fmt.status('WARN', `No Backlog task file for DB-owned adhoc identity ${slug}; identity and lifecycle are DB-authoritative.`));
    return false;
  }
  reportTaskResolution(taskResolution, slug, deps.error);
  deps.exit(1);
  return true;
}

type StartTransitionPrep = {
  stopped: boolean;
  handoffJustRan: boolean;
  prNumber: number | null;
  confirmedPullRequest: PullRequestReference | null;
  skipHandoff: boolean;
};

/**
 * SC1: provider reachability + open-PR confirmation, then the fresh --start
 * handoff transition (skipped for dry runs, explicit skips, and --continue).
 * Returns stopped=true once a diagnostic has been emitted and the exit code set.
 */
async function prepareStartTransition(params: {
  slug: string;
  dryRun: boolean;
  forgejoEnabled: boolean;
  verbose: boolean;
  isContinue: boolean;
  providerState: ProviderPrelude;
  implementer: string;
  branch: string;
  worktree: string;
  taskResolution: { ok: boolean; taskFile?: string | null };
  pullRequestReference: (_number: unknown, _url: unknown) => PullRequestReference | null;
  resolvedProviderAvailableFn: (_url: string) => Promise<boolean> | boolean;
  runFn: unknown;
  getPrStatusFn: Function;
  performHandoffFn: unknown;
  getTaskStatusFn: Function;
  transitionTaskFn: Function;
  readReviewStateFn: Function;
  writeReviewStateFn: Function;
  missionStore: MissionStore | null;
  lifecycleService?: MissionLifecycleService | null;
  log: (_msg: string) => void;
  error: (_msg: string) => void;
  exit: (_code: number) => void;
}): Promise<StartTransitionPrep> {
  const { slug, dryRun, forgejoEnabled, verbose, isContinue, providerState, implementer, branch, worktree, taskResolution, pullRequestReference, resolvedProviderAvailableFn, runFn, getPrStatusFn, performHandoffFn, getTaskStatusFn, transitionTaskFn, readReviewStateFn, writeReviewStateFn, missionStore, log, error, exit } = params;
  const stopped = (): StartTransitionPrep => ({
    stopped: true, handoffJustRan: false, prNumber: providerState.prNumber, confirmedPullRequest: providerState.confirmedPullRequest, skipHandoff: providerState.skipHandoff,
  });
  if (!dryRun && forgejoEnabled) {
    if (!await ensureProviderReachable({ resolvedProviderAvailableFn, runFn, log, error, exit })) { return stopped(); }
    confirmOpenReviewPr(providerState, { branch, worktree, getPrStatusFn, pullRequestReference, log });
  } else if (verbose && !dryRun && !forgejoEnabled) {
    log(fmt.status('INFO', 'Forgejo validation skipped (review provider is not forgejo). Using workflow-owned review surfaces.'));
  }
  // Production has Mission authority: only its Review proves handoff finished.
  if (missionStore && providerState.skipHandoff && !isContinue && !dryRun) {
    const recordedReview = await Promise.resolve(readReviewStateFn(slug, worktree));
    const taskStatus = taskResolution.ok ? getTaskStatusFn(taskResolution.taskFile!) : null;
    if (!recordedReview || (taskStatus && taskStatus !== 'review')) { providerState.skipHandoff = false; }
  }
  let continueHandoff = false;
  if (missionStore && isContinue && !dryRun) {
    const loaded = await missionStore.load(missionId(slug));
    continueHandoff = loaded.kind === 'found' && loaded.mission.status === 'active'
      && Boolean(loaded.mission.review && ['awaiting-review', 'ready-for-next-round'].includes(reviewStatus(loaded.mission.review)));
    if (continueHandoff) { providerState.skipHandoff = false; }
  }
  let handoffJustRan = false;
  if (!dryRun && !providerState.skipHandoff && (!isContinue || continueHandoff)) {
    const handedOff = await performStartHandoff(slug, providerState, {
      performHandoffFn, implementer, worktree, branch, forgejoEnabled, taskResolution,
      getTaskStatusFn, getPrStatusFn, transitionTaskFn, readReviewStateFn, writeReviewStateFn,
      missionStore, lifecycleService: params.lifecycleService, pullRequestReference, log, error, exit,
    });
    handoffJustRan = handedOff.ran;
    if (!handedOff.ok) {
      return { stopped: true, handoffJustRan, prNumber: providerState.prNumber, confirmedPullRequest: providerState.confirmedPullRequest, skipHandoff: providerState.skipHandoff };
    }
  }
  return { stopped: false, handoffJustRan, prNumber: providerState.prNumber, confirmedPullRequest: providerState.confirmedPullRequest, skipHandoff: providerState.skipHandoff };
}

/** Build (and persist) the ReviewState a start resumes or creates. */
async function buildStartReviewState(params: {
  slug: string;
  persisted: ReviewState | null;
  reviewer: string;
  implementer: string;
  confirmedPullRequest: PullRequestReference | null;
  dryRun: boolean;
  worktree: string;
  missionStore: MissionStore | null;
  writeReviewStateFn: typeof writeReviewState;
  log: (_msg: string) => void;
}): Promise<ReviewState> {
  const { slug, persisted, reviewer, implementer, confirmedPullRequest, dryRun, worktree, missionStore, writeReviewStateFn, log } = params;
  let state: ReviewState;
  if (persisted) {
    state = ReviewState.from(slug, persisted);
    state.reviewer = reviewer;
    state.implementer = implementer;
    await persistReviewStateOrThrow(writeReviewStateFn, slug, state, worktree, missionStore);
  } else {
    state = new ReviewState(slug, { reviewer, implementer });
  }
  if (confirmedPullRequest) {
    state.pullRequest = confirmedPullRequest;
  }
  await persistNormalizedPhaseRepair(slug, state, worktree, { log, writeReviewStateFn, missionStore });
  if (persisted && state.round > 1 && !dryRun) {
    log(fmt.status('INFO', `Resuming review loop from round ${state.round} (${state.phase}).`));
  }
  return state;
}

export async function startReviewLoop(slug: string, opts: {
  implementer?: string;
  reviewer?: string;
  focus?: string;
  maxAttempts?: number;
  reboundsPerRound?: number;
  dryRun?: boolean;
  reset?: boolean;
  continue?: boolean;
  isContinue?: boolean;
  /**
   * The caller already performed the handoff transition (e.g. `px active`
   * post-execute repair, which is a fresh review start, not a resume) and the
   * loop must not run performHandoff a second time. Distinct from `isContinue`,
   * which also flips the resume-only behaviors (reviewer reuse, existing-review
   * skip-poll, existing-disposition skip-poll) that a fresh start must not take.
   */
  skipHandoff?: boolean;
  verbose?: boolean;
  pollTimeoutSeconds?: number | null;
  worktree?: string;
  missionPath?: string;
  resetReviewStateFn?: typeof resetReviewState;
  maybeUpdateGraphifyBeforeReviewFn?: typeof maybeUpdateGraphifyBeforeReview;
  readReviewStateFn?: typeof readReviewState;
  resolveTaskFileFn?: typeof resolveTaskFile;
  getTaskImplementerFn?: typeof getTaskImplementer;
  getTaskStatusFn?: typeof getTaskStatus;
  transitionTaskFn?: typeof transitionTask;
  toVirtualFn?: typeof toVirtual;
  transitionVirtualFn?: typeof transitionVirtual;
  workflowLauncherStatusFn?: typeof workflowLauncherStatus;
  buildAutonomousReviewMatrixFn?: typeof buildAutonomousReviewMatrix;
  formatMatrixSummaryFn?: typeof formatMatrixSummary;
  selectAgentFn?: typeof selectAgent;
  providerAvailableFn?: ((_url: string) => Promise<boolean>) | null | undefined;
  runFn?: typeof run;
  getPrStatusFn?: typeof getPrStatus;
  enforceTaskAssigneeFn?: typeof enforceTaskAssignee;
  resolveReviewUserFn?: (() => string) | null | undefined;
  forgejoAvailableFn?: ((_url: string) => Promise<boolean>) | null;
  resolveForgejoUserFn?: (() => string) | null;
  readTokenFn?: typeof readToken;
  getCommentsFn?: typeof getComments;
  postCommentFn?: typeof postComment;
  postReviewFn?: typeof postReview;
  writeReviewStateFn?: typeof writeReviewState;
  startAgentFn?: typeof startAgent;
  pollForReviewFn?: typeof pollForReview;
  pollForDispositionFn?: typeof pollForDisposition;
  applyAgentFallbackFn?: typeof applyAgentFallback;
  buildReviewPromptFn?: typeof buildReviewPrompt;
  buildActOnReviewPromptFn?: typeof buildActOnReviewPrompt;
  buildCompactReviewPromptFn?: typeof buildCompactReviewPrompt;
  buildCompactActOnReviewPromptFn?: typeof buildCompactActOnReviewPrompt;
  consumeReviewerArtifactsFn?: typeof consumeReviewerArtifacts;
  consumeImplementerArtifactsFn?: typeof consumeImplementerArtifacts;
  rebaseBeforeReviewRoundFn?: typeof rebaseBeforeReviewRound;
  eligibleAgentsForStepFn?: typeof eligibleAgentsForStep;
  performHandoffFn?: (_slug: string, _opts?: Record<string, unknown>) => Promise<Record<string, unknown>>;
  log?: (_msg: string) => void;
  error?: (_msg: string) => void;
  getLatestReviewForPrFn?: typeof getLatestReviewForPr;
  getLatestDispositionForPrFn?: typeof getLatestDispositionForPr;
  sleepFn?: typeof delay;
  exit?: (_code: number) => never;
  gitFn?: typeof git;
  isReviewProviderEnabledFn?: ((_rootDir?: string) => boolean) | null | undefined;
  legacyIsForgejoReviewEnabledFn?: ((_rootDir?: string) => boolean) | null;
  isForgejoReviewEnabledFn?: ((_rootDir?: string) => boolean) | null;
  recordStageStatsSafeFn?: (..._args: any[]) => void | Promise<void>;
  runPreReviewGateFn?: typeof runPreReviewGate;
  reboundPreReviewFailureFn?: typeof reboundPreReviewFailure;
  lifecycleService?: MissionLifecycleService | null;
  pushReviewRefFn?: typeof pushReviewRef;
  isStaleInfoPushRejectionFn?: typeof isStaleInfoPushRejection;
  fetchReviewBranchFn?: typeof fetchReviewBranch;
  hasNewCommittedChangeFn?: ((_branch: string, _rootDir: string) => boolean) | null;
  missionStore?: MissionStore | null;
  agentSelectionSnapshotPort?: AgentSelectionSnapshotPort | null;
  onAgentLaunched?: (_agent: string, _phase: 'review' | 'review-response') => Promise<void> | void;
  onAutonomousStop?: (_reason: string) => Promise<void> | void;
} = {}): Promise<void> {
  let {
    implementer,
    reviewer,
    focus = 'all',
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    reboundsPerRound = DEFAULT_REBOUNDS_PER_ROUND,
    dryRun = false,
    reset = false,
    continue: continueFlag = false,
    isContinue = false,
    skipHandoff: skipHandoffOpt = false,
    verbose = false,
    pollTimeoutSeconds = null,
    worktree: callerWorktree,
    missionPath,
    runPreReviewGateFn = runPreReviewGate,
    reboundPreReviewFailureFn = reboundPreReviewFailure,
    resetReviewStateFn = resetReviewState,
    maybeUpdateGraphifyBeforeReviewFn = maybeUpdateGraphifyBeforeReview,
    readReviewStateFn = readReviewState,
    resolveTaskFileFn = resolveTaskFile,
    getTaskImplementerFn = getTaskImplementer,
    getTaskStatusFn = getTaskStatus,
    transitionTaskFn = transitionTask,
    transitionVirtualFn = transitionVirtual,
    workflowLauncherStatusFn = workflowLauncherStatus,
    buildAutonomousReviewMatrixFn = buildAutonomousReviewMatrix,
    formatMatrixSummaryFn = formatMatrixSummary,
    selectAgentFn = selectAgent,
    providerAvailableFn = undefined,
    runFn = run,
    getPrStatusFn = getPrStatus,
    enforceTaskAssigneeFn = enforceTaskAssignee,
    resolveReviewUserFn = undefined,
    forgejoAvailableFn = null,
    resolveForgejoUserFn = null,
    readTokenFn = readToken,
    getCommentsFn = getComments,
    postCommentFn = postComment,
    postReviewFn = postReview,
    writeReviewStateFn = writeReviewState,
    startAgentFn = startAgent,
    pollForReviewFn = pollForReview,
    pollForDispositionFn = pollForDisposition,
    applyAgentFallbackFn = applyAgentFallback,
    buildReviewPromptFn = buildReviewPrompt,
    buildActOnReviewPromptFn = buildActOnReviewPrompt,
    buildCompactReviewPromptFn = buildCompactReviewPrompt,
    buildCompactActOnReviewPromptFn = buildCompactActOnReviewPrompt,
    consumeReviewerArtifactsFn = consumeReviewerArtifacts,
    consumeImplementerArtifactsFn = consumeImplementerArtifacts,
    rebaseBeforeReviewRoundFn = rebaseBeforeReviewRound,
    eligibleAgentsForStepFn = eligibleAgentsForStep,
    log = fmt.log.plain,
    error = fmt.log.plainError,
    getLatestReviewForPrFn = getLatestReviewForPr,
    getLatestDispositionForPrFn = getLatestDispositionForPr,
    sleepFn = delay,
    exit = process.exit,
    gitFn = git,
    isReviewProviderEnabledFn = undefined,
    legacyIsForgejoReviewEnabledFn = null,
    isForgejoReviewEnabledFn = null,
    recordStageStatsSafeFn = () => {},
    pushReviewRefFn = pushReviewRef,
    isStaleInfoPushRejectionFn = isStaleInfoPushRejection,
    lifecycleService = null,
    fetchReviewBranchFn = fetchReviewBranch,
    hasNewCommittedChangeFn = null,
    missionStore = null,
    agentSelectionSnapshotPort = null,
    onAgentLaunched = undefined,
    onAutonomousStop = undefined,
  } = opts;
  const performHandoffFn = opts.performHandoffFn;
  let prNumber: number | null = null;
  let confirmedPullRequest: PullRequestReference | null = null;
  const pullRequestReference = (number: unknown, url: unknown): PullRequestReference | null => {
    const id = String(number ?? '').trim();
    if (!id) { return null; }
    return {
      kind: 'pull-request',
      provider: 'forgejo',
      id,
      url: typeof url === 'string' && url.trim() ? url : null,
      sourceBranch: branch,
      targetBranch: (() => {
        try { return getPrimaryBranch(worktree, gitFn) || 'main'; }
        catch { return 'main'; }
      })(),
    };
  };
  isContinue = Boolean(isContinue || continueFlag);
  const pollIntervalMs = resolvePollIntervalMs();
  const pollTimeoutMs = resolvePollTimeoutMs(pollTimeoutSeconds || 0);
  const worktree = callerWorktree || resolveWorktree(slug) || process.cwd();
  const resolvedProviderAvailableFn = providerAvailableFn || forgejoAvailableFn || providerAvailable;
  const resolvedReviewUserFn = resolveReviewUserFn || resolveForgejoUserFn || resolveReviewUser;
  const branch = missionBranchName(slug, worktree);
  const artifactDir = resolveArtifactDir(worktree);
  const missionDir = findMissionDir(slug, worktree, { missionPath });
  const effectiveMissionPath = resolveEffectiveMissionPath(missionPath, missionDir, log);
  const taskResolution = resolveTaskFileFn(slug, worktree);
  if (!dryRun) {
    await maybeUpdateGraphifyBeforeReviewFn(worktree, { commandRunner: runFn, log });
  }
  await applyStartReset(reset, slug, worktree, { resetReviewStateFn, log });
  if (missionStore && !dryRun) { await recoverLegacyIntegrationRepairReview(missionStore, slug); }
  const preparedSelection = agentSelectionSnapshotPort
    ? await PreparedAgentSelection.prepare(agentSelectionSnapshotPort)
    : null;
  const selectReviewer = (excludeSet: Set<string>) => preparedSelection
    ? selectPreparedReviewer(preparedSelection, excludeSet)
    : selectAgentFn('review', { exclude: excludeSet });
  const agents = eligibleAgentsForStepFn('review');
  let persisted = await Promise.resolve(readReviewStateFn(slug, worktree));
  implementer = resolveStartImplementer(slug, implementer, persisted, taskResolution, { getTaskImplementerFn, log });
  if (shouldStopOnMissingTaskFile(taskResolution, slug, { log, error, exit })) { return; }
  const forgejoEnabledFn = isReviewProviderEnabledFn
    || legacyIsForgejoReviewEnabledFn
    || isForgejoReviewEnabledFn
    || isProviderEnabled;
  const forgejoEnabled = forgejoEnabledFn(worktree);
  // SC1: `px review <slug> --start` performs the sync/push and active -> review
  // transition that `px handoff` used to own. An open PR does not prove that
  // handoff finished writing the Review aggregate.
  let skipHandoff = skipHandoffOpt;
  const providerState: ProviderPrelude = { prNumber, confirmedPullRequest, skipHandoff };
  const transitionPrep = await prepareStartTransition({
    slug, dryRun, forgejoEnabled, verbose, isContinue, providerState, implementer: implementer!,
    branch, worktree, taskResolution, pullRequestReference, resolvedProviderAvailableFn, runFn,
    getPrStatusFn, performHandoffFn, getTaskStatusFn, transitionTaskFn, readReviewStateFn, writeReviewStateFn,
    missionStore, lifecycleService, log, error, exit,
  });
  if (transitionPrep.stopped) { return; }
  ({ prNumber, confirmedPullRequest, skipHandoff } = transitionPrep);
  // Tracks whether this fresh --start just ran the handoff transition, so the
  // handoff-created Review (with its reviewer/round) can be reloaded before
  // reviewer resolution (round-3: preserve the handoff review assignment).
  const handoffJustRan = transitionPrep.handoffJustRan;
  // SC1: a fresh --start handoff just created the authoritative Review with its
  // reviewer and round. Reload it so reviewer resolution and state construction
  // resume the handoff-created reviewer/round instead of selecting a new one.
  // A --continue never enters this branch (persisted was already non-null), and
  // a Forgejo start with an existing PR skips handoff entirely, so this reload
  // only ever re-reads the handoff-created state.
  if (handoffJustRan) {
    persisted = await Promise.resolve(readReviewStateFn(slug, worktree));
  }
  const resolvedReviewer = resolveReviewerIdentity({
    reviewer, implementer: implementer!, isContinue, persisted, agents, selectReviewer,
    workflowLauncherStatusFn, buildAutonomousReviewMatrixFn, formatMatrixSummaryFn,
    maxAttempts, dryRun, forgejoEnabled, slug, log, error,
  });
  if (!resolvedReviewer) {
    exit(1);
    return;
  }
  reviewer = resolvedReviewer.reviewer;
  const state = await buildStartReviewState({
    slug, persisted, reviewer, implementer: implementer!, confirmedPullRequest, dryRun, worktree, missionStore, writeReviewStateFn, log,
  });
  const escalateToHumanReview = async (reason: string, disposition = state.disposition) => {
    state.disposition = disposition || reason;
    state.metadata = {
      ...state.metadata,
      humanEscalationReason: reason,
      humanEscalatedAt: new Date().toISOString()
    };
    await persistReviewStateOrThrow(writeReviewStateFn, slug, state, worktree, missionStore);
    // The mission is now waiting on a human. Publish why, so the board says
    // more than "nothing is running" (TASK-2373 SC10).
    await onAutonomousStop?.(reason);
    log(fmt.status('INFO', `Autonomous review stopped: human review required after reviewer ${reason}.`));
  };
  log(fmt.status('INFO', `REVIEW — ${slug}`));
  log(fmt.status('INFO', `Implementer: ${implementer}`));
  log(fmt.status('INFO', `Reviewer: ${reviewer}`));
  log(fmt.status('INFO', `Independence: ${reviewIndependence(implementer!, reviewer!)}`));
  log(fmt.status('INFO', `Branch: ${branch}`));
  if (verbose) {
    log(fmt.status('INFO', `Focus: ${focus} | Max attempts: ${maxAttempts}`));
    log(fmt.status('INFO', `Poll interval: ${Math.round(pollIntervalMs / 1000)}s | Poll timeout: ${Math.round(pollTimeoutMs / 1000)}s | Verbose: on`));
  }
  if (dryRun) {
    log(fmt.status('DRY-RUN', 'No agents will be launched.'));
  }
  const pollingUser = forgejoEnabled ? (resolvedReviewUserFn as () => string | null)() : null;
  const token = dryRun || !forgejoEnabled ? null : readTokenFn(pollingUser!, { rootDir: worktree });
  const initialRound = state.round;
  const identities = { implementer, reviewer };
  const roundContext = {
    applyAgentFallbackFn,
    artifactDir,
    branch,
    buildActOnReviewPromptFn,
    buildCompactActOnReviewPromptFn,
    buildCompactReviewPromptFn,
    buildReviewPromptFn,
    consumeImplementerArtifactsFn,
    consumeReviewerArtifactsFn,
    dryRun,
    effectiveMissionPath,
    enforceTaskAssigneeFn,
    error,
    escalateToHumanReview,
    exit,
    fetchReviewBranchFn,
    focus,
    forgejoEnabled,
    forgejoEnabledFn,
    getCommentsFn,
    getLatestDispositionForPrFn,
    getLatestReviewForPrFn,
    gitFn,
    hasNewCommittedChangeFn,
    initialRound,
    isContinue,
    isStaleInfoPushRejectionFn,
    log,
    maxAttempts,
    missionStore,
    onAgentLaunched,
    onAutonomousStop,
    pollForDispositionFn,
    pollForReviewFn,
    pollIntervalMs,
    pollTimeoutMs,
    postCommentFn,
    postReviewFn,
    prNumber,
    pushReviewRefFn,
    readReviewStateFn,
    readTokenFn,
    rebaseBeforeReviewRoundFn,
    reboundPreReviewFailureFn,
    lifecycleService,
    rebaseWorkflowOptions: missionStore ? { missionServicesFn: async () => ({ store: missionStore, lifecycle: lifecycleService }) } : undefined,
    reboundsPerRound,
    recordStageStatsSafeFn,
    runFn,
    runPreReviewGateFn,
    sleepFn,
    slug,
    startAgentFn,
    taskResolution,
    token,
    transitionTaskFn,
    transitionVirtualFn,
    verbose,
    worktree,
    writeReviewStateFn,
  };
  for (let attempt = initialRound; attempt <= maxAttempts; attempt++) {
    if (await runReviewRound(attempt, roundContext, state, identities) === 'stop') { return; }
  }

  state.disposition = 'MAX_ATTEMPTS';
  state.metadata = {
    ...state.metadata,
    humanEscalationReason: 'MAX_ATTEMPTS',
    humanEscalatedAt: new Date().toISOString()
  };
  await persistReviewStateOrThrow(writeReviewStateFn, slug, state, worktree, missionStore);
  log(fmt.status('INFO', `Autonomous review stopped: reached ${maxAttempts} attempts. Hand off to human review.`));
}
export { commitSafeMissionArtifacts, rebaseBeforeReviewRound };
export {
  runPreReviewGate,
  reboundPreReviewFailure,
  gateFailureReason,
  hookFailureReason,
  NO_GATE_NOTICE_ALIAS,
  strictlyLaterIso,
  DEFAULT_MAX_ATTEMPTS,
  CONTINUE_SKIP_CHECK_TIMEOUT_MS,
} from './review-gate-handling.js';
export type { PreReviewGateResult } from './review-gate-handling.js';
export {
  applyAgentFallback,
  persistNormalizedPhaseRepair,
  selectPreparedReviewer,
  stageWindowKey,
  stageLaunchSinceMs,
  stageLaunchFingerprint,
  markStageLaunchRecorded,
  recordStageStatsSafe,
  getStats,
  maybeUpdateGraphifyBeforeReview,
} from './review-agent-fallback.js';
