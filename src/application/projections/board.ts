import type { MissionId } from '../../domain/mission.js';
import type { CohortComparison } from './cohorts.js';
import type { RepositoryId } from '../../domain/repository.js';
import type { AgentFamily } from '../../domain/agents.js';
import type { SourceFact } from '../contracts.js';
import type { BoardCommandKind } from '../controller/board-command.js';
import type {
  BoardLane,
  CommandAvailability,
  MissionCard,
} from './mission-board.js';

// ---------------------------------------------------------------------------
// BoardProjection — versioned read model consumed by Ink and web clients
// ---------------------------------------------------------------------------

export const BOARD_PROJECTION_VERSION = 1 as const;
export const IN_FLIGHT_WIP_LANES: ReadonlySet<BoardLane> = new Set(['refined', 'active', 'review', 'integration']);

export interface BoardStage {
  readonly lane: BoardLane;
  readonly cards: readonly MissionCard[];
  readonly count: number;
}

export interface AttentionItem {
  readonly missionId: MissionId;
  readonly rank: number;
  readonly reason: AttentionReason;
  readonly card: MissionCard;
  /**
   * The typed application command this item stands for, resolved here rather
   * than guessed by a UI adapter. The operator sees `action.display` and Enter
   * dispatches `action.kind`, so the advertised and dispatched commands cannot
   * drift apart (AC #14).
   */
  readonly action: AttentionAction;
  /**
   * The source facts this item's conclusion actually depends on. A stale
   * source is only worth warning about on the items it could have misled; a
   * global banner stamped onto every row tells the operator nothing (AC #15).
   */
  readonly dependsOnSources: readonly string[];
}

/** The command an attention item advertises and dispatches. */
export interface AttentionAction {
  readonly kind: BoardCommandKind;
  /** Exactly what the operator is shown, e.g. `px review task-0001`. */
  readonly display: string;
}

export type AttentionReason =
  | { readonly kind: 'blocking'; readonly detail: string }
  | { readonly kind: 'gate-failed'; readonly detail: string }
  | { readonly kind: 'review-lane'; readonly detail: string }
  | { readonly kind: 'integrate-lane'; readonly detail: string }
  /** Work was published as running, then stopped being verifiable. */
  | { readonly kind: 'stale-work'; readonly detail: string }
  | { readonly kind: 'none' };

export interface MetricSeries {
  readonly series: readonly {
    readonly at: string;
    readonly value: number | null;
    /** Number of observations that contributed to this point. */
    readonly observationCount?: number;
  }[];
  /** Exact behavior when event history is incomplete. */
  readonly missingHistoryFallback: 'null' | 'estimate' | 'skip';
}

/** One figure plus the number of observations it was computed from. */
export interface DecisionMetric {
  readonly value: number | null;
  readonly observationCount: number;
}

/**
 * The completed-mission statistics of one rolling decision window.
 *
 * Every figure is computed from the missions whose lifecycle completion falls
 * inside `startDate`…`endDate`, using each selected mission's full lifecycle —
 * intervals are never truncated at the window edge, and agent runs are never
 * filtered by their own timestamps.
 */
export interface DecisionWindowMetrics {
  /** Operator-facing range, e.g. `2026-08-05 → 2026-08-11`. */
  readonly label: string;
  readonly startDate: string;
  readonly endDate: string;
  /** Missions whose lifecycle completed inside the window. */
  readonly completedMissions: number;
  readonly cycleTime: DecisionMetric;
  readonly agentRuntime: DecisionMetric;
  readonly activeDwell: DecisionMetric;
  readonly reviewDwell: DecisionMetric;
  readonly integrationDwell: DecisionMetric;
  readonly reviewBounce: DecisionMetric;
}

/** The current rolling seven days beside the seven before them. */
export interface DecisionWindowComparison {
  readonly current: DecisionWindowMetrics;
  readonly previous: DecisionWindowMetrics;
}

export interface StateFlowPoint {
  readonly at: string;
  readonly counts: Readonly<Record<BoardLane, number>>;
  /** Number of lifecycle observations represented in this snapshot. */
  readonly observationCount?: number;
}

export interface StateFlowSeries {
  readonly series: readonly StateFlowPoint[];
  readonly missingHistoryFallback: MetricSeries['missingHistoryFallback'];
}

/**
 * One reporting window's cumulative flow, with the window it is scoped to.
 *
 * The window travels with the series so no surface has to re-derive it: the
 * browser renders exactly the days and counts the projection published.
 */
