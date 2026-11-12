import type { MissionId, MissionStatus } from './mission.js';
import type { MissionCommand } from './mission-workflow.js';
import type { RepositoryId } from './repository.js';

const WORKFLOW_RETURN_STAGES = [
  'agent-review', 'human-review', 'declared-gates', 'integration-gates', 'pre-review-rebase',
] as const;
export type WorkflowReturnStage = typeof WORKFLOW_RETURN_STAGES[number];
export const DECLARED_GATES_RETURN_STAGE: WorkflowReturnStage = 'declared-gates';
/** Facts not already owned by the Review, lane event, or repair record. */
export interface WorkflowReturnIdentity {
  readonly stage: WorkflowReturnStage;
  /** Null together when the operator return had no durable workflow owner. */
  readonly operationId: string | null;
  readonly operationGeneration: number | null;
}
const RETURN_STAGES: ReadonlySet<string> = new Set(WORKFLOW_RETURN_STAGES);

/** Shared validation for every durable return-history boundary. */
export function parseWorkflowReturnIdentity(value: unknown): WorkflowReturnIdentity | undefined {
  if (!value || typeof value !== 'object') { return undefined; }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.stage !== 'string' || !RETURN_STAGES.has(candidate.stage)) { return undefined; }
  const operationId = candidate.operationId ?? null;
  const operationGeneration = candidate.operationGeneration ?? null;
  const unowned = operationId === null && operationGeneration === null;
  const owned = typeof operationId === 'string' && operationId.trim().length > 0
    && Number.isSafeInteger(operationGeneration) && Number(operationGeneration) >= 1;
  return unowned || owned ? { stage: candidate.stage as WorkflowReturnStage,
    operationId: unowned ? null : operationId as string,
    operationGeneration: unowned ? null : Number(operationGeneration) } : undefined;
}

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
  /** Return placement and durable operation authority not already represented by this event. */
  readonly returnIdentity?: WorkflowReturnIdentity;
}

/** A transition store refused an already-recorded lane-event identity. */
export class DuplicateLaneEventError extends Error {
  readonly kind = 'duplicate-lane-event';
  readonly idempotencyKey: string;

  constructor(idempotencyKey: string) {
    super(`Duplicate idempotency key: ${idempotencyKey}`);
    this.name = 'DuplicateLaneEventError';
    this.idempotencyKey = idempotencyKey;
  }
}

/**
 * Derive the `trigger` (MissionCommand type) from a from→to transition.
 *
 * The mapping follows the `decideMission` state machine in mission-workflow.ts:
 *   - backlog → refined      : 'refine'
 *   - refined/active/null → active : 'activate' (null is the intake identity)
 *   - active → refined       : 'abort-activation'
 *   - active → review         : 'submit-for-review'
 *   - review → active         : 'request-changes'
 *   - review → integration    : 'approve'
 *   - active → integration    : 'approve' (the repaired active lane, TASK-2514)
 *   - integration → active    : 'rebound-to-active'
 *   - integration → done      : 'integrate'
 *
 * Returns `null` when the transition is not recognised by the state machine
 * (e.g. a direct Markdown edit that bypassed the authority path).
 */
const TRANSITION_TRIGGERS: Readonly<Partial<Record<string, MissionCommand['type']>>> = {
  'backlog:refined': 'refine',
  'refined:active': 'activate',
  'active:active': 'activate',
  'null:active': 'activate',
  'active:refined': 'abort-activation',
  'active:review': 'submit-for-review',
  'review:active': 'request-changes',
  'review:integration': 'approve',
  'active:integration': 'approve',
  'integration:active': 'rebound-to-active',
  'integration:review': 'revoke-approval',
  'integration:done': 'integrate',
};

export function triggerFromTransition(from: MissionStatus | null, to: MissionStatus): MissionCommand['type'] | null {
  return TRANSITION_TRIGGERS[`${from}:${to}`] ?? null;
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
