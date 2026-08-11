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
  /** The mission that occupied the lane, so dwell can be attributed per mission. */
  readonly missionId: MissionId;
  readonly state: BoardLane;
  readonly enteredAt: string;
  readonly exitedAt: string | null;
}

const BOARD_LANES: readonly BoardLane[] = ['backlog', 'refined', 'active', 'review', 'integration', 'done'];
const TERMINAL_LANES: readonly BoardLane[] = ['done'];

/** Convert minutes to human-readable duration string. */
export function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${Math.round(minutes)} min`;
  }
  if (minutes < 1440) {
    return `${(minutes / 60).toFixed(1)}h`;
  }
  return `${(minutes / 1440).toFixed(1)}d`;
}

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
  const ordered = [...outcomes].sort((a, b) => a.closedAt.localeCompare(b.closedAt));
  const values: number[] = [];
  let index = 0;
  return {
    series: [...instants].sort().map((through) => {
      while (index < ordered.length && ordered[index]!.closedAt <= through) {
        const value = ordered[index++]!.cycleTimeMinutes;
        const insertion = values.findIndex((existing) => existing > value);
        values.splice(insertion === -1 ? values.length : insertion, 0, value);
      }
      if (values.length === 0) { return { at: through, value: null, observationCount: 0 }; }
      const middle = Math.floor(values.length / 2);
      const median = values.length % 2 === 0
        ? (values[middle - 1] + values[middle]) / 2
        : values[middle];
      return { at: through, value: median, observationCount: values.length };
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
    series: instants.map((through) => {
      const measured = outcomes
        .filter((outcome) => outcome.closedAt <= through)
        .map((outcome) => agentRuntimeMinutes(outcome))
        .filter((minutes): minutes is number => minutes !== null);
      return { at: through, value: median(measured), observationCount: measured.length };
    }),
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
  const state = new Map(initial);
  let completed = [...state.values()].filter((status) => status === 'done').length;
  let index = 0;
  return {
    series: [...instants].sort().map((at) => {
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
  const ordered = [...transitions].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  return {
    series: instants.map((at) => {
      const state = new Map(initial);
      for (const transition of ordered) {
        if (transition.occurredAt <= at) { state.set(transition.missionId, transition.to); }
      }
      const counts = emptyCounts();
      for (const lane of state.values()) { counts[lane] += 1; }
      return { at, counts, observationCount: state.size };
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
      return { at, value: completed, observationCount: completed };
    }),
    missingHistoryFallback: 'skip',
  };
}

// ---------------------------------------------------------------------------
// Review bounce rate — lifecycle review → active transitions
// ---------------------------------------------------------------------------

/**
 * Compute lifecycle review bounces per mission that entered review.
 *
 * missingHistoryFallback: 'estimate' — when some outcomes are missing,
 * computes average from available data (partial estimate).
 */
export function reviewBounceRateSeries(
  transitions: readonly MissionTransition[],
  instants: readonly string[],
): MetricSeries {
  if (transitions.length === 0) {
    return { series: [], missingHistoryFallback: 'estimate' };
  }
  return {
    series: instants.map((at) => {
      const passages = new Map<MissionId, { enteredReview: boolean; bounces: number }>();
      for (const transition of transitions) {
        if (transition.occurredAt > at) { continue; }
        const passage = passages.get(transition.missionId) ?? { enteredReview: false, bounces: 0 };
        if (transition.to === 'review') { passage.enteredReview = true; }
        if (transition.from === 'review' && transition.to === 'active') {
          passage.enteredReview = true;
          passage.bounces += 1;
        }
        passages.set(transition.missionId, passage);
      }
      const entered = [...passages.values()].filter((passage) => passage.enteredReview);
      const bounces = entered.reduce((total, passage) => total + passage.bounces, 0);
      return { at, value: entered.length === 0 ? null : bounces / entered.length, observationCount: entered.length };
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
      intervals.push({ missionId: transition.missionId, state: open[0], enteredAt: open[1], exitedAt: transition.occurredAt });
    }
    // Open new interval for the state the mission enters
    openByMission.set(transition.missionId, [transition.to as BoardLane, transition.occurredAt]);
  }

  // Remaining open intervals are current lanes (exitedAt: null)
  for (const [missionId, [state, enteredAt]] of openByMission) {
    intervals.push({ missionId, state, enteredAt, exitedAt: null });
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
    series: BOARD_LANES.map((lane) => {
      const observations = byLane.get(lane) ?? [];
      return { lane, value: median(observations), observationCount: observations.length };
    }),
    missingHistoryFallback: 'null',
  };
}

/**
 * Whether the event stream records this mission's intake.
 *
 * The intake is the transition with no prior lane (`from === null`), which is
 * exactly what `board_lane_events.from_status IS NULL` persists. This is
 * deliberately not `from === to`: a self-transition is a real recorded event
 * shape, and reading it as an intake would let an accidental normalization
 * decide when a mission came into existence.
 */
function hasRecordedIntake(
  transitions: readonly MissionTransition[],
  missionId: MissionId,
): boolean {
  return transitions.some(
    (transition) => transition.missionId === missionId && transition.from === null,
  );
}

/** Return the UTC ISO-week start for a timestamp. */
function isoWeekStart(timestamp: string): string {
  const date = new Date(timestamp);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
}

/**
 * Completed outcomes grouped into ISO weeks.
 *
 * Zero completions is a measurement whenever the board has lifecycle activity
 * to measure: twelve missions moving through the lanes and none finishing is
 * the number `0`, not an absent series. The series is skipped only when there
 * is no lifecycle activity at all, because then nothing has been observed.
 */
export function weeklyThroughputSeries(
  outcomes: readonly MissionOutcome[],
  asOf?: string,
  hasLifecycleActivity = false,
): MetricSeries {
  if (outcomes.length === 0 && !(hasLifecycleActivity && asOf !== undefined)) {
    return { series: [], missingHistoryFallback: 'skip' };
  }
  const byWeek = new Map<string, number>();
  for (const outcome of outcomes) {
    const week = isoWeekStart(outcome.closedAt);
    byWeek.set(week, (byWeek.get(week) ?? 0) + 1);
  }
  // The injected projection clock makes the current operational week explicit
  // when nothing has completed in it.
  if (asOf !== undefined) {
    const currentWeek = isoWeekStart(asOf);
    if (!byWeek.has(currentWeek)) { byWeek.set(currentWeek, 0); }
  }
  return {
    series: [...byWeek.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([at, value]) => ({ at, value, observationCount: value })),
    missingHistoryFallback: 'skip',
  };
}

/** Median age in each current lane, derived from transitions and lifecycle entries. */
export function medianAgeByLaneSeries(
  transitions: readonly MissionTransition[],
  asOf: string,
  initialStates?: ReadonlyMap<MissionId, MissionStatus>,
  lifecycleEntries?: ReadonlyMap<MissionId, string>,
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
  // Missions with no transition: use lifecycle entry timestamp as enteredAt
  if (initialStates && lifecycleEntries) {
    for (const [missionId, status] of initialStates) {
      if (!latestByMission.has(missionId)) {
        const enteredAt = lifecycleEntries.get(missionId);
        if (enteredAt) {
          const minutes = (Date.parse(asOf) - Date.parse(enteredAt)) / 60_000;
          if (Number.isFinite(minutes) && minutes >= 0) {
            ages.set(status as BoardLane, [...(ages.get(status as BoardLane) ?? []), minutes]);
          }
        }
      }
    }
  }
  return {
    series: BOARD_LANES.map((lane) => {
      const observations = ages.get(lane) ?? [];
      return { lane, value: median(observations), observationCount: observations.length };
    }),
    missingHistoryFallback: 'null',
  };
}

/** Select the largest observed lane age and state the named inputs without UI involvement. */
export function bottleneckNarrative(
  medianAgeByLane: LaneMetricSeries,
  reviewBounceRate: MetricSeries,
  weeklyThroughput: MetricSeries,
): BottleneckNarrative {
  const oldest = medianAgeByLane.series
    .filter((entry): entry is { lane: BoardLane; value: number } => entry.value !== null && !TERMINAL_LANES.includes(entry.lane))
    .sort((left, right) => right.value - left.value)[0] ?? null;
  const bounceRate = reviewBounceRate.series.at(-1)?.value ?? null;
  const throughput = weeklyThroughput.series.at(-1)?.value ?? null;
  if (!oldest) {
    return {
      sentence: 'Bottleneck unavailable: history is missing.',
      inputs: { lane: null, medianAgeMinutes: null, reviewBounceRate: bounceRate, weeklyThroughput: throughput },
    };
  }
  const reviewText = bounceRate === null ? 'unavailable review-bounce data' : `review bounce ${bounceRate.toFixed(1)}`;
  const throughputText = throughput === null ? 'unavailable weekly completions' : `${throughput} completed in the current reporting week`;
  return {
    sentence: `${oldest.lane} is the oldest lane at ${formatDuration(oldest.value)} median age; ${reviewText}; ${throughputText}.`,
    inputs: { lane: oldest.lane, medianAgeMinutes: oldest.value, reviewBounceRate: bounceRate, weeklyThroughput: throughput },
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
  /** Lifecycle entry timestamps for missions without transitions (missionId → enteredAt ISO string). */
  readonly lifecycleEntries?: ReadonlyMap<MissionId, string>;
}

/**
 * Build all time-based metrics from recorded events.
 * Each metric declares its missingHistoryFallback behavior.
 */
export function buildMetrics(input: MetricsInput): ReturnType<typeof buildBoardMetrics> {
  // A mission with a recorded intake starts at that event, not at today's board
  // state: seeding it earlier would put it in the history of weeks before it
  // existed. Current state is a legacy fallback only for a mission whose intake
  // was never recorded, where there is nothing else to start from.
  const historicalInitialStates = new Map(
    [...input.initialStates].filter(([missionId]) => !hasRecordedIntake(input.transitions, missionId)),
  );
  const stateFlow = cumulativeFlowByStateSeries(historicalInitialStates, input.transitions, input.instants);
  const cycleByState = medianCycleTimeByStateSeries(input.transitions);
  // Recorded lane transitions are the evidence that there was lifecycle to
  // measure, so a week without completions can be reported as the zero it is.
  const weeklyThroughput = weeklyThroughputSeries(input.outcomes, input.asOf, input.transitions.length > 0);
  const medianAgeByLane = medianAgeByLaneSeries(
    input.transitions,
    input.asOf ?? input.instants.at(-1) ?? new Date(0).toISOString(),
    input.initialStates,
    input.lifecycleEntries,
  );
  const reviewBounceRate = reviewBounceRateSeries(input.transitions, input.instants);
  return {
    ...buildBoardMetrics({
      cumulativeFlow: cumulativeFlowSeries(historicalInitialStates, input.transitions, input.instants),
      cumulativeFlowByState: stateFlow,
      medianStateTimes: medianStateTimes(input.outcomes, input.instants),
      medianCycleTimeByState: cycleByState,
      throughput: throughputSeries(input.outcomes, input.instants),
      weeklyThroughput,
      reviewBounceRate,
      medianAgeByLane,
      agentAvailability: input.agentAvailability ?? [],
      bottleneck: bottleneckNarrative(medianAgeByLane, reviewBounceRate, weeklyThroughput),
    }),
    medianAgentRuntime: medianAgentRuntime(input.outcomes, input.instants),
  };
}