export interface WeeklyStateFlowSeries extends StateFlowSeries {
  readonly window: {
    readonly startDate: string;
    readonly endDate: string;
    /** Operator-facing range, e.g. `2026-08-25 → 2026-08-31`. */
    readonly label: string;
  };
}

export interface LaneMetricSeries {
  readonly series: readonly {
    readonly lane: BoardLane;
    readonly value: number | null;
    /** Number of observations that contributed to this lane value. */
    readonly observationCount?: number;
  }[];
  readonly missingHistoryFallback: MetricSeries['missingHistoryFallback'];
}

export interface AgentAvailabilityMetric {
  readonly family: AgentFamily;
  readonly available: boolean;
  readonly blockedForMs: number;
  /** Why the family is blocked, when the block carries a reason. */
  readonly reason?: string | null;
  /**
   * Missions this family is running right now, or `null` when liveness could
   * not be observed. Null is unknown and must not be rendered as zero.
   */
  readonly runningSessions?: number | null;
}

/** A fixed, projection-owned explanation of the constraint identified by FLOW. */
export interface BottleneckNarrative {
  readonly sentence: string;
  readonly inputs: {
    readonly lane: BoardLane | null;
    readonly medianAgeMinutes: number | null;
    readonly reviewBounceRate: number | null;
    readonly weeklyThroughput: number | null;
  };
}

export interface WipCountMetric {
  readonly lane: BoardLane;
  readonly count: number;
  /** Optional configured WIP limit. When present, header renders "count/limit". */
  readonly wipLimit?: number;
}

export interface OperationLogEntry {
  readonly operationId: string;
  readonly phase: string;
  readonly message: string;
  readonly timestamp: string;
  readonly agent?: string;
}

export interface BoardProjection {
  readonly version: typeof BOARD_PROJECTION_VERSION;
  readonly repositoryId: RepositoryId;
  readonly stages: readonly BoardStage[];
  readonly attentionQueue: readonly AttentionItem[];
  readonly wipCounts: readonly WipCountMetric[];
  readonly inFlightWip: number;
  readonly availableActions: readonly CommandAvailability[];
  readonly operationLog: readonly OperationLogEntry[];
  /** Time-based metrics derived from recorded events. */
  readonly metrics: BoardMetrics;
  /** Source facts for rebuildability, one per `(source, status, value)` tuple; repeats are collapsed. */
  readonly sourceFacts: readonly SourceFact<string>[];
}

export interface BoardMetrics {
  /** Collection health is separate from metric-level missing-history fallbacks. */
  readonly health: StatisticsHealth;
  /** The exact data set used to derive this metrics projection. */
  readonly provenance: MetricsProvenance;
  /**
   * The weekly decision comparison FLOW is built around. Optional because a
   * projection cached before TASK-2363 carries none; when present, the
   * completed-mission series below report the same current window.
   */
  readonly decisionWindow?: DecisionWindowComparison;
  readonly cumulativeFlow: MetricSeries;
  /**
   * Running agent sessions that could not be attributed to a family, or `null`
   * when liveness was not observed. Kept beside `agentAvailability` so the
   * per-family counts never have to absorb a session they cannot claim.
   */
  readonly unattributedRunningSessions?: number | null;
  readonly cumulativeFlowByState: StateFlowSeries;
  /**
   * Cumulative flow scoped to the current rolling reporting window. Optional
   * because a projection cached before TASK-2459 carries none; when present it
   * is what FLOW renders, so the week's `done` band cannot start loaded with
   * missions completed before the window.
   */
  readonly weeklyCumulativeFlow?: WeeklyStateFlowSeries;
  /** Median mission lifetime in minutes: lane entry to closure, waiting included. */
  readonly medianStateTimes: MetricSeries;
  /**
   * Median agent execution minutes per completed mission, summed from the
   * outcome's runs. Deliberately separate from `medianStateTimes`: one measures
   * how efficiently the agents work, the other how efficiently the delivery
   * system moves missions through the board.
   */
  readonly medianAgentRuntime: MetricSeries;
  readonly medianCycleTimeByState: LaneMetricSeries;
  readonly throughput: MetricSeries;
  readonly weeklyThroughput: MetricSeries;
  /** Lifecycle `review → active` bounces per mission that entered review. */
  readonly reviewBounceRate: MetricSeries;
  readonly medianAgeByLane: LaneMetricSeries;
  readonly agentAvailability: readonly AgentAvailabilityMetric[];
  readonly bottleneck: BottleneckNarrative;
  /**
   * Completed missions compared along one experiment dimension. Optional
   * because a board without lifecycle history has no cohort to report; when
   * present, every cohort carries the sample size it was computed from.
   */
  readonly cohorts?: CohortComparison;
}

