import type { MissionId, MissionStatus } from '../../domain/mission.js';
import type { MissionTransition } from '../../domain/mission-workflow.js';
import type { BoardLane } from './mission-board.js';
import type { MetricSeries, StateFlowSeries, WeeklyStateFlowSeries } from './board.js';
import type { DecisionWindow } from '../../domain/decision-window.js';
import { decisionWindowContains, decisionWindowDays, decisionWindowDay, decisionWindowDayEnd } from '../../domain/decision-window.js';

function emptyCounts(): Record<BoardLane, number> {
  return { backlog: 0, refined: 0, active: 0, review: 0, integration: 0, done: 0 };
}

/** WIP count at a point in time. */
export interface WipSnapshot {
  readonly at: string;
  readonly counts: Readonly<Record<MissionStatus, number>>;
}

/** Cumulative completed-mission data point. */
export interface FlowPoint {
  readonly at: string;
  readonly counts: Readonly<Record<MissionStatus, number>>;
}

/** Throughput: completed missions per time period. */
export interface ThroughputPoint {
  readonly at: string;
  readonly completedCount: number;
}

/**
 * Compute WIP counts at a point in time from the initial state and transitions.
 *
 * missingHistoryFallback: 'null' — when no transitions are available,
 * returns the initial state counts as-is (they represent the known baseline).
 */
export function wipAtTime(
  initial: ReadonlyMap<MissionId, MissionStatus>,
  transitions: readonly MissionTransition[],
  at: string,
): WipSnapshot {
  const ordered = [...transitions].sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt));
  const state = new Map(initial);
  for (const transition of ordered) {
    if (Date.parse(transition.occurredAt) <= Date.parse(at)) { state.set(transition.missionId, transition.to); }
  }

  const statusList = ['backlog', 'refined', 'active', 'review', 'integration', 'done'] as const;
  const counts = Object.fromEntries(statusList.map((status) => [status, 0])) as Record<MissionStatus, number>;
  for (const status of state.values()) { counts[status] += 1; }
  return { at, counts };
}

/**
 * Compute WIP series over multiple time instants.
 *
 * missingHistoryFallback: 'null' — returns initial state when no transitions exist.
 */
export function wipSeries(
  initial: ReadonlyMap<MissionId, MissionStatus>,
  transitions: readonly MissionTransition[],
  instants: readonly string[],
): MetricSeries {
  return {
    series: instants.map((at) => {
      const snapshot = wipAtTime(initial, transitions, at);
      const totalWip = Object.values(snapshot.counts).reduce((sum, count) => sum + count, 0);
      return { at, value: totalWip };
    }),
    missingHistoryFallback: 'null',
  };
}

/**
 * Compute cumulative completed-mission counts from initial state and transitions.
 *
 * missingHistoryFallback: 'estimate' — when transitions are missing,
 * returns initial state as the best estimate of current distribution.
 */
export function cumulativeFlowSeries(
  initial: ReadonlyMap<MissionId, MissionStatus>,
  transitions: readonly MissionTransition[],
  instants: readonly string[],
): MetricSeries {
  const ordered = [...transitions].sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt));
  const state = new Map(initial);
  let completed = [...state.values()].filter((status) => status === 'done').length;
  let index = 0;
  return {
    // instants is readonly string[] (ISO-8601); default order == chronological, left implicit per SC6.
    series: [...instants].sort((left, right) => left.localeCompare(right)).map((at) => {
      while (index < ordered.length && ordered[index]!.occurredAt <= at) {
        const transition = ordered[index++]!;
        const previous = state.get(transition.missionId);
        if (previous === 'done') { completed -= 1; }
        if (transition.to === 'done') { completed += 1; }
        state.set(transition.missionId, transition.to);
      }
      return { at, value: completed, observationCount: state.size };
    }),
    missingHistoryFallback: 'estimate',
  };
}

