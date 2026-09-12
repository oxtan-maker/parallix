/**
 * Review Agent Fallback Module
 *
 * Owns agent identity repair after a launcher fallback, reviewer selection from
 * a prepared snapshot, stage-launch de-duplication, stage telemetry recording,
 * and the pre-review Graphify knowledge-graph refresh. Extracted from
 * `review-loop.ts` so the loop keeps orchestration only.
 */

import * as fmt from '../../application/presentation/cli-format.js';
import { run } from '../git/git.js';
import { enforceTaskAssignee } from '../backlog/backlog.js';
import { ReviewState, writeReviewState, VALID_PHASES, persistReviewStateOrThrow } from './review-state.js';
import type { MissionStore } from '../../application/domain-ports.js';
import { PreparedAgentSelection } from '../../application/services/agent-selection.js';
import { recordAgentSelectionOutcome } from '../../application/services/agent-selection-telemetry.js';
import { workflowLauncherStatus } from '../agents/agents.js';
import { resolveStageTelemetry } from '../agents/stage-telemetry.js';
import * as statsModule from '../cli/commands/stats.js';
import { updateGraphifyKnowledgeGraph } from '../filesystem/mission-utils.js';

/** Lazily loaded stats module — loaded on first use to avoid circular dependency. */
let _stats: any = null;
export function getStats(): any {
  if (!_stats) {
    _stats = statsModule;
  }
  return _stats as any;
}

// Stage telemetry recording is best-effort: a failure must never break the
// review loop. Token columns are populated only for the codex role (the C2 rule
// guarantees at most one of implementer/reviewer is codex); other families
// record honest zeros (architecture migration).
//
// Codex writes a fresh-counter rollout per launch, so we sum total_token_usage
// across every rollout since the FIRST launch for this stored mission phase and
// agent family. For non-Codex families we accumulate launcher-attached telemetry
// one launch at a time, de-duped via review-state metadata, so Claude/custom rows
// are cumulative too. A family switch creates a separate row instead of mixing
// agents in one record.
export function stageLaunchFingerprint(agentFamily: string, result: { sessionId?: string; startedAt?: string; endedAt?: string; status?: number } | null): string {
  return [
    String(agentFamily || '').trim().toLowerCase(),
    result && result.sessionId ? String(result.sessionId) : '',
    result && result.startedAt ? String(result.startedAt) : '',
    result && result.endedAt ? String(result.endedAt) : '',
    result && result.status !== undefined && result.status !== null ? String(result.status) : '',
  ].join('|');
}

export async function markStageLaunchRecorded(
  state: Record<string, any> | null,
  opts: { stage: string; agentFamily: string; result?: Record<string, any>; slug: string; worktree?: string; writeReviewStateFn?: typeof writeReviewState; missionStore?: MissionStore | null }
): Promise<boolean> {
  const { stage, agentFamily, result, slug, worktree, writeReviewStateFn = writeReviewState, missionStore = null } = opts || {};
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
  await persistReviewStateOrThrow(writeReviewStateFn, slug, state as ReviewState, worktree || process.cwd(), missionStore);
  return true;
}

export async function recordStageStatsSafe(
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
    missionStore?: MissionStore | null;
  }
): Promise<void> {
  const { stage, slug, rootDir, worktree, implementer, reviewer, result, sinceMs, log, state, writeReviewStateFn = writeReviewState, model = null, missionStore = null } = opts;
  let durationMinutes = 0;
  if (result && result.startedAt && result.endedAt) {
    durationMinutes = (Date.parse(result.endedAt) - Date.parse(result.startedAt)) / 60000;
  }
  const telemetry = resolveStageTelemetry({ worktree: worktree || '', result: result || {}, sinceMs: sinceMs || 0 });
  try {
    const actorFamily = kind === 'review' ? reviewer : implementer;
    if (state && actorFamily && !(await markStageLaunchRecorded(state, {
      stage,
      agentFamily: actorFamily,
      result,
      slug,
      worktree,
      writeReviewStateFn,
      missionStore
    }))) {
      return;
    }
    try { getStats().accumulateStageStats({ stage, slug, rootDir, implementer, reviewer, telemetry, durationMinutes, model }); } catch { /* best-effort */ }
  } catch (err: unknown) {
    log?.(fmt.status('WARN', `Could not record ${kind} stats for ${slug}: ${(err as Error).message}`));
  }
}

// ============================================================================
// Pre-review Setup
// ============================================================================

