import type { MissionId, MissionStatus } from '../../domain/mission.js';
import type { MissionTransition } from '../../domain/mission-workflow.js';
import type { MissionOutcome } from '../../domain/usage.js';
import type { AgentAvailabilityRow } from './agent-status.js';
import type { BoardLane } from './mission-board.js';
import type { BottleneckNarrative, LaneMetricSeries, MetricSeries, StateFlowSeries } from './board.js';
import { buildBoardMetrics } from './board.js';

// ---------------------------------------------------------------------------
// Time-based metrics — derived from recorded events
// ---------------------------------------------------------------------------

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

/** Review loop rate: average review-fix rounds per completed mission. */
export interface ReviewLoopPoint {
  readonly at: string;
  readonly averageRounds: number | null;
}

/** Time interval a mission spent in a single lane. Open intervals (exitedAt: null) track the current lane. */
export interface LaneInterval {
  readonly state: BoardLane;
  readonly enteredAt: string;
  readonly exitedAt: string | null;
}

const BOARD_LANES: readonly BoardLane[] = ['backlog', 'refined', 'active', 'review', 'integration', 'done'];

function emptyCounts(): Record<BoardLane, number> {
  return { backlog: 0, refined: 0, active: 0, review: 0, integration: 0, done: 0 };
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) { return null; }
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1]! + ordered[middle]!) / 2
    : ordered[middle]!;
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
// Median state times — lifecycle cycle time from outcomes
// ---------------------------------------------------------------------------

/**
 * Compute the median lifecycle cycle time of completed missions.
 *
 * `MissionOutcome.cycleTimeMinutes` is the mission's wall-clock lifetime,
 * derived from its lane events. It is not the agents' execution time — that is
 * `medianAgentRuntime`, which reads `outcome.runs`.
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
      const values = sorted
        .filter((outcome) => outcome.closedAt <= through)
        .map((outcome) => outcome.cycleTimeMinutes)
        .sort((a, b) => a - b);
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
// Median agent runtime — execution minutes from the runs on each outcome
// ---------------------------------------------------------------------------

/** Total measured execution minutes an outcome's agents spent. */
export function agentRuntimeMinutes(outcome: MissionOutcome): number | null {
  const measured = outcome.runs
    .map((run) => run.durationMinutes)
    .filter((duration): duration is { readonly kind: 'measured'; readonly value: number } => duration.kind === 'measured');
  return measured.length === 0 ? null : measured.reduce((sum, duration) => sum + duration.value, 0);
}

/**
 * Compute the median agent runtime of completed missions — how long the agents
 * actually ran, with queueing and review waits excluded. Its counterpart is
 * `medianStateTimes`, which measures the lifecycle those runs sit inside.
 *
 * missingHistoryFallback: 'null' — returns null when no outcome has a measured
 * run duration, so an unmeasured mission never reads as zero minutes of work.
 */
export function medianAgentRuntime(
  outcomes: readonly MissionOutcome[],
  instants: readonly string[],
): MetricSeries {
  return {
    series: instants.map((through) => ({
      at: through,
      value: median(
        outcomes
          .filter((outcome) => outcome.closedAt <= through)
          .map((outcome) => agentRuntimeMinutes(outcome))
          .filter((minutes): minutes is number => minutes !== null),
      ),
    })),
    missingHistoryFallback: 'null',
  };
}

