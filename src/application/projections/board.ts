import type { MissionId } from '../../domain/mission.js';
import type { CohortComparison } from './cohorts.js';
import type { RepositoryId } from '../../domain/repository.js';
import type { AgentFamily } from '../../domain/agents.js';
import type { SourceFact } from '../contracts.js';
import type {
  BoardLane,
  CommandAvailability,
  MissionCard,
} from './mission-board.js';

// ---------------------------------------------------------------------------
// BoardProjection — versioned read model consumed by Ink and web clients
// ---------------------------------------------------------------------------

export const BOARD_PROJECTION_VERSION = 1 as const;

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
}

export type AttentionReason =
  | { readonly kind: 'blocking'; readonly detail: string }
  | { readonly kind: 'gate-failed'; readonly detail: string }
  | { readonly kind: 'review-lane'; readonly detail: string }
  | { readonly kind: 'integrate-lane'; readonly detail: string }
  | { readonly kind: 'none' };

export interface MetricSeries {
  readonly series: readonly { readonly at: string; readonly value: number | null }[];
  /** Exact behavior when event history is incomplete. */
  readonly missingHistoryFallback: 'null' | 'estimate' | 'skip';
}

export interface StateFlowPoint {
  readonly at: string;
  readonly counts: Readonly<Record<BoardLane, number>>;
}

export interface StateFlowSeries {
  readonly series: readonly StateFlowPoint[];
  readonly missingHistoryFallback: MetricSeries['missingHistoryFallback'];
}

export interface LaneMetricSeries {
  readonly series: readonly { readonly lane: BoardLane; readonly value: number | null }[];
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
    readonly reviewLoopRate: number | null;
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
  readonly availableActions: readonly CommandAvailability[];
  readonly operationLog: readonly OperationLogEntry[];
  /** Time-based metrics derived from recorded events. */
  readonly metrics: BoardMetrics;
  /** Source facts for rebuildability. */
  readonly sourceFacts: readonly SourceFact<string>[];
}

export interface BoardMetrics {
  /** Collection health is separate from metric-level missing-history fallbacks. */
  readonly health: StatisticsHealth;
  /** The exact data set used to derive this metrics projection. */
  readonly provenance: MetricsProvenance;
  readonly cumulativeFlow: MetricSeries;
  /**
   * Running agent sessions that could not be attributed to a family, or `null`
   * when liveness was not observed. Kept beside `agentAvailability` so the
   * per-family counts never have to absorb a session they cannot claim.
   */
  readonly unattributedRunningSessions?: number | null;
  readonly cumulativeFlowByState: StateFlowSeries;
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
  readonly reviewLoopRate: MetricSeries;
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
  if (card.lane === 'review') { return { kind: 'review-lane', detail: 'Awaiting review decision' }; }
  if (card.lane === 'integration') { return { kind: 'integrate-lane', detail: 'Awaiting integration' }; }
  return { kind: 'none' };
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
      inputs: { lane: null, medianAgeMinutes: null, reviewLoopRate: null, weeklyThroughput: null },
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
  readonly medianStateTimes: MetricSeries;
  readonly medianCycleTimeByState?: LaneMetricSeries;
  readonly throughput: MetricSeries;
  readonly weeklyThroughput?: MetricSeries;
  readonly reviewLoopRate: MetricSeries;
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
    reviewLoopRate: input.reviewLoopRate,
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

  const ranked = cards.map((card) => ({
    missionId: card.id,
    rank: attentionRank(card),
    reason: attentionReason(card),
    card,
  }));
  const attentionQueue = ranked.sort((left, right) => {
    const rank = left.rank - right.rank;
    return rank === 0 ? left.missionId.localeCompare(right.missionId) : rank;
  });

  const wipCounts = allLanes.map((lane) => ({
    lane,
    count: cards.filter((card) => card.lane === lane).length,
  }));

  return {
    version: BOARD_PROJECTION_VERSION,
    repositoryId,
    stages,
    attentionQueue,
    wipCounts,
    availableActions,
    operationLog,
    metrics,
    sourceFacts,
  };
}

// Re-export for convenience
import { attentionRank } from './mission-board.js';
export { attentionRank };
