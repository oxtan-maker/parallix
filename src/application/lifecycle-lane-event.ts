/**
 * Lane events for the lifecycle steps that live outside `decideMission`.
 *
 * `MissionLifecycleService` builds its own event from `triggerFromTransition`,
 * which only knows the lane-to-lane commands the state machine owns. Mission
 * intake (entry into `backlog`) and closure are lifecycle steps that the state
 * machine does not model as a `MissionCommand`, yet both change what the lane
 * history must show: without them, backlog age has no start and the final lane
 * dwell of every mission is truncated.
 *
 * Every event built here is still committed by the same transition-aware store
 * operation (`saveWithTransition`), so the aggregate write and its lane event
 * remain one unit (ADR 0053 transaction rule 1).
 */

import type { MissionTransitionStore } from './domain-ports.js';
import type { LaneTransitionEvent } from '../domain/board-event.js';
import type { Mission, MissionId, MissionStatus } from '../domain/mission.js';
import type { MissionCommand } from '../domain/mission-workflow.js';

/**
 * Triggers a lane event can carry: every `MissionCommand` type, plus the two
 * lifecycle steps outside the state machine.
 */
export type LifecycleLaneTrigger = MissionCommand['type'] | 'intake' | 'close' | 'recover-active';

/**
 * Widen a lifecycle trigger to the field type `LaneTransitionEvent` declares.
 *
 * `LaneTransitionEvent.trigger` is typed as `MissionCommand['type']` and the
 * storage column is plain TEXT (`migrations/0003-board-lane-events.sql`).
 * Recording `intake` and `close` therefore needs no schema, interface or state
 * machine change — only this one documented widening, kept in a single place so
 * the extra vocabulary is discoverable rather than scattered across cast sites.
 */
export function laneEventTrigger(trigger: LifecycleLaneTrigger): MissionCommand['type'] {
  return trigger as MissionCommand['type'];
}

/**
 * The deterministic idempotency key every lane event uses.
 *
 * Derived from the transition identity — mission, trigger, occurrence time — so
 * replaying one transition writes one row, while two genuinely distinct
 * transitions of the same kind never collide. This is the same shape
 * `MissionLifecycleService` already applies
 * (`src/application/mission-lifecycle-service.ts:142`).
 */
export function laneEventIdempotencyKey(
  mission: MissionId,
  trigger: LifecycleLaneTrigger,
  occurredAt: string,
): string {
  return `${mission}:${trigger}:${occurredAt}`;
}

export interface LifecycleLaneEventInput {
  readonly mission: Mission;
  /** Lane the mission left, or `null` when it had no prior lane (intake). */
  readonly from: MissionStatus | null;
  readonly trigger: LifecycleLaneTrigger;
  readonly agent: string;
  readonly occurredAt: string;
  /** Supplying the same key twice records the transition once. */
  readonly idempotencyKey?: string;
}

/** Build the lane event describing a lifecycle step of the given mission. */
export function lifecycleLaneEvent(input: LifecycleLaneEventInput): LaneTransitionEvent {
  return {
    missionId: input.mission.id,
    repositoryId: input.mission.repositoryId,
    from: input.from,
    to: input.mission.status,
    trigger: laneEventTrigger(input.trigger),
    agent: input.agent,
    occurredAt: input.occurredAt,
    idempotencyKey: input.idempotencyKey
      ?? laneEventIdempotencyKey(input.mission.id, input.trigger, input.occurredAt),
  };
}

/** True for a store refusal caused by a lane event that was already recorded. */
export function isDuplicateLaneEvent(error: unknown): boolean {
  return error instanceof Error && /Duplicate idempotency key/.test(error.message);
}

/**
 * True when a duplicate-key refusal is a replay rather than a collision.
 *
 * Callers that want a retried operation to record one lane event supply a
 * stable idempotency key (`handoff-${slug}` at the review transition in
 * `src/application/handoff-command-use-case.ts`). The store honours that by
 * refusing the second write — but the refusal rolls the whole transaction back,
 * so the aggregate change is discarded together with the event that was already
 * durable, and the caller sees a conflict for work the history already records.
 *
 * The discriminator is the recorded event, never the incoming command: a
 * refusal is a replay only when the event stored under that exact key describes
 * this same transition (same mission, same lane pair, same trigger). Reusing a
 * key for a genuinely different transition matches nothing and stays a
 * conflict, as does a store that keeps no lane history — the narrow answer is
 * the safe one when the transition cannot be proven already recorded.
 */
export async function isReplayedLaneEvent(
  store: MissionTransitionStore,
  event: LaneTransitionEvent,
): Promise<boolean> {
  if (!store.findTransitions) {
    return false;
  }
  const recorded = await store.findTransitions(event.missionId);
  return recorded.some((entry) => entry.idempotencyKey === event.idempotencyKey
    && entry.trigger === event.trigger
    && (entry.fromStatus ?? null) === event.from
    && entry.toStatus === event.to);
}
