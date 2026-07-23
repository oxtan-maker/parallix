import { MISSION_STATUSES, type ClosedMission, type MissionId, type MissionStatus } from '../../domain/mission.js';
import type { MissionTransition } from '../../domain/mission-workflow.js';
import type { MissionOutcome } from '../../domain/usage.js';

export interface FlowPoint {
  readonly at: string;
  readonly counts: Readonly<Record<MissionStatus, number>>;
}

export function cumulativeFlow(
  initial: ReadonlyMap<MissionId, MissionStatus>,
  transitions: readonly MissionTransition[],
  instants: readonly string[],
): FlowPoint[] {
  const ordered = [...transitions].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  return instants.map((at) => {
    const state = new Map(initial);
    for (const transition of ordered) {
      if (transition.occurredAt <= at) { state.set(transition.missionId, transition.to); }
    }
    const counts = Object.fromEntries(MISSION_STATUSES.map((status) => [status, 0])) as Record<MissionStatus, number>;
    for (const status of state.values()) { counts[status] += 1; }
    return { at, counts };
  });
}

export function medianCycleTime(outcomes: readonly MissionOutcome[]): number | null {
  if (outcomes.length === 0) { return null; }
  const values = outcomes.map((outcome) => outcome.cycleTimeMinutes).sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 0
    ? ((values[middle - 1] as number) + (values[middle] as number)) / 2
    : values[middle] as number;
}

export interface CompletedMissionOutcome {
  readonly mission: ClosedMission;
  readonly outcome: MissionOutcome;
}

export function medianCycleTimeSeries(
  completed: readonly CompletedMissionOutcome[],
  instants: readonly string[],
): readonly { readonly through: string; readonly medianMinutes: number | null }[] {
  return instants.map((through) => ({
    through,
    medianMinutes: medianCycleTime(
      completed.filter(({ mission }) => mission.closedAt <= through).map(({ outcome }) => outcome),
    ),
  }));
}
