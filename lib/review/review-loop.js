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
// Codex writes a fresh-counter rollout per round, so we sum total_token_usage
// across every rollout since the review loop started (`sinceMs`). This is
// recomputed from the rollout files each round — idempotent across the workflow
// process being resumed mid-mission — and the per-(mission,stage) upsert leaves
// the codex role's full multi-round total. `result.telemetry` is used only as a
// signal that codex ran this round, so the window-sum is attributed to the right
// role and never double-counted onto the non-codex stage.
function recordStageStatsSafe(kind, { slug, rootDir, worktree, implementer, reviewer, result, sinceMs, log, error }) {
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
    const fn = kind === 'review' ? stats.recordReviewStats : stats.recordActiveStats;
    fn({ slug, rootDir, implementer, reviewer, telemetry, durationMinutes });
  } catch (err) {
    // Best-effort: never escalate to the fatal `error` channel.
    log(fmt.status('WARN', `Could not record ${kind} stats for ${slug}: ${err.message}`));
  }
}

const DEFAULT_MAX_ATTEMPTS = 5;
const CONTINUE_SKIP_CHECK_TIMEOUT_MS = 10_000;
const SHARED_FILE_REBASE_CONFLICT_RE = /shared file(?:\(s\))? require agent-assisted resolution|shared-file-conflicts/i;

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

async function commitSafeMissionArtifacts(slug, worktree, {
  taskFile = null,
  gitFn = git,
  log = fmt.log.plain,
  error = fmt.log.plainError,
  isMissionArtifactFn = require('../core/mission-utils').isMissionArtifact,
  isWorkflowGeneratedArtifactFn = require('../core/mission-utils').isWorkflowGeneratedArtifact,
  // The review loop itself writes per-stage telemetry rows to the configured
  // stats CSV (recordStageStatsSafe -> recordStage/Active/ReviewStats). The
  // effective path is <PARALLIX_HOME>/stats.csv (external to the repo), so
  // this resolver always returns null — the stats file never appears in the
  // worktree's git status and cannot trip the "non-mission paths" guard.
  resolveStatsRelPathFn = () => null
} = {}) {
  const rootDir = worktree || process.cwd();
  const statusResult = gitFn(['-C', rootDir, 'status', '--porcelain=v1', '-z']);
  if (statusResult.status !== 0 || !statusResult.stdout) {
    return { ok: true, dirty: false };
  }

  const parsePorcelainZ = (stdout) => {
    const entries = String(stdout).split('\0').filter(Boolean);
    const dirty = [];
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      const xy = entry.slice(0, 2);
      const file = entry.slice(3);
      const record = { xy, file, paths: [file] };
      if ((xy[0] === 'R' || xy[0] === 'C') && i + 1 < entries.length) {
        const source = entries[i + 1];
        record.source = source;
        record.paths.push(source);
        i += 1;
      }
      dirty.push(record);
    }
    return dirty;
  };

  const dirtyFiles = parsePorcelainZ(statusResult.stdout);

  const unmerged = dirtyFiles.filter(f => ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(f.xy));
  if (unmerged.length > 0) {
    error(fmt.status('FAIL', `Cannot auto-commit: unmerged/conflicting files detected:\n${unmerged.map(f => `       - ${f.file}`).join('\n')}`));
    return { ok: false, dirty: true, unsafe: true };
  }

  const resolvedTaskFile = taskFile ? path.relative(rootDir, taskFile) : null;
  const statsRelPath = resolveStatsRelPathFn(rootDir);
  const isSafeToCommit = (file) =>
    isWorkflowGeneratedArtifactFn(file)
    || isMissionArtifactFn(file, slug, rootDir)
    || (resolvedTaskFile && file === resolvedTaskFile)
    || (statsRelPath && file === statsRelPath);

  const unsafeFiles = dirtyFiles
    .flatMap(f => f.paths)
    .filter(file => !isSafeToCommit(file));
  if (unsafeFiles.length > 0) {
    error(fmt.status('FAIL', `Cannot auto-commit: dirty files include non-mission paths:`));
    unsafeFiles.forEach(file => error(`       - ${file}`));
    return { ok: false, dirty: true, unsafe: true };
  }

  log(`Auto-committing safe mission artifacts for ${fmt.branch(`mission/${slug}`)} before rebase...`);
  dirtyFiles.forEach(f => {
    log(`       - ${f.file}`);
    gitFn(['-C', rootDir, 'add', '--', f.file]);
  });

  const commitRes = gitFn(['-C', rootDir, 'commit', '-m', `workflow(${slug}): auto-commit mission artifacts before pre-review rebase`]);
  if (commitRes.status === 0) {
    log(fmt.status('PASS', 'Mission artifacts committed.'));
    return { ok: true, dirty: true };
  } else {
    const failureMsg = [commitRes.stderr, commitRes.stdout].filter(Boolean).join('\n').trim();
    error(fmt.status('FAIL', `Failed to commit mission artifacts: ${failureMsg}`));
    return { ok: false, dirty: true };
  }
}

