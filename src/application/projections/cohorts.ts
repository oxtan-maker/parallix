import type { MissionId } from '../../domain/mission.js';
import type { MissionTransition } from '../../domain/mission-workflow.js';
import type { MissionOutcome } from '../../domain/usage.js';
import { agentRuntimeMinutes, deriveLaneIntervals } from './metrics.js';

// ---------------------------------------------------------------------------
// Cohort comparison — "did this workflow change improve delivery?"
//
// A cohort is a set of completed missions that share one experiment dimension.
// Every figure below is reported beside the sample size it was computed from,
// because a median over two missions and a median over forty are not the same
// claim. Cohorts under `lowSampleThreshold` are flagged rather than dropped:
// the operator still sees they exist, but not as a comparable result.
// ---------------------------------------------------------------------------

/** The dimensions a completed mission can be sliced by. */
export type CohortDimension = 'label' | 'implementer' | 'model' | 'provider' | 'date-range';

/**
 * Below this many completed missions a cohort is marked low-sample. Five is the
 * smallest n at which a median and a p75 are computed from distinct values
 * rather than restating one or two missions.
 */
export const LOW_SAMPLE_THRESHOLD = 5;

/** The cohort a mission falls into when it carries no value for the dimension. */
export const UNASSIGNED_COHORT = '(none)';

/** A named window used by the `date-range` dimension; both ends inclusive. */
export interface CohortDateRange {
  readonly name: string;
  /** ISO instant; a mission joins when it closed at or after this. */
  readonly from: string;
  /** ISO instant; a mission joins when it closed at or before this. */
  readonly to: string;
}

/** Per-cohort figures. Every quantity is null when nothing measured it. */
export interface CohortMetrics {
  /** The dimension value this cohort collects, e.g. `ai_sdlc` or `codex`. */
  readonly key: string;
  /** Completed missions in the cohort. Never omitted from presentation. */
  readonly n: number;
  /** True when cohort population `n` is below the comparison's threshold. */
  readonly lowSamplePopulation: boolean;
  /**
   * Backward-compatible alias for lowSamplePopulation. Consumers that check
   * `cohort.lowSample` for the cohort-level flag still work.
   * @deprecated use lowSamplePopulation
   */
  readonly lowSample: boolean;
  /** Per-metric low-sample flags — each metric judged by its own observation count. */
  readonly lowSampleByMetric: Readonly<{
    cycleTime: boolean;
    activeDwell: boolean;
    reviewDwell: boolean;
    reviewBounce: boolean;
    reviewFixRounds: boolean;
    tokens: boolean;
    runtime: boolean;
    cost: boolean;
    netEngineeringLines: boolean;
  }>;
  readonly medianCycleTimeMinutes: number | null;
  readonly p75CycleTimeMinutes: number | null;
  readonly medianActiveDwellMinutes: number | null;
  readonly medianReviewDwellMinutes: number | null;
  /** `review → active` transitions per mission that entered review. */
  readonly reviewBounceRate: number | null;
  readonly medianReviewFixRounds: number | null;
  readonly tokensPerMission: number | null;
  readonly agentRuntimeMinutesPerMission: number | null;
  readonly costUsdPerMission: number | null;
  readonly netEngineeringLinesPerMission: number | null;
  /** Observation counts are metric-specific; cohort population is not a proxy. */
  readonly observationCounts: Readonly<{
    cycleTime: number;
    activeDwell: number;
    reviewDwell: number;
    reviewBounce: number;
    reviewFixRounds: number | null;
    tokens: number;
    runtime: number;
    cost: number;
    netEngineeringLines: number;
  }>;
}

export interface CohortComparison {
  readonly dimension: CohortDimension;
  readonly lowSampleThreshold: number;
  /** Ordered by descending `n`, then by key, so output is deterministic. */
  readonly cohorts: readonly CohortMetrics[];
}

export interface CohortComparisonInput {
  readonly outcomes: readonly MissionOutcome[];
  /** Lifecycle history; the authority for dwell and for review bounces. */
  readonly transitions: readonly MissionTransition[];
  readonly dimension: CohortDimension;
  /**
   * Net engineering lines per mission, read from `ClosedMission` by the caller.
   * A mission absent from the map contributes nothing to the cohort's NEL.
   */
  readonly netEngineeringLines?: ReadonlyMap<MissionId, number | null>;
  readonly lowSampleThreshold?: number;
  /** Required by the `date-range` dimension; ignored by every other one. */
  readonly dateRanges?: readonly CohortDateRange[];
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

function median(values: readonly number[]): number | null {
  if (values.length === 0) { return null; }
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1]! + ordered[middle]!) / 2
    : ordered[middle]!;
}