export type StatisticsHealthState = 'healthy' | 'partial' | 'unavailable' | 'no-completions' | 'no-telemetry' | 'pre-lifecycle';

export interface StatisticsHealth {
  readonly state: StatisticsHealthState;
}

export interface MetricsProvenance {
  readonly repositoryId: RepositoryId;
  readonly evaluatedWindow: { readonly startedAt: string | null; readonly endedAt: string | null };
  readonly sampleSize: number;
  readonly newestEventTimestamp: string | null;
  readonly rejectedOrMissingIdentityRowCount: number;
  readonly adapterSucceeded: boolean;
}

// ---------------------------------------------------------------------------
// Build helpers
// ---------------------------------------------------------------------------

/** Derive AttentionReason from a MissionCard's operational facts. */
export function attentionReason(card: MissionCard): AttentionReason {
  if (card.blockingReason) { return { kind: 'blocking', detail: card.blockingReason }; }
  if (card.gate === 'failed') { return { kind: 'gate-failed', detail: `Gate ${card.gate}` }; }
  // An agent is already taking this lane's turn — see `agentIsWorking`.
  if (agentIsWorking(card)) { return { kind: 'none' }; }
  // Published work that stopped being verifiable is not silently forgotten:
  // the operator is told the mission looked busy and no longer does.
  if (card.currentWork?.freshness === 'stale') {
    return { kind: 'stale-work', detail: `${card.currentWork.phase} work is no longer verifiable` };
  }
  if (card.lane === 'review') { return { kind: 'review-lane', detail: 'Awaiting review decision' }; }
  if (card.lane === 'integration') { return { kind: 'integrate-lane', detail: 'Awaiting integration' }; }
  return { kind: 'none' };
}

/**
 * The typed command an attention item resolves to.
 *
 * One function owns both halves of the pair the operator sees and presses, so
 * no surface can render `px review` beside a dispatch of `active:execute`.
 */
export function attentionAction(card: MissionCard, reason: AttentionReason): AttentionAction {
  switch (reason.kind) {
    case 'integrate-lane':
      return { kind: 'integrate:merge', display: `px integrate ${card.id}` };
    case 'review-lane':
      return { kind: 'review:submit', display: `px review ${card.id}` };
    default:
      return { kind: 'active:execute', display: `px active ${card.id}` };
  }
}

/**
 * Which source facts an attention item's conclusion rests on.
 *
 * `current-work` and `gate` are named even when the projection carries no
 * source fact for them: the map is about what the conclusion depends on, not
 * about what happened to be reported this build.
 */
export function attentionSources(reason: AttentionReason): readonly string[] {
  switch (reason.kind) {
    case 'blocking':
    case 'stale-work':
      return ['current-work'];
    case 'gate-failed':
      return ['gate'];
    case 'review-lane':
    case 'integrate-lane':
      return ['task-markdown'];
    default:
      return [];
  }
}

/** Build a BoardStage from cards in a given lane. */
export function buildBoardStage(lane: BoardLane, cards: readonly MissionCard[]): BoardStage {
  const laneCards = cards.filter((card) => card.lane === lane);
  return { lane, cards: laneCards, count: laneCards.length };
}

function emptyFlowMetrics(): Pick<BoardMetrics, 'cumulativeFlowByState' | 'medianCycleTimeByState' | 'medianAgentRuntime' | 'weeklyThroughput' | 'medianAgeByLane' | 'agentAvailability' | 'bottleneck'> {
  return {
    cumulativeFlowByState: { series: [], missingHistoryFallback: 'skip' },
    medianAgentRuntime: { series: [], missingHistoryFallback: 'null' },
    medianCycleTimeByState: { series: [], missingHistoryFallback: 'skip' },
    weeklyThroughput: { series: [], missingHistoryFallback: 'skip' },
    medianAgeByLane: { series: [], missingHistoryFallback: 'skip' },
    agentAvailability: [],
    bottleneck: {
      sentence: 'Bottleneck unavailable: history is missing.',
      inputs: { lane: null, medianAgeMinutes: null, reviewBounceRate: null, weeklyThroughput: null },
    },
  };
}

