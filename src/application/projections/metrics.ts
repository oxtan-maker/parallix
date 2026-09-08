import type { MissionId, MissionStatus } from '../../domain/mission.js';
import type { MissionTransition } from '../../domain/mission-workflow.js';
import type { MissionOutcome } from '../../domain/usage.js';
import type { AgentAvailabilityRow } from './agent-status.js';
import type { BoardLane } from './mission-board.js';
import type {
  BottleneckNarrative,
  DecisionMetric,
  DecisionWindowComparison,
  DecisionWindowMetrics,
  LaneMetricSeries,
  MetricSeries,
  StateFlowSeries,
  WeeklyStateFlowSeries,
} from './board.js';
import { buildBoardMetrics } from './board.js';
import type { DecisionWindow, DecisionWindows } from '../services/decision-window.js';
import { decisionWindowContains, decisionWindowDays } from '../services/decision-window.js';

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
// The decision cohort — completed missions selected by a rolling window
//
// The window selects whole missions by their lifecycle completion, never pieces
// of a lifecycle. Once a mission is selected, its full history is used: a
// mission that entered backlog in July and completed on August 6 contributes
// its whole dwell, and an agent run it made eight days ago is still its run.
// ---------------------------------------------------------------------------

/** Outcomes whose lifecycle completed inside the window. */
export function outcomesCompletedInWindow(
  outcomes: readonly MissionOutcome[],
  window: DecisionWindow | undefined,
): readonly MissionOutcome[] {
  return window === undefined
    ? outcomes
    : outcomes.filter((outcome) => decisionWindowContains(window, outcome.closedAt));
}

/** The missions a window selects; `undefined` means every mission is in scope. */
export function missionsCompletedInWindow(
  outcomes: readonly MissionOutcome[],
  window: DecisionWindow | undefined,
): ReadonlySet<MissionId> | undefined {
  return window === undefined
    ? undefined
    : new Set(outcomesCompletedInWindow(outcomes, window).map((outcome) => outcome.missionId));
}

