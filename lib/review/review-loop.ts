/**
 * Review Loop Module
 * Extracted from parallix/lib/review.js for task-1201
 * Handles autonomous review loop orchestration.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as fmt from '../core/fmt.js';
import { git, run } from '../core/git.js';
import { findMissionDir, findMissionArea, resolveWorktree, missionBranchName, getPrimaryBranch } from '../core/mission-utils.js';
import { formatVerificationCommand, resolveEffectiveArea } from '../core/verification.js';
import { resolveTaskFile, getTaskImplementer, getTaskStatus, enforceTaskAssignee, transitionTask, reportTaskResolution } from '../tools/backlog.js';
import { toVirtual, transitionVirtual } from '../core/state-map.js';
import { getPrStatus, readToken, getLatestReviewForPr, getLatestDispositionForPr, providerAvailable, getComments, postComment, postReview, resolveReviewUser, isProviderEnabled } from './review-adapter.js';
import { buildAutonomousReviewMatrix, formatMatrixSummary } from '../core/runtime-matrix.js';
import { buildReviewPrompt, buildActOnReviewPrompt, buildCompactReviewPrompt, buildCompactActOnReviewPrompt } from './review-prompts.js';
import { ReviewState, readReviewState, writeReviewState, resetReviewState, VALID_PHASES, persistReviewStateOrThrow, assertReviewStatePersisted } from './review-state.js';
import { workflowLauncherStatus, startAgent, eligibleAgentsForStep, selectAgent } from '../agents/agents.js';
import { commitSafeMissionArtifacts, rebaseBeforeReviewRound } from './rebase.js';
import { resolveAgentModel } from '../core/product-config.js';
import { POLL_TIMEOUT, delay, resolvePollIntervalMs, resolvePollTimeoutMs, formatElapsed, isPollTimeout, pollForReview, pollForDisposition } from './review-polling.js';
import { buildMetadataFooter, resolveArtifactDir, consumeReviewerArtifacts, consumeImplementerArtifacts } from './review-artifacts.js';
import { resolveStageTelemetry } from '../agents/stage-telemetry.js';

/** Lazily loaded stats module — loaded on first use to avoid circular dependency. */
let _stats: any = null;
function getStats(): any {
  if (!_stats) {
    _stats = _require('../commands/stats.js');
  }
  return _stats as any;
}

/** Lazily loaded handoff module. */
let _handoff: any = null;
function getHandoff(): any {
  if (!_handoff) {
    _handoff = _require('../commands/handoff.js');
  }
  return _handoff as any;
}

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
function stageLaunchFingerprint(agentFamily: string, result: { sessionId?: string; startedAt?: string; endedAt?: string; status?: number } | null): string {
  return [
    String(agentFamily || '').trim().toLowerCase(),
    result && result.sessionId ? String(result.sessionId) : '',
    result && result.startedAt ? String(result.startedAt) : '',
    result && result.endedAt ? String(result.endedAt) : '',
    result && result.status !== undefined && result.status !== null ? String(result.status) : '',
  ].join('|');
}

function markStageLaunchRecorded(
  state: Record<string, any> | null,
  opts: { stage: string; agentFamily: string; result?: Record<string, any>; slug: string; worktree?: string; writeReviewStateFn?: typeof writeReviewState }
): boolean {
  const { stage, agentFamily, result, slug, worktree, writeReviewStateFn = writeReviewState } = opts || {};
  if (!state || !agentFamily) { return true; }
  const key = stageWindowKey(stage, agentFamily);
  const fingerprint = stageLaunchFingerprint(agentFamily, result || null);
  const recordedStageLaunches = state.metadata && typeof state.metadata === 'object'
    ? (state.metadata.recordedStageLaunches || {})
    : {};
  const recorded: string[] = Array.isArray(recordedStageLaunches[key]) ? recordedStageLaunches[key] : [];
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
  persistReviewStateOrThrow(writeReviewStateFn, slug, state as ReviewState, worktree || process.cwd());
  return true;
}

export function recordStageStatsSafe(
  kind: 'review' | 'active',
  opts: {
    stage: string;
    slug: string;
    rootDir?: string;
    worktree?: string;
    implementer?: string;
    reviewer?: string;
    result?: Record<string, any>;
    sinceMs?: number;
    log?: (_msg: string) => void;
    error?: (_msg: string) => void;
    state?: Record<string, any>;
    writeReviewStateFn?: typeof writeReviewState;
    model?: string | null;
  }
): void {
  const { stage, slug, rootDir, worktree, implementer, reviewer, result, sinceMs, log, state, writeReviewStateFn = writeReviewState, model = null } = opts;
  let durationMinutes = 0;
  if (result && result.startedAt && result.endedAt) {
    durationMinutes = (Date.parse(result.endedAt) - Date.parse(result.startedAt)) / 60000;
  }
  const telemetry = resolveStageTelemetry({ worktree: worktree || '', result: result || {}, sinceMs: sinceMs || 0 });
  try {
    const actorFamily = kind === 'review' ? reviewer : implementer;
    if (state && actorFamily && !markStageLaunchRecorded(state, {
      stage,
      agentFamily: actorFamily,
      result,
      slug,
      worktree,
      writeReviewStateFn
    })) {
      return;
    }
    try { getStats().accumulateStageStats({ stage, slug, rootDir, implementer, reviewer, telemetry, durationMinutes, model }); } catch { /* best-effort */ }
  } catch (err: unknown) {
    log?.(fmt.status('WARN', `Could not record ${kind} stats for ${slug}: ${(err as Error).message}`));
  }
}

const DEFAULT_MAX_ATTEMPTS = 5;
const CONTINUE_SKIP_CHECK_TIMEOUT_MS = 10_000;

function strictlyLaterIso(earlierIso: string, nowMs = Date.now()): string {
  const earlierMs = Date.parse(earlierIso);
  if (!Number.isFinite(earlierMs)) {
    return new Date(nowMs).toISOString();
  }
  return new Date(Math.max(nowMs, earlierMs + 1)).toISOString();
}

// ============================================================================
// Pre-review Setup Functions
// ============================================================================

import { createRequire } from 'node:module';
const _require = createRequire(__filename);