/** Cumulative flow distribution by state; `estimate` means the initial snapshot is all that is known. */
export function cumulativeFlowByStateSeries(
  initial: ReadonlyMap<MissionId, MissionStatus>,
  transitions: readonly MissionTransition[],
  instants: readonly string[],
): StateFlowSeries {
  const ordered = transitions.map(transition => ({ transition, at: Date.parse(transition.occurredAt) }))
    .filter(entry => Number.isFinite(entry.at)).sort((left, right) => left.at - right.at);
  const state = new Map(initial);
  const counts = emptyCounts();
  for (const lane of state.values()) { counts[lane] += 1; }
  let index = 0;
  // Sort evaluation instants for one sweep, then restore caller ordering.
  // Parse instants numerically so offsets and duplicate instants stay exact.
  const points = instants.map((at, position) => ({ at, time: Date.parse(at), position }))
    .sort((left, right) => left.time - right.time);
  const series: StateFlowSeries['series'][number][] = [];
  for (const point of points) {
    while (index < ordered.length && ordered[index]!.at <= point.time) {
      const transition = ordered[index++]!.transition;
      const previous = state.get(transition.missionId);
      if (previous !== undefined) { counts[previous] -= 1; }
      counts[transition.to] += 1;
      state.set(transition.missionId, transition.to);
    }
    series[point.position] = { at: point.at, counts: { ...counts }, observationCount: state.size };
  }
  return {
    series,
    missingHistoryFallback: 'estimate',
  };
}

/**
 * Cumulative flow by lane across the reporting window's local calendar days.
 *
 * The all-history series above answers "what does the board hold now"; this one
 * answers "what moved during the week the operator is reading". The difference
 * is what the week starts from: a mission that was already `done` when the
 * window opened is finished work from an earlier week, so it is left behind
 * rather than carried into every point of this week's `done` band. Open work is
 * carried in at the lane it held on the boundary, and only transitions recorded
 * inside the window move it.
 *
 * Nothing is invented: the boundary state is folded from the same recorded
 * transitions the historical series uses, and a mission with no recorded
 * lifecycle keeps the `estimate` contract — the initial snapshot is all that is
 * known. With no lifecycle facts at all the series is empty and `skip`, so a
 * week with no evidence is reported as unavailable rather than as zeroes.
 */
export function weeklyCumulativeFlowByStateSeries(
  initial: ReadonlyMap<MissionId, MissionStatus>,
  transitions: readonly MissionTransition[],
  window: DecisionWindow,
): WeeklyStateFlowSeries {
  const scopedWindow = { startDate: window.startDate, endDate: window.endDate, label: window.label };
  if (transitions.length === 0 && initial.size === 0) {
    return { series: [], missingHistoryFallback: 'skip', window: scopedWindow };
  }
  const ordered = [...transitions].sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt));
  const firstDeliveries = new Map<MissionId, string>();
  for (const transition of ordered) {
    if (transition.to === 'done' && transition.from !== 'done' && !firstDeliveries.has(transition.missionId)) {
      firstDeliveries.set(transition.missionId, transition.occurredAt);
    }
  }
  // State as the window opened: every transition recorded before its first day.
  const boundary = new Map(initial);
  for (const transition of ordered) {
    if (decisionWindowDay(transition.occurredAt, window.timeZone) < window.startDate) { boundary.set(transition.missionId, transition.to); }
  }
  const carried = new Map([...boundary].filter(([, lane]) => lane !== 'done'));
  const inWindow = ordered.filter((transition) => decisionWindowContains(window, transition.occurredAt));
  return {
    series: decisionWindowDays(window).map((day) => {
      const at = decisionWindowDayEnd(day, window.timeZone);
      const state = new Map(carried);
      for (const transition of inWindow) {
        // A mission that opened inside the window has no boundary lane; its
        // intake transition is what puts it on the board.
        if (Date.parse(transition.occurredAt) <= Date.parse(at)) {
          const deliveredAt = firstDeliveries.get(transition.missionId);
          if (transition.to === 'done' && (deliveredAt === undefined || !decisionWindowContains(window, deliveredAt))) {
            state.delete(transition.missionId);
          } else { state.set(transition.missionId, transition.to); }
        }
      }
      const counts = emptyCounts();
      for (const lane of state.values()) { counts[lane] += 1; }
      return { at, counts, observationCount: state.size };
    }),
    missingHistoryFallback: 'estimate',
    window: scopedWindow,
  };
}

