import type { AgentFamily } from './agents.js';
import type { MissionId } from './mission.js';

/**
 * The board-relevant long-running operations. Each value is a phase an
 * operator can see on the board, not a lifecycle lane.
 */
export type ExecutionActivityStage =
  | 'draft'
  | 'execute'
  | 'waiting'
  | 'review'
  | 'review-response'
  | 'integrate'
  /**
   * A fleet recovery supervisor is working this mission: the supervision
   * itself, or the fresh recovery agent it started (ADR 0059). It is a phase an
   * operator can see, never a lifecycle lane — recovery is not a mission state.
   */
  | 'recovery';

/**
 * What the newest event says about the mission:
 *
 *  - `running` — an operation is underway;
 *  - `ended`   — the operation finished; nobody is working the mission;
 *  - `blocked` — the operation could not continue autonomously (for example
 *    every eligible agent family is unavailable) and needs an operator.
 */
export type ExecutionActivityState = 'running' | 'ended' | 'blocked';

export interface ExecutionActivity {
  readonly purpose?: 'repair';
  readonly missionId: MissionId;
  /** Correlates the events of one operation. Not a durable run identity. */
  readonly operationId: string;
  readonly phase: ExecutionActivityStage;
  readonly state: ExecutionActivityState;
  /** One operator-facing line describing what is happening. */
  readonly summary: string;
  /** The family running the operation, or `null` when none applies. */
  readonly agent: AgentFamily | null;
  /**
   * The `px` process that published the event. Used only to reconcile a
   * `running` fact left behind by an abnormally terminated process; it is not
   * a stored Process entity (ADR 0053 excludes one).
   */
  readonly processId: number | null;
  /**
   * The publishing process's start identity, when the platform could supply
   * one. Paired with `processId` it survives pid reuse; absent (legacy rows,
   * or a platform that cannot report it) degrades reconciliation to the
   * bare-pid check it used before.
   */
  readonly processIdentity?: string | null;
  /** Why the operation cannot continue; `null` unless `state` is `blocked`. */
  readonly blockedReason: string | null;
  readonly occurredAt: string;
  /**
   * The operational store's own append order for this event, when the row came
   * from storage. Two events published inside the same millisecond are ordered
   * by this and never by timestamp coincidence; a freshly built (unstored)
   * event has none.
   */
  readonly sequence?: number;
}


export type ActivityFreshness = 'live' | 'unverified' | 'stale';
export interface ObservedActivity {
  readonly operationId: string;
  readonly phase: string;
  readonly summary: string;
  readonly agent: AgentFamily | null;
  readonly updatedAt: string;
  readonly freshness: ActivityFreshness;
}
export type ProcessLivenessProbe = (_pid: number, _identity: string | null) => boolean | null;

export interface ObservedExecutionFacts {
  /** Identity of the resolved activity, including terminal and blocked reports. */
  readonly operationId?: string;
  readonly currentWork: ObservedActivity | null;
  readonly blockingReason: string | null;
}

export interface ActivityObservation {
  readonly nowMs: number;
  /**
   * How long an unverifiable `running` fact stays credible. Past this, the
   * fact is reported `stale` so an abnormally terminated process cannot leave
   * a mission displayed as permanently running.
   */
  readonly ttlMs: number;
  /**
   * Bounded recovery evidence only. Omitted (or returning `null`) means the
   * board cannot check, which yields `unverified` rather than a fabricated
   * conclusion.
   */
  readonly isProcessAlive?: ProcessLivenessProbe;
}

/** The current activity of one execution, including suspended parent work. */
export interface ActivityFrame { readonly sourceId: string; readonly event: ExecutionActivity; }
export interface ExecutionActivitySnapshot {
  readonly missionId: MissionId;
  readonly operationId: string;
  readonly frames: readonly ActivityFrame[];
  readonly closedSources: readonly string[];
  readonly supersededOperations: readonly string[];
  readonly retainedBlocker: ExecutionActivity | null;
  readonly terminal: ExecutionActivity | null;
}

/**
 * The sole activity transition owner. Execution identity determines replacement;
 * source identity determines nesting. Process liveness never grants precedence.
 */
export function advanceExecutionActivity(
  previous: ExecutionActivitySnapshot | null,
  event: ExecutionActivity,
  sourceId: string,
  admittedExecutionId: string | null = null,
): ExecutionActivitySnapshot | null {
  requireActivityIdentity(previous, event, sourceId);
  if (!mayPublishActivity(previous, event, admittedExecutionId)) { return previous; }
  if (previous && previous.operationId !== event.operationId && event.state !== 'running') { return previous; }
  const state = previous?.operationId === event.operationId ? previous : beginActivity(previous, event);
  if (state.closedSources.includes(sourceId)) { return state; }
  const index = state.frames.findIndex(frame => frame.sourceId === sourceId);
  if (event.state === 'blocked' && index < 0 && state.frames.length) { return state; }
  return event.state === 'ended' ? closeActivityFrame(state, event, sourceId, index)
    : updateActivityFrame(state, event, sourceId, index);
}

