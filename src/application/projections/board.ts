import type { MissionId } from '../../domain/mission.js';
import type { RepositoryId } from '../../domain/repository.js';
import type { SourceFact } from '../../platform/runtime/lib/application/contracts.js';
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

export interface WipCountMetric {
  readonly lane: BoardLane;
  readonly count: number;
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
  readonly cumulativeFlow: MetricSeries;
  readonly medianStateTimes: MetricSeries;
  readonly throughput: MetricSeries;
  readonly reviewLoopRate: MetricSeries;
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

/** Build BoardMetrics with explicit missing-history fallback behavior. */
export function buildBoardMetrics(
  cumulativeFlow: MetricSeries,
  medianStateTimes: MetricSeries,
  throughput: MetricSeries,
  reviewLoopRate: MetricSeries,
): BoardMetrics {
  return { cumulativeFlow, medianStateTimes, throughput, reviewLoopRate };
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
