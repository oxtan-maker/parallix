import type { OperationalHistoryEntry, OperationalHistoryRepository } from '../ports/operation-history.js';
import type { MissionId } from '../../domain/mission.js';
import type { MissionCommand } from '../../domain/mission-workflow.js';

/**
 * One lifecycle operation an operator ran, as the board's operation log shows
 * it.
 *
 * The event describes a transition the mission actually made. It is derived
 * from the same `MissionCommand` trigger the lane event carries, so the two
 * histories cannot disagree about what happened, and neither is ever read back
 * as the mission's current state (ADR 0053: events are authoritative for the
 * history itself, never for current Mission state).
 */
export interface LifecycleOperationEvent {
  readonly missionId: MissionId;
  /** The command that caused the transition. */
  readonly trigger: MissionCommand['type'];
  /** Lane the mission moved to — the operator-visible result. */
  readonly toStatus: string;
  /** Agent that performed the operation (`'unknown'` when unattributed). */
  readonly agent: string;
  readonly occurredAt: string;
}

/** `event_type` recorded for a lifecycle operation. */
export function operationEventType(trigger: MissionCommand['type']): string {
  return `mission.${trigger}`;
}

/**
 * Map a lifecycle operation onto the stored history entry.
 *
 * `eventData` is the JSON shape `ConcreteOperationLogReadAdapter` already
 * reads: a `message` for the operator and an `agent` for attribution.
 */
export function operationEventToEntry(event: LifecycleOperationEvent): OperationalHistoryEntry {
  return {
    eventType: operationEventType(event.trigger),
    eventData: JSON.stringify({
      missionId: event.missionId,
      message: `${event.missionId} → ${event.toStatus}`,
      agent: event.agent,
    }),
    createdAt: event.occurredAt,
  };
}

/**
 * Operation-log write side.
 *
 * Persists lifecycle operations to the existing `operational_history` table
 * through `OperationalHistoryRepository`. The recorder does not open a
 * database or start a transaction of its own: its caller appends the operation
 * inside the same transaction as the lane-transition event that describes the
 * same state change, so the two rows commit together or not at all.
 */
export class OperationEventRecorder {
  private readonly historyRepo: OperationalHistoryRepository;

  constructor(historyRepo: OperationalHistoryRepository) {
    this.historyRepo = historyRepo;
  }

  async append(event: LifecycleOperationEvent): Promise<void> {
    await this.historyRepo.append(operationEventToEntry(event));
  }
}
