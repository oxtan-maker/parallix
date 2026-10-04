/**
 * Review Agent Fallback Module
 *
 * Owns agent identity repair after a launcher fallback for the rebase and
 * integrate workflows, stage-launch de-duplication, stage telemetry recording,
 * and the pre-review Graphify knowledge-graph refresh.
 */

import * as fmt from '../../application/presentation/cli-format.js';
import { run } from '../git/git.js';
import { enforceTaskAssignee } from '../backlog/backlog.js';
import { ReviewState, readReviewState, writeReviewState, VALID_PHASES, persistReviewStateOrThrow } from './review-state.js';
import type { MissionStore } from '../../application/domain-ports.js';
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
    const currentState = state && await readReviewState(slug, worktree || process.cwd(), missionStore);
    if (state && actorFamily && !(await markStageLaunchRecorded(currentState || state, {
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
  state?: Record<string, any>;
  slug: string;
  worktree?: string;
  taskResolution?: Record<string, any>;
  log?: (_msg: string) => void;
  writeReviewStateFn?: typeof writeReviewState;
  enforceTaskAssigneeFn?: typeof enforceTaskAssignee;
  missionStore?: MissionStore | null;
}): Promise<string> {
  const { role, original, launchResult, state = {}, slug, worktree, taskResolution, log = fmt.log.plain, writeReviewStateFn = writeReviewState, enforceTaskAssigneeFn, missionStore = null } = opts;
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

export function stageWindowKey(stage: string, agentFamily: string): string {
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