function mayPublishActivity(previous: ExecutionActivitySnapshot | null, event: ExecutionActivity, admitted: string | null): boolean {
  if (admitted !== null && admitted !== event.operationId) { return false; }
  return !previous?.supersededOperations.includes(event.operationId);
}

function requireActivityIdentity(previous: ExecutionActivitySnapshot | null, event: ExecutionActivity, sourceId: string): void {
  if (!sourceId.trim()) { throw new Error('Activity requires a publication source'); }
  if (previous && previous.missionId !== event.missionId) { throw new Error('Activity belongs to another mission'); }
}

function beginActivity(previous: ExecutionActivitySnapshot | null, event: ExecutionActivity): ExecutionActivitySnapshot {
  return {
    missionId: event.missionId, operationId: event.operationId, frames: [], closedSources: [],
    supersededOperations: previous ? [...previous.supersededOperations, previous.operationId] : [],
    retainedBlocker: event.phase === 'recovery' ? suspendedBlocker(previous) : null,
    terminal: null,
  };
}

function suspendedBlocker(previous: ExecutionActivitySnapshot | null): ExecutionActivity | null {
  const standing = previous?.frames.at(-1)?.event;
  return standing?.state === 'blocked' ? standing : previous?.retainedBlocker ?? null;
}

function closeActivityFrame(state: ExecutionActivitySnapshot, event: ExecutionActivity, sourceId: string, index: number): ExecutionActivitySnapshot {
  // Closing a failed bracket does not erase its unresolved failure.
  if (index >= 0 && state.frames[index].event.state === 'blocked') { return state; }
  return { ...state, frames: state.frames.filter(frame => frame.sourceId !== sourceId),
    closedSources: [...new Set([...state.closedSources, sourceId])],
    terminal: index === 0 || !state.frames.length ? event : state.terminal };
}

function updateActivityFrame(state: ExecutionActivitySnapshot, event: ExecutionActivity, sourceId: string, index: number): ExecutionActivitySnapshot {
  const removed = index >= 0 ? state.frames.slice(index + 1) : [];
  return { ...state,
    frames: [...(index >= 0 ? state.frames.slice(0, index) : state.frames), { sourceId, event }],
    closedSources: [...new Set([...state.closedSources, ...removed.map(frame => frame.sourceId)])],
    retainedBlocker: event.phase === 'recovery' ? state.retainedBlocker : null,
    terminal: null,
  };
}

/** A projection of checked activity and bounded liveness; never a history replay. */
export function projectExecutionActivity(
  snapshots: readonly ExecutionActivitySnapshot[],
  options: ActivityObservation,
): Map<MissionId, ObservedExecutionFacts> {
  return new Map(snapshots.map(snapshot => [snapshot.missionId, observeActivity(snapshot, options)]));
}

function observeActivity(snapshot: ExecutionActivitySnapshot, options: ActivityObservation): ObservedExecutionFacts {
  const event = snapshot.frames.at(-1)?.event ?? snapshot.terminal;
  const blocker = snapshot.retainedBlocker;
  if (!event || event.state === 'ended') {
    return { operationId: snapshot.operationId, currentWork: null, blockingReason: blocker?.blockedReason ?? null };
  }
  if (event.state === 'blocked') {
    return { operationId: snapshot.operationId, currentWork: null,
      blockingReason: event.blockedReason ?? 'operation cannot continue autonomously' };
  }
  const freshness = activityFreshness(event, options);
  if (freshness === null || freshness === 'stale' && blocker) {
    return { operationId: snapshot.operationId, currentWork: null, blockingReason: blocker?.blockedReason ?? null };
  }
  return { operationId: snapshot.operationId, blockingReason: null,
    currentWork: { operationId: event.operationId, phase: event.phase, summary: event.summary,
      agent: event.agent, updatedAt: event.occurredAt, freshness } };
}

function activityFreshness(event: ExecutionActivity, options: ActivityObservation): ActivityFreshness | null {
  const alive = event.processId === null || !options.isProcessAlive
    ? null : options.isProcessAlive(event.processId, event.processIdentity ?? null);
  if (alive === false) { return null; }
  if (alive === true) { return 'live'; }
  const age = options.nowMs - Date.parse(event.occurredAt);
  return Number.isNaN(age) || age > options.ttlMs ? 'stale' : 'unverified';
}

export const ACTIVITY_OBSERVATION_TTL_MS = 5 * 60 * 1000;

/**
 * Whether this current work means an agent is progressing the mission.
 *
 * `unverified` counts: the board could not check, and turning a failed
 * observation into "nobody is working" is exactly the silent conversion AC #8
 * forbids. `stale` does not count — that is the bound on a crashed process.
 */
export function isWorkInProgress(work: ObservedActivity | null | undefined): work is ObservedActivity {
  return work !== null && work !== undefined && work.freshness !== 'stale';
}