/**
 * Nearest-rank 75th percentile: the smallest observed value at or above which
 * 75% of the sample sits. An observed value is used rather than an interpolated
 * one so a reported p75 is always a duration some mission actually took.
 */
export function percentile75(values: readonly number[]): number | null {
  if (values.length === 0) { return null; }
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.ceil(ordered.length * 0.75) - 1]!;
}

/** Mean over the missions that measured the quantity; null when none did. */
function meanOfMeasured(values: readonly (number | null)[]): number | null {
  const measured = values.filter((value): value is number => value !== null);
  return measured.length === 0
    ? null
    : measured.reduce((sum, value) => sum + value, 0) / measured.length;
}

// ---------------------------------------------------------------------------
// Lifecycle facts read per mission
// ---------------------------------------------------------------------------

/** Total closed dwell per mission in one lane; re-entries are summed. */
function dwellMinutesByMission(
  transitions: readonly MissionTransition[],
  lane: 'active' | 'review',
): ReadonlyMap<MissionId, number> {
  const dwell = new Map<MissionId, number>();
  for (const interval of deriveLaneIntervals(transitions)) {
    // An open interval has no end, so counting it would understate the dwell of
    // a mission still sitting in the lane.
    if (interval.state !== lane || interval.exitedAt === null) { continue; }
    const minutes = (Date.parse(interval.exitedAt) - Date.parse(interval.enteredAt)) / 60_000;
    if (!Number.isFinite(minutes) || minutes < 0) { continue; }
    dwell.set(interval.missionId, (dwell.get(interval.missionId) ?? 0) + minutes);
  }
  return dwell;
}

/** Per mission: whether it ever entered review, and how often it bounced out. */
export interface ReviewPassage {
  readonly enteredReview: boolean;
  readonly bounces: number;
}

/**
 * Read each mission's review passage from lane history.
 *
 * A bounce is a recorded `review → active` transition. This is deliberately not
 * `pr_fix_rounds`: that column counts what a usage row claimed about a review,
 * while the lane events record what the board actually did, and the two diverge
 * whenever a round was never written to telemetry.
 */
