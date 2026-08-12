import type { SqliteDatabaseAdapter } from '../../src/adapters/sqlite/database-adapter.js';
import type { SqliteBoardLaneEventRepository } from '../../src/adapters/sqlite/board-lane-event-repository.js';
import { insertUsageRow, laneEvent } from './task-2357-statistics-fixture.js';

// ---------------------------------------------------------------------------
// TASK-2363 production-certification fixture.
//
// Every mission below is persisted as real rows: lane events through
// `SqliteBoardLaneEventRepository`, telemetry through a parameter-bound INSERT
// into `usage_statistics`. Nothing constructs a `MissionTransition`,
// `MissionOutcome`, or `BoardMetrics` by hand.
//
// The lane shape is fixed so every dwell is a stated constant rather than a
// derived one. A mission that did not bounce is persisted as:
//
//   intake(created) → active(C-16) → review(C-7) → integration(C-3) → done(C)
//       backlog = C-created-16   active = 9   review = 4   integration = 3
//
// A mission that bounced once inserts one extra review→active→review pair:
//
//   intake → active(C-29) → review(C-20) → active(C-16) → review(C-7)
//          → integration(C-3) → done(C)
//       active = 9, 9   review = 4, 4   integration = 3
//
// The previous window uses the same shape with active = 20, review = 8,
// integration = 5, and the old history uses active = 600, review = 200,
// integration = 60 so that including it would be unmistakable.
// ---------------------------------------------------------------------------

export interface MissionShape {
  /** Dwell in `active`, per occupancy of the lane. */
  readonly activeMinutes: number;
  /** Dwell in `review`, per occupancy of the lane. */
  readonly reviewMinutes: number;
  /** Dwell in `integration`. */
  readonly integrationMinutes: number;
}

export const CURRENT_SHAPE: MissionShape = { activeMinutes: 9, reviewMinutes: 4, integrationMinutes: 3 };
export const PREVIOUS_SHAPE: MissionShape = { activeMinutes: 20, reviewMinutes: 8, integrationMinutes: 5 };
export const OLD_SHAPE: MissionShape = { activeMinutes: 600, reviewMinutes: 200, integrationMinutes: 60 };

export interface SeededMission {
  readonly repositoryId: string;
  readonly missionId: string;
  /** ISO instant the mission reached `done`. */
  readonly closedAt: string;
  /** Whole-lifecycle minutes; the intake instant is `closedAt` minus this. */
  readonly cycleTimeMinutes: number;
  readonly shape: MissionShape;
  readonly bounced: boolean;
  readonly classification: string;
  /** Omitted entirely: the mission completes with no telemetry at all. */
  readonly telemetry?: {
    readonly durationMinutes?: number;
    readonly inputTokens?: number;
    readonly costUsd?: number;
    /** `undefined` writes SQL NULL — an unknown number of review-fix rounds. */
    readonly prFixRounds?: number;
  };
}

function shift(at: string, minutes: number): string {
  return new Date(Date.parse(at) + minutes * 60_000).toISOString();
}

/** Persist one mission's whole lifecycle and (optionally) its telemetry row. */
export async function persistMission(
  laneEventRepo: SqliteBoardLaneEventRepository,
  db: SqliteDatabaseAdapter,
  mission: SeededMission,
): Promise<void> {
  const { closedAt, shape } = mission;
  const intake = shift(closedAt, -mission.cycleTimeMinutes);
  const tail = shape.reviewMinutes + shape.integrationMinutes;
  const lanes: readonly (readonly [string | null, string, string])[] = mission.bounced
    ? [
      [null, 'backlog', intake],
      ['backlog', 'active', shift(closedAt, -(shape.activeMinutes * 2 + shape.reviewMinutes + tail))],
      ['active', 'review', shift(closedAt, -(shape.activeMinutes + shape.reviewMinutes + tail))],
      ['review', 'active', shift(closedAt, -(shape.activeMinutes + tail))],
      ['active', 'review', shift(closedAt, -tail)],
      ['review', 'integration', shift(closedAt, -shape.integrationMinutes)],
      ['integration', 'done', closedAt],
    ]
    : [
      [null, 'backlog', intake],
      ['backlog', 'active', shift(closedAt, -(shape.activeMinutes + tail))],
      ['active', 'review', shift(closedAt, -tail)],
      ['review', 'integration', shift(closedAt, -shape.integrationMinutes)],
      ['integration', 'done', closedAt],
    ];

  for (const [from, to, at] of lanes) {
    await laneEventRepo.append(laneEvent({
      repositoryId: mission.repositoryId,
      missionId: mission.missionId,
      from,
      to,
      at,
    }));
  }

  if (mission.telemetry === undefined) { return; }
  await insertUsageRow(db, {
    repo: mission.repositoryId,
    mission: mission.missionId,
    date: closedAt.slice(0, 10),
    classification: mission.classification,
    prFixRounds: mission.telemetry.prFixRounds ?? null,
    durationMinutes: mission.telemetry.durationMinutes ?? null,
    inputTokens: mission.telemetry.inputTokens ?? null,
    costUsd: mission.telemetry.costUsd ?? null,
  });
}

/** Persist a mission that entered the board inside the window but never closed. */
export async function persistOpenMission(
  laneEventRepo: SqliteBoardLaneEventRepository,
  repositoryId: string,
  missionId: string,
  intakeAt: string,
): Promise<void> {
  await laneEventRepo.append(laneEvent({ repositoryId, missionId, from: null, to: 'backlog', at: intakeAt }));
  await laneEventRepo.append(laneEvent({ repositoryId, missionId, from: 'backlog', to: 'active', at: shift(intakeAt, 60) }));
}
