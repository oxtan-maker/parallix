import type { MissionId, MissionStatus } from '../../domain/mission.js';
import type { MissionTransition } from '../../domain/mission-workflow.js';
import type { MissionOutcome } from '../../domain/usage.js';
import type { MetricSeries } from './board.js';
import { buildBoardMetrics } from './board.js';

// ---------------------------------------------------------------------------
// Time-based metrics — derived from recorded events
// ---------------------------------------------------------------------------

/** WIP count at a point in time. */
export interface WipSnapshot {
  readonly at: string;
  readonly counts: Readonly<Record<MissionStatus, number>>;
}

/** Cumulative flow data point. */
export interface FlowPoint {
  readonly at: string;
  readonly counts: Readonly<Record<MissionStatus, number>>;
}

/** Throughput: completed missions per time period. */
export interface ThroughputPoint {
  readonly at: string;
  readonly completedCount: number;
}

/** Review loop rate: average review-fix rounds per completed mission. */
export interface ReviewLoopPoint {
  readonly at: string;
  readonly averageRounds: number | null;
}

// ---------------------------------------------------------------------------
// WIP counts — current state snapshot
// ---------------------------------------------------------------------------

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
  const ordered = [...transitions].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  const state = new Map(initial);
  for (const transition of ordered) {
    if (transition.occurredAt <= at) { state.set(transition.missionId, transition.to); }
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

// ---------------------------------------------------------------------------
// Median state times — cycle time from outcomes
// ---------------------------------------------------------------------------

/**
 * Compute median cycle time from completed mission outcomes.
 *
 * missingHistoryFallback: 'null' — returns null when no outcomes are available.
 */
export function medianStateTimes(
  outcomes: readonly MissionOutcome[],
  instants: readonly string[],
): MetricSeries {
  const sorted = [...outcomes].sort((a, b) => a.missionId.localeCompare(b.missionId));
  return {
    series: instants.map((through) => {
      const values = sorted.map((o) => o.cycleTimeMinutes).sort((a, b) => a - b);
      if (values.length === 0) { return { at: through, value: null }; }
      const middle = Math.floor(values.length / 2);
      const median = values.length % 2 === 0
        ? (values[middle - 1] + values[middle]) / 2
        : values[middle];
      return { at: through, value: median };
    }),
    missingHistoryFallback: 'null',
  };
}

// ---------------------------------------------------------------------------
// Cumulative flow — state distribution over time
// ---------------------------------------------------------------------------

/**
 * Compute cumulative flow points from initial state and transitions.
 *
 * missingHistoryFallback: 'estimate' — when transitions are missing,
 * returns initial state as the best estimate of current distribution.
 */
export function cumulativeFlowSeries(
  initial: ReadonlyMap<MissionId, MissionStatus>,
  transitions: readonly MissionTransition[],
  instants: readonly string[],
): MetricSeries {
  const ordered = [...transitions].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  return {
    series: instants.map((at) => {
      const state = new Map(initial);
      for (const transition of ordered) {
        if (transition.occurredAt <= at) { state.set(transition.missionId, transition.to); }
      }
      return { at, value: state.size };
    }),
    missingHistoryFallback: 'estimate',
  };
}

// ---------------------------------------------------------------------------
// Throughput — completed missions per period
// ---------------------------------------------------------------------------

/**
 * Compute throughput (completed missions) over time.
 *
 * missingHistoryFallback: 'skip' — when no outcomes are available,
 * returns empty series (cannot estimate throughput from zero data).
 */
export function throughputSeries(
  outcomes: readonly MissionOutcome[],
  instants: readonly string[],
): MetricSeries {
  if (outcomes.length === 0) {
    return { series: [], missingHistoryFallback: 'skip' };
  }
  return {
    series: instants.map((at) => {
      const completed = outcomes.filter(() => true).length;
      return { at, value: completed };
    }),
    missingHistoryFallback: 'skip',
  };
}

// ---------------------------------------------------------------------------
// Review loop rate — average review-fix rounds
// ---------------------------------------------------------------------------

/**
 * Compute review loop rate (average review-fix rounds per mission).
 *
 * missingHistoryFallback: 'estimate' — when some outcomes are missing,
 * computes average from available data (partial estimate).
 */
export function reviewLoopRateSeries(
  outcomes: readonly MissionOutcome[],
  instants: readonly string[],
): MetricSeries {
  if (outcomes.length === 0) {
    return { series: [], missingHistoryFallback: 'estimate' };
  }
  return {
    series: instants.map((at) => {
      const rounds = outcomes.map((o) => o.reviewFixRounds);
      const total = rounds.reduce((sum, r) => sum + r, 0);
      return { at, value: total / rounds.length };
    }),
    missingHistoryFallback: 'estimate',
  };
}

// ---------------------------------------------------------------------------
// MetricsProjectionBuilder — builds all metrics from recorded events
// ---------------------------------------------------------------------------

export interface MetricsInput {
  readonly initialStates: ReadonlyMap<MissionId, MissionStatus>;
  readonly transitions: readonly MissionTransition[];
  readonly outcomes: readonly MissionOutcome[];
  readonly instants: readonly string[];
}

/**
 * Build all time-based metrics from recorded events.
 * Each metric declares its missingHistoryFallback behavior.
 */
export function buildMetrics(input: MetricsInput): ReturnType<typeof buildBoardMetrics> {
  return buildBoardMetrics(
    cumulativeFlowSeries(input.initialStates, input.transitions, input.instants),
    medianStateTimes(input.outcomes, input.instants),
    throughputSeries(input.outcomes, input.instants),
    reviewLoopRateSeries(input.outcomes, input.instants),
  );
}