export function maybeUpdateGraphifyBeforeReview(
  rootDir: string,
  { commandRunner = run, log = fmt.log.plain }: { commandRunner?: typeof run; log?: (_msg: string) => void } = {}
): unknown {
  // Lazy require to break circular dependency with core/mission-utils
  const { updateGraphifyKnowledgeGraph } = _require('../core/mission-utils.js');
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
export function applyAgentFallback(opts: {
  role: string;
  original: string;
  launchResult?: Record<string, any>;
  state: Record<string, any>;
  slug: string;
  worktree?: string;
  taskResolution?: Record<string, any>;
  log?: (_msg: string) => void;
  writeReviewStateFn?: typeof writeReviewState;
  enforceTaskAssigneeFn?: typeof enforceTaskAssignee;
}): string {
  const { role, original, launchResult, state, slug, worktree, taskResolution, log = fmt.log.plain, writeReviewStateFn = writeReviewState, enforceTaskAssigneeFn } = opts;
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
  persistReviewStateOrThrow(writeReviewStateFn, slug, state as ReviewState, worktree || process.cwd());
  if (role === 'implementer' && taskResolution && taskResolution.ok) {
    if (enforceTaskAssigneeFn && !enforceTaskAssigneeFn(taskResolution.taskFile, fallback)) {
      log(fmt.status('WARN', `Could not enforce fallback implementer ${fallback} in backlog task.`));
    }
  }
  return fallback;
}

export function persistNormalizedPhaseRepair(
  slug: string,
  state: ReviewState,
  worktree: string,
  { log = fmt.log.plain, writeReviewStateFn = writeReviewState }: { log?: (_msg: string) => void; writeReviewStateFn?: typeof writeReviewState } = {}
): void {
  if (!state || !state.phaseOriginal || (VALID_PHASES as readonly string[]).includes(state.phaseOriginal)) {
    return;
  }
  log(fmt.status('WARN', `Persisted review phase "${state.phaseOriginal}" is invalid. Repairing to "${state.phase}".`));
  persistReviewStateOrThrow(writeReviewStateFn, slug, state, worktree);
  state.phaseOriginal = null;
}

function stageWindowKey(stage: string, agentFamily: string): string {
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
export function stageLaunchSinceMs(result: { startedAt?: string } | null | undefined): number {
  const startedAt = result && result.startedAt ? String(result.startedAt) : '';
  const startedMs = startedAt ? Date.parse(startedAt) : NaN;
  return Number.isFinite(startedMs) ? startedMs : 0;
}

// ============================================================================
// Pre-review Gate Enforcement (ADR 0048 Control C1 / TASK-1385)
// ============================================================================

export function classifyGateFailure(output: string): { classification: string; action: string; isRelaunchable: boolean } {
  const rep = _require('../commands/repair-handoff.js');
  const { failureClass, dispatchAction } = rep.classifyError(output);
  return {
    classification: failureClass,
    action: dispatchAction,
    isRelaunchable: dispatchAction !== 'HumanOnly',
  };
}

export interface PreReviewGateResult {
  ok: boolean;
  area: string;
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}

/**
 * Run the verification gate with the mission area before a review round.
 * Captures stdout/stderr for use in auto-bounce fix prompts.
 */
export async function runPreReviewGate(
  slug: string,
  worktree: string,
  opts: {
    resolveEffectiveAreaFn?: typeof resolveEffectiveArea;
    findMissionAreaFn?: typeof findMissionArea;
    runFn?: typeof run;
    log?: (_msg: string) => void;
    error?: (_msg: string) => void;
  } = {}
): Promise<PreReviewGateResult> {
  const {
    resolveEffectiveAreaFn = resolveEffectiveArea,
    findMissionAreaFn,
    runFn: runFnOverride = run,
    log = fmt.log.plain,
    error = fmt.log.plainError,
  } = opts;

  const missionDir = findMissionDir(slug, worktree);
  // findMissionAreaFn remains injectable for existing callers/tests. Normal
  // runtime selection is diff-scoped through resolveEffectiveArea.
  const area = findMissionAreaFn && missionDir
    ? findMissionAreaFn(missionDir)
    : resolveEffectiveAreaFn(undefined, worktree, missionDir);
  const command = formatVerificationCommand(area, worktree, missionDir);

  if (command === NO_GATE_NOTICE_ALIAS) {
    log(fmt.status('INFO', `No verification gate configured for area ${area}; skipping pre-review gate check.`));
    return { ok: true, area, command, exitCode: 0, stdout: '', stderr: '' };
  }

  log(fmt.status('INFO', `Pre-review gate for area "${area}": ${fmt.command(command)}`));

  // Run with pipe mode to capture output for auto-bounce fix prompts.
  const result = runFnOverride('bash', ['-lc', command], {
    cwd: worktree,
    stdio: 'pipe',
    maxBuffer: 10 * 1024 * 1024, // 10MB buffer
  });

  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  const stderr = typeof result.stderr === 'string' ? result.stderr : '';

  if (result.status !== 0) {
    error(fmt.status('FAIL', `Pre-review gate failed for area "${area}" (exit ${result.status}).`));
    if (stderr) {
      error(`  stderr: ${stderr.split('\n').slice(0, 10).join('\n  ')}`);
    }
    return {
      ok: false,
      area,
      command,
      exitCode: result.status,
      stdout,
      stderr,
      error: `verification gate failed with exit code ${result.status}`,
    };
  }

  log(fmt.status('PASS', `Pre-review gate passed for area "${area}".`));
  return { ok: true, area, command, exitCode: 0, stdout, stderr };
}

const NO_GATE_NOTICE_ALIAS = ': # no verification gate configured (set adapters.verification.command)';

/**
 * Handle a pre-review gate failure by auto-bouncing to the implementer.
 * Does NOT consume a reviewer cycle or transition the task out of review status.
 * Tracks retry count in review state metadata.
 * Returns true if bounced, false if retry limit exceeded (mission strands).
 */
export async function handleGateFailureAutoBounce(
  slug: string,
  worktree: string,
  gateResult: PreReviewGateResult,
  implementer: string,
  opts: {
    startAgentFn?: typeof startAgent;
    writeReviewStateFn?: typeof writeReviewState;
    readReviewStateFn?: typeof readReviewState;
    transitionTaskFn?: typeof transitionTask;
    applyAgentFallbackFn?: typeof applyAgentFallback;
    taskResolution?: { ok: boolean; taskFile?: string };
    enforceTaskAssigneeFn?: typeof enforceTaskAssignee;
    log?: (_msg: string) => void;
    error?: (_msg: string) => void;
    sleepFn?: typeof delay;
    buildCompactActOnReviewPromptFn?: typeof buildCompactActOnReviewPrompt;
    isForgejoReviewEnabledFn?: ((_rootDir?: string) => boolean) | null;
    isReviewProviderEnabledFn?: ((_rootDir?: string) => boolean) | null;
    legacyIsForgejoReviewEnabledFn?: ((_rootDir?: string) => boolean) | null;
    exit?: (_code: number) => never;
  } = {}
): Promise<{ bounced: boolean; stranded: boolean }> {
  const {
    startAgentFn = startAgent,
    writeReviewStateFn = writeReviewState,
    readReviewStateFn = readReviewState,
    transitionTaskFn = transitionTask,
    applyAgentFallbackFn = applyAgentFallback,
    taskResolution,
    enforceTaskAssigneeFn,
    log = fmt.log.plain,
    error = fmt.log.plainError,
    sleepFn: _sleepFn = delay,
    buildCompactActOnReviewPromptFn: _buildCompactActOnReviewPromptFn = buildCompactActOnReviewPrompt,
    isForgejoReviewEnabledFn: _isForgejoReviewEnabledFn,
    isReviewProviderEnabledFn: _isReviewProviderEnabledFn,
    legacyIsForgejoReviewEnabledFn: _legacyIsForgejoReviewEnabledFn,
    exit: _exit = process.exit,
  } = opts;

  const MAX_GATE_RETRY = 2;

  // Read persisted state to get current retry count
  const persisted = readReviewStateFn(slug, worktree);
  const retryCount = persisted && persisted.metadata && typeof persisted.metadata === 'object'
    ? (Number((persisted.metadata as any).gateFailureRetryCount) || 0)
    : 0;

  if (retryCount >= MAX_GATE_RETRY) {
    error(fmt.status('FAIL', `Pre-review gate failure: max retries exceeded (${MAX_GATE_RETRY}). Mission stranded for ${slug}.`));
    error(fmt.status('FAIL', `Area "${gateResult.area}" verification failed ${retryCount} times. Human intervention required.`));
    error(fmt.status('FAIL', `Gate output:\n${gateResult.stdout || gateResult.stderr || '(no output)'}\n`));
    return { bounced: false, stranded: true };
  }

  // Classify the failure
  const combinedOutput = gateResult.stderr || gateResult.stdout || 'Gate failed with exit code ' + gateResult.exitCode;
  const classification = classifyGateFailure(combinedOutput);

  log(fmt.status('WARN', `Pre-review gate failed for area "${gateResult.area}" (exit ${gateResult.exitCode}). Classification: ${classification.classification}.`));

  // ADR 0048 C6: InfraBlocker and StateMachineViolation are HumanOnly — do not
  // auto-bounce to implementer; surface for human intervention.
  if (!classification.isRelaunchable) {
    error(fmt.status('FAIL', `Pre-review gate failure: ${classification.classification} (${classification.action}). Human intervention required — not auto-bouncing.`));
    error(fmt.status('FAIL', `Gate output:\n${gateResult.stdout || gateResult.stderr || '(no output)'}\n`));
    return { bounced: false, stranded: true };
  }

  // Build fix prompt with captured gate output
  const fixPrompt = [
    `PRE-REVIEW GATE FAILURE — FIX REQUIRED`,
    ``,
    `Mission: ${slug}`,
    `Area: ${gateResult.area}`,
    `Gate command: ${gateResult.command}`,
    `Exit code: ${gateResult.exitCode}`,
    ``,
    `Gate output (use this to diagnose and fix):`,
    `---`,
    gateResult.stdout || '(no stdout)',
    `---`,
    gateResult.stderr || '(no stderr)',
    `---`,
    ``,
    `Classification: ${classification.classification} — ${classification.action}`,
    `Retry attempt: ${retryCount + 1}/${MAX_GATE_RETRY}`,
    ``,
    `Fix the underlying issue so the verification gate passes for area "${gateResult.area}".`,
    `After fixing, restart the review loop; it will re-run the gate before the next review round.`,
  ].join('\n');

  // Increment retry count in metadata
  if (!persisted || !persisted.metadata || typeof persisted.metadata !== 'object') {
    // Create new metadata
  }
  const metadata = persisted && persisted.metadata && typeof persisted.metadata === 'object'
    ? { ...persisted.metadata }
    : {};
  metadata.gateFailureRetryCount = retryCount + 1;

  // Update review state with incremented retry count
  if (persisted) {
    const updatedState = { ...persisted, metadata };
    persistReviewStateOrThrow(writeReviewStateFn, slug, updatedState as any, worktree);
  } else {
    persistReviewStateOrThrow(writeReviewStateFn, slug, { metadata } as any, worktree);
  }

  // Transition task back to active (implementer phase) without consuming reviewer cycle
  transitionTaskFn(slug, 'active', { rootDir: worktree, log });
  log(fmt.status('INFO', `Auto-bouncing to implementer (${implementer}) with fix prompt. Retry ${retryCount + 1}/${MAX_GATE_RETRY}.`));

  // Launch implementer with the fix prompt
  try {
    const launchResult = await startAgentFn('act-on-review', {
      agent: implementer,
      prompt: (_actualImplementer: string) => fixPrompt,
      worktree,
      slug,
      role: 'implementer',
      exclude: [],
    });

    // Apply any agent fallback if needed
    implementer = applyAgentFallbackFn({
      role: 'implementer',
      original: implementer,
      launchResult,
      state: persisted || {},
      slug,
      worktree,
      taskResolution,
      log,
      writeReviewStateFn,
      enforceTaskAssigneeFn,
    });
  } catch (err: unknown) {
    error(fmt.status('FAIL', `Could not relaunch implementer (${implementer}) for gate failure auto-bounce: ${(err as Error).message}`));
    return { bounced: false, stranded: true };
  }

  log(fmt.status('INFO', `Implementer (${implementer}) relaunched with gate failure fix prompt.`));
  return { bounced: true, stranded: false };
}

// ============================================================================
// Main Review Loop
// ============================================================================

export async function startReviewLoop(slug: string, opts: {
  implementer?: string;
  reviewer?: string;
  focus?: string;
  maxAttempts?: number;
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
  recordStageStatsSafeFn?: (..._args: any[]) => void;
  runPreReviewGateFn?: typeof runPreReviewGate;
  handleGateFailureAutoBounceFn?: typeof handleGateFailureAutoBounce;
} = {}): Promise<void> {
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
    runPreReviewGateFn = runPreReviewGate,
    handleGateFailureAutoBounceFn = handleGateFailureAutoBounce,
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
    recordStageStatsSafeFn = () => {}
  } = opts;

  const performHandoffFn = opts.performHandoffFn || (await getHandoff()).performHandoff;

  let prNumber: number | null = null;
  isContinue = Boolean(isContinue || continueFlag);

  const pollIntervalMs = resolvePollIntervalMs();
  const pollTimeoutMs = resolvePollTimeoutMs(pollTimeoutSeconds || 0);

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

  // --reset: clear persisted state before starting
  if (reset) {
    const resetResult = resetReviewStateFn(slug, worktree);
    assertReviewStatePersisted(resetResult, { slug, phase: 'reset', round: null });
    if (resetResult.outcome === 'committed') {
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
      // Check task status to detect pre-review (implementation) phase
      const taskStatus = taskResolution.ok ? getTaskStatusFn(taskResolution.taskFile!) : null;
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
      const fallbackGuidance = (reason: string | null) => {
        error(fmt.status('FAIL', `No open review PR found for ${branch}. Create the PR before starting the review loop.`));
        if (reason) { error(`       Handoff failure: ${reason}`); }
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
        // Auto-bounce for declared-gate validation failures: transition back to
        // active and relaunch the implementer with a fix prompt, so the mission
        // is not stranded waiting for manual intervention.
        const handoffObj = handoff || {};
        if (handoffObj.reason === 'validation-failed') {
          transitionTaskFn(slug, 'active', { rootDir: worktree, log });
          log(fmt.status('INFO', `Auto-bounced ${slug} to active: declared-gate validation failure. Fix the gate in MISSION.md and retry.`));
          // Persist rejection reason for follow-up action
          const persisted = readReviewStateFn(slug, worktree);
          const metadata = persisted && persisted.metadata && typeof persisted.metadata === 'object'
            ? { ...persisted.metadata }
            : {};
          metadata.gateFailureReason = 'validation-failed';
          metadata.gateFailureError = handoffObj.error;
          persistReviewStateOrThrow(
            writeReviewStateFn,
            slug,
            { ...(persisted || {}), metadata } as any,
            worktree
          );
          exit(1);
          return;
        }
        fallbackGuidance(handoff && handoff.error ? String(handoff.error) : null);
        exit(1);
        return;
      }

      // Handoff succeeded — re-check whether an open PR now exists.
      const healedPr = getPrStatusFn(branch, worktree) as Record<string, unknown>;
      if (!healedPr.exists || healedPr.state !== 'open') {
        fallbackGuidance(null);
        exit(1);
        return;
      }

      log(fmt.status('INFO', `Self-heal succeeded: review PR #${healedPr.number} confirmed open for ${branch}. Continuing review loop.`));
      prNumber = healedPr.number as number | null;
      // Fall through into the normal loop with the recovered PR number.
    } else {
      log(fmt.status('INFO', `Review PR #${pr.number} confirmed open for ${branch}.`));
      prNumber = pr.number as number | null;
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
  const persistedContinueReviewer = isContinue && persisted && persisted.reviewer
    ? persisted.reviewer
    : null;
  let selectErr: Error | null = null;
  if (!reviewer) {
    if (persisted && persisted.reviewer) {
      reviewer = persisted.reviewer;
      reviewerSource = 'persisted';
      log(fmt.status('INFO', `Resuming persisted reviewer: ${reviewer} (round ${persisted.round})`));
    } else {
      try {
        reviewer = selectAgentFn('review', { exclude: new Set([implementer]) });
      } catch (err: unknown) {
        selectErr = err as Error;
        reviewer = undefined;
      }
      reviewerSource = 'auto-derived';
    }
  }

  if (!reviewer) {
    const anyDifferentFamilyRunnable = agents.some((a: string) => a !== implementer && workflowLauncherStatusFn(a).supported);
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
        formatMatrixSummaryFn(buildAutonomousReviewMatrixFn()).forEach((line: string) => error(`  ${line}`));
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

  const maybeFallbackToPersistedContinueReviewer = () => {
    if (!persistedContinueReviewer || reviewer === persistedContinueReviewer) {return false;}
    log(fmt.status('WARN', `Unsupported explicit reviewer "${reviewer}" while resuming ${slug}; falling back to persisted reviewer "${persistedContinueReviewer}" for the in-flight round.`));
    reviewer = persistedContinueReviewer;
    reviewerSource = 'persisted-continue-fallback';
    return true;
  };

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
      if (maybeFallbackToPersistedContinueReviewer()) {
        log(fmt.status('INFO', `Resuming persisted reviewer "${reviewer}" for continue-mode validation.`));
      } else {
        const reason = !agents.includes(reviewer) ? 'blocked or unsupported' : 'launcher is not available';
        error(fmt.status('FAIL', `Unsupported reviewer: "${reviewer}" (${reason}).`));
        if (reason === 'launcher is not available' && reviewerStatus.detail) {
          error(`       Looked for: ${reviewerStatus.detail}`);
        }
        error('\n' + fmt.status('INFO', 'Full runtime matrix:'));
        formatMatrixSummaryFn(buildAutonomousReviewMatrixFn()).forEach((line: string) => error(`  ${line}`));
        error('\n' + fmt.status('FAIL', `No runnable reviewer route for implementer "${implementer}".`));
        exit(1);
        return;
      }
    }
  } else if (!willLaunchRounds) {
    if (!agents.includes(reviewer)) {
      if (maybeFallbackToPersistedContinueReviewer()) {
        log(fmt.status('INFO', `Resuming persisted reviewer "${reviewer}" for continue-mode validation.`));
      } else {
        error(fmt.status('FAIL', `Unsupported reviewer: "${reviewer}" (blocked or unsupported).`));
        error('\n' + fmt.status('INFO', 'Full runtime matrix:'));
        formatMatrixSummaryFn(buildAutonomousReviewMatrixFn()).forEach((line: string) => error(`  ${line}`));
        error('\n' + fmt.status('FAIL', `No runnable reviewer route for implementer "${implementer}".`));
        exit(1);
        return;
      }
    }
  } else {
    let reviewerStatus = workflowLauncherStatusFn(reviewer);
    const triedReviewers = new Set<string>();
    while (!agents.includes(reviewer) || !reviewerStatus.supported) {
      triedReviewers.add(reviewer);
      if (reviewerSource === 'explicit') {
        if (maybeFallbackToPersistedContinueReviewer()) {
          reviewerStatus = workflowLauncherStatusFn(reviewer);
          continue;
        }
        const reason = !agents.includes(reviewer) ? 'blocked or unsupported' : 'launcher is not available';
        error(fmt.status('FAIL', `Unsupported reviewer: "${reviewer}" (${reason}).`));
        if (reviewerStatus.detail) { error(`       Looked for: ${reviewerStatus.detail}`); }
        error('\n' + fmt.status('INFO', 'Full runtime matrix:'));
        formatMatrixSummaryFn(buildAutonomousReviewMatrixFn()).forEach((line: string) => error(`  ${line}`));
        error('\n' + fmt.status('FAIL', `No runnable reviewer route for implementer "${implementer}".`));
        exit(1);
        return;
      }

      const excludeSet = new Set([...triedReviewers, implementer]);
      let fallback: string | undefined;
      let fallbackStatus: { agent: string; supported: boolean; detail: string } | null;
      try {
        fallback = selectAgentFn('review', { exclude: excludeSet });
        if (excludeSet.has(fallback!)) {
          fallback = undefined;
          fallbackStatus = null;
        } else {
          fallbackStatus = workflowLauncherStatusFn(fallback!);
        }
      } catch {
        fallback = undefined;
        fallbackStatus = null;
      }

      if (!fallback) {
        const anyDifferentFamilyRunnable = agents.some((a: string) => a !== implementer && workflowLauncherStatusFn(a).supported);
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
        if (reviewerStatus.detail) { error(`       Looked for: ${reviewerStatus.detail}`); }
        error('\n' + fmt.status('INFO', 'Full runtime matrix:'));
        formatMatrixSummaryFn(buildAutonomousReviewMatrixFn()).forEach((line: string) => error(`  ${line}`));
        error('\n' + fmt.status('FAIL', `No runnable reviewer route for implementer "${implementer}".`));
        exit(1);
        return;
      }

      const reason = !agents.includes(reviewer) ? 'blocked or unsupported' : 'launcher is not available';
      log(fmt.status('WARN', `Unsupported reviewer: "${reviewer}" (${reason}); trying fallback "${fallback}".`));
      reviewer = fallback;
      reviewerStatus = fallbackStatus!;
      reviewerSource = reviewerSource === 'persisted' ? 'persisted-fallback' : 'auto-derived-fallback';
    }
  }

  log(fmt.status('INFO', `Selected reviewer: ${reviewer} (${reviewerSource})`));

  // Build the canonical ReviewState instance. When persisted state exists we
  // resume from it — preserving round, startedAt, phase, disposition, retry
  // counts, and metadata — and only overwrite the identities with the ones
  // selected for this launch (which may differ after a reviewer/implementer
  // fallback). Constructing fresh would silently reset all persisted progress.
  let state: ReviewState;
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
  const pollingUser = forgejoEnabled ? (resolvedReviewUserFn as () => string | null)() : null;
  const token = dryRun || !forgejoEnabled ? null : readTokenFn(pollingUser!, { rootDir: worktree });
  const initialRound = state.round;

  for (let attempt = initialRound; attempt <= maxAttempts; attempt++) {
    log('\n' + fmt.status('INFO', `========== Round ${attempt} / ${maxAttempts} ==========`));

    // On rounds after the first, advance the state machine
    if (attempt > state.round) {
      state.advanceRound();
    }

    // Snapshot the primary branch's HEAD commit for this round. This is a
    // fallback value only, used for paths that don't rebase this round (a
    // dry run, or resuming with an existing reviewState): once
    // rebaseBeforeReviewRoundFn runs below, HEAD is rebased onto primary's
    // *current* tip, so the baseline is re-captured immediately after the
    // rebase completes (see below). Capturing it here, before the rebase,
    // would pin the diff to a stale pre-rebase SHA; since rebase replays
    // primary's newer commits into HEAD's ancestry, diffing against that
    // stale SHA would surface exactly the "not rebased to main" noise this
    // baseline exists to suppress (task-1407).
    // Falls back to undefined (letting the prompt builders resolve the live
    // primary branch ref themselves) if the primary branch cannot be detected,
    // e.g. in a repo with no main/master branch yet.
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

    let reviewState: unknown;

    if (state.phase === 'reviewing') {
      // Check if we can skip reviewer launch
      if (isContinue && attempt === initialRound) {
        if (!dryRun) { transitionTaskFn(slug, 'review', { rootDir: worktree, log }); }
        if (forgejoEnabled) {
          log(fmt.status('INFO', `Round ${attempt}: checking for existing review by ${reviewer} since ${state.startedAt}...`));
          reviewState = await pollForReviewFn(prNumber as number, reviewer!, state.startedAt, token!, {
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
            log((buildReviewPromptFn as any)({ reviewer: reviewer!, branch, implementer: implementer!, focus, attempt, repoRoot: worktree, missionPath: effectiveMissionPath || undefined, reviewBaseline }));
          }
        }
      } else {
        if (!reviewState) {
          // First launch or hard failure (null)
          const rebaseResult = await rebaseBeforeReviewRoundFn(slug, {
            worktree, runFn: runFn as any, log, error,
            taskFile: taskResolution.taskFile,
            gitFn,
            isReviewProviderEnabledFn: forgejoEnabledFn
          });
          if (!rebaseResult.ok) { exit(1); return; }

          // Re-capture after rebase: HEAD is now rebased onto primary's tip,
          // so the pre-rebase snapshot above is stale and must be replaced
          // with the SHA that HEAD was actually rebased onto (task-1407).
          reviewBaseline = captureReviewBaseline();

          if (!dryRun) { transitionTaskFn(slug, 'review', { rootDir: worktree, log }); }
          state.phase = 'reviewing';
          persistReviewStateOrThrow(writeReviewStateFn, slug, state, worktree);

        }

        // Pre-review gate enforcement: run before every review round.
        // A failed gate auto-bounces before a reviewer cycle is consumed.
        if (!dryRun) {
          const preReviewGateResult = await runPreReviewGateFn(slug, worktree, {
            runFn: runFn as any,
            log,
            error,
          });
          if (!preReviewGateResult.ok) {
            log(fmt.status('WARN', `Pre-review gate failed for area "${preReviewGateResult.area}" (exit ${preReviewGateResult.exitCode}). Auto-bouncing to implementer.`));
            const bounceResult = await handleGateFailureAutoBounceFn(slug, worktree, preReviewGateResult, implementer, {
              startAgentFn: startAgentFn,
              writeReviewStateFn: writeReviewStateFn,
              readReviewStateFn: readReviewStateFn,
              transitionTaskFn: transitionTaskFn,
              applyAgentFallbackFn: applyAgentFallbackFn,
              taskResolution,
              enforceTaskAssigneeFn,
              log,
              error,
              sleepFn,
              buildCompactActOnReviewPromptFn,
              isForgejoReviewEnabledFn,
              isReviewProviderEnabledFn,
              legacyIsForgejoReviewEnabledFn,
              exit,
            });
            if (bounceResult.stranded) {
              error(fmt.status('FAIL', `Pre-review gate failure stranded mission ${slug}. Exiting review loop.`));
              exit(1); return;
            }
            if (bounceResult.bounced) {
              log(fmt.status('INFO', `Autonomous review stopped: gate failure auto-bounced to implementer. Hand off to human review.`));
              return;
            }
          } else {
            log(fmt.status('PASS', `Pre-review gate passed for area "${preReviewGateResult.area}".`));
          }
        }

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
                worktree, slug, role: 'reviewer', exclude: [implementer]
              });
            } catch (err: unknown) {
              error(fmt.status('FAIL', `Could not launch reviewer agent (${reviewer}): ${(err as Error).message}`));
              exit(1); return;
            }

            reviewer = applyAgentFallbackFn({
              role: 'reviewer', original: reviewer!, launchResult: reviewerLaunchResult,
              state: state as unknown as Record<string, any>, slug, worktree, taskResolution, log, writeReviewStateFn, enforceTaskAssigneeFn
            });

            // Record review-stage telemetry immediately after the reviewer runs,
            // so the worktree's newest codex rollout is this reviewer's session.
            // The window is bounded to this round's launch so each round adds
            // only its own usage; accumulateStageStats sums the rounds into one
            // cumulative row per reviewer family.
            const reviewSinceMs = stageLaunchSinceMs(reviewerLaunchResult?.result);
            recordStageStatsSafeFn('review', {
              stage: 'review', slug, rootDir: worktree, worktree, reviewer, implementer,
              result: reviewerLaunchResult?.result,
              sinceMs: reviewSinceMs || 0, log, error, state, writeReviewStateFn,
              model: resolveAgentModel(reviewer!, worktree),
            });
          }

          const reviewerArtifacts = await consumeReviewerArtifactsFn(slug, reviewer!, {
            worktree,
            tmpDir: artifactDir,
            fallbackToTmp: true,
            readTokenFn,
            getCommentsFn: getCommentsFn as any,
            postCommentFn,
            postReviewFn,
            buildMetadataFooterFn: buildMetadataFooter,
            forgejoEnabled,
            log,
            error
          });
          if (reviewerArtifacts.consumed) {
            if (!reviewerArtifacts.ok) {
              log(fmt.status('WARN', `Reviewer ${reviewer} produced incomplete or invalid review artifacts; retrying the reviewer.`));
              reviewState = POLL_TIMEOUT;
            } else {
              reviewState = reviewerArtifacts.reviewState;
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
            // Local-artifact review has no provider poll to yield POLL_TIMEOUT.
            // Treat a missing outcome as reviewer recovery work before entering
            // the bounded retry loop below.
            const handoff = forgejoEnabled
              ? 'did not submit a formal review outcome'
              : `did not leave a complete local review handoff in ${artifactDir} (${slug}-review-findings.md, ${slug}-review-outcome.md, ${slug}-review-verdict.txt)`;
            log(fmt.status('WARN', `Reviewer ${reviewer} ${handoff} for ${branch}; retrying the reviewer.`));
            reviewState = POLL_TIMEOUT;
          }
          // Timeout recovery loop for reviewer
          const stateAny = state as unknown as Record<string, any>;
          while ((stateAny['reviewerRetryCount'] || 0) < 2) {
            stateAny['reviewerRetryCount'] = (stateAny['reviewerRetryCount'] || 0) + 1;
            persistReviewStateOrThrow(writeReviewStateFn, slug, state, worktree);
            const elapsedStr = formatElapsed(Date.now() - Date.parse(stateAny['startedAt'] as string));
            const recoveryPrompt = `RECOVERY: Reviewer timeout after ${elapsedStr}. Please complete the review for ${branch}.`;
            log(fmt.status('INFO', `Round ${attempt}: relaunching reviewer (${reviewer}) with recovery prompt (retry ${stateAny['reviewerRetryCount']}/3)...`));

            let relaunchResult: any;
            try {
              relaunchResult = await startAgentFn('review', {
                agent: reviewer,
                prompt: (actualReviewer: string) => (buildCompactReviewPromptFn as any)({ reviewer: reviewer!, branch, implementer: implementer!, focus, attempt, repoRoot: worktree, missionPath: effectiveMissionPath || undefined, actualReviewer, reviewBaseline }) + '\n\n' + recoveryPrompt,
                worktree, slug, role: 'reviewer', exclude: [implementer]
              });
            } catch (err: unknown) {
              error(fmt.status('FAIL', `Could not relaunch reviewer agent (${reviewer}): ${(err as Error).message}`));
              exit(1); return;
            }

            reviewer = applyAgentFallbackFn({
              role: 'reviewer', original: reviewer!, launchResult: relaunchResult,
              state: state as unknown as Record<string, any>, slug, worktree, taskResolution, log, writeReviewStateFn, enforceTaskAssigneeFn
            });

            // The preceding attempt timed out. Clear that sentinel before
            // inspecting artifacts and polling the newly launched reviewer;
            // otherwise `!reviewState` stays false and every recovery launch
            // is treated as another timeout without ever checking its result.
            reviewState = null;
            const retryArtifacts = await consumeReviewerArtifactsFn(slug, reviewer!, {
              worktree,
              tmpDir: artifactDir,
              fallbackToTmp: true,
              readTokenFn,
              getCommentsFn: getCommentsFn as any,
              postCommentFn,
              postReviewFn,
              buildMetadataFooterFn: buildMetadataFooter,
              forgejoEnabled,
              log,
              error
            });
            if (retryArtifacts.consumed) {
              if (!retryArtifacts.ok) {
                log(fmt.status('WARN', `Reviewer ${reviewer} produced incomplete or invalid review artifacts; retrying the reviewer.`));
                reviewState = POLL_TIMEOUT;
              } else {
                reviewState = retryArtifacts.reviewState;
              }
            }
            if (!reviewState && forgejoEnabled) {
              reviewState = await pollForReviewFn(prNumber as number, reviewer!, state.startedAt, token!, {
                getLatestReviewForPrFn, sleepFn, intervalMs: pollIntervalMs, timeoutMs: pollTimeoutMs, retryCount: state.reviewerRetryCount, verbose, label: `round ${attempt} review retry ${state.reviewerRetryCount}`, log
              });
            }

            if (!isPollTimeout(reviewState)) { break; }
          }

          if (isPollTimeout(reviewState)) {
            error(fmt.status('FAIL', `Reviewer ${reviewer} did not submit a usable formal review outcome after ${stateAny['reviewerRetryCount']} recovery retries.`));
            error('       Human intervention is required to complete or repair the review.');
            exit(1); return;
          }
        }
      }

      if (dryRun) { return; }

      if (!reviewState) {
        if (forgejoEnabled) {
          error(fmt.status('FAIL', `Reviewer ${reviewer} did not submit a formal review outcome for ${branch}.`));
          error('       The reviewer agent may have exited without posting to the review PR.');
        } else {
          error(fmt.status('FAIL', `Reviewer ${reviewer} did not leave a complete local review handoff for ${branch}.`));
          error(`       Expected: ${artifactDir}/${slug}-review-findings.md, ${artifactDir}/${slug}-review-outcome.md, and ${artifactDir}/${slug}-review-verdict.txt.`);
        }
        exit(1); return;
      }

      if (isPollTimeout(reviewState)) {
        error(fmt.status('FAIL', `Reviewer ${reviewer} did not submit a usable formal review outcome after bounded recovery retries.`));
        error('       Human intervention is required to complete or repair the review.');
        exit(1); return;
      }

      log(fmt.status('INFO', `Round ${attempt}: reviewer outcome = ${reviewState}`));

      if (reviewState === 'APPROVED') {
        state.transitionTo('approved');
        state.disposition = reviewState as string;
        persistReviewStateOrThrow(writeReviewStateFn, slug, state, worktree);
        log(fmt.status('PASS', 'Autonomous review stopped: reviewer approved the PR. Hand off to human review/integration.'));
        transitionVirtualFn(transitionTaskFn, slug, 'approved', { log });
        return;
      }
      state.transitionTo('fixing');
      state.disposition = reviewState as string;
    } else {
      // Resume in fixing phase, need reviewState
      if (forgejoEnabled) {
        const latestReview = await getLatestReviewForPrFn(prNumber as number, reviewer!, state.startedAt, token!);
        reviewState = latestReview ? (latestReview as Record<string, unknown>).state : null;
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
    let disposition: unknown;
    let reLaunch: boolean | null;
    let sinceIso = state.startedAt;
    if (isContinue && attempt === state.round) {
      if (forgejoEnabled) {
        log(fmt.status('INFO', `Round ${attempt}: checking for existing disposition by ${implementer} since ${state.startedAt}...`));
        disposition = await pollForDispositionFn(prNumber as number, implementer!, state.startedAt, token!, {
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
        log((buildActOnReviewPromptFn as any)({ implementer: implementer!, branch, attempt, repoRoot: worktree, missionPath: effectiveMissionPath || undefined, reviewBaseline }));
        if (reLaunch!) {
          log(fmt.status('INFO', `Round ${attempt}: stale BLOCKED/PARKED disposition replaced by fresh implementer action.`));
        }
        return;
      }

      persistReviewStateOrThrow(writeReviewStateFn, slug, state, worktree);
      transitionTaskFn(slug, 'active', { implementer, rootDir: worktree, log });
      if (implementer === 'autonomous' && !forgejoEnabled) {
        log(fmt.status('INFO', `Round ${attempt}: implementer identity is autonomous; skipping implementer launch and using local review artifacts only.`));
      } else {
        log(fmt.status('INFO', `Round ${attempt}: launching implementer (${implementer}) for act-on-review...`));

        let implementerLaunchResult: any;
        try {
          implementerLaunchResult = await startAgentFn('act-on-review', {
            agent: implementer,
            prompt: (actualImplementer: string) => (buildCompactActOnReviewPromptFn as any)({ implementer: implementer!, branch, attempt, reviewOutcome: reviewState, repoRoot: worktree, missionPath: effectiveMissionPath || undefined, actualImplementer, reviewBaseline }),
            worktree, slug, role: 'implementer', exclude: [reviewer]
          });
        } catch (err: unknown) {
          error(fmt.status('FAIL', `Could not launch implementer agent (${implementer}): ${(err as Error).message}`));
          exit(1); return;
        }

        implementer = applyAgentFallbackFn({
          role: 'implementer', original: implementer!, launchResult: implementerLaunchResult,
          state: state as unknown as Record<string, any>, slug, worktree, taskResolution, log, writeReviewStateFn, enforceTaskAssigneeFn
        });

        // Record follow-up telemetry immediately after the implementer runs.
        // This is intentionally a separate stored phase from the initial
        // execute/active launch. The window is bounded to this round's launch
        // so each act-on-review round adds only its own usage.
        const followUpSinceMs = stageLaunchSinceMs(implementerLaunchResult?.result);
        recordStageStatsSafeFn('active', {
          stage: 'follow-up', slug, rootDir: worktree, worktree, implementer, reviewer,
          result: implementerLaunchResult?.result,
          sinceMs: followUpSinceMs || 0, log, error, state, writeReviewStateFn,
          model: resolveAgentModel(implementer!, worktree),
        });
      }

      const implementerArtifacts = await consumeImplementerArtifactsFn(slug, implementer!, {
        worktree,
        tmpDir: artifactDir,
        fallbackToTmp: true,
        readTokenFn,
        getCommentsFn: getCommentsFn as any,
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
        disposition = await pollForDispositionFn(prNumber as number, implementer!, sinceIso, token!, {
          getLatestDispositionForPrFn, sleepFn, intervalMs: pollIntervalMs, timeoutMs: pollTimeoutMs, retryCount: 0, verbose, label: `round ${attempt} disposition`, log
        });
      }

      if (isPollTimeout(disposition)) {
        // Timeout recovery loop for implementer
        const stateAny = state as unknown as Record<string, any>;
        while ((stateAny['implementerRetryCount'] || 0) < 2) {
          stateAny['implementerRetryCount'] = (stateAny['implementerRetryCount'] || 0) + 1;
          persistReviewStateOrThrow(writeReviewStateFn, slug, state, worktree);
          const elapsedStr = formatElapsed(Date.now() - Date.parse(stateAny['startedAt'] as string));
          const recoveryPrompt = `RECOVERY: Implementer disposition timeout after ${elapsedStr}. Please provide a disposition (PUSHBACK_ALL, BLOCKED, PARKED, or continue with fixes) for ${branch}.`;
          log(fmt.status('INFO', `Round ${attempt}: relaunching implementer (${implementer}) with recovery prompt (retry ${stateAny['implementerRetryCount']}/3)...`));

          let relaunchResult: any;
          try {
            relaunchResult = await startAgentFn('act-on-review', {
              agent: implementer,
              prompt: (actualImplementer: string) => (buildCompactActOnReviewPromptFn as any)({ implementer: implementer!, branch, attempt, reviewOutcome: reviewState, repoRoot: worktree, missionPath: effectiveMissionPath || undefined, actualImplementer, reviewBaseline }) + '\n\n' + recoveryPrompt,
              worktree, slug, role: 'implementer', exclude: [reviewer]
            });
          } catch (err: unknown) {
            error(fmt.status('FAIL', `Could not relaunch implementer agent (${implementer}): ${(err as Error).message}`));
            exit(1); return;
          }

          implementer = applyAgentFallbackFn({
            role: 'implementer', original: implementer!, launchResult: relaunchResult,
            state: state as unknown as Record<string, any>, slug, worktree, taskResolution, log, writeReviewStateFn, enforceTaskAssigneeFn
          });

          const retryArtifacts = await consumeImplementerArtifactsFn(slug, implementer!, {
            worktree,
            tmpDir: artifactDir,
            fallbackToTmp: true,
            readTokenFn,
            getCommentsFn: getCommentsFn as any,
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
            disposition = await pollForDispositionFn(prNumber as number, implementer!, sinceIso, token!, {
              getLatestDispositionForPrFn, sleepFn, intervalMs: pollIntervalMs, timeoutMs: pollTimeoutMs, retryCount: state.implementerRetryCount, verbose, label: `round ${attempt} disposition retry ${state.implementerRetryCount}`, log
            });
          }

          if (!isPollTimeout(disposition)) { break; }
        }

        if (isPollTimeout(disposition)) {
          persistReviewStateOrThrow(writeReviewStateFn, slug, state, worktree);
          log(fmt.status('INFO', `Autonomous review stopped: excessive implementer timeout retries`));
          return;
        }
      } else if (!disposition) {
        error(fmt.status('FAIL', `Implementer ${implementer} did not post an autonomous review disposition comment.`));
        exit(1); return;
      }

      // Suppress the duplicate message after re-launch
      reLaunch = null;
    } else if (reLaunch!) {
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
      persistReviewStateOrThrow(writeReviewStateFn, slug, state, worktree);
      log(fmt.status('INFO', `Autonomous review stopped: excessive implementer timeout retries`));
      return;
    }

    log(fmt.status('INFO', `Round ${attempt}: implementer disposition = ${disposition}`));

    if (disposition === 'PUSHBACK_ALL') {
      state.disposition = disposition as string;
      persistReviewStateOrThrow(writeReviewStateFn, slug, state, worktree);
      log(fmt.status('INFO', 'Autonomous review stopped: implementer pushed back on all remaining comments. Hand off to human review.'));
      return;
    }

    if (disposition === 'BLOCKED' || disposition === 'PARKED') {
      state.disposition = disposition as string;
      persistReviewStateOrThrow(writeReviewStateFn, slug, state, worktree);
      log(fmt.status('INFO', `Autonomous review stopped: implementer reported ${disposition}. Hand off to human review.`));
      return;
    }

    state.disposition = disposition as string;
    try { state.transitionTo('reviewing'); } catch (_) { /* ignore */ }
    persistReviewStateOrThrow(writeReviewStateFn, slug, state, worktree);
    log(fmt.status('INFO', `Round ${attempt}: implementer made changes. Continuing to round ${attempt + 1}.`));
  }

  if (!state.disposition) {
    state.disposition = 'MAX_ATTEMPTS';
    persistReviewStateOrThrow(writeReviewStateFn, slug, state, worktree);
  }
  log(fmt.status('INFO', `Autonomous review stopped: reached ${maxAttempts} attempts. Hand off to human review.`));
}

// Re-export from rebase module so callers that import from review-loop still work
export { commitSafeMissionArtifacts, rebaseBeforeReviewRound };