export function reviewPassagesByMission(
  transitions: readonly MissionTransition[],
): ReadonlyMap<MissionId, ReviewPassage> {
  const passages = new Map<MissionId, { enteredReview: boolean; bounces: number }>();
  for (const transition of transitions) {
    const passage = passages.get(transition.missionId)
      ?? { enteredReview: false, bounces: 0 };
    if (transition.to === 'review') { passage.enteredReview = true; }
    if (transition.from === 'review' && transition.to === 'active') {
      passage.bounces += 1;
      // A mission can only bounce out of review if it was in review, even when
      // the entering transition itself was never recorded.
      passage.enteredReview = true;
    }
    passages.set(transition.missionId, passage);
  }
  return passages;
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

/**
 * The cohort keys a mission belongs to for one dimension.
 *
 * A mission with two labels, or two models, is counted in both cohorts — it
 * genuinely belongs to both experiments — so cohort sizes may sum to more than
 * the number of completed missions. A mission with no value for the dimension
 * lands in `(none)` rather than vanishing from the comparison.
 */
export function cohortKeys(
  outcome: MissionOutcome,
  dimension: CohortDimension,
  dateRanges: readonly CohortDateRange[] = [],
): readonly string[] {
  const keys = dimensionValues(outcome, dimension, dateRanges);
  return keys.length === 0 ? [UNASSIGNED_COHORT] : [...new Set(keys)];
}

function dimensionValues(
  outcome: MissionOutcome,
  dimension: CohortDimension,
  dateRanges: readonly CohortDateRange[],
): readonly string[] {
  switch (dimension) {
    case 'label':
      return outcome.labels;
    case 'implementer':
      return outcome.implementer === null ? [] : [outcome.implementer];
    case 'model':
      return outcome.modelsInvolved
        .map((involvement) => involvement.model)
        .filter((model): model is string => model !== null);
    case 'provider':
      return outcome.modelsInvolved
        .map((involvement) => involvement.provider)
        .filter((provider): provider is string => provider !== null);
    case 'date-range':
      return dateRanges
        .filter((range) => outcome.closedAt >= range.from && outcome.closedAt <= range.to)
        .map((range) => range.name);
  }
}

/** Group completed missions into cohorts along one experiment dimension. */
export function groupIntoCohorts(
  outcomes: readonly MissionOutcome[],
  dimension: CohortDimension,
  dateRanges: readonly CohortDateRange[] = [],
): ReadonlyMap<string, readonly MissionOutcome[]> {
  const groups = new Map<string, MissionOutcome[]>();
  for (const outcome of outcomes) {
    for (const key of cohortKeys(outcome, dimension, dateRanges)) {
      groups.set(key, [...(groups.get(key) ?? []), outcome]);
    }
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/** Compute every cohort's figures for one experiment dimension. */
export function compareCohorts(input: CohortComparisonInput): CohortComparison {
  const threshold = input.lowSampleThreshold ?? LOW_SAMPLE_THRESHOLD;
  const groups = groupIntoCohorts(input.outcomes, input.dimension, input.dateRanges ?? []);
  const activeDwell = dwellMinutesByMission(input.transitions, 'active');
  const reviewDwell = dwellMinutesByMission(input.transitions, 'review');
  const passages = reviewPassagesByMission(input.transitions);
  const netEngineeringLines = input.netEngineeringLines ?? new Map<MissionId, number | null>();

  const cohorts = [...groups.entries()].map(([key, members]) => {
    const cycleTimes = members.map((outcome) => outcome.cycleTimeMinutes);
    const activeDwells = dwellOf(members, activeDwell);
    const reviewDwells = dwellOf(members, reviewDwell);
    const tokens = members.map((outcome) => outcome.totalInputAndOutputTokens).filter((value): value is number => value !== null);
    const runtimes = members.map(agentRuntimeMinutes).filter((value): value is number => value !== null);
    const costs = members.map((outcome) => outcome.totalCostUsd).filter((value): value is number => value !== null);
    const nels = members.map((outcome) => netEngineeringLines.get(outcome.missionId) ?? null).filter((value): value is number => value !== null);
    const entered = members.filter((outcome) => passages.get(outcome.missionId)?.enteredReview === true);
    const bounces = entered.reduce(
      (sum, outcome) => sum + (passages.get(outcome.missionId)?.bounces ?? 0),
      0,
    );
    return {
      key,
      n: members.length,
      lowSamplePopulation: members.length < threshold,
      lowSample: members.length < threshold,
      lowSampleByMetric: {
        cycleTime: cycleTimes.length < threshold,
        activeDwell: activeDwells.length < threshold,
        reviewDwell: reviewDwells.length < threshold,
        reviewBounce: entered.length < threshold,
        reviewFixRounds: members.filter((outcome) => outcome.reviewFixRounds !== null).length < threshold,
        tokens: tokens.length < threshold,
        runtime: runtimes.length < threshold,
        cost: costs.length < threshold,
        netEngineeringLines: nels.length < threshold,
      },
      medianCycleTimeMinutes: median(cycleTimes),
      p75CycleTimeMinutes: percentile75(cycleTimes),
      medianActiveDwellMinutes: median(activeDwells),
      medianReviewDwellMinutes: median(reviewDwells),
      // Null, not zero: a cohort where nothing reached review has no bounce
      // rate to report, which is a different claim from "never bounced".
      reviewBounceRate: entered.length === 0 ? null : bounces / entered.length,
      medianReviewFixRounds: median(
        members.map((outcome) => outcome.reviewFixRounds).filter((value): value is number => value !== null),
      ),
      tokensPerMission: meanOfMeasured(members.map((outcome) => outcome.totalInputAndOutputTokens)),
      agentRuntimeMinutesPerMission: meanOfMeasured(members.map((outcome) => agentRuntimeMinutes(outcome))),
      costUsdPerMission: meanOfMeasured(members.map((outcome) => outcome.totalCostUsd)),
      netEngineeringLinesPerMission: meanOfMeasured(
        members.map((outcome) => netEngineeringLines.get(outcome.missionId) ?? null),
      ),
      observationCounts: {
        cycleTime: cycleTimes.length,
        activeDwell: activeDwells.length,
        reviewDwell: reviewDwells.length,
        reviewBounce: entered.length,
        reviewFixRounds: members.filter((outcome) => outcome.reviewFixRounds !== null).length,
        tokens: tokens.length,
        runtime: runtimes.length,
        cost: costs.length,
        netEngineeringLines: nels.length,
      },
    };
  });

  return {
    dimension: input.dimension,
    lowSampleThreshold: threshold,
    cohorts: cohorts.sort((left, right) => right.n - left.n || left.key.localeCompare(right.key)),
  };
}

/** The recorded dwell of each member that has one; unmeasured members drop out. */
function dwellOf(
  members: readonly MissionOutcome[],
  dwell: ReadonlyMap<MissionId, number>,
): readonly number[] {
  return members
    .map((outcome) => dwell.get(outcome.missionId))
    .filter((minutes): minutes is number => minutes !== undefined);
}