export function maybeUpdateGraphifyBeforeReview(
  rootDir: string,
  { commandRunner = run, log = fmt.log.plain }: { commandRunner?: typeof run; log?: (_msg: string) => void } = {}
): unknown {
  // Lazy require to break circular dependency with core/mission-utils
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
export async function applyAgentFallback(opts: {
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
  missionStore?: MissionStore | null;
}): Promise<string> {
  const { role, original, launchResult, state, slug, worktree, taskResolution, log = fmt.log.plain, writeReviewStateFn = writeReviewState, enforceTaskAssigneeFn, missionStore = null } = opts;
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
  await persistReviewStateOrThrow(writeReviewStateFn, slug, state as ReviewState, worktree || process.cwd(), missionStore);
  if (role === 'implementer' && taskResolution && taskResolution.ok) {
    if (enforceTaskAssigneeFn && !enforceTaskAssigneeFn(taskResolution.taskFile, fallback)) {
      log(fmt.status('WARN', `Could not enforce fallback implementer ${fallback} in backlog task.`));
    }
  }
  return fallback;
}

export async function persistNormalizedPhaseRepair(
  slug: string,
  state: ReviewState,
  worktree: string,
  { log = fmt.log.plain, writeReviewStateFn = writeReviewState, missionStore = null }: { log?: (_msg: string) => void; writeReviewStateFn?: typeof writeReviewState; missionStore?: MissionStore | null } = {}
): Promise<void> {
  if (!state || !state.phaseOriginal || (VALID_PHASES as readonly string[]).includes(state.phaseOriginal)) {
    return;
  }
  log(fmt.status('WARN', `Persisted review phase "${state.phaseOriginal}" is invalid. Repairing to "${state.phase}".`));
  await persistReviewStateOrThrow(writeReviewStateFn, slug, state, worktree, missionStore);
  state.phaseOriginal = null;
}

/** Synchronous reviewer selection from the snapshot materialized for this loop. */
export function selectPreparedReviewer(selection: PreparedAgentSelection, excluded: ReadonlySet<string>): string {
  return selection.select('review', { excluded: new Set([...excluded].map((family) => family as any)) });
}

export function stageWindowKey(stage: string, agentFamily: string): string {
  const normalizedStage = String(stage || 'default').trim().toLowerCase() || 'default';
  const normalizedAgent = String(agentFamily || '').trim().toLowerCase();
  return `${normalizedStage}:${normalizedAgent}`;
}

function logSingleFamilyFallback(
  agents: string[],
  implementer: string,
  workflowLauncherStatusFn: (_agent: string) => { supported: boolean; detail: string },
  log: (_message: string) => void,
): void {
  const unavailable = agents
    .filter((agent) => agent !== implementer)
    .map((agent) => `${agent}: ${workflowLauncherStatusFn(agent).detail || 'unavailable'}`)
    .join('; ');
  log(fmt.status('WARN', `no different-family agent is runnable for implementer "${implementer}"; unavailable families: ${unavailable}.`));
  log(fmt.status('WARN', `Single-family fallback: reviewer="${implementer}" is the PR author family; local review will run, but external formal approval will be required.`));
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

/**
 * Resolve the reviewer identity for this loop: explicit, persisted, or
 * auto-derived, then walk the blocked/unsupported fallback chain.
 * Returns null when no runnable reviewer route exists (caller exits non-zero).
 */
export function resolveReviewerIdentity(opts: {
  reviewer?: string;
  implementer: string;
  isContinue: boolean;
  persisted: Record<string, any> | null;
  agents: string[];
  selectReviewer: (_excluded: Set<string>) => string;
  workflowLauncherStatusFn: typeof workflowLauncherStatus;
  buildAutonomousReviewMatrixFn: () => any;
  formatMatrixSummaryFn: (_matrix: any) => string[];
  maxAttempts: number;
  dryRun: boolean;
  forgejoEnabled: boolean;
  slug: string;
  log: (_msg: string) => void;
  error: (_msg: string) => void;
}): { reviewer: string; reviewerSource: string } | null {
  let {
    reviewer,
    implementer,
    isContinue,
    persisted,
    agents,
    selectReviewer,
    workflowLauncherStatusFn,
    buildAutonomousReviewMatrixFn,
    formatMatrixSummaryFn,
    maxAttempts,
    dryRun,
    forgejoEnabled,
    slug,
    log,
    error,
  } = opts;

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
          reviewer = selectReviewer(new Set([implementer]));
          recordAgentSelectionOutcome(log, 'nominated', { agent: reviewer, step: 'review' });
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
        logSingleFamilyFallback(agents, implementer, workflowLauncherStatusFn, log);
          reviewer = implementer;
          recordAgentSelectionOutcome(log, 'fallback', { agent: reviewer, step: 'review', reason: 'single-family' });
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
          return null;
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
          return null;
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
          return null;
        }
      }
    } else {
      let reviewerStatus = workflowLauncherStatusFn(reviewer);
      const triedReviewers = new Set<string>();
      while (!agents.includes(reviewer) || !reviewerStatus.supported) {
        if (!agents.includes(reviewer)) {
          recordAgentSelectionOutcome(log, 'skipped-blocked', { agent: reviewer, step: 'review' });
        }
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
          return null;
        }

        const excludeSet = new Set([...triedReviewers, implementer]);
        let fallback: string | undefined;
        let fallbackStatus: { agent: string; supported: boolean; detail: string } | null;
        try {
          // Legacy fallback seam retained when no prepared snapshot is supplied:
          // selectAgentFn('review', { exclude: excludeSet })
          fallback = selectReviewer(excludeSet);
          if (fallback) { recordAgentSelectionOutcome(log, 'nominated', { agent: fallback, step: 'review', retry: true }); }
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
            logSingleFamilyFallback(agents, implementer, workflowLauncherStatusFn, log);
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
          return null;
        }

        const reason = !agents.includes(reviewer) ? 'blocked or unsupported' : 'launcher is not available';
        log(fmt.status('WARN', `Unsupported reviewer: "${reviewer}" (${reason}); trying fallback "${fallback}".`));
        reviewer = fallback;
        reviewerStatus = fallbackStatus!;
        reviewerSource = reviewerSource === 'persisted' ? 'persisted-fallback' : 'auto-derived-fallback';
      }
    }

    log(fmt.status('INFO', `Selected reviewer: ${reviewer} (${reviewerSource})`));

  return { reviewer: reviewer!, reviewerSource };
}