async function rebaseBeforeReviewRound(slug, {
  runFn = run,
  gitFn = git,
  taskFile = null,
  worktree = resolveWorktree(slug) || process.cwd(),
  log = fmt.log.plain,
  error = fmt.log.plainError,
  isReviewProviderEnabledFn = undefined,
  legacyIsForgejoReviewEnabledFn = null,
  isForgejoReviewEnabledFn = null
} = {}) {
  // Always commit safe worktree state first (mission artifacts, task file, stats)
  // so the reviewer sees a clean, committed tree. This runs in both provider-backed and
  // standalone modes; it only touches safe mission paths.
  const cleanup = await commitSafeMissionArtifacts(slug, worktree, { taskFile, gitFn, log, error });
  if (!cleanup.ok) {
    error(fmt.status('WARN', 'Worktree is dirty with unsafe or conflicted files. Rebase may fail.'));
    return { ok: false, sharedFileConflicts: false };
  }

  // When provider-backed review is disabled (standalone mode), there is no shared primary
  // branch to rebase onto via the provider-backed rebase path; skip the rebase
  // entirely after committing worktree state.
  const forgejoEnabledFn = isReviewProviderEnabledFn
    || legacyIsForgejoReviewEnabledFn
    || isForgejoReviewEnabledFn
    || isProviderEnabled;
  const forgejoEnabled = forgejoEnabledFn(worktree);
  if (!forgejoEnabled) {
    log(fmt.status('INFO', `Review provider disabled; committed worktree state and skipping pre-review rebase for ${fmt.branch(`mission/${slug}`)}.`));
    return { ok: true, sharedFileConflicts: false };
  }

  const workflowCli = path.resolve(__dirname, '..', 'index.js');

  log(`Rebasing ${fmt.branch(`mission/${slug}`)} onto the latest primary branch before reviewer launch...`);

  const result = runFn(process.execPath, [workflowCli, 'rebase', slug, '--push'], {
    cwd: worktree,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();

  if (result.status === 0) {
    log(fmt.status('PASS', `Pre-review rebase completed for ${fmt.branch(`mission/${slug}`)}.`));
    return { ok: true, sharedFileConflicts: false };
  }

  if (output) {
    error(output);
  }
  const sharedFileConflicts = SHARED_FILE_REBASE_CONFLICT_RE.test(output);
  if (sharedFileConflicts) {
    error(fmt.status('FAIL', 'Shared-file rebase conflicts detected. Autonomous review loop cannot continue safely.'));
    log(fmt.status('INFO', `Resolve the conflicts in the worktree, then re-run: px review ${slug} --start`));
  } else {
    error(fmt.status('FAIL', `Rebase failed before launching reviewer for ${fmt.branch(`mission/${slug}`)}.`));
  }
  return { ok: false, sharedFileConflicts };
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
    isForgejoReviewEnabledFn = null
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

  // Note: The implementer may not be in the agents list (eligible for review step)
  // if its launcher is unavailable. This is OK - we'll use fallback logic for the reviewer.
  // The strict implementer eligibility check was removed to allow fallback reviewer selection (SC 4).

  // Resolve reviewer
  let reviewerSource = 'explicit';
  let selectErr = null;
  if (!reviewer) {
    if (persisted && persisted.reviewer) {
      reviewer = persisted.reviewer;
      reviewerSource = 'persisted';
      log(fmt.status('INFO', `Resuming persisted reviewer: ${reviewer} (round ${persisted.round})`));
    } else {
      // Unbiased reviewer selection: draw from the eligible-and-supported pool
      // for the review step (per agents.json), excluding the implementer. No
      // hardcoded implementer→reviewer routing — configuration alone decides.
      // selectAgent throws when no different-family agent is runnable; that
      // surfaces as the "No reviewer could be auto-derived" failure below.
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
    const detail = selectErr ? `: ${selectErr.message}` : '';
    reviewer = 'autonomous';
    reviewerSource = 'fallback';
    log(fmt.status('WARN', `No reviewer could be auto-derived${detail}; defaulting to "autonomous"`));
  }

  // When the reviewer was defaulted to 'autonomous' via the mission-required
  // identity fallback (no reviewer could be auto-derived), skip launcher
  // availability checks entirely — autonomous is not an agent launcher but a
  // terminal identity meaning the workflow's own review surfaces are used.
  if (reviewerSource === 'fallback') {
    log(fmt.status('INFO', `Reviewer identity defaulted to autonomous; skipping launcher availability check.`));
  } else {
    // Check reviewer availability
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

      // Select fallback from eligible pool using selectAgent semantics (SC 1, SC 2)
      const excludeSet = new Set([...triedReviewers, implementer]);
      let fallback;
      let fallbackStatus;
      try {
        fallback = selectAgentFn('review', { exclude: excludeSet });
        fallbackStatus = workflowLauncherStatusFn(fallback);
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
  } // end else (launcher availability check)

  log(fmt.status('INFO', `Selected reviewer: ${reviewer} (${reviewerSource})`));

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

  // Build the canonical ReviewState instance — either from persisted state or fresh
  const state = persisted && persisted.reviewer === reviewer && persisted.implementer === implementer
    ? ReviewState.from(slug, persisted)
    : new ReviewState(slug, { reviewer, implementer });
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
            // Codex sessions are resumed across rounds, so total_token_usage is
            // cumulative for the reviewer role; the per-round upsert overwrites,
            // leaving the final row = the reviewer's full-mission usage.
            recordStageStatsSafe('review', {
              slug, rootDir: worktree, worktree, reviewer, implementer,
              result: reviewerLaunchResult && reviewerLaunchResult.result,
              sinceMs: state.startedAt ? Date.parse(state.startedAt) : 0, log, error
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
          // immediately return the same stale disposition.
          sinceIso = new Date().toISOString();
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

        // Record active-stage telemetry immediately after the implementer runs.
        // Same cumulative-session semantics as the review stage above; the final
        // round's upsert leaves the implementer's full-mission usage.
        recordStageStatsSafe('active', {
          slug, rootDir: worktree, worktree, implementer, reviewer,
          result: implementerLaunchResult && implementerLaunchResult.result,
          sinceMs: state.startedAt ? Date.parse(state.startedAt) : 0, log, error
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
  startReviewLoop
};
