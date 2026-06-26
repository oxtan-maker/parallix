/**
 * Review Loop Module
 * Extracted from parallix/lib/review.js for task-1201
 * Handles autonomous review loop orchestration.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const fmt = require('../core/fmt');
const { git, run } = require('../core/git');
const { findMissionDir, resolveWorktree, missionBranchName } = require('../core/mission-utils');
const { resolveTaskFile, getTaskImplementer, getTaskStatus, enforceTaskAssignee, transitionTask, reportTaskResolution } = require('../tools/backlog');
const { toVirtual, transitionVirtual } = require('../core/state-map');
const { getPrStatus, readToken, getLatestReviewForPr, getLatestDispositionForPr, providerAvailable, getComments, postComment, postReview, closePr, resolveReviewUser, isProviderEnabled } = require('./review-adapter');
const { buildAutonomousReviewMatrix, formatMatrixSummary } = require('../core/runtime-matrix');
const { buildReviewPrompt, buildActOnReviewPrompt, buildCompactReviewPrompt, buildCompactActOnReviewPrompt } = require('./review-prompts');
const { ReviewState, readReviewState, writeReviewState, resetReviewState, VALID_PHASES } = require('./review-state');
const { createEvent, consumeHumanNotes, VALID_EVENT_TYPES } = require('./review-events');
const { workflowLauncherStatus, startAgent, eligibleAgentsForStep, selectAgent } = require('../agents/agents');
const { performHandoff } = require('../commands/handoff');
const { commitSafeMissionArtifacts, rebaseBeforeReviewRound } = require('./rebase');
const { resolveAgentModel } = require('../core/product-config');

// Import from review-polling module
const { POLL_TIMEOUT, delay, resolvePollIntervalMs, resolvePollTimeoutMs, formatElapsed, isPollTimeout, pollForReview, pollForDisposition } = require('./review-polling');
// Import from review-artifacts module
const { buildMetadataFooter, reviewArtifactPath, resolveArtifactDir, readArtifactFile, deleteArtifactFile, normalizeReviewVerdict, normalizeDisposition, postWorkflowComment, postWorkflowReview, consumeReviewerArtifacts, consumeImplementerArtifacts } = require('./review-artifacts');
const stats = require('../commands/stats');
const { resolveStageTelemetry } = require('../agents/stage-telemetry');

// Stage telemetry recording is best-effort: a failure must never break the
// review loop. Token columns are populated only for the codex role (the C2 rule
// guarantees at most one of implementer/reviewer is codex); other families
// record honest zeros (task-1251).
//
// Codex writes a fresh-counter rollout per launch, so we sum total_token_usage
// across every rollout since the FIRST launch for this stored mission phase and
// agent family. For non-Codex families we accumulate launcher-attached telemetry
// one launch at a time, de-duped via review-state metadata, so Claude/custom rows
// are cumulative too. A family switch creates a separate row instead of mixing
// agents in one record.
function stageLaunchFingerprint(agentFamily, result) {
  return [
    String(agentFamily || '').trim().toLowerCase(),
    result && result.sessionId ? String(result.sessionId) : '',
    result && result.startedAt ? String(result.startedAt) : '',
    result && result.endedAt ? String(result.endedAt) : '',
    result && result.status !== undefined && result.status !== null ? String(result.status) : '',
  ].join('|');
}

function markStageLaunchRecorded(state, { stage, agentFamily, result, slug, worktree, writeReviewStateFn = writeReviewState } = {}) {
  if (!state || !agentFamily) return true;
  const key = stageWindowKey(stage, agentFamily);
  const fingerprint = stageLaunchFingerprint(agentFamily, result);
  const recordedStageLaunches = state.metadata && typeof state.metadata === 'object'
    ? (state.metadata.recordedStageLaunches || {})
    : {};
  const recorded = Array.isArray(recordedStageLaunches[key]) ? recordedStageLaunches[key] : [];
  if (recorded.includes(fingerprint)) {
    return false;
  }
  if (!state.metadata || typeof state.metadata !== 'object') {
    state.metadata = {};
  }
  state.metadata.recordedStageLaunches = {
    ...(state.metadata.recordedStageLaunches || {}),
    [key]: [...recorded, fingerprint].slice(-20),
  };
  writeReviewStateFn(slug, state, worktree);
  return true;
}

function recordStageStatsSafe(kind, { stage, slug, rootDir, worktree, implementer, reviewer, result, sinceMs, log, error, state, writeReviewStateFn = writeReviewState, model = null }) {
  let durationMinutes = 0;
  if (result && result.startedAt && result.endedAt) {
    durationMinutes = (Date.parse(result.endedAt) - Date.parse(result.startedAt)) / 60000;
  }
  // Shared with the execute hook (commands/active.js) via stage-telemetry.js:
  // prefer the windowed Codex rollout, else the launcher-attached telemetry so
  // Claude active/review stages record real tokens instead of all-zeros
  // (task-1274), bounded to this stage by sinceMs (task-1285 F6).
  const telemetry = resolveStageTelemetry({ worktree, result, sinceMs });
  try {
    const actorFamily = kind === 'review' ? reviewer : implementer;
    if (state && !markStageLaunchRecorded(state, {
      stage,
      agentFamily: actorFamily,
      result,
      slug,
      worktree,
      writeReviewStateFn
    })) {
      return;
    }
    stats.accumulateStageStats({ stage, slug, rootDir, implementer, reviewer, telemetry, durationMinutes, model });
  } catch (err) {
    // Best-effort: never escalate to the fatal `error` channel.
    log(fmt.status('WARN', `Could not record ${kind} stats for ${slug}: ${err.message}`));
  }
}

const DEFAULT_MAX_ATTEMPTS = 5;
const CONTINUE_SKIP_CHECK_TIMEOUT_MS = 10_000;

function strictlyLaterIso(earlierIso, nowMs = Date.now()) {
  const earlierMs = Date.parse(earlierIso);
  if (!Number.isFinite(earlierMs)) {
    return new Date(nowMs).toISOString();
  }
  return new Date(Math.max(nowMs, earlierMs + 1)).toISOString();
}

// ============================================================================
// Pre-review Setup Functions
// ============================================================================

function maybeUpdateGraphifyBeforeReview(rootDir, { commandRunner = run, log = fmt.log.plain } = {}) {
  const updateGraphifyKnowledgeGraph = require('../core/mission-utils').updateGraphifyKnowledgeGraph;
  return updateGraphifyKnowledgeGraph({
    rootDir,
    commandRunner,
    log,
    startMessage: 'Updating graphify knowledge graph...',
    failureHint: 'Continuing without blocking review start.'
  });
}


// ============================================================================
// Agent Fallback Handling
// ============================================================================

// If startAgent fell back to a different family after a limit hit, the comments
// that gate the loop (review outcome / disposition) will be authored by the
// fallback identity selected by the launcher.
// This helper detects the fallback, persists the new identity to review state
// and the Backlog assignee, and returns the identity that should be polled for.
function applyAgentFallback({
  role,
  original,
  launchResult,
  state,
  slug,
  worktree,
  taskResolution,
  log = fmt.log.plain,
  writeReviewStateFn = writeReviewState,
  enforceTaskAssigneeFn = enforceTaskAssignee
} = {}) {
  if (!launchResult || !launchResult.agent || launchResult.agent === original) {
    return original;
  }
  const fallback = launchResult.agent;
  log(fmt.status('INFO', `${role} fell back from ${original} to ${fallback}; updating identity before polling.`));
  if (role === 'reviewer') {
    state.reviewer = fallback;
  } else {
    state.implementer = fallback;
  }
  writeReviewStateFn(slug, state, worktree);
  if (role === 'implementer' && taskResolution && taskResolution.ok) {
    if (!enforceTaskAssigneeFn(taskResolution.taskFile, fallback)) {
      log(fmt.status('WARN', `Could not enforce fallback implementer ${fallback} in backlog task.`));
    }
  }
  return fallback;
}

function persistNormalizedPhaseRepair(slug, state, worktree, { log = fmt.log.plain, writeReviewStateFn = writeReviewState } = {}) {
  if (!state || !state.phaseOriginal || VALID_PHASES.includes(state.phaseOriginal)) {
    return;
  }
  log(fmt.status('WARN', `Persisted review phase "${state.phaseOriginal}" is invalid. Repairing to "${state.phase}".`));
  writeReviewStateFn(slug, state, worktree);
  state.phaseOriginal = null;
}

function stageWindowKey(stage, agentFamily) {
  const normalizedStage = String(stage || 'default').trim().toLowerCase() || 'default';
  const normalizedAgent = String(agentFamily || '').trim().toLowerCase();
  return `${normalizedStage}:${normalizedAgent}`;
}

// Window the Codex telemetry read to the CURRENT launch's start so each round
// contributes only its own rollouts. Earlier rounds' rollouts have an mtime
// strictly before this launch's startedAt and are excluded, so the per-round
// deltas accumulate (via accumulateStageStats) to the family's true total
// instead of re-summing a cumulative-since-first-launch window every round.
// Resume-idempotency is provided separately by the launch fingerprint in
// markStageLaunchRecorded, so the window itself does not need to persist.
function stageLaunchSinceMs(result) {
  const startedAt = result && result.startedAt ? String(result.startedAt) : '';
  const startedMs = startedAt ? Date.parse(startedAt) : NaN;
  return Number.isFinite(startedMs) ? startedMs : 0;
}

// ============================================================================
// Main Review Loop
// ============================================================================

async function startReviewLoop(slug, opts = {}) {
  let {
    implementer,
    reviewer,
    focus = 'all',
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    dryRun = false,
    reset = false,
    continue: continueFlag = false,
    isContinue = false,
    verbose = false,
    pollTimeoutSeconds = null,
    worktree: callerWorktree,
    missionPath,
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
    performHandoffFn = performHandoff,
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
    recordStageStatsSafeFn = () => {}
  } = opts;
  let prNumber = null;
  isContinue = Boolean(isContinue || continueFlag);

  const pollIntervalMs = resolvePollIntervalMs();
  const pollTimeoutMs = resolvePollTimeoutMs(pollTimeoutSeconds);

  const worktree = callerWorktree || resolveWorktree(slug) || process.cwd();
  const resolvedProviderAvailableFn = providerAvailableFn || forgejoAvailableFn || providerAvailable;
  const resolvedReviewUserFn = resolveReviewUserFn || resolveForgejoUserFn || resolveReviewUser;
  const branch = missionBranchName(slug, worktree);
  // Resolve the artifact directory once so reviewer/implementer artifact reads
  // and writes use the adapter-configured location instead of os.tmpdir().
  const artifactDir = resolveArtifactDir(worktree);

  // `--mission <path>` override (task-1272 SC7): when the caller points the
  // review loop at a mission contract in a non-standard location, resolve the
  // mission directory via the override and thread the contract file path into
  // the reviewer/implementer prompts so launched agents read it (not the
  // slug-derived default). Absent the flag, `effectiveMissionPath` stays
  // undefined and the prompts fall back to the standard slug-derived path.
  const missionDir = findMissionDir(slug, worktree, { missionPath });
  let effectiveMissionPath;
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
    maybeUpdateGraphifyBeforeReviewFn(worktree, { commandRunner: runFn, log });
  }

  // --reset: clear persisted state before starting
  if (reset) {
    if (resetReviewStateFn(slug, worktree)) {
      log(fmt.status('INFO', `Review state reset for ${slug}.`));
    }
  }

  const agents = eligibleAgentsForStepFn('review');

  const persisted = readReviewStateFn(slug, worktree);

  if (!implementer) {
    // Try to resume from persisted state
    if (persisted) {
      implementer = persisted.implementer;
      log(fmt.status('INFO', `Resuming persisted implementer: ${implementer}`));
    } else {
      // Try to resolve from backlog task
      if (taskResolution.ok) {
        implementer = getTaskImplementerFn(taskResolution.taskFile);
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
    reportTaskResolution(taskResolution, slug, error);
    exit(1);
    return;
  }

  // Validate remote review state only when a review provider is enabled.
  const forgejoEnabledFn = isReviewProviderEnabledFn
    || legacyIsForgejoReviewEnabledFn
    || isForgejoReviewEnabledFn
    || isProviderEnabled;
  const forgejoEnabled = forgejoEnabledFn(worktree);
  if (!dryRun && forgejoEnabled) {
    const forgejoUrl = process.env.FORGEJO_URL || 'http://localhost:3300';
    const bootstrapScript = path.resolve(__dirname, '../../scripts/bootstrap.sh');
    log(fmt.status('INFO', `Checking review-provider availability at ${forgejoUrl}...`));
    if (!await resolvedProviderAvailableFn(forgejoUrl)) {
      error(fmt.status('FAIL', `Review provider not reachable at ${forgejoUrl}`));
      error('       Attempting to bootstrap provider containers...');
      const bootstrapResult = runFn('bash', [bootstrapScript], { stdio: 'inherit' });
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
    const pr = getPrStatusFn(branch, worktree);
    if (!pr.exists || pr.state !== 'open') {
      // Check task status to detect pre-review (implementation) phase
      const taskStatus = taskResolution.ok ? getTaskStatusFn(taskResolution.taskFile) : null;
      const virtualStatus = taskStatus ? toVirtualFn(taskStatus) : null;

      // Implementation phase states: 'active' or any virtual state mapping to it
      const isImplementationPhase = taskStatus === 'active' || virtualStatus === 'active';

      if (isImplementationPhase) {
        // Task is still in implementation phase - provide guidance, don't hard-fail
        log(fmt.status('INFO', `PR not found for ${branch}. Task is in ${taskStatus} — create the PR first: px review ${slug} --push`));
        return;
      }

      // Task is in a post-implementation state (review/approved/ready-for-integration)
      // or the status is ambiguous, yet no open PR exists. Rather than dead-ending
      // with manual guidance, self-heal: run the canonical handoff (push branch +
      // create PR, reliable since task-1317), re-check, and continue the loop once a
      // PR exists. Only fall back to guidance when self-heal cannot yield an open PR.
      // Emits `--push` (the command self-heal attempts and the correct manual
      // equivalent) — never the old, frequently-wrong `--submit`.
      const fallbackGuidance = (reason) => {
        error(fmt.status('FAIL', `No open review PR found for ${branch}. Create the PR before starting the review loop.`));
        if (reason) error(`       Handoff failure: ${reason}`);
        error(`       Run: px review ${slug} --push`);
      };

      if (dryRun) {
        // Dry-run never self-heals (no agents/side effects); emit guidance and exit.
        fallbackGuidance(null);
        exit(1);
        return;
      }

      log(fmt.status('INFO', `No open review PR for ${branch} (task in ${taskStatus}) — attempting automatic handoff (px review ${slug} --push)...`));
      const handoff = await performHandoffFn(slug, { forgejoUser: implementer, worktree });

      if (handoff && handoff.gatekeeperPushedBack) {
        // Mandatory artifacts are missing: don't spin the loop. The gatekeeper
        // kept the task in its current state; surface that and stop.
        error(fmt.status('FAIL', `Handoff blocked for ${branch}: mandatory mission artifacts are missing. Task stays in ${taskStatus}; supply the required artifacts and retry.`));
        exit(1);
        return;
      }

      if (!handoff || !handoff.ok) {
        fallbackGuidance(handoff && handoff.error ? handoff.error : null);
        exit(1);
        return;
      }

      // Handoff succeeded — re-check whether an open PR now exists.
      const healedPr = getPrStatusFn(branch, worktree);
      if (!healedPr.exists || healedPr.state !== 'open') {
        fallbackGuidance(null);
        exit(1);
        return;
      }

      log(fmt.status('INFO', `Self-heal succeeded: review PR #${healedPr.number} confirmed open for ${branch}. Continuing review loop.`));
      prNumber = healedPr.number;
      // Fall through into the normal loop with the recovered PR number.
    } else {
      log(fmt.status('INFO', `Review PR #${pr.number} confirmed open for ${branch}.`));
      prNumber = pr.number;
    }
  } else if (!dryRun && !forgejoEnabled) {
    log(fmt.status('INFO', 'Forgejo validation skipped (review provider is not forgejo). Using workflow-owned review surfaces.'));
  }

  // Note: The implementer may not be in the agents list (eligible for review step)
  // if its launcher is unavailable. This is OK - we'll use fallback logic for the reviewer.
  // The strict implementer eligibility check was removed to allow fallback reviewer selection (SC 4).

  // Resolve reviewer after the no-PR/self-heal gate so implementation-phase
  // guidance does not depend on workstation launcher availability.
  let reviewerSource = 'explicit';
  let selectErr = null;
  if (!reviewer) {
    if (persisted && persisted.reviewer) {
      reviewer = persisted.reviewer;
      reviewerSource = 'persisted';
      log(fmt.status('INFO', `Resuming persisted reviewer: ${reviewer} (round ${persisted.round})`));
    } else {
      try {
        reviewer = selectAgentFn('review', { exclude: new Set([implementer]) });
      } catch (err) {
        selectErr = err;
        reviewer = null;
      }
      reviewerSource = 'auto-derived';
    }
  }

  if (!reviewer) {
    const anyDifferentFamilyRunnable = agents.some(a => a !== implementer && workflowLauncherStatusFn(a).supported);
    const implementerRunnable = agents.includes(implementer) && workflowLauncherStatusFn(implementer).supported;
    if (!anyDifferentFamilyRunnable && implementerRunnable) {
      log(fmt.status('WARN', `No supported different-family reviewer found for implementer "${implementer}".`));
      log(fmt.status('WARN', `Single-family fallback: reviewer="${implementer}" (same as implementer) — no different-family agent is runnable or unblocked on this workstation.`));
      reviewer = implementer;
      reviewerSource = 'single-family-fallback';
    } else if (!anyDifferentFamilyRunnable) {
      if (!forgejoEnabled) {
        const detail = selectErr ? `: ${selectErr.message}` : '';
        reviewer = 'autonomous';
        reviewerSource = 'fallback';
        log(fmt.status('WARN', `No reviewer could be auto-derived${detail}; defaulting to "autonomous"`));
        // Provider=none mode can complete the loop with workflow-owned artifacts only.
        // Do not hard-fail just because no local reviewer launcher is runnable.
        log(fmt.status('INFO', 'Review provider disabled and no runnable reviewer route available; using autonomous workflow-owned review surfaces.'));
      } else {
        const reason = selectErr ? `: ${selectErr.message}` : '';
        error(fmt.status('FAIL', `No reviewer could be auto-derived${reason}.`));
        error('\n' + fmt.status('INFO', 'Full runtime matrix:'));
        formatMatrixSummaryFn(buildAutonomousReviewMatrixFn()).forEach(line => error(`  ${line}`));
        error('\n' + fmt.status('FAIL', `No runnable reviewer route for implementer "${implementer}".`));
        exit(1);
        return;
      }
    } else {
      const detail = selectErr ? `: ${selectErr.message}` : '';
      reviewer = 'autonomous';
      reviewerSource = 'fallback';
      log(fmt.status('WARN', `No reviewer could be auto-derived${detail}; defaulting to "autonomous"`));
    }
  }

  const willLaunchRounds = maxAttempts >= ((persisted && persisted.round) || 1);
  const resumesInFixingPhase = persisted && persisted.phase === 'fixing' && !dryRun;

  // Dry-run validates the reviewer identity but only explicit reviewers bypass
  // launcher support checks; auto-derived/persisted reviewers still exercise
  // fallback routing so dry-run logs reflect the real selection path.
  if (reviewerSource === 'fallback') {
    log(fmt.status('INFO', `Reviewer identity defaulted to autonomous; skipping launcher availability check.`));
  } else if (resumesInFixingPhase) {
    log(fmt.status('INFO', `Resuming in fixing phase with reviewer "${reviewer}"; skipping launcher availability check until a new review launch is needed.`));
  } else if (dryRun && reviewerSource === 'explicit') {
    const reviewerStatus = workflowLauncherStatusFn(reviewer);
    const hasInjectedLauncherStatus = workflowLauncherStatusFn !== workflowLauncherStatus;
    if (!agents.includes(reviewer) || (hasInjectedLauncherStatus && !reviewerStatus.supported)) {
      const reason = !agents.includes(reviewer) ? 'blocked or unsupported' : 'launcher is not available';
      error(fmt.status('FAIL', `Unsupported reviewer: "${reviewer}" (${reason}).`));
      if (reason === 'launcher is not available' && reviewerStatus.detail) {
        error(`       Looked for: ${reviewerStatus.detail}`);
      }
      error('\n' + fmt.status('INFO', 'Full runtime matrix:'));
      formatMatrixSummaryFn(buildAutonomousReviewMatrixFn()).forEach(line => error(`  ${line}`));
      error('\n' + fmt.status('FAIL', `No runnable reviewer route for implementer "${implementer}".`));
      exit(1);
      return;
    }
  } else if (!willLaunchRounds) {
    if (!agents.includes(reviewer)) {
      error(fmt.status('FAIL', `Unsupported reviewer: "${reviewer}" (blocked or unsupported).`));
      error('\n' + fmt.status('INFO', 'Full runtime matrix:'));
      formatMatrixSummaryFn(buildAutonomousReviewMatrixFn()).forEach(line => error(`  ${line}`));
      error('\n' + fmt.status('FAIL', `No runnable reviewer route for implementer "${implementer}".`));
      exit(1);
      return;
    }
  } else {
    let reviewerStatus = workflowLauncherStatusFn(reviewer);
    const triedReviewers = new Set();
    while (!agents.includes(reviewer) || !reviewerStatus.supported) {
      triedReviewers.add(reviewer);
      if (reviewerSource === 'explicit') {
        const reason = !agents.includes(reviewer) ? 'blocked or unsupported' : 'launcher is not available';
        error(fmt.status('FAIL', `Unsupported reviewer: "${reviewer}" (${reason}).`));
        if (reviewerStatus.detail) error(`       Looked for: ${reviewerStatus.detail}`);
        error('\n' + fmt.status('INFO', 'Full runtime matrix:'));
        formatMatrixSummaryFn(buildAutonomousReviewMatrixFn()).forEach(line => error(`  ${line}`));
        error('\n' + fmt.status('FAIL', `No runnable reviewer route for implementer "${implementer}".`));
        exit(1);
        return;
      }

      const excludeSet = new Set([...triedReviewers, implementer]);
      let fallback;
      let fallbackStatus;
      try {
        fallback = selectAgentFn('review', { exclude: excludeSet });
        if (excludeSet.has(fallback)) {
          fallback = null;
          fallbackStatus = null;
        } else {
          fallbackStatus = workflowLauncherStatusFn(fallback);
        }
      } catch (err) {
        fallback = null;
        fallbackStatus = null;
      }

      if (!fallback) {
        const anyDifferentFamilyRunnable = agents.some(a => a !== implementer && workflowLauncherStatusFn(a).supported);
        const implementerRunnable = agents.includes(implementer) && workflowLauncherStatusFn(implementer).supported;
        if (!anyDifferentFamilyRunnable && implementerRunnable) {
          log(fmt.status('WARN', `No supported different-family reviewer found for implementer "${implementer}".`));
          log(fmt.status('WARN', `Single-family fallback: reviewer="${implementer}" (same as implementer) — no different-family agent is runnable or unblocked on this workstation.`));
          reviewer = implementer;
          reviewerSource = 'single-family-fallback';
          break;
        }
        if (dryRun && implementer === 'autonomous') {
          reviewer = 'autonomous';
          reviewerSource = 'fallback';
          log(fmt.status('WARN', `No runnable reviewer launcher available in dry-run; defaulting reviewer identity to "autonomous".`));
          break;
        }
        const reason = !agents.includes(reviewer) ? 'blocked or unsupported' : 'launcher is not available';
        error(fmt.status('FAIL', `Unsupported reviewer: "${reviewer}" (${reason}) and no unblocked different-family fallback is available.`));
        if (reviewerStatus.detail) error(`       Looked for: ${reviewerStatus.detail}`);
        error('\n' + fmt.status('INFO', 'Full runtime matrix:'));
        formatMatrixSummaryFn(buildAutonomousReviewMatrixFn()).forEach(line => error(`  ${line}`));
        error('\n' + fmt.status('FAIL', `No runnable reviewer route for implementer "${implementer}".`));
        exit(1);
        return;
      }

      const reason = !agents.includes(reviewer) ? 'blocked or unsupported' : 'launcher is not available';
      log(fmt.status('WARN', `Unsupported reviewer: "${reviewer}" (${reason}); trying fallback "${fallback}".`));
      reviewer = fallback;
      reviewerStatus = fallbackStatus;
      reviewerSource = reviewerSource === 'persisted' ? 'persisted-fallback' : 'auto-derived-fallback';
    }
  }

  log(fmt.status('INFO', `Selected reviewer: ${reviewer} (${reviewerSource})`));

  // Build the canonical ReviewState instance. When persisted state exists we
  // resume from it — preserving round, startedAt, phase, disposition, retry
  // counts, and metadata — and only overwrite the identities with the ones
  // selected for this launch (which may differ after a reviewer/implementer
  // fallback). Constructing fresh would silently reset all persisted progress.
  let state;
  if (persisted) {
    state = ReviewState.from(slug, persisted);
    state.reviewer = reviewer;
    state.implementer = implementer;
  } else {
    state = new ReviewState(slug, { reviewer, implementer });
  }
  persistNormalizedPhaseRepair(slug, state, worktree, { log, writeReviewStateFn });

  if (persisted && state.round > 1 && !dryRun) {
    log(fmt.status('INFO', `Resuming review loop from round ${state.round} (${state.phase}).`));
  }

  log(fmt.status('INFO', `Starting autonomous review loop for mission: ${slug}`));
  log(fmt.status('INFO', `Branch: ${branch}`));
  log(fmt.status('INFO', `Implementer: ${implementer} | Reviewer: ${reviewer} (${reviewerSource})`));
  log(fmt.status('INFO', `Focus: ${focus} | Max attempts: ${maxAttempts}`));
  log(fmt.status('INFO', `Poll interval: ${Math.round(pollIntervalMs / 1000)}s | Poll timeout: ${Math.round(pollTimeoutMs / 1000)}s${verbose ? ' | Verbose: on' : ''}`));

  if (dryRun) {
    log(fmt.status('DRY-RUN', 'No agents will be launched.'));
  }

  // Only resolve a provider identity and read a token when a provider is enabled.
  const pollingUser = forgejoEnabled ? resolvedReviewUserFn() : null;
  const token = dryRun || !forgejoEnabled ? null : readTokenFn(pollingUser, { rootDir: worktree });
  const initialRound = state.round;

  for (let attempt = initialRound; attempt <= maxAttempts; attempt++) {
    log('\n' + fmt.status('INFO', `========== Round ${attempt} / ${maxAttempts} ==========`));

    // On rounds after the first, advance the state machine
    if (attempt > state.round) {
      state.advanceRound();
    }

    let reviewState;

    if (state.phase === 'reviewing') {
      // Check if we can skip reviewer launch
      if (isContinue && attempt === initialRound) {
        if (!dryRun) transitionTaskFn(slug, 'review', { rootDir: worktree, log });
        if (forgejoEnabled) {
          log(fmt.status('INFO', `Round ${attempt}: checking for existing review by ${reviewer} since ${state.startedAt}...`));
          reviewState = await pollForReviewFn(prNumber, reviewer, state.startedAt, token, {
            getLatestReviewForPrFn, sleepFn, intervalMs: 1000, timeoutMs: 2000, retryCount: state.reviewerRetryCount, verbose, label: `round ${attempt} skip-check`, log
          });
          // Skip-check timeout means no existing review - treat as null to proceed with initial launch
          if (isPollTimeout(reviewState)) {
            reviewState = null;
          }
        } else {
          // When the provider is disabled, use local review state instead of polling.
          log(fmt.status('INFO', `Round ${attempt}: review provider disabled; using workflow-owned review state.`));
          reviewState = null;
        }
      }

      // Handle reviewState: could be a valid state, null (no existing review or hard failure), or undefined (first time)
      if (dryRun) {
        if (!reviewState) {
          if (reviewer === 'autonomous') {
            log(fmt.status('INFO', `Round ${attempt}: reviewer identity is autonomous; skipping dry-run reviewer prompt and using local review artifacts only.`));
          } else {
            log(`\n--- DRY-RUN: reviewer (${reviewer}) prompt ---`);
            log(buildReviewPromptFn({ reviewer, branch, implementer, focus, attempt, repoRoot: worktree, missionPath: effectiveMissionPath, actualReviewer: '{{AGENT_NAME}}' }));
          }
        }
      } else {
        if (!reviewState) {
          // First launch or hard failure (null)
          const rebaseResult = await rebaseBeforeReviewRoundFn(slug, {
            worktree, runFn, log, error,
            taskFile: taskResolution.taskFile,
            gitFn,
            isReviewProviderEnabledFn: forgejoEnabledFn
          });
          if (!rebaseResult.ok) { exit(1); return; }

          if (!dryRun) transitionTaskFn(slug, 'review', { rootDir: worktree, log });
          state.phase = 'reviewing';
          writeReviewStateFn(slug, state, worktree);
          if (reviewer === 'autonomous' && !forgejoEnabled) {
            log(fmt.status('INFO', `Round ${attempt}: reviewer identity is autonomous; skipping reviewer launch and using local review artifacts only.`));
          } else {
            log(fmt.status('INFO', `Round ${attempt}: launching reviewer (${reviewer})...`));

            let reviewerLaunchResult;
            try {
              reviewerLaunchResult = await startAgentFn('review', {
                agent: reviewer,
                prompt: (actualReviewer) => buildCompactReviewPromptFn({ reviewer, branch, implementer, focus, attempt, repoRoot: worktree, missionPath: effectiveMissionPath, actualReviewer }),
                worktree, slug, role: 'reviewer', exclude: [implementer]
              });
            } catch (err) {
              error(fmt.status('FAIL', `Could not launch reviewer agent (${reviewer}): ${err.message}`));
              exit(1); return;
            }

            reviewer = applyAgentFallbackFn({
              role: 'reviewer', original: reviewer, launchResult: reviewerLaunchResult,
              state, slug, worktree, taskResolution, log, writeReviewStateFn, enforceTaskAssigneeFn
            });

            // Record review-stage telemetry immediately after the reviewer runs,
            // so the worktree's newest codex rollout is this reviewer's session.
            // The window is bounded to this round's launch so each round adds
            // only its own usage; accumulateStageStats sums the rounds into one
            // cumulative row per reviewer family.
            const reviewSinceMs = stageLaunchSinceMs(reviewerLaunchResult && reviewerLaunchResult.result);
            recordStageStatsSafeFn('review', {
              stage: 'review', slug, rootDir: worktree, worktree, reviewer, implementer,
              result: reviewerLaunchResult && reviewerLaunchResult.result,
              sinceMs: reviewSinceMs, log, error, state, writeReviewStateFn,
              model: resolveAgentModel(reviewer, worktree),
            });
          }

          const reviewerArtifacts = await consumeReviewerArtifactsFn(slug, reviewer, {
            worktree,
            tmpDir: artifactDir,
            fallbackToTmp: true,
            readTokenFn,
            getCommentsFn,
            postCommentFn,
            postReviewFn,
            buildMetadataFooterFn: buildMetadataFooter,
            forgejoEnabled,
            log,
            error
          });
          if (reviewerArtifacts.consumed) {
            if (!reviewerArtifacts.ok) { exit(1); return; }
            reviewState = reviewerArtifacts.reviewState;
          }
          if (!reviewState && forgejoEnabled) {
            reviewState = await pollForReviewFn(prNumber, reviewer, state.startedAt, token, {
              getLatestReviewForPrFn, sleepFn, intervalMs: pollIntervalMs, timeoutMs: pollTimeoutMs, retryCount: 0, verbose, label: `round ${attempt} review`, log
            });
          }
        }

        if (isPollTimeout(reviewState)) {
          // Timeout recovery loop for reviewer
          while (state.reviewerRetryCount < 2) {
            state.reviewerRetryCount++;
            writeReviewStateFn(slug, state, worktree);
            const elapsedStr = formatElapsed(Date.now() - new Date(state.startedAt));
            const recoveryPrompt = `RECOVERY: Reviewer timeout after ${elapsedStr}. Please complete the review for ${branch}.`;
            log(fmt.status('INFO', `Round ${attempt}: relaunching reviewer (${reviewer}) with recovery prompt (retry ${state.reviewerRetryCount}/3)...`));

            let relaunchResult;
            try {
              relaunchResult = await startAgentFn('review', {
                agent: reviewer,
                prompt: (actualReviewer) => buildCompactReviewPromptFn({ reviewer, branch, implementer, focus, attempt, repoRoot: worktree, missionPath: effectiveMissionPath, actualReviewer }) + '\n\n' + recoveryPrompt,
                worktree, slug, role: 'reviewer', exclude: [implementer]
              });
            } catch (err) {
              error(fmt.status('FAIL', `Could not relaunch reviewer agent (${reviewer}): ${err.message}`));
              exit(1); return;
            }

            reviewer = applyAgentFallbackFn({
              role: 'reviewer', original: reviewer, launchResult: relaunchResult,
              state, slug, worktree, taskResolution, log, writeReviewStateFn, enforceTaskAssigneeFn
            });

            const retryArtifacts = await consumeReviewerArtifactsFn(slug, reviewer, {
              worktree,
              tmpDir: artifactDir,
              fallbackToTmp: true,
              readTokenFn,
              getCommentsFn,
              postCommentFn,
              postReviewFn,
              buildMetadataFooterFn: buildMetadataFooter,
              forgejoEnabled,
              log,
              error
            });
            if (retryArtifacts.consumed) {
              if (!retryArtifacts.ok) { exit(1); return; }
              reviewState = retryArtifacts.reviewState;
            }
            if (!reviewState && forgejoEnabled) {
              reviewState = await pollForReviewFn(prNumber, reviewer, state.startedAt, token, {
                getLatestReviewForPrFn, sleepFn, intervalMs: pollIntervalMs, timeoutMs: pollTimeoutMs, retryCount: state.reviewerRetryCount, verbose, label: `round ${attempt} review retry ${state.reviewerRetryCount}`, log
              });
            }

            if (!isPollTimeout(reviewState)) break;
          }

          if (isPollTimeout(reviewState)) {
            log(fmt.status('INFO', `Autonomous review stopped: excessive reviewer timeout retries`));
            return;
          }
        } else if (!reviewState) {
          error(fmt.status('FAIL', `Reviewer ${reviewer} did not submit a formal review outcome for ${branch}.`));
          error('       The reviewer agent may have exited without posting to the review PR.');
          exit(1); return;
        }
      }

      if (dryRun) return;

      if (!reviewState) {
        error(fmt.status('FAIL', `Reviewer ${reviewer} did not submit a formal review outcome for ${branch}.`));
        error('       The reviewer agent may have exited without posting to the review PR.');
        exit(1); return;
      }

      if (isPollTimeout(reviewState)) {
        log(fmt.status('INFO', `Autonomous review stopped: excessive reviewer timeout retries`));
        return;
      }

      log(fmt.status('INFO', `Round ${attempt}: reviewer outcome = ${reviewState}`));

      if (reviewState === 'APPROVED') {
        state.transitionTo('approved');
        state.disposition = reviewState;
        writeReviewStateFn(slug, state, worktree);
        log(fmt.status('PASS', 'Autonomous review stopped: reviewer approved the PR. Hand off to human review/integration.'));
        transitionVirtualFn(transitionTaskFn, slug, 'approved', { rootDir: worktree, log });
        return;
      }
      state.transitionTo('fixing');
      state.disposition = reviewState;
    } else {
      // Resume in fixing phase, need reviewState
      if (forgejoEnabled) {
        const latestReview = await getLatestReviewForPrFn(prNumber, reviewer, state.startedAt, token);
        reviewState = latestReview ? latestReview.state : null;
        if (!reviewState) {
          // Restore retry path: missing review on resume is recoverable
          // (e.g., reviewer identity changed, state is stale, or artifact not yet
          // discoverable). Treat as request-changes so the fixing phase proceeds
          // and can re-trigger the review on the next attempt.
          log(fmt.status('WARN', `No review found for ${reviewer} since ${state.startedAt}; treating as request-changes and proceeding to fixing phase.`));
          reviewState = 'request-changes';
        }
      } else {
        // When the provider is disabled, use persisted review state.
        reviewState = state.disposition || null;
        if (!reviewState) {
          // Restore retry path: missing local review state on resume is recoverable.
          // Treat as request-changes so the fixing phase proceeds.
          log(fmt.status('WARN', `No local review state found for ${reviewer}; treating as request-changes and proceeding to fixing phase.`));
          reviewState = 'request-changes';
        }
      }
      log(fmt.status('INFO', `Round ${attempt}: resuming in fixing phase with review outcome = ${reviewState}`));
    }

    // Fixing phase
    let disposition;
    let reLaunch;
    let sinceIso = state.startedAt;
    if (isContinue && attempt === state.round) {
      if (forgejoEnabled) {
        log(fmt.status('INFO', `Round ${attempt}: checking for existing disposition by ${implementer} since ${state.startedAt}...`));
        disposition = await pollForDispositionFn(prNumber, implementer, state.startedAt, token, {
          getLatestDispositionForPrFn, sleepFn, intervalMs: 1000, timeoutMs: CONTINUE_SKIP_CHECK_TIMEOUT_MS, verbose, label: `round ${attempt} skip-check`, log
        });
        // Skip-check timeout means no existing disposition - treat as null to proceed with initial launch
        if (isPollTimeout(disposition)) {
          disposition = null;
        } else if (isContinue && (disposition === 'BLOCKED' || disposition === 'PARKED')) {
          // Stale BLOCKED/PARKED from a previous round: re-launch the implementer
          // so they can post a fresh disposition reflecting the current state of the branch.
          log(fmt.status('INFO', `Round ${attempt}: implementer disposition found (${disposition}). Re-launching implementer to assess whether blocker is resolved...`));
          reLaunch = true;
          // Capture a fresh sinceIso so the post-relaunch poll doesn't
          // immediately return the same stale disposition. Use a strictly
          // newer timestamp than the persisted round start to avoid same-ms
          // collisions during fast local test runs.
          sinceIso = strictlyLaterIso(state.startedAt);
          disposition = null;
        }
      } else {
        // When the provider is disabled, use local review state.
        log(fmt.status('INFO', `Round ${attempt}: review provider disabled; using workflow-owned disposition state.`));
        disposition = null;
      }
    }

    if (!disposition) {
      // First launch or re-launch after stale BLOCKED/PARKED
      if (dryRun) {
        log(`\n--- DRY-RUN: implementer (${implementer}) act-on-review prompt ---`);
        log(buildActOnReviewPromptFn({ implementer, branch, attempt, repoRoot: worktree, missionPath: effectiveMissionPath, actualImplementer: '{{AGENT_NAME}}' }));
        if (reLaunch) {
          log(fmt.status('INFO', `Round ${attempt}: stale BLOCKED/PARKED disposition replaced by fresh implementer action.`));
        }
        return;
      }

      writeReviewStateFn(slug, state, worktree);
      transitionTaskFn(slug, 'active', { implementer, rootDir: worktree, log });
      if (implementer === 'autonomous' && !forgejoEnabled) {
        log(fmt.status('INFO', `Round ${attempt}: implementer identity is autonomous; skipping implementer launch and using local review artifacts only.`));
      } else {
        log(fmt.status('INFO', `Round ${attempt}: launching implementer (${implementer}) for act-on-review...`));

        let implementerLaunchResult;
        try {
          implementerLaunchResult = await startAgentFn('act-on-review', {
            agent: implementer,
            prompt: (actualImplementer) => buildCompactActOnReviewPromptFn({ implementer, branch, attempt, reviewOutcome: reviewState, repoRoot: worktree, missionPath: effectiveMissionPath, actualImplementer }),
            worktree, slug, role: 'implementer', exclude: [reviewer]
          });
        } catch (err) {
          error(fmt.status('FAIL', `Could not launch implementer agent (${implementer}): ${err.message}`));
          exit(1); return;
        }

        implementer = applyAgentFallbackFn({
          role: 'implementer', original: implementer, launchResult: implementerLaunchResult,
          state, slug, worktree, taskResolution, log, writeReviewStateFn, enforceTaskAssigneeFn
        });

        // Record follow-up telemetry immediately after the implementer runs.
        // This is intentionally a separate stored phase from the initial
        // execute/active launch. The window is bounded to this round's launch
        // so each act-on-review round adds only its own usage.
        const followUpSinceMs = stageLaunchSinceMs(implementerLaunchResult && implementerLaunchResult.result);
        recordStageStatsSafeFn('active', {
          stage: 'follow-up', slug, rootDir: worktree, worktree, implementer, reviewer,
          result: implementerLaunchResult && implementerLaunchResult.result,
          sinceMs: followUpSinceMs, log, error, state, writeReviewStateFn,
          model: resolveAgentModel(implementer, worktree),
        });
      }

      const implementerArtifacts = await consumeImplementerArtifactsFn(slug, implementer, {
        worktree,
        tmpDir: artifactDir,
        fallbackToTmp: true,
        readTokenFn,
        getCommentsFn,
        postCommentFn,
        buildMetadataFooterFn: buildMetadataFooter,
        forgejoEnabled,
        log,
        error
      });
      if (implementerArtifacts.consumed) {
        if (!implementerArtifacts.ok) { exit(1); return; }
        disposition = implementerArtifacts.disposition;
      }
      if (!disposition && forgejoEnabled) {
        disposition = await pollForDispositionFn(prNumber, implementer, sinceIso, token, {
          getLatestDispositionForPrFn, sleepFn, intervalMs: pollIntervalMs, timeoutMs: pollTimeoutMs, retryCount: 0, verbose, label: `round ${attempt} disposition`, log
        });
      }

      if (isPollTimeout(disposition)) {
        // Timeout recovery loop for implementer
        while (state.implementerRetryCount < 2) {
          state.implementerRetryCount++;
          writeReviewStateFn(slug, state, worktree);
          const elapsedStr = formatElapsed(Date.now() - new Date(state.startedAt));
          const recoveryPrompt = `RECOVERY: Implementer disposition timeout after ${elapsedStr}. Please provide a disposition (PUSHBACK_ALL, BLOCKED, PARKED, or continue with fixes) for ${branch}.`;
          log(fmt.status('INFO', `Round ${attempt}: relaunching implementer (${implementer}) with recovery prompt (retry ${state.implementerRetryCount}/3)...`));

          let relaunchResult;
          try {
            relaunchResult = await startAgentFn('act-on-review', {
              agent: implementer,
              prompt: (actualImplementer) => buildCompactActOnReviewPromptFn({ implementer, branch, attempt, reviewOutcome: reviewState, repoRoot: worktree, missionPath: effectiveMissionPath, actualImplementer }) + '\n\n' + recoveryPrompt,
              worktree, slug, role: 'implementer', exclude: [reviewer]
            });
          } catch (err) {
            error(fmt.status('FAIL', `Could not relaunch implementer agent (${implementer}): ${err.message}`));
            exit(1); return;
          }

          implementer = applyAgentFallbackFn({
            role: 'implementer', original: implementer, launchResult: relaunchResult,
            state, slug, worktree, taskResolution, log, writeReviewStateFn, enforceTaskAssigneeFn
          });

          const retryArtifacts = await consumeImplementerArtifactsFn(slug, implementer, {
            worktree,
            tmpDir: artifactDir,
            fallbackToTmp: true,
            readTokenFn,
            getCommentsFn,
            postCommentFn,
            buildMetadataFooterFn: buildMetadataFooter,
            forgejoEnabled,
            log,
            error
          });
          if (retryArtifacts.consumed) {
            if (!retryArtifacts.ok) { exit(1); return; }
            disposition = retryArtifacts.disposition;
          }
          if (!disposition && forgejoEnabled) {
            disposition = await pollForDispositionFn(prNumber, implementer, sinceIso, token, {
              getLatestDispositionForPrFn, sleepFn, intervalMs: pollIntervalMs, timeoutMs: pollTimeoutMs, retryCount: state.implementerRetryCount, verbose, label: `round ${attempt} disposition retry ${state.implementerRetryCount}`, log
            });
          }

          if (!isPollTimeout(disposition)) break;
        }

        if (isPollTimeout(disposition)) {
          writeReviewStateFn(slug, state, worktree);
          log(fmt.status('INFO', `Autonomous review stopped: excessive implementer timeout retries`));
          return;
        }
      } else if (!disposition) {
        error(fmt.status('FAIL', `Implementer ${implementer} did not post an autonomous review disposition comment.`));
        exit(1); return;
      }

      // Suppress the duplicate message after re-launch
      reLaunch = null;
    } else if (reLaunch) {
      // Re-launch path: stale BLOCKED/PARKED was replaced by fresh implementation.
      // The disposition was set by the re-launch above (lines 767-785).
      // Fall through to disposition handling below.
    } else {
      // Skip-check found an existing disposition that is not BLOCKED/PARKED (or reLaunch flag).
      log(fmt.status('INFO', `Round ${attempt}: implementer disposition found (${disposition}). Skipping implementer launch.`));
    }

    if (!disposition) {
      error(fmt.status('FAIL', `Implementer ${implementer} did not post an autonomous review disposition comment.`));
      exit(1); return;
    }

    if (isPollTimeout(disposition)) {
      writeReviewStateFn(slug, state, worktree);
      log(fmt.status('INFO', `Autonomous review stopped: excessive implementer timeout retries`));
      return;
    }

    log(fmt.status('INFO', `Round ${attempt}: implementer disposition = ${disposition}`));

    if (disposition === 'PUSHBACK_ALL') {
      state.disposition = disposition;
      writeReviewStateFn(slug, state, worktree);
      log(fmt.status('INFO', 'Autonomous review stopped: implementer pushed back on all remaining comments. Hand off to human review.'));
      return;
    }

    if (disposition === 'BLOCKED' || disposition === 'PARKED') {
      state.disposition = disposition;
      writeReviewStateFn(slug, state, worktree);
      log(fmt.status('INFO', `Autonomous review stopped: implementer reported ${disposition}. Hand off to human review.`));
      return;
    }

    state.disposition = disposition;
    try { state.transitionTo('reviewing'); } catch (_) {}
    writeReviewStateFn(slug, state, worktree);
    log(fmt.status('INFO', `Round ${attempt}: implementer made changes. Continuing to round ${attempt + 1}.`));
  }

  log(fmt.status('INFO', `Autonomous review stopped: reached ${maxAttempts} attempts. Hand off to human review.`));
}

// ============================================================================
// Module Exports
// ============================================================================

module.exports = {
  maybeUpdateGraphifyBeforeReview,
  commitSafeMissionArtifacts,
  rebaseBeforeReviewRound,
  applyAgentFallback,
  persistNormalizedPhaseRepair,
  stageLaunchSinceMs,
  startReviewLoop,
  recordStageStatsSafe
};
