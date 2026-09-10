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
import { isDbAdhocIdentity } from '../../domain/mission.js';
import type { PullRequestReference } from '../../domain/review.js';
import { resolveTaskFile, getTaskImplementer, getTaskStatus, enforceTaskAssignee, transitionTask, reportTaskResolution } from '../backlog/backlog.js';
import { toVirtual, transitionVirtual } from '../config/state-map.js';
import { getPrStatus, readToken, getLatestReviewForPr, getLatestDispositionForPr, providerAvailable, getComments, postComment, postReview, resolveReviewUser, isProviderEnabled } from './review-adapter.js';
import { buildAutonomousReviewMatrix, formatMatrixSummary } from '../agents/runtime-matrix.js';
import { buildReviewPrompt, buildActOnReviewPrompt, buildCompactReviewPrompt, buildCompactActOnReviewPrompt } from './review-prompts.js';
import { ReviewState, readReviewState, writeReviewState, resetReviewState, persistReviewStateOrThrow, assertReviewStatePersisted } from './review-state.js';
import type { MissionStore } from '../../application/domain-ports.js';
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
  getHandoff,
  applyAgentFallback,
  persistNormalizedPhaseRepair,
  selectPreparedReviewer,
  resolveReviewerIdentity,
  stageLaunchSinceMs,
  maybeUpdateGraphifyBeforeReview,
} from './review-agent-fallback.js';
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
export function renderReviewVerdict(reviewState: string | null, findings: readonly string[], log: (_msg: string) => void, verbose = false): void {
  if (reviewState === 'APPROVED') {
    log(fmt.status('PASS', '========== APPROVED =========='));
    return;
  }
  if (reviewState === 'REQUEST_CHANGES') {
    log(fmt.status('WARN', '====== CHANGES REQUESTED ======'));
    for (const finding of findings) {
      log(fmt.status('WARN', `Blocking finding: ${finding}`));
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
    toVirtualFn = toVirtual,
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
    fetchReviewBranchFn = fetchReviewBranch,
    hasNewCommittedChangeFn = null,
    missionStore = null,
    agentSelectionSnapshotPort = null,
    onAgentLaunched = undefined,
    onAutonomousStop = undefined,
  } = opts;
  const performHandoffFn = opts.performHandoffFn || (await getHandoff()).performHandoff;
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
  let effectiveMissionPath: string | null = null;
  if (missionPath && fs.existsSync(missionPath)) {
    effectiveMissionPath = fs.statSync(missionPath).isDirectory()
      ? path.join(missionPath, 'MISSION.md')
      : missionPath;
    log(fmt.status('INFO', `Using mission contract from --mission override: ${effectiveMissionPath}`));
  } else if (missionPath) {
    log(fmt.status('WARN', `--mission path not found: ${missionPath}; falling back to slug-derived mission location${missionDir ? ` (${missionDir})` : ''}.`));
  }
  const taskResolution = resolveTaskFileFn(slug, worktree);
  if (!dryRun) {
    await maybeUpdateGraphifyBeforeReviewFn(worktree, { commandRunner: runFn, log });
  }
  if (reset) {
    const resetResult = await resetReviewStateFn(slug, worktree);
    assertReviewStatePersisted(resetResult, { slug, phase: 'reset', round: null });
    if (resetResult.outcome === 'committed') {
      log(fmt.status('INFO', `Review state reset for ${slug}.`));
    }
  }
  const preparedSelection = agentSelectionSnapshotPort
    ? await PreparedAgentSelection.prepare(agentSelectionSnapshotPort)
    : null;
  const selectReviewer = (excludeSet: Set<string>) => preparedSelection
    ? selectPreparedReviewer(preparedSelection, excludeSet)
    : selectAgentFn('review', { exclude: excludeSet });
  const agents = eligibleAgentsForStepFn('review');
  const persisted = await Promise.resolve(readReviewStateFn(slug, worktree));
  if (!implementer) {
    if (persisted) {
      implementer = persisted.implementer;
      log(fmt.status('INFO', `Resuming persisted implementer: ${implementer}`));
    } else {
      if (taskResolution.ok) {
        implementer = (getTaskImplementerFn(taskResolution.taskFile!) || undefined);
        if (implementer) {
          log(fmt.status('INFO', `Auto-derived implementer from backlog task: ${implementer}`));
        }
      }
    }
  }
  if (!implementer) {
    implementer = 'autonomous';
    log(fmt.status('WARN', `No implementer identity resolved for ${slug}; defaulting to "autonomous"`));
  }
  if (!taskResolution.ok) {
    // A DB-owned adhoc identity has no Backlog task file to resolve; its identity
    // and lifecycle are DB-authoritative. The implementer defaulted above (from
    // persisted review state, or "autonomous"). Backlog-backed missions keep the
    // hard failure.
    if (isDbAdhocIdentity(slug)) {
      log(fmt.status('WARN', `No Backlog task file for DB-owned adhoc identity ${slug}; identity and lifecycle are DB-authoritative.`));
    } else {
      reportTaskResolution(taskResolution, slug, error);
      exit(1);
      return;
    }
  }
  const forgejoEnabledFn = isReviewProviderEnabledFn
    || legacyIsForgejoReviewEnabledFn
    || isForgejoReviewEnabledFn
    || isProviderEnabled;
  const forgejoEnabled = forgejoEnabledFn(worktree);
  if (!dryRun && forgejoEnabled) {
    const forgejoUrl = process.env.FORGEJO_URL || 'http://localhost:3300';
    const bootstrapScript = path.join(packageRoot(MODULE_DIR), 'scripts', 'bootstrap.sh');
    log(fmt.status('INFO', `Checking review-provider availability at ${forgejoUrl}...`));
    if (!await resolvedProviderAvailableFn(forgejoUrl)) {
      error(fmt.status('FAIL', `Review provider not reachable at ${forgejoUrl}`));
      error('       Attempting to bootstrap provider containers...');
      const bootstrapResult = (runFn as any)('bash', [bootstrapScript], { stdio: 'inherit' });
      if (bootstrapResult.status === 0) {
        log(fmt.status('INFO', 'Bootstrap succeeded. Continuing with review loop.'));
      } else {
        error(fmt.status('FAIL', 'Bootstrap failed. Please run \'scripts/bootstrap.sh\' manually and retry.'));
        exit(1);
        return;
      }
    } else {
      log(fmt.status('INFO', `Review provider is running and reachable at ${forgejoUrl}.`));
    }
    const pr = getPrStatusFn(branch, worktree) as Record<string, unknown>;
    if (!pr.exists || pr.state !== 'open') {
      const taskStatus = taskResolution.ok ? getTaskStatusFn(taskResolution.taskFile!) : null;
      const virtualStatus = taskStatus ? toVirtualFn(taskStatus) : null;
      const isImplementationPhase = taskStatus === 'active' || virtualStatus === 'active';
      if (isImplementationPhase) {
        log(fmt.status('INFO', `PR not found for ${branch}. Task is in ${taskStatus} — create the PR first: px review ${slug} --push`));
        return;
      }
      const fallbackGuidance = (reason: string | null) => {
        error(fmt.status('FAIL', `No open review PR found for ${branch}. Create the PR before starting the review loop.`));
        if (reason) { error(`       Handoff failure: ${reason}`); }
        error(`       Run: px review ${slug} --push`);
      };
      if (dryRun) {
        fallbackGuidance(null);
        exit(1);
        return;
      }
      log(fmt.status('INFO', `No open review PR for ${branch} (task in ${taskStatus}) — attempting automatic handoff (px review ${slug} --push)...`));
      const handoff = await performHandoffFn(slug, { forgejoUser: implementer, worktree, recoverGateFailure: true });
      if (handoff && handoff.gatekeeperPushedBack) {
        error(fmt.status('FAIL', `Handoff blocked for ${branch}: mandatory mission artifacts are missing. Task stays in ${taskStatus}; supply the required artifacts and retry.`));
        exit(1);
        return;
      }
      if (!handoff || !handoff.ok) {
        const handoffObj = handoff || {};
        if (handoffObj.reason === 'validation-failed' && !handoffObj.recoveryAttempted) {
          await transitionTaskFn(slug, 'active', { rootDir: worktree, log });
          log(fmt.status('INFO', `Auto-bounced ${slug} to active: declared-gate validation failure. Fix the gate in MISSION.md and retry.`));
          const persisted = await Promise.resolve(readReviewStateFn(slug, worktree));
          const metadata = persisted && persisted.metadata && typeof persisted.metadata === 'object'
            ? { ...persisted.metadata }
            : {};
          metadata.gateFailureReason = 'validation-failed';
          metadata.gateFailureError = handoffObj.error;
          await persistReviewStateOrThrow(
            writeReviewStateFn,
            slug,
            { ...(persisted || {}), metadata } as any,
            worktree,
            missionStore
          );
          exit(1);
          return;
        }
        fallbackGuidance(handoff && handoff.error ? String(handoff.error) : null);
        exit(1);
        return;
      }
      const healedPr = getPrStatusFn(branch, worktree) as Record<string, unknown>;
      if (!healedPr.exists || healedPr.state !== 'open') {
        fallbackGuidance(null);
        exit(1);
        return;
      }
      log(fmt.status('INFO', `Self-heal succeeded: review PR #${healedPr.number} confirmed open for ${branch}. Continuing review loop.`));
      prNumber = healedPr.number as number | null;
      confirmedPullRequest = pullRequestReference(healedPr.number, healedPr.url);
    } else {
      log(fmt.status('INFO', `Review PR #${pr.number} confirmed open for ${branch}.`));
      prNumber = pr.number as number | null;
      confirmedPullRequest = pullRequestReference(pr.number, pr.url);
    }
  } else if (!dryRun && !forgejoEnabled) {
    log(fmt.status('INFO', 'Forgejo validation skipped (review provider is not forgejo). Using workflow-owned review surfaces.'));
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
  log(fmt.status('INFO', `Focus: ${focus}`));
  if (verbose) {
    log(fmt.status('INFO', `Max attempts: ${maxAttempts}`));
  }
  log(fmt.status('INFO', `Poll interval: ${Math.round(pollIntervalMs / 1000)}s | Poll timeout: ${Math.round(pollTimeoutMs / 1000)}s`));
  if (dryRun) {
    log(fmt.status('DRY-RUN', 'No agents will be launched.'));
  }
  const pollingUser = forgejoEnabled ? (resolvedReviewUserFn as () => string | null)() : null;
  const token = dryRun || !forgejoEnabled ? null : readTokenFn(pollingUser!, { rootDir: worktree });
  const initialRound = state.round;
  let reboundsUsedThisRound = 0;
  for (let attempt = initialRound; attempt <= maxAttempts; attempt++) {
    let blockingFindings: string[] = [];
    log('\n' + fmt.status('INFO', `========== Round ${attempt} / ${maxAttempts} ==========`));
    // The per-round relaunch cap is round-local scratch (TASK-2377.04): every
    // round starts with a fresh counter; nothing is persisted.
    reboundsUsedThisRound = 0;
    // The remaining polling retry counter is round-local scratch; timeout
    // recovery attempts themselves are owned by the rebound kernel.
    let reviewerTimeoutRetries = 0;
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
    let reviewBaseline: string | undefined = captureReviewBaseline();
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
        isReviewProviderEnabledFn: forgejoEnabledFn
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
    });
    /** True when a kernel verify already re-ran the rebase and gate this round. */
    let preReviewSetupVerified = false;
    let reviewState: unknown;
    if (state.phase === 'reviewing') {
      if (isContinue && attempt === initialRound) {
        if (!dryRun) { await transitionTaskFn(slug, 'review', { rootDir: worktree, log }); }
        if (forgejoEnabled) {
          log(fmt.status('INFO', `Round ${attempt}: checking for existing review by ${reviewer} since ${state.startedAt}...`));
          reviewState = await pollForReviewFn(prNumber as number, reviewer!, state.startedAt, token!, {
            getLatestReviewForPrFn, sleepFn, intervalMs: 1000, timeoutMs: 2000, retryCount: reviewerTimeoutRetries, verbose, label: `round ${attempt} skip-check`, log
          });
          if (isPollTimeout(reviewState)) {
            reviewState = null;
          }
        } else {
          // Provider plumbing: verbose-only so it does not compete with the
          // reviewer launch on the provider=none happy path.
          if (verbose) {
            log(fmt.status('INFO', `Round ${attempt}: review provider disabled; using workflow-owned review state.`));
          }
          reviewState = null;
        }
      }
      if (dryRun) {
        if (!reviewState) {
          if (reviewer === 'autonomous') {
            log(fmt.status('INFO', `Round ${attempt}: reviewer identity is autonomous; skipping dry-run reviewer prompt and using local review artifacts only.`));
          } else {
            log(`\n--- DRY-RUN: reviewer (${reviewer}) prompt ---`);
            log((buildReviewPromptFn as any)({ reviewer: reviewer!, branch, implementer: implementer!, focus, attempt, repoRoot: worktree, missionPath: effectiveMissionPath || undefined, actualReviewer: reviewer!, reviewBaseline }));
          }
        }
      } else {
        if (!reviewState) {
          const rebaseResult = await rebaseBeforeReviewRoundFn(slug, {
            worktree, log, error, verbose,
            taskFile: taskResolution.taskFile,
            gitFn,
            isReviewProviderEnabledFn: forgejoEnabledFn
          });
          if (!rebaseResult.ok) {
            const rebaseFailure = rebaseResult.failure;
            if (rebaseFailure?.kind === 'gate') {
              // TASK-2377.02: the push-time verification gate is a gate failure,
              // even when its captured output mentions the enclosing pre-push
              // hook. It never consumes the hook budget or the hook fix prompt.
              error(fmt.status('FAIL', `Pre-review rebase gate failed for area "${rebaseFailure.gate.area}" (exit ${rebaseFailure.gate.exitCode}) during the ${rebaseFailure.operation} step.`));
              error(fmt.status('INFO', `Gate command: ${rebaseFailure.gate.command}`));
              if (roundReboundCapReached()) {
                await stopForRoundReboundCap('pre-review gate');
                return;
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
                implementer!,
                {
                  ...reboundCollaborators(),
                  verifyFn: verifyPreReviewSetup,
                  maxAttempts: Math.min(DEFAULT_REBOUND_ATTEMPTS, reboundsRemainingThisRound()),
                },
              );
              reboundsUsedThisRound += bounceResult.attempts ?? 0;
              implementer = bounceResult.implementer || implementer;
              if (!bounceResult.bounced) {
                if (roundReboundCapReached()) {
                  await stopForRoundReboundCap('pre-review gate');
                  return;
                }
                error(fmt.status('FAIL', `Pre-review rebase gate failure stranded mission ${slug} (${bounceResult.outcome}). Exiting review loop.`));
                exit(1); return;
              }
              log(fmt.status('PASS', `Pre-review rebase gate repair verified for ${slug}; continuing this review round.`));
              preReviewSetupVerified = true;
            }
            if (rebaseResult.hookFailure) {
              // TASK-2377.02 typed hook evidence (hook identity from git state)
              // is preferred; the legacy hookOutput field stays as fallback so
              // callers that do not populate `failure` keep working.
              const hookOutput = rebaseFailure?.kind === 'hook' ? rebaseFailure.hook.output : (rebaseResult.hookOutput || '');
              if (roundReboundCapReached()) {
                await stopForRoundReboundCap('pre-review hook');
                return;
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
                implementer!,
                {
                  ...reboundCollaborators(),
                  verifyFn: verifyPreReviewSetup,
                  // TASK-2377.04: the per-occurrence budget is clamped to the
                  // remaining per-round relaunch cap before the launch.
                  maxAttempts: Math.min(DEFAULT_REBOUND_ATTEMPTS, reboundsRemainingThisRound()),
                },
              );
              reboundsUsedThisRound += bounceResult.attempts ?? 0;
              implementer = bounceResult.implementer || implementer;
              if (bounceResult.bounced) {
                // The kernel's verify re-ran the pre-review rebase and the
                // verification gate, and both passed: the hook fix is proven,
                // so this round continues instead of stranding on an
                // unverified "implementer relaunched" claim.
                log(fmt.status('PASS', `Pre-review Git hook failure repaired and re-verified for ${slug}; continuing this review round.`));
                preReviewSetupVerified = true;
              } else {
                if (roundReboundCapReached()) {
                  await stopForRoundReboundCap('pre-review hook');
                  return;
                }
                error(fmt.status('FAIL', `Pre-review Git hook failure ${bounceResult.outcome === 'human-only' ? 'requires human intervention' : 'exhausted its repair budget'} for ${slug}.`));
                exit(1); return;
              }
            } else if (!preReviewSetupVerified) {
              // TASK-2415: the catch-all exit serves unclassified or unrepaired
              // failures only. A gate-only failure the kernel already repaired
              // and verified continues to the reviewer launch in the same round.
              exit(1); return;
            }
          }
          reviewBaseline = captureReviewBaseline();
          if (!dryRun) { await transitionTaskFn(slug, 'review', { rootDir: worktree, log }); }
          state.phase = 'reviewing';
          await persistReviewStateOrThrow(writeReviewStateFn, slug, state, worktree, missionStore);
        }
        if (!dryRun && !preReviewSetupVerified) {
          const preReviewGateResult = await runPreReviewGateFn(slug, worktree, {
            runFn: runFn as any,
            log,
            error,
          });
          if (!preReviewGateResult.ok) {
            log(fmt.status('WARN', `Pre-review gate failed for area "${preReviewGateResult.area}" (exit ${preReviewGateResult.exitCode}). Bouncing to implementer.`));
            if (roundReboundCapReached()) {
              await stopForRoundReboundCap('pre-review gate');
              return;
            }
            const bounceResult = await reboundPreReviewFailureFn(
              slug,
              worktree,
              gateFailureReason(preReviewGateResult),
              implementer!,
              {
                ...reboundCollaborators(),
                verifyFn: verifyPreReviewSetup,
                // TASK-2377.04: the per-occurrence budget is clamped to the
                // remaining per-round relaunch cap before the launch.
                maxAttempts: Math.min(DEFAULT_REBOUND_ATTEMPTS, reboundsRemainingThisRound()),
              },
            );
            reboundsUsedThisRound += bounceResult.attempts ?? 0;
            implementer = bounceResult.implementer || implementer;
            if (!bounceResult.bounced) {
              if (roundReboundCapReached()) {
                await stopForRoundReboundCap('pre-review gate');
                return;
              }
              error(fmt.status('FAIL', `Pre-review gate failure stranded mission ${slug} (${bounceResult.outcome}). Exiting review loop.`));
              exit(1); return;
            }
            // The kernel verified the repair by re-running the pre-review
            // rebase and the gate, so this round resumes with the verified
            // tree rather than restarting the whole review setup.
            log(fmt.status('PASS', `Declared gate repair verified for ${slug}; resuming this review round.`));
            reviewBaseline = captureReviewBaseline();
            await transitionTaskFn(slug, 'review', { rootDir: worktree, log });
          }
        }
        preReviewSetupVerified = false;
        if (!reviewState) {
          if (reviewer === 'autonomous' && !forgejoEnabled) {
            log(fmt.status('INFO', `Round ${attempt}: reviewer identity is autonomous; skipping reviewer launch and using local review artifacts only.`));
          } else {
            log(fmt.status('INFO', `Round ${attempt}: launching reviewer (${reviewer})...`));
            let reviewerLaunchResult: any;
            try {
              reviewerLaunchResult = await startAgentFn('review', {
                agent: reviewer,
                prompt: (actualReviewer: string) => (buildCompactReviewPromptFn as any)({ reviewer: reviewer!, branch, implementer: implementer!, focus, attempt, repoRoot: worktree, missionPath: effectiveMissionPath || undefined, actualReviewer, reviewBaseline }),
                worktree, slug, role: 'reviewer', exclude: [implementer], onLaunch: ({ agent }: { agent: string }) => onAgentLaunched?.(agent, 'review')
              });
            } catch (err: unknown) {
              recordAgentSelectionOutcome(log, 'launch-failed', { agent: reviewer, step: 'review', error: (err as Error).message });
              error(fmt.status('FAIL', `Could not launch reviewer agent (${reviewer}): ${(err as Error).message}`));
              await escalateToHumanReview('REVIEWER_LAUNCH_FAILURE');
              return;
            }
            reviewer = await applyAgentFallbackFn({
              role: 'reviewer', original: reviewer!, launchResult: reviewerLaunchResult,
              state: state as unknown as Record<string, any>, slug, worktree, taskResolution, log, writeReviewStateFn, enforceTaskAssigneeFn, missionStore
            });
            const reviewSinceMs = stageLaunchSinceMs(reviewerLaunchResult?.result);
            await recordStageStatsSafeFn('review', {
              stage: 'review', slug, rootDir: worktree, worktree, reviewer, implementer,
              result: reviewerLaunchResult?.result,
              sinceMs: reviewSinceMs || 0, log, error, state, writeReviewStateFn,
              model: resolveAgentModel(reviewer!, worktree),
              missionStore,
            });
          }
          const reviewerArtifacts = await consumeReviewerArtifactsFn(slug, reviewer!, {
            worktree,
            tmpDir: artifactDir,
            readTokenFn,
            getCommentsFn: getCommentsFn as any,
            postCommentFn,
            postReviewFn,
            buildMetadataFooterFn: buildMetadataFooter,
            forgejoEnabled,
            verbose,
            currentState: state,
            log,
            error,
            missionStore,
          });
          if (reviewerArtifacts.consumed) {
            if (!reviewerArtifacts.ok) {
              const reviewerDiagnostic = reviewerArtifacts.diagnostic || `Reviewer ${reviewer} produced incomplete or invalid review artifacts`;
              if (isArtifactInfraDiagnostic(reviewerDiagnostic)) {
                error(fmt.status('FAIL', `Reviewer artifact infrastructure failure: ${reviewerDiagnostic}`));
                await escalateToHumanReview('REVIEWER_ARTIFACT_INFRA_FAILURE');
                return;
              }
              // TASK-2377.04: the artifact bounce runs through the rebound
              // kernel. `fixed` requires the re-consumed artifacts to be
              // complete — a relaunch alone is no evidence that the reviewer
              // produced anything.
              if (roundReboundCapReached()) {
                await stopForRoundReboundCap('reviewer artifact');
                return;
              }
              let recoveredReviewerArtifacts = reviewerArtifacts;
              const reviewerDispatch = await dispatchArtifactFailure('reviewer', reviewerDiagnostic, {
                // TASK-2377.04: the per-occurrence budget is clamped to the
                // remaining per-round relaunch cap before the launch.
                maxAttempts: Math.min(ARTIFACT_REBOUND_ATTEMPTS, reboundsRemainingThisRound()),
                slug,
                worktree,
                agent: reviewer!,
                startAgentFn: async (_step, launchOptions) => await (startAgentFn as any)('review', {
                  agent: reviewer,
                  prompt: (actualReviewer: string) => (buildCompactReviewPromptFn as any)({ reviewer: reviewer!, branch, implementer: implementer!, focus, attempt, repoRoot: worktree, missionPath: effectiveMissionPath || undefined, actualReviewer, reviewBaseline })
                    + '\n\n' + String((launchOptions as any).prompt(actualReviewer)),
                  worktree, slug, role: 'reviewer', exclude: [implementer],
                  onLaunch: ({ agent }: { agent: string }) => onAgentLaunched?.(agent, 'review'),
                }),
                applyAgentFallbackFn: async ({ launchResult, original }) => {
                  reviewer = await applyAgentFallbackFn({
                    role: 'reviewer', original, launchResult: launchResult as any,
                    state: state as unknown as Record<string, any>, slug, worktree, taskResolution, log, writeReviewStateFn, enforceTaskAssigneeFn, missionStore
                  });
                  return reviewer!;
                },
                verifyFn: async () => {
                  recoveredReviewerArtifacts = await consumeReviewerArtifactsFn(slug, reviewer!, {
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
                    missionStore,
                  });
                  if (!recoveredReviewerArtifacts.consumed) {
                    return { ok: false, diagnostic: `Reviewer ${reviewer} produced no review artifacts after the relaunch` };
                  }
                  if (!recoveredReviewerArtifacts.ok) {
                    return { ok: false, diagnostic: recoveredReviewerArtifacts.diagnostic || `Reviewer ${reviewer} produced incomplete or invalid review artifacts` };
                  }
                  return { ok: true };
                },
                log, error,
              });
              reboundsUsedThisRound += reviewerDispatch.attempts ?? 0;
              reviewer = reviewerDispatch.agent || reviewer;
              if (reviewerDispatch.action !== 'fixed') {
                if (reviewerDispatch.action === 'human-only') {
                  error(fmt.status('FAIL', `Reviewer artifact recovery requires human intervention for ${slug}.`));
                  await escalateToHumanReview('REVIEWER_ARTIFACT_INFRA_FAILURE');
                  return;
                }
                if (roundReboundCapReached()) {
                  await stopForRoundReboundCap('reviewer artifact');
                  return;
                }
                error(fmt.status('FAIL', `Reviewer artifact recovery exhausted its ${reviewerDispatch.maxAttempts}-attempt budget for ${slug}.`));
                await escalateToHumanReview('REVIEWER_ARTIFACT_RETRY_EXHAUSTED');
                return;
              }
              log(fmt.status('PASS', `Reviewer artifacts re-consumed and complete after ${reviewerDispatch.attempts} attempt(s).`));
              reviewState = recoveredReviewerArtifacts.reviewState;
              // TASK-2477/F1: recovery carries findingSummaries too; restore them
              // so the CHANGES REQUESTED summary is not empty on the recovery path.
              blockingFindings = recoveredReviewerArtifacts.findingSummaries || [];
            } else {
              reviewState = reviewerArtifacts.reviewState;
              blockingFindings = reviewerArtifacts.findingSummaries || [];
            }
          }
          if (!reviewState && forgejoEnabled) {
            reviewState = await pollForReviewFn(prNumber as number, reviewer!, state.startedAt, token!, {
              getLatestReviewForPrFn, sleepFn, intervalMs: pollIntervalMs, timeoutMs: pollTimeoutMs, retryCount: 0, verbose, label: `round ${attempt} review`, log
            });
          }
        }
        if (isPollTimeout(reviewState) || !reviewState) {
          if (!reviewState) {
            const handoff = forgejoEnabled
              ? 'did not submit a formal review outcome'
              : `did not leave a complete local review handoff in ${artifactDir} (${slug}-review-findings.md, ${slug}-review-outcome.md, ${slug}-review-verdict.txt)`;
            log(fmt.status('WARN', `Reviewer ${reviewer} ${handoff} for ${branch}; retrying the reviewer.`));
            reviewState = POLL_TIMEOUT;
          }
          const timeoutRecovery = await rebound({
            kind: 'agent-timeout', role: 'reviewer',
            diagnostic: `No usable review outcome for ${branch} after ${formatElapsed(Date.now() - Date.parse(state.startedAt))}.`,
            expectedOutput: forgejoEnabled ? 'a formal review outcome' : `complete local review artifacts in ${artifactDir}`,
          }, {
            slug, worktree, implementer: reviewer!, step: 'review', role: 'reviewer',
            exclude: [implementer!],
            maxAttempts: Math.min(DEFAULT_REBOUND_ATTEMPTS, reboundsRemainingThisRound()),
            startAgent: async (_step, launchOptions) => await (startAgentFn as any)('review', {
              agent: reviewer,
              prompt: (actualReviewer: string) => (buildCompactReviewPromptFn as any)({ reviewer: reviewer!, branch, implementer: implementer!, focus, attempt, repoRoot: worktree, missionPath: effectiveMissionPath || undefined, actualReviewer, reviewBaseline })
                + '\n\n' + String((launchOptions as any).prompt(actualReviewer)),
              worktree, slug, role: 'reviewer', exclude: [implementer],
              onLaunch: ({ agent }: { agent: string }) => onAgentLaunched?.(agent, 'review'),
            }),
            applyAgentFallback: async ({ launchResult, original }) => {
              reviewer = await applyAgentFallbackFn({
                role: 'reviewer', original, launchResult: launchResult as any,
                state: state as unknown as Record<string, any>, slug, worktree, taskResolution, log,
                writeReviewStateFn, enforceTaskAssigneeFn, missionStore,
              });
              return reviewer!;
            },
            verify: async () => {
              reviewState = null;
              const retryArtifacts = await consumeReviewerArtifactsFn(slug, reviewer!, {
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
              missionStore,
              });
              const retryDiagnostic = retryArtifacts.diagnostic || `Reviewer output still missing for ${branch}`;
              reviewState = retryArtifacts.consumed && retryArtifacts.ok ? retryArtifacts.reviewState : null;
              if (!reviewState && forgejoEnabled) {
                reviewState = await pollForReviewFn(prNumber as number, reviewer!, state.startedAt, token!, { getLatestReviewForPrFn, sleepFn, intervalMs: pollIntervalMs, timeoutMs: pollTimeoutMs, retryCount: 0, verbose, label: `round ${attempt} review recovery`, log });
              }
              return reviewState && !isPollTimeout(reviewState)
                ? { ok: true }
                : { ok: false, diagnostic: retryDiagnostic, reason: { kind: 'artifact-incomplete', role: 'reviewer', diagnostic: retryDiagnostic } };
            }, log, error,
          });
          reboundsUsedThisRound += timeoutRecovery.attempts;
          reviewer = timeoutRecovery.implementer || reviewer;
          if (timeoutRecovery.outcome !== 'fixed') {
            if (roundReboundCapReached()) {
              await stopForRoundReboundCap('reviewer timeout recovery');
              return;
            }
            error(fmt.status('FAIL', timeoutRecovery.dossier || `Reviewer ${reviewer} did not submit a usable formal review outcome after ${timeoutRecovery.attempts} recovery attempt(s).`));
            log('       Human intervention is required to complete or repair the review.');
            await escalateToHumanReview('REVIEWER_NON_APPROVAL');
            return;
          }
        }
      }
      if (dryRun) { return; }
      if (reviewState === 'APPROVED') {
        state.transitionTo('approved');
        state.disposition = reviewState as string;
        try {
          await persistReviewStateOrThrow(writeReviewStateFn, slug, state, worktree, missionStore);
        } catch (err) {
          // The review is recorded as approved but the review → integration
          // boundary failed. Do not promote the Backlog task to approved
          // while the Mission is still in review; px integrate recovers it.
          error(fmt.status('FAIL', `Reviewer approved ${slug} but the review → integration transition failed: ${err instanceof Error ? err.message : String(err)}`));
          error(fmt.status('FAIL', `Recovery: px integrate ${slug}`));
          return;
        }
        renderReviewVerdict(state.disposition, [], log, verbose);
        log(fmt.status('PASS', 'Autonomous review stopped: reviewer approved the PR. Hand off to human review/integration.'));
        await transitionVirtualFn(transitionTaskFn, slug, 'approved', { log });
        return;
      }
      state.transitionTo('fixing');
      state.disposition = reviewState as string;
    } else {
      if (forgejoEnabled) {
        const latestReview = await getLatestReviewForPrFn(prNumber as number, reviewer!, state.startedAt, token!);
        reviewState = latestReview ? (latestReview as Record<string, unknown>).state : null;
        if (!reviewState) {
          log(fmt.status('WARN', `No review found for ${reviewer} since ${state.startedAt}; treating as request-changes and proceeding to fixing phase.`));
          reviewState = 'request-changes';
        }
      } else {
        reviewState = state.disposition || null;
        if (!reviewState) {
          log(fmt.status('WARN', `No local review state found for ${reviewer}; treating as request-changes and proceeding to fixing phase.`));
          reviewState = 'request-changes';
        }
      }
      log(fmt.status('INFO', `Round ${attempt}: resuming in fixing phase with review outcome = ${reviewState}`));
    }
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
    let disposition: unknown;
    let reLaunch: boolean | null;
    let implementerSkippedResume = false;
    let sinceIso = state.startedAt;
    if (isContinue && attempt === state.round) {
      if (forgejoEnabled) {
        log(fmt.status('INFO', `Round ${attempt}: checking for existing disposition by ${implementer} since ${state.startedAt}...`));
        disposition = await pollForDispositionFn(prNumber as number, implementer!, state.startedAt, token!, {
          getLatestDispositionForPrFn, sleepFn, intervalMs: 1000, timeoutMs: CONTINUE_SKIP_CHECK_TIMEOUT_MS, verbose, label: `round ${attempt} skip-check`, log
        });
        if (isPollTimeout(disposition)) {
          disposition = null;
        } else if (isContinue && (disposition === 'BLOCKED' || disposition === 'PARKED')) {
          log(fmt.status('INFO', `Round ${attempt}: implementer disposition found (${disposition}). Re-launching implementer to assess whether blocker is resolved...`));
          reLaunch = true;
          sinceIso = strictlyLaterIso(state.startedAt);
          disposition = null;
        }
      } else {
        // Provider plumbing: verbose-only (see provider-disabled demotion).
        if (verbose) {
          log(fmt.status('INFO', `Round ${attempt}: review provider disabled; using workflow-owned disposition state.`));
        }
        disposition = null;
      }
    }
    if (!disposition) {
      if (dryRun) {
        log(`\n--- DRY-RUN: implementer (${implementer}) act-on-review prompt ---`);
        log((buildActOnReviewPromptFn as any)({ implementer: implementer!, branch, attempt, repoRoot: worktree, missionPath: effectiveMissionPath || undefined, reviewBaseline }));
        if (reLaunch!) {
          log(fmt.status('INFO', `Round ${attempt}: stale BLOCKED/PARKED disposition replaced by fresh implementer action.`));
        }
        return;
      }
      await persistReviewStateOrThrow(writeReviewStateFn, slug, state, worktree, missionStore);
      renderReviewVerdict(state.disposition, blockingFindings, log, verbose);
      await transitionTaskFn(slug, 'active', { implementer, rootDir: worktree, log });
      if (implementer === 'autonomous' && !forgejoEnabled) {
        log(fmt.status('INFO', `Round ${attempt}: implementer identity is autonomous; skipping implementer launch and using local review artifacts only.`));
      } else {
        log(fmt.status('INFO', `Round ${attempt}: launching implementer (${implementer}) for act-on-review...`));
        let implementerLaunchResult: any;
        try {
          implementerLaunchResult = await startAgentFn('act-on-review', {
            agent: implementer,
            prompt: (actualImplementer: string) => (buildCompactActOnReviewPromptFn as any)({ implementer: implementer!, branch, attempt, reviewOutcome: reviewState, repoRoot: worktree, missionPath: effectiveMissionPath || undefined, actualImplementer, reviewBaseline }),
            worktree, slug, role: 'implementer', exclude: [reviewer], onLaunch: ({ agent }: { agent: string }) => onAgentLaunched?.(agent, 'review-response')
          });
        } catch (err: unknown) {
          error(fmt.status('FAIL', `Could not launch implementer agent (${implementer}): ${(err as Error).message}`));
          exit(1); return;
        }
        implementer = await applyAgentFallbackFn({
          role: 'implementer', original: implementer!, launchResult: implementerLaunchResult,
          state: state as unknown as Record<string, any>, slug, worktree, taskResolution, log, writeReviewStateFn, enforceTaskAssigneeFn, missionStore
        });
        const followUpSinceMs = stageLaunchSinceMs(implementerLaunchResult?.result);
        await recordStageStatsSafeFn('active', {
          stage: 'follow-up', slug, rootDir: worktree, worktree, implementer, reviewer,
          result: implementerLaunchResult?.result,
          sinceMs: followUpSinceMs || 0, log, error, state, writeReviewStateFn,
          model: resolveAgentModel(implementer!, worktree),
          missionStore,
        });
      }
      const implementerArtifacts = await consumeImplementerArtifactsFn(slug, implementer!, {
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
      if (implementerArtifacts.consumed) {
        if (!implementerArtifacts.ok) {
          const implDiagnostic = implementerArtifacts.diagnostic || `Implementer ${implementer} produced incomplete or invalid artifacts`;
          if (isArtifactInfraDiagnostic(implDiagnostic)) {
            error(fmt.status('FAIL', `Implementer artifact infrastructure failure: ${implDiagnostic}`));
            await escalateToHumanReview('IMPLEMENTER_ARTIFACT_INFRA_FAILURE');
            return;
          }
          // TASK-2377.04: one rebound-kernel occurrence replaces the inline
          // relaunch-and-re-consume ladder. `fixed` requires the re-consumed
          // implementer artifacts to be complete; the per-occurrence budget
          // is in-memory and starts fresh at every occurrence.
          if (roundReboundCapReached()) {
            await stopForRoundReboundCap('implementer artifact');
            return;
          }
          let recoveredImplementerArtifacts = implementerArtifacts;
          const implDispatch = await dispatchArtifactFailure('implementer', implDiagnostic, {
            // TASK-2377.04: the per-occurrence budget is clamped to the
            // remaining per-round relaunch cap before the launch.
            maxAttempts: Math.min(ARTIFACT_REBOUND_ATTEMPTS, reboundsRemainingThisRound()),
            slug,
            worktree,
            agent: implementer!,
            startAgentFn: async (_step, launchOptions) => await (startAgentFn as any)('act-on-review', {
              agent: implementer,
              prompt: (actualImplementer: string) => (buildCompactActOnReviewPromptFn as any)({ implementer: implementer!, branch, attempt, reviewOutcome: reviewState, repoRoot: worktree, missionPath: effectiveMissionPath || undefined, actualImplementer, reviewBaseline })
                + '\n\n' + String((launchOptions as any).prompt(actualImplementer)),
              worktree, slug, role: 'implementer', exclude: [reviewer],
              onLaunch: ({ agent }: { agent: string }) => onAgentLaunched?.(agent, 'review-response'),
            }),
            applyAgentFallbackFn: async ({ launchResult, original }) => {
              implementer = await applyAgentFallbackFn({
                role: 'implementer', original, launchResult: launchResult as any,
                state: state as unknown as Record<string, any>, slug, worktree, taskResolution, log, writeReviewStateFn, enforceTaskAssigneeFn, missionStore
              });
              return implementer!;
            },
            verifyFn: async () => {
              recoveredImplementerArtifacts = await consumeImplementerArtifactsFn(slug, implementer!, {
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
                return { ok: false, diagnostic: `Implementer ${implementer} produced no round artifacts after the relaunch` };
              }
              if (!recoveredImplementerArtifacts.ok) {
                return { ok: false, diagnostic: recoveredImplementerArtifacts.diagnostic || `Implementer ${implementer} still produced incomplete artifacts after the relaunch` };
              }
              return { ok: true };
            },
            log, error,
          });
          reboundsUsedThisRound += implDispatch.attempts ?? 0;
          implementer = implDispatch.agent || implementer;
          if (implDispatch.action !== 'fixed') {
            const infraAfterBounce = isArtifactInfraDiagnostic(implDispatch.diagnostic);
            const infra = implDispatch.action === 'human-only' || infraAfterBounce;
            if (infra) {
              error(fmt.status('FAIL', `Implementer artifact recovery requires human intervention for ${slug}.`));
              await escalateToHumanReview('IMPLEMENTER_ARTIFACT_INFRA_FAILURE');
              return;
            }
            if (roundReboundCapReached()) {
              await stopForRoundReboundCap('implementer artifact');
              return;
            }
            error(fmt.status('FAIL', `Implementer artifact recovery exhausted its ${implDispatch.maxAttempts}-attempt budget for ${slug}.`));
            await escalateToHumanReview('IMPLEMENTER_ARTIFACT_RETRY_EXHAUSTED');
            return;
          }
          log(fmt.status('PASS', `Implementer artifacts re-consumed and complete after ${implDispatch.attempts} attempt(s).`));
          disposition = recoveredImplementerArtifacts.disposition;
        } else {
          disposition = implementerArtifacts.disposition;
        }
      }
      if (!disposition && forgejoEnabled) {
        disposition = await pollForDispositionFn(prNumber as number, implementer!, sinceIso, token!, {
          getLatestDispositionForPrFn, sleepFn, intervalMs: pollIntervalMs, timeoutMs: pollTimeoutMs, retryCount: 0, verbose, label: `round ${attempt} disposition`, log
        });
      }
      if (isPollTimeout(disposition)) {
        const timeoutRecovery = await rebound({
          kind: 'agent-timeout', role: 'implementer',
          diagnostic: `No implementer disposition for ${branch} after ${formatElapsed(Date.now() - Date.parse(state.startedAt))}.`,
          expectedOutput: 'a disposition: PUSHBACK_ALL, BLOCKED, PARKED, or a completed fix response',
        }, {
          slug, worktree, implementer: implementer!, step: 'act-on-review', role: 'implementer',
          exclude: [reviewer!],
          maxAttempts: Math.min(DEFAULT_REBOUND_ATTEMPTS, reboundsRemainingThisRound()),
          startAgent: async (_step, launchOptions) => await (startAgentFn as any)('act-on-review', {
            agent: implementer,
            prompt: (actualImplementer: string) => (buildCompactActOnReviewPromptFn as any)({ implementer: implementer!, branch, attempt, reviewOutcome: reviewState, repoRoot: worktree, missionPath: effectiveMissionPath || undefined, actualImplementer, reviewBaseline })
              + '\n\n' + String((launchOptions as any).prompt(actualImplementer)),
            worktree, slug, role: 'implementer', exclude: [reviewer],
            onLaunch: ({ agent }: { agent: string }) => onAgentLaunched?.(agent, 'review-response'),
          }),
          applyAgentFallback: async ({ launchResult, original }) => {
            implementer = await applyAgentFallbackFn({
              role: 'implementer', original, launchResult: launchResult as any,
              state: state as unknown as Record<string, any>, slug, worktree, taskResolution, log,
              writeReviewStateFn, enforceTaskAssigneeFn, missionStore,
            });
            return implementer!;
          },
          verify: async () => {
            const retryArtifacts = await consumeImplementerArtifactsFn(slug, implementer!, {
              worktree, tmpDir: artifactDir, readTokenFn, getCommentsFn: getCommentsFn as any,
              postCommentFn, buildMetadataFooterFn: buildMetadataFooter, forgejoEnabled, log, error,
            });
            const retryArtifactDiagnostic = retryArtifacts.diagnostic || `Implementer disposition still missing for ${branch}`;
            const retryDiagnostic = isArtifactInfraDiagnostic(retryArtifactDiagnostic)
              ? `Recovery infrastructure failure: ${retryArtifactDiagnostic}`
              : retryArtifactDiagnostic;
            disposition = retryArtifacts.consumed && retryArtifacts.ok ? retryArtifacts.disposition : null;
            if (!disposition && forgejoEnabled) {
              disposition = await pollForDispositionFn(prNumber as number, implementer!, sinceIso, token!, { getLatestDispositionForPrFn, sleepFn, intervalMs: pollIntervalMs, timeoutMs: pollTimeoutMs, retryCount: 0, verbose, label: `round ${attempt} disposition recovery`, log });
            }
            return disposition && !isPollTimeout(disposition)
              ? { ok: true }
              : { ok: false, diagnostic: retryDiagnostic, reason: { kind: 'artifact-incomplete', role: 'implementer', diagnostic: retryDiagnostic } };
          }, log, error,
        });
        reboundsUsedThisRound += timeoutRecovery.attempts;
        implementer = timeoutRecovery.implementer || implementer;
        if (timeoutRecovery.outcome !== 'fixed') {
          if (isArtifactInfraDiagnostic(timeoutRecovery.diagnostic)) {
            error(fmt.status('FAIL', `Implementer artifact infrastructure failure during timeout recovery: ${timeoutRecovery.diagnostic}`));
            await escalateToHumanReview('IMPLEMENTER_ARTIFACT_INFRA_FAILURE');
            return;
          }
          if (roundReboundCapReached()) {
            await stopForRoundReboundCap('implementer timeout recovery');
            return;
          }
          await persistReviewStateOrThrow(writeReviewStateFn, slug, state, worktree, missionStore);
          error(fmt.status('FAIL', timeoutRecovery.dossier || `Implementer timeout recovery exhausted for ${branch}.`));
          await escalateToHumanReview('IMPLEMENTER_TIMEOUT_EXHAUSTED');
          return;
        }
      } else if (!disposition) {
        error(fmt.status('FAIL', `Implementer ${implementer} did not post an autonomous review disposition comment.`));
        exit(1); return;
      }
      reLaunch = null;
    } else if (reLaunch!) {
    } else if (disposition) {
      log(fmt.status('INFO', `Round ${attempt}: implementer disposition found (${disposition}). Skipping implementer launch.`));
      implementerSkippedResume = true;
    }
    if (!disposition) {
      error(fmt.status('FAIL', `Implementer ${implementer} did not post an autonomous review disposition comment.`));
      exit(1); return;
    }
    if (isPollTimeout(disposition)) {
      await persistReviewStateOrThrow(writeReviewStateFn, slug, state, worktree, missionStore);
      log(fmt.status('INFO', `Autonomous review stopped: excessive implementer timeout retries`));
      return;
    }
    log(fmt.status('INFO', `Round ${attempt}: implementer disposition = ${disposition}`));
    if (disposition === 'PUSHBACK_ALL') {
      state.disposition = disposition as string;
      try { state.transitionTo('reviewing'); } catch (_) { /* ignore */ }
      await persistReviewStateOrThrow(writeReviewStateFn, slug, state, worktree, missionStore);
      log(fmt.status('INFO', `Round ${attempt}: implementer responded to all findings. Continuing to reviewer re-review round ${attempt + 1}.`));
      continue;
    }
    if (disposition === 'BLOCKED' || disposition === 'PARKED') {
      state.disposition = disposition as string;
      await persistReviewStateOrThrow(writeReviewStateFn, slug, state, worktree, missionStore);
      await onAutonomousStop?.(`implementer reported ${disposition}`);
      log(fmt.status('INFO', `Autonomous review stopped: implementer reported ${disposition}. Hand off to human review.`));
      return;
    }
    state.disposition = disposition as string;
    try { state.transitionTo('reviewing'); } catch (_) { /* ignore */ }
    const hasCommittedChange = hasNewCommittedChangeFn
      ? hasNewCommittedChangeFn(branch, worktree)
      : (() => {
          if (implementerSkippedResume) { return true; }
          const postFixHeadSha = readBranchHeadSha();
          if (preFixHeadSha === null || postFixHeadSha === null) { return true; }
          return postFixHeadSha !== preFixHeadSha;
        })();
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
    log(fmt.status('INFO', `Round ${attempt}: implementer made changes. Continuing to round ${attempt + 1}.`));
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
  getHandoff,
  maybeUpdateGraphifyBeforeReview,
} from './review-agent-fallback.js';
