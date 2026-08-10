import type { MissionId, MissionStatus } from './mission.js';
import type { MissionCommand } from './mission-workflow.js';
import type { RepositoryId } from './repository.js';

/**
 * Board lane-transition telemetry event.
 *
 * Emitted once every time a mission changes lane through the single
 * `transitionTask` compatibility path. Per ADR 0053, events are the source of
 * truth for the event history itself, but a replayed event log never becomes
 * the authoritative current lane of a mission.
 *
 * The event is persisted in the dedicated `board_lane_events` table
 * (migration 0003) with typed columns matching this interface. This follows
 * the same analytical pattern as `usage_statistics` — proper relational columns
 * instead of JSON blobs — so the data is queryable and defensible.
 *
 * Relationship to usage_statistics:
 *   board_lane_events records every lifecycle transition (the "when" and
 *   "how" of mission movement). usage_statistics records outcome measurements
 *   for completed missions (cycle time, tokens, cost, review rounds).
 *   Together they feed buildMetrics():
 *     - board_lane_events → MissionTransition[] → cumulativeFlow, wipSeries
 *     - usage_statistics  → MissionOutcome[]    → throughput and runtime metrics
 */
export interface LaneTransitionEvent {
  /** Mission id / slug whose lane changed. */
  readonly missionId: MissionId;
  /** Stable repository identifier. */
  readonly repositoryId: RepositoryId;
  /** Lane the mission moved from, or `null` if the mission had no prior status. */
  readonly from: MissionStatus | null;
  /** Lane the mission moved to (always a valid MissionStatus). */
  readonly to: MissionStatus;
  /** Which MissionCommand caused this transition. */
  readonly trigger: MissionCommand['type'];
  /** Agent that performed the transition (e.g. 'codex', 'claude', 'unknown'). */
  readonly agent: string;
  /** ISO-8601 timestamp of the transition. */
  readonly occurredAt: string;
  /**
   * Stable identifier for idempotency. Two emissions sharing an idempotency key
   * never produce two rows.
   */
  readonly idempotencyKey: string;
}

/**
 * Derive the `trigger` (MissionCommand type) from a from→to transition.
 *
 * The mapping follows the `decideMission` state machine in mission-workflow.ts:
 *   - backlog/refined/active → active  : 'activate'
 *   - active → review         : 'submit-for-review'
 *   - review → active         : 'request-changes'
 *   - review → integration    : 'approve'
 *   - integration → done      : 'integrate'
 *
 * Returns `null` when the transition is not recognised by the state machine
 * (e.g. a direct Markdown edit that bypassed the authority path).
 */
export function triggerFromTransition(
  from: MissionStatus | null,
  to: MissionStatus,
): MissionCommand['type'] | null {
  if (to === 'active' && (from === 'backlog' || from === 'refined' || from === 'active' || from === null)) {
    return 'activate';
  }
  if (from === 'active' && to === 'review') {
    return 'submit-for-review';
  }
  if (from === 'review' && to === 'active') {
    return 'request-changes';
  }
  if (from === 'review' && to === 'integration') {
    return 'approve';
  }
  if (from === 'integration' && to === 'done') {
    return 'integrate';
  }
  return null;
}

/**
 * Validate that a string is a valid MissionStatus value.
 * Returns the typed value or `null` if not recognised.
 */
const MISSION_STATUS_VALUES = new Set([
  'backlog',
  'refined',
  'active',
  'review',
  'integration',
  'done',
]);

export function parseMissionStatus(value: string): MissionStatus | null {
  const normalized = value.trim().toLowerCase();
  return MISSION_STATUS_VALUES.has(normalized) ? normalized as MissionStatus : null;
}