function defaultHealth(): Pick<BoardMetrics, 'health' | 'provenance'> {
  return {
    health: { state: 'no-telemetry' },
    provenance: {
      repositoryId: '' as RepositoryId,
      evaluatedWindow: { startedAt: null, endedAt: null },
      sampleSize: 0,
      newestEventTimestamp: null,
      rejectedOrMissingIdentityRowCount: 0,
      adapterSucceeded: true,
    },
  };
}

export interface BoardMetricsInput {
  readonly cumulativeFlow: MetricSeries;
  readonly cumulativeFlowByState?: StateFlowSeries;
  readonly weeklyCumulativeFlow?: WeeklyStateFlowSeries;
  readonly medianStateTimes: MetricSeries;
  readonly medianCycleTimeByState?: LaneMetricSeries;
  readonly throughput: MetricSeries;
  readonly weeklyThroughput?: MetricSeries;
  readonly reviewBounceRate: MetricSeries;
  readonly medianAgeByLane?: LaneMetricSeries;
  readonly agentAvailability?: readonly AgentAvailabilityMetric[];
  readonly bottleneck?: BottleneckNarrative;
}

/** Build BoardMetrics from named series so a metric cannot be silently swapped. */
export function buildBoardMetrics(input: BoardMetricsInput): BoardMetrics {
  const defaults = emptyFlowMetrics();
  return {
    ...defaultHealth(),
    ...defaults,
    ...input,
    cumulativeFlow: input.cumulativeFlow,
    cumulativeFlowByState: input.cumulativeFlowByState ?? defaults.cumulativeFlowByState,
    medianStateTimes: input.medianStateTimes,
    medianCycleTimeByState: input.medianCycleTimeByState ?? defaults.medianCycleTimeByState,
    throughput: input.throughput,
    weeklyThroughput: input.weeklyThroughput ?? defaults.weeklyThroughput,
    reviewBounceRate: input.reviewBounceRate,
    medianAgeByLane: input.medianAgeByLane ?? defaults.medianAgeByLane,
    agentAvailability: input.agentAvailability ?? defaults.agentAvailability,
    bottleneck: input.bottleneck ?? defaults.bottleneck,
  };
}

/** Assemble the full BoardProjection from mission cards and operational data. */
export function buildBoardProjection(
  repositoryId: RepositoryId,
  cards: readonly MissionCard[],
  availableActions: readonly CommandAvailability[],
  operationLog: readonly OperationLogEntry[],
  metrics: BoardMetrics,
  sourceFacts: readonly SourceFact<string>[],
): BoardProjection {
  const allLanes: readonly BoardLane[] = ['backlog', 'refined', 'active', 'review', 'integration', 'done'];
  const stages = allLanes.map((lane) => buildBoardStage(lane, cards));

  const ranked = cards.flatMap((card) => {
    const reason = attentionReason(card);
    if (reason.kind === 'none') { return []; }
    const action = attentionAction(card, reason);
    const command = action.kind.split(':', 1)[0];
    if (!card.commands.some((item) => item.command === command && item.enabled)) { return []; }
    return [{
      missionId: card.id,
      rank: attentionRank(card),
      reason,
      card,
      action,
      dependsOnSources: attentionSources(reason),
    }];
  });
  const attentionQueue = ranked.sort((left, right) => {
    const rank = left.rank - right.rank;
    return rank === 0 ? left.missionId.localeCompare(right.missionId) : rank;
  }).map((item, index) => ({ ...item, rank: index + 1 }));

  const wipCounts = allLanes.map((lane) => ({
    lane,
    count: cards.filter((card) => card.lane === lane).length,
  }));
  const inFlightWip = cards.filter((card) => IN_FLIGHT_WIP_LANES.has(card.lane)).length;
  const uniqueSourceFacts = [...new Map(sourceFacts.map((fact) => [JSON.stringify([fact.source, fact.status, fact.value]), fact])).values()];

  return {
    version: BOARD_PROJECTION_VERSION,
    repositoryId,
    stages,
    attentionQueue,
    wipCounts,
    inFlightWip,
    availableActions,
    operationLog,
    metrics,
    sourceFacts: uniqueSourceFacts,
  };
}

// Re-export for convenience
import { agentIsWorking, attentionRank } from './mission-board.js';
export { attentionRank };