// ---------------------------------------------------------------------------
// Cumulative flow — state distribution over time
// ---------------------------------------------------------------------------

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
  const ordered = [...transitions].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  return {
    series: instants.map((at) => {
      const state = new Map(initial);
      for (const transition of ordered) {
        if (transition.occurredAt <= at) { state.set(transition.missionId, transition.to); }
      }
      return { at, value: [...state.values()].filter((status) => status === 'done').length };
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
  const ordered = [...transitions].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  return {
    series: instants.map((at) => {
      const state = new Map(initial);
      for (const transition of ordered) {
        if (transition.occurredAt <= at) { state.set(transition.missionId, transition.to); }
      }
      const counts = emptyCounts();
      for (const lane of state.values()) { counts[lane] += 1; }
      return { at, counts };
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
      const completed = outcomes.filter((outcome) => outcome.closedAt <= at).length;
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
      const rounds = outcomes
        .filter((outcome) => outcome.closedAt <= at)
        .map((outcome) => outcome.reviewFixRounds);
      if (rounds.length === 0) { return { at, value: null }; }
      const total = rounds.reduce((sum, r) => sum + r, 0);
      return { at, value: total / rounds.length };
    }),
    missingHistoryFallback: 'estimate',
  };
}

/**
 * Derive lane intervals from ordered mission transitions.
 *
 * For each mission, replays transitions sorted by occurredAt and builds
 * `{ state, enteredAt, exitedAt | null }` records. The state field is the
 * lane the mission *occupied* during the interval (transition.from for the
 * dwell between two transitions, transition.to for the current open lane).
 * Duplicates (same missionId + from + to + occurredAt) are collapsed.
 * Open intervals (exitedAt: null) mark the mission's current lane.
 */
export function deriveLaneIntervals(
  transitions: readonly MissionTransition[],
): LaneInterval[] {
  // Sort by time, then missionId for deterministic ordering
  const sorted = [...transitions].sort(
    (left, right) => left.occurredAt.localeCompare(right.occurredAt)
    || left.missionId.localeCompare(right.missionId),
  );

  // Deduplicate: same missionId + from + to + occurredAt
  const seen = new Set<string>();
  const unique: MissionTransition[] = [];
  for (const t of sorted) {
    const key = `${t.missionId}|${t.from}|${t.to}|${t.occurredAt}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(t);
    }
  }

  const intervals: LaneInterval[] = [];
  // Track open interval per mission: [state, enteredAt]
  const openByMission = new Map<MissionId, [BoardLane, string]>();

  for (const transition of unique) {
    // Close any open interval for this mission
    const open = openByMission.get(transition.missionId);
    if (open) {
      intervals.push({ state: open[0], enteredAt: open[1], exitedAt: transition.occurredAt });
    }
    // Open new interval for the state the mission enters
    openByMission.set(transition.missionId, [transition.to as BoardLane, transition.occurredAt]);
  }

  // Remaining open intervals are current lanes (exitedAt: null)
  for (const [, [state, enteredAt]] of openByMission) {
    intervals.push({ state, enteredAt, exitedAt: null });
  }

  return intervals;
}

/**
 * Median cycle time per lane, computed from closed lane intervals only.
 *
 * Dwell time is attributed to the state the mission *occupied* during the
 * interval (interval.state), not the state it entered. Open intervals
 * (missions still in a lane) are excluded from dwell calculations.
 */
export function medianCycleTimeByStateSeries(
  transitions: readonly MissionTransition[],
): LaneMetricSeries {
  const intervals = deriveLaneIntervals(transitions);
  const byLane = new Map<BoardLane, number[]>();

  for (const interval of intervals) {
    // Closed intervals only — open intervals (current lane) excluded from dwell
    if (interval.exitedAt === null) {
      continue;
    }
    const minutes = (Date.parse(interval.exitedAt) - Date.parse(interval.enteredAt)) / 60_000;
    if (Number.isFinite(minutes) && minutes >= 0) {
      byLane.set(interval.state, [...(byLane.get(interval.state) ?? []), minutes]);
    }
  }

  return {
    series: BOARD_LANES.map((lane) => ({ lane, value: median(byLane.get(lane) ?? []) })),
    missingHistoryFallback: 'null',
  };
}

/** Return the UTC ISO-week start for a timestamp. */
function isoWeekStart(timestamp: string): string {
  const date = new Date(timestamp);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
}

/** Completed outcomes grouped into ISO weeks; no outcomes means the series is skipped. */
export function weeklyThroughputSeries(outcomes: readonly MissionOutcome[]): MetricSeries {
  if (outcomes.length === 0) { return { series: [], missingHistoryFallback: 'skip' }; }
  const byWeek = new Map<string, number>();
  for (const outcome of outcomes) {
    const week = isoWeekStart(outcome.closedAt);
    byWeek.set(week, (byWeek.get(week) ?? 0) + 1);
  }
  return {
    series: [...byWeek.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([at, value]) => ({ at, value })),
    missingHistoryFallback: 'skip',
  };
}

/** Median age in each current lane, derived solely from the last recorded transition. */
export function medianAgeByLaneSeries(
  transitions: readonly MissionTransition[],
  asOf: string,
): LaneMetricSeries {
  const latestByMission = new Map<MissionId, MissionTransition>();
  for (const transition of transitions) {
    const previous = latestByMission.get(transition.missionId);
    if (!previous || previous.occurredAt < transition.occurredAt) { latestByMission.set(transition.missionId, transition); }
  }
  const ages = new Map<BoardLane, number[]>();
  for (const transition of latestByMission.values()) {
    const minutes = (Date.parse(asOf) - Date.parse(transition.occurredAt)) / 60_000;
    if (Number.isFinite(minutes) && minutes >= 0) {
      ages.set(transition.to, [...(ages.get(transition.to) ?? []), minutes]);
    }
  }
  return {
    series: BOARD_LANES.map((lane) => ({ lane, value: median(ages.get(lane) ?? []) })),
    missingHistoryFallback: 'null',
  };
}

/** Select the largest observed lane age and state the named inputs without UI involvement. */
export function bottleneckNarrative(
  medianAgeByLane: LaneMetricSeries,
  reviewLoopRate: MetricSeries,
  weeklyThroughput: MetricSeries,
): BottleneckNarrative {
  const oldest = medianAgeByLane.series
    .filter((entry): entry is { lane: BoardLane; value: number } => entry.value !== null)
    .sort((left, right) => right.value - left.value)[0] ?? null;
  const loopRate = reviewLoopRate.series.at(-1)?.value ?? null;
  const throughput = weeklyThroughput.series.at(-1)?.value ?? null;
  if (!oldest) {
    return {
      sentence: 'Bottleneck unavailable: history is missing.',
      inputs: { lane: null, medianAgeMinutes: null, reviewLoopRate: loopRate, weeklyThroughput: throughput },
    };
  }
  const reviewText = loopRate === null ? 'unavailable review-loop data' : `review loop ${loopRate.toFixed(1)}`;
  const throughputText = throughput === null ? 'unavailable weekly completions' : `${throughput} completed in the latest recorded week`;
  return {
    sentence: `${oldest.lane} is the oldest lane at ${oldest.value} min median age; ${reviewText}; ${throughputText}.`,
    inputs: { lane: oldest.lane, medianAgeMinutes: oldest.value, reviewLoopRate: loopRate, weeklyThroughput: throughput },
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
  readonly agentAvailability?: readonly AgentAvailabilityRow[];
  /** Injected by the read adapter so deterministic tests never depend on wall-clock time. */
  readonly asOf?: string;
}

/**
 * Build all time-based metrics from recorded events.
 * Each metric declares its missingHistoryFallback behavior.
 */
export function buildMetrics(input: MetricsInput): ReturnType<typeof buildBoardMetrics> {
  const stateFlow = cumulativeFlowByStateSeries(input.initialStates, input.transitions, input.instants);
  const cycleByState = medianCycleTimeByStateSeries(input.transitions);
  const weeklyThroughput = weeklyThroughputSeries(input.outcomes);
  const medianAgeByLane = medianAgeByLaneSeries(input.transitions, input.asOf ?? input.instants.at(-1) ?? new Date(0).toISOString());
  const reviewLoopRate = reviewLoopRateSeries(input.outcomes, input.instants);
  return {
    ...buildBoardMetrics(
      cumulativeFlowSeries(input.initialStates, input.transitions, input.instants),
      stateFlow,
      medianStateTimes(input.outcomes, input.instants),
      cycleByState,
      throughputSeries(input.outcomes, input.instants),
      weeklyThroughput,
      reviewLoopRate,
      medianAgeByLane,
      input.agentAvailability ?? [],
      bottleneckNarrative(medianAgeByLane, reviewLoopRate, weeklyThroughput),
    ),
    medianAgentRuntime: medianAgentRuntime(input.outcomes, input.instants),
  };
}
