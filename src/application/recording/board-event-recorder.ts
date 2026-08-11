import type { BoardLaneEventEntry, BoardLaneEventRepository } from '../ports/operation-history.js';
import type { LaneTransitionEvent } from '../../domain/board-event.js';
import { parseMissionStatus } from '../../domain/board-event.js';
import type { MissionId } from '../../domain/mission.js';
import type { RepositoryId } from '../../domain/repository.js';
import type { MissionCommand, MissionTransition } from '../../domain/mission-workflow.js';

/**
 * Board lane-transition event recorder — the write side of the board
 * time-series metrics.
 *
 * Persists typed `LaneTransitionEvent` to the dedicated `board_lane_events`
 * table (migration 0003) using the `BoardLaneEventRepository`. Follows the
 * same analytical pattern as `usage_statistics` — typed columns, proper
 * indexes, no JSON encoding.
 *
 * Idempotent per idempotency key at the storage layer (UNIQUE index).
 *
 * Authority: operator-local telemetry only (ADR 0051). This recorder never
 * mutates repository Git/Markdown lifecycle state.
 */
export class BoardEventRecorder {
  private readonly laneEventRepo: BoardLaneEventRepository;
  private _failureCount = 0;

  constructor(laneEventRepo: BoardLaneEventRepository) {
    this.laneEventRepo = laneEventRepo;
  }

  /**
   * Record a lane-transition event.
   *
   * Returns `true` when a new row was written, `false` when the idempotency key
   * was already recorded (idempotent no-op).
   */
  async append(event: LaneTransitionEvent): Promise<boolean> {
    return await this.laneEventRepo.append(eventToEntry(event));
  }

  get failureCount(): number { return this._failureCount; }

  recordFailure(): void { this._failureCount += 1; }
}

/**
 * Best-effort recording that never rejects.
 *
 * Operator-local telemetry must never block or corrupt the authoritative
 * transition (ADR 0051): if the recorder throws — repository unavailable,
 * storage-layer constraint, serialization error — the failure is swallowed and
 * the caller proceeds. Returns `true` only when a new row was written.
 */
export async function recordLaneTransitionSafely(
  recorder: Pick<BoardEventRecorder, 'append'> & Partial<Pick<BoardEventRecorder, 'recordFailure'>>,
  event: LaneTransitionEvent,
): Promise<boolean> {
  try {
    return await recorder.append(event);
  } catch {
    recorder.recordFailure?.();
    return false;
  }
}

/**
 * Map a typed `LaneTransitionEvent` to a `BoardLaneEventEntry` for storage.
 * The mapping is 1:1 — no JSON encoding, every field maps to a typed column.
 */
export function eventToEntry(event: LaneTransitionEvent): BoardLaneEventEntry {
  return {
    repositoryId: event.repositoryId,
    missionId: event.missionId,
    fromStatus: event.from,
    toStatus: event.to,
    trigger: event.trigger,
    agent: event.agent,
    occurredAt: event.occurredAt,
    idempotencyKey: event.idempotencyKey,
  };
}

/**
 * Convert a stored `BoardLaneEventEntry` back into a `LaneTransitionEvent`.
 * Returns `null` when the entry has missing required fields or invalid status values.
 */
export function entryToEvent(
  entry: BoardLaneEventEntry,
): LaneTransitionEvent | null {
  if (!entry.missionId || !entry.toStatus || !entry.trigger || !entry.idempotencyKey) {
    return null;
  }
  const fromStatus = entry.fromStatus ? parseMissionStatus(entry.fromStatus) : null;
  const toStatus = parseMissionStatus(entry.toStatus);
  if (!toStatus) {
    return null;
  }
  const trigger = entry.trigger as MissionCommand['type'];
  return {
    missionId: entry.missionId as MissionId,
    repositoryId: entry.repositoryId as RepositoryId,
    from: fromStatus,
    to: toStatus,
    trigger,
    agent: entry.agent,
    occurredAt: entry.occurredAt,
    idempotencyKey: entry.idempotencyKey,
  };
}

/**
 * Convert a recorded lane-transition event into the `MissionTransition` shape
 * consumed by `buildMetrics` (`src/application/projections/metrics.ts`).
 *
 * The mapping is lossless: every field in LaneTransitionEvent has a direct
 * counterpart in MissionTransition, including the null `from` that marks the
 * mission's intake.
 */
export function laneTransitionEventToMissionTransition(
  event: LaneTransitionEvent,
): MissionTransition {
  return {
    missionId: event.missionId,
    from: event.from,
    to: event.to,
    trigger: event.trigger,
    actor: event.agent,
    occurredAt: event.occurredAt,
  };
}
