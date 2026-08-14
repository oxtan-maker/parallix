import type { MissionId } from '../../domain/mission.js';
import type { CurrentWorkEvent } from '../recording/current-work-recorder.js';
import type { CurrentWorkFreshness, LiveMissionWork } from './mission-board.js';

export type { CurrentWorkFreshness };

/**
 * Read side of the current-work fact: newest event per mission, reconciled
 * against bounded evidence that the publishing process still exists.
 *
 * Why reconciliation exists at all: the recorder appends and never cleans up,
 * so a `px` process killed mid-operation leaves a `running` event behind. This
 * module is the only place allowed to conclude anything about that event's
 * continued truth, and it is deliberately conservative — a failed observation
 * produces `unverified`, never `idle`.
 */

/**
 * `CurrentWorkFreshness` grades a surviving `running` fact. A process observed
 * *dead* is a fourth case and produces no current work at all: that is
 * known-stopped, which the board must not confuse with the unverifiable
 * grades.
 */

/**
 * Whether a published process is still running: `null` means unobservable.
 *
 * `identity` is the publisher's recorded process-start identity, when it had
 * one. It exists so a recycled pid now held by an unrelated process is
 * reported dead instead of keeping a mission WORKING forever.
 */
export type ProcessLivenessProbe = (_processId: number, _identity: string | null) => boolean | null;

/** Read adapter for the current-work authority. */
export interface CurrentWorkReadAdapter {
  /**
   * The newest current-work event for every mission that has one. Missions
   * with no event are simply absent; absence is "no fact recorded", not
   * "known idle".
   */
  loadCurrentWork(): Promise<readonly CurrentWorkEvent[]>;
}

/**
 * The operational facts one mission's current-work event resolves to.
 *
 * Both fields feed `MissionOperationalFacts`, so the projection reuses the
 * card's existing `currentWork`/`blockingReason` vocabulary instead of adding a
 * parallel one.
 */
export interface CurrentWorkFacts {
  readonly currentWork: LiveMissionWork | null;
  readonly blockingReason: string | null;
}

export interface ReconcileCurrentWorkOptions {
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

/** Default freshness window for an unverifiable running fact: five minutes. */
export const CURRENT_WORK_TTL_MS = 5 * 60 * 1000;

/**
 * Reduce the current-work events to one fact per mission.
 *
 * The newest *running* event wins, but a terminal event only clears the
 * operation it belongs to. Wall-clock "newest event for the mission wins"
 * cannot express that: publications from two overlapping operations complete
 * out of order, so an old operation ending after newer work started would
 * silently blank a mission that is still being worked.
 *
 * Ordering is the operational store's own row order (`sequence`) whenever the
 * events came from storage; two events published inside the same millisecond
 * are then still deterministic. `occurredAt` remains the fallback for events
 * that never reached the store.
 *
 * Only the resulting fact is state. The earlier events stay history, so this is
 * not the replay-as-authority model ADR 0053 rejects.
 */
export function reconcileCurrentWork(
  events: readonly CurrentWorkEvent[],
  options: ReconcileCurrentWorkOptions,
): Map<MissionId, CurrentWorkFacts> {
  const byMission = new Map<MissionId, CurrentWorkEvent[]>();
  for (const event of events) {
    byMission.set(event.missionId, [...(byMission.get(event.missionId) ?? []), event]);
  }

  const facts = new Map<MissionId, CurrentWorkFacts>();
  for (const [missionId, missionEvents] of byMission) {
    const resolved = resolveOperation([...missionEvents].sort(byDurableOrder));
    if (resolved) { facts.set(missionId, reconcileOne(resolved, options)); }
  }
  return facts;
}

/** Durable append order, falling back to publication time for unstored events. */
function byDurableOrder(left: CurrentWorkEvent, right: CurrentWorkEvent): number {
  if (left.sequence !== undefined && right.sequence !== undefined) {
    return left.sequence - right.sequence;
  }
  return Date.parse(left.occurredAt) - Date.parse(right.occurredAt);
}

/**
 * The event that still describes the mission, or `null` when none does.
 *
 * A `running` event always replaces what came before it: that is the mission's
 * current work by definition. A terminal event is accepted only from the
 * operation that owns the standing work — anything else is a late report about
 * an operation that has already been superseded.
 */
function resolveOperation(ordered: readonly CurrentWorkEvent[]): CurrentWorkEvent | null {
  let standing: CurrentWorkEvent | null = null;
  for (const event of ordered) {
    if (event.state === 'running') { standing = event; continue; }
    if (standing !== null && !sameOperation(standing, event)) { continue; }
    // An operation that stopped *with a reason* is the operator's answer to
    // "why is nobody working this?". The same operation's bracket-closing
    // `ended` must not overwrite it with silence; only new work can.
    if (standing?.state === 'blocked' && event.state === 'ended') { continue; }
    standing = event;
  }
  return standing;
}

/**
 * Whether two events belong to the same operation.
 *
 * A missing `operationId` is a legacy row from before publication carried one.
 * Those keep the old, correlation-free behaviour rather than being treated as
 * a distinct operation that can never be cleared.
 */
function sameOperation(standing: CurrentWorkEvent, event: CurrentWorkEvent): boolean {
  return !standing.operationId || !event.operationId || standing.operationId === event.operationId;
}

function reconcileOne(event: CurrentWorkEvent, options: ReconcileCurrentWorkOptions): CurrentWorkFacts {
  if (event.state === 'ended') {
    return { currentWork: null, blockingReason: null };
  }
  if (event.state === 'blocked') {
    // Exhaustion is not "running slowly": no work is underway, and the reason
    // is the truthful thing to put in front of the operator.
    return { currentWork: null, blockingReason: event.blockedReason ?? 'operation cannot continue autonomously' };
  }

  const freshness = runningFreshness(event, options);
  if (freshness === null) {
    // The publishing process is gone. That is a known-stopped observation, so
    // the fact is cleared rather than kept as an aging "maybe".
    return { currentWork: null, blockingReason: null };
  }
  return {
    currentWork: {
      operationId: event.operationId,
      phase: event.phase,
      summary: event.summary,
      agent: event.agent,
      updatedAt: event.occurredAt,
      freshness,
    },
    blockingReason: null,
  };
}

/** Freshness of a `running` fact, or `null` when the publisher is known dead. */
function runningFreshness(
  event: CurrentWorkEvent,
  options: ReconcileCurrentWorkOptions,
): CurrentWorkFreshness | null {
  const alive = event.processId === null || !options.isProcessAlive
    ? null
    : options.isProcessAlive(event.processId, event.processIdentity ?? null);
  if (alive === true) { return 'live'; }
  if (alive === false) { return null; }
  const ageMs = options.nowMs - Date.parse(event.occurredAt);
  return Number.isNaN(ageMs) || ageMs > options.ttlMs ? 'stale' : 'unverified';
}

/**
 * Whether this current work means an agent is progressing the mission.
 *
 * `unverified` counts: the board could not check, and turning a failed
 * observation into "nobody is working" is exactly the silent conversion AC #8
 * forbids. `stale` does not count — that is the bound on a crashed process.
 */
export function isWorkInProgress(work: LiveMissionWork | null | undefined): boolean {
  return work !== null && work !== undefined && work.freshness !== 'stale';
}