/** Lifecycle history of the selected missions, kept whole. */
function transitionsOf(
  transitions: readonly MissionTransition[],
  missions: ReadonlySet<MissionId> | undefined,
): readonly MissionTransition[] {
  return missions === undefined
    ? transitions
    : transitions.filter((transition) => missions.has(transition.missionId));
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
 * When a decision `window` is supplied, only missions that completed inside it
 * are measured, so the reported median and `observationCount` describe the
 * weekly decision population rather than every mission ever completed.
 *
 * missingHistoryFallback: 'null' — returns null when no outcomes are available.
 */
export function medianStateTimes(
  outcomes: readonly MissionOutcome[],
  instants: readonly string[],
  window?: DecisionWindow,
): MetricSeries {
  const ordered = [...outcomesCompletedInWindow(outcomes, window)]
    .sort((a, b) => a.closedAt.localeCompare(b.closedAt));
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
 * A decision `window` selects the missions, never the individual runs: a
 * mission completed today keeps the runtime of a run it made eight days ago,
 * because that work is part of the outcome the window selected.
 *
 * missingHistoryFallback: 'null' — returns null when no outcome has a measured
 * run duration, so an unmeasured mission never reads as zero minutes of work.
 */
export function medianAgentRuntime(
  outcomes: readonly MissionOutcome[],
  instants: readonly string[],
  window?: DecisionWindow,
): MetricSeries {
  const selected = outcomesCompletedInWindow(outcomes, window);
  return {
    series: instants.map((through) => {
      const measured = selected
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

/**
 * Cumulative flow by lane across the reporting window's UTC calendar days.
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
  const ordered = [...transitions].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  // State as the window opened: every transition recorded before its first day.
  const boundary = new Map(initial);
  for (const transition of ordered) {
    if (transition.occurredAt.slice(0, 10) < window.startDate) { boundary.set(transition.missionId, transition.to); }
  }
  const carried = new Map([...boundary].filter(([, lane]) => lane !== 'done'));
  const inWindow = ordered.filter((transition) => decisionWindowContains(window, transition.occurredAt));
  return {
    series: decisionWindowDays(window).map((day) => {
      const at = `${day}T23:59:59.999Z`;
      const state = new Map(carried);
      for (const transition of inWindow) {
        // A mission that opened inside the window has no boundary lane; its
        // intake transition is what puts it on the board.
        if (transition.occurredAt <= at) { state.set(transition.missionId, transition.to); }
      }
      const counts = emptyCounts();
      for (const lane of state.values()) { counts[lane] += 1; }
      return { at, counts, observationCount: state.size };
    }),
    missingHistoryFallback: 'estimate',
    window: scopedWindow,
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
  missions?: ReadonlySet<MissionId>,
): MetricSeries {
  const scoped = transitionsOf(transitions, missions);
  if (scoped.length === 0) {
    return { series: [], missingHistoryFallback: 'estimate' };
  }
  return {
    series: instants.map((at) => {
      const passages = new Map<MissionId, { enteredReview: boolean; bounces: number }>();
      for (const transition of scoped) {
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
 *
 * `missions` restricts the calculation to a decision cohort. The restriction is
 * applied to whole missions before the intervals are derived, so a selected
 * mission contributes every interval of its lifecycle — including the days it
 * spent in a lane before the window opened. Filtering intervals by their own
 * timestamps instead would truncate exactly the missions the window is about.
 */
export function medianCycleTimeByStateSeries(
  transitions: readonly MissionTransition[],
  missions?: ReadonlySet<MissionId>,
): LaneMetricSeries {
  const intervals = deriveLaneIntervals(transitionsOf(transitions, missions));
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
): BottleneckNarrative {
  const oldest = medianAgeByLane.series
    .filter((entry): entry is { lane: BoardLane; value: number } => entry.value !== null && !TERMINAL_LANES.includes(entry.lane))
    .sort((left, right) => right.value - left.value)[0] ?? null;
  const bounceRate = reviewBounceRate.series.at(-1)?.value ?? null;
  if (!oldest) {
    return {
      sentence: 'Bottleneck unavailable: history is missing.',
      inputs: { lane: null, medianAgeMinutes: null, reviewBounceRate: bounceRate },
    };
  }
  const reviewText = bounceRate === null ? 'unavailable review-bounce data' : `review bounce ${bounceRate.toFixed(1)}`;
  return {
    sentence: `${oldest.lane} is the oldest lane at ${formatDuration(oldest.value)} median age; ${reviewText}.`,
    inputs: { lane: oldest.lane, medianAgeMinutes: oldest.value, reviewBounceRate: bounceRate },
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
  /**
   * The rolling decision windows the completed-mission metrics report. Supplied
   * by the read adapter from the same injected clock as `asOf`. Absent means
   * "no window": every completed mission is measured, which is the pre-TASK-2363
   * behavior and is what callers that build metrics from a hand-picked outcome
   * list still want.
   */
  readonly decisionWindows?: DecisionWindows;
}

function decisionMetric(values: readonly number[]): DecisionMetric {
  return { value: median(values), observationCount: values.length };
}

/** Total closed dwell in one lane across the cohort's full lifecycle intervals. */
function laneDwell(dwell: LaneMetricSeries, lane: BoardLane): DecisionMetric {
  const entry = dwell.series.find((point) => point.lane === lane);
  return { value: entry?.value ?? null, observationCount: entry?.observationCount ?? 0 };
}

/**
 * The completed-mission statistics of one decision window.
 *
 * Deliberately built from the same windowed functions the main series use, so
 * FLOW's current column and FLOW's previous column cannot be computed by two
 * different definitions of the same figure.
 */
function decisionWindowMetrics(
  window: DecisionWindow,
  outcomes: readonly MissionOutcome[],
  transitions: readonly MissionTransition[],
): DecisionWindowMetrics {
  const selected = outcomesCompletedInWindow(outcomes, window);
  const missions = missionsCompletedInWindow(outcomes, window);
  const dwell = medianCycleTimeByStateSeries(transitions, missions);
  // Every selected mission completed on or before the window's last day, so its
  // whole review passage is recorded by the end of that day.
  const bounce = reviewBounceRateSeries(transitions, [`${window.endDate}T23:59:59.999Z`], missions)
    .series.at(-1);
  return {
    label: window.label,
    startDate: window.startDate,
    endDate: window.endDate,
    completedMissions: selected.length,
    cycleTime: decisionMetric(selected.map((outcome) => outcome.cycleTimeMinutes)),
    agentRuntime: decisionMetric(
      selected.map(agentRuntimeMinutes).filter((minutes): minutes is number => minutes !== null),
    ),
    activeDwell: laneDwell(dwell, 'active'),
    reviewDwell: laneDwell(dwell, 'review'),
    integrationDwell: laneDwell(dwell, 'integration'),
    reviewBounce: { value: bounce?.value ?? null, observationCount: bounce?.observationCount ?? 0 },
  };
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
  // The current rolling window selects the completed-mission decision metrics.
  // Current-state operational metrics below (lane age, WIP, bottleneck) and the
  // historical cumulative flow deliberately stay unwindowed: they answer "what
  // does the board look like now", not "how did last week go".
  const currentWindow = input.decisionWindows?.current;
  const currentMissions = missionsCompletedInWindow(input.outcomes, currentWindow);
  const stateFlow = cumulativeFlowByStateSeries(historicalInitialStates, input.transitions, input.instants);
  // The weekly series is what FLOW renders. It shares the window with the
  // decision metrics above, so the chart and the figures beside it cannot
  // report two different weeks.
  const weeklyCumulativeFlow = currentWindow === undefined
    ? undefined
    : weeklyCumulativeFlowByStateSeries(historicalInitialStates, input.transitions, currentWindow);
  const cycleByState = medianCycleTimeByStateSeries(input.transitions, currentMissions);
  const medianAgeByLane = medianAgeByLaneSeries(
    input.transitions,
    input.asOf ?? input.instants.at(-1) ?? new Date(0).toISOString(),
    input.initialStates,
    input.lifecycleEntries,
  );
  const reviewBounceRate = reviewBounceRateSeries(input.transitions, input.instants, currentMissions);
  const decisionWindow: DecisionWindowComparison | undefined = input.decisionWindows === undefined
    ? undefined
    : {
      current: decisionWindowMetrics(input.decisionWindows.current, input.outcomes, input.transitions),
      previous: decisionWindowMetrics(input.decisionWindows.previous, input.outcomes, input.transitions),
    };
  return {
    ...(decisionWindow === undefined ? {} : { decisionWindow }),
    ...buildBoardMetrics({
      cumulativeFlow: cumulativeFlowSeries(historicalInitialStates, input.transitions, input.instants),
      cumulativeFlowByState: stateFlow,
      ...(weeklyCumulativeFlow === undefined ? {} : { weeklyCumulativeFlow }),
      medianStateTimes: medianStateTimes(input.outcomes, input.instants, currentWindow),
      medianCycleTimeByState: cycleByState,
      throughput: throughputSeries(input.outcomes, input.instants),
      reviewBounceRate,
      medianAgeByLane,
      agentAvailability: input.agentAvailability ?? [],
      bottleneck: bottleneckNarrative(medianAgeByLane, reviewBounceRate),
    }),
    medianAgentRuntime: medianAgentRuntime(input.outcomes, input.instants, currentWindow),
  };
}
