/**
 * Mocked BoardProjection data for the Ink TUI component tests.
 *
 * These fixtures are plain data — no test that uses them launches an agent,
 * touches Forgejo, reads a repository, or runs a workflow command.
 */
import { attentionAction, attentionSources, IN_FLIGHT_WIP_LANES } from '../../src/application/projections/board.js';
import type {
  AttentionItem,
  AttentionReason,
  BoardMetrics,
  BoardProjection,
  BoardStage,
  MetricSeries,
} from '../../src/application/projections/board.js';
import type { BoardLane, MissionCard } from '../../src/application/projections/mission-board.js';
import type { AgentFamily } from '../../src/domain/agents.js';
import type { MissionId } from '../../src/domain/mission.js';
import type { RepositoryId } from '../../src/domain/repository.js';

const emptySeries: MetricSeries = { series: [], missingHistoryFallback: 'skip' };

export const emptyMetrics: BoardMetrics = {
  health: { state: 'no-telemetry' },
  provenance: {
    repositoryId: 'test-repo' as RepositoryId,
    evaluatedWindow: { startedAt: null, endedAt: null },
    sampleSize: 0,
    newestEventTimestamp: null,
    rejectedOrMissingIdentityRowCount: 0,
    adapterSucceeded: true,
  },
  cumulativeFlow: emptySeries,
  cumulativeFlowByState: emptySeries as unknown as BoardMetrics['cumulativeFlowByState'],
  medianStateTimes: emptySeries,
  medianAgentRuntime: emptySeries,
  medianCycleTimeByState: emptySeries as unknown as BoardMetrics['medianCycleTimeByState'],
  throughput: emptySeries,
  reviewBounceRate: emptySeries,
  medianAgeByLane: emptySeries as unknown as BoardMetrics['medianAgeByLane'],
  agentAvailability: [],
  bottleneck: {
    sentence: 'Bottleneck unavailable: history is missing.',
    inputs: { lane: null, medianAgeMinutes: null, reviewBounceRate: null },
  },
};

export const ALL_LANES: readonly BoardLane[] = [
  'backlog', 'refined', 'active', 'review', 'integration', 'done',
];

/** A card with every optional projection fact absent. */
export function makeCard(overrides: Partial<MissionCard> = {}): MissionCard {
  return {
    id: 'task-9999' as MissionId,
    repositoryId: 'test-repo' as RepositoryId,
    title: 'Test task-9999',
    labels: [],
    lane: 'active',
    status: 'active',
    rawStatus: 'active',
    closed: false,
    agent: null,
    checkpoint: null,
    checkpointDescription: null,
    nextActionText: null,
    gate: 'unknown',
    pullRequest: null,
    reviewApproved: false,
    reviewRound: null,
    reviewPhase: null,
    reviewDisposition: null,
    reviewHistory: [],
    currentWork: null,
    blockingReason: null,
    flags: [],
    commands: [],
    ...overrides,
  };
}

/** A card with every projection fact present. */
export function makeFullCard(overrides: Partial<MissionCard> = {}): MissionCard {
  return makeCard({
    id: 'task-1234' as MissionId,
    title: 'Full card title',
    lane: 'review',
    status: 'review',
    rawStatus: 'review',
    agent: 'custom' as AgentFamily,
    checkpoint: 'CP-2.md',
    checkpointDescription: 'CP-2: components extracted',
    nextActionText: 'run the verification gate',
    gate: 'passed',
    pullRequest: {
      kind: 'pull-request',
      provider: 'forgejo',
      id: '42',
      url: 'https://example.invalid/pr/42',
      sourceBranch: 'mission/task-1234',
      targetBranch: 'main',
    },
    reviewApproved: true,
    blockingReason: 'waiting on upstream fix',
    ...overrides,
  });
}

export function makeStage(lane: BoardLane, cards: readonly MissionCard[] = []): BoardStage {
  return { lane, cards, count: cards.length };
}

/** Build a full BoardProjection from a lane→cards map. */
export function makeProjection(
  cardsByLane: Partial<Record<BoardLane, readonly MissionCard[]>> = {},
  repositoryId = 'test-repo',
): BoardProjection {
  const stages = ALL_LANES.map((lane) => makeStage(lane, cardsByLane[lane] ?? []));
  return {
    version: 1,
    repositoryId: repositoryId as RepositoryId,
    stages,
    attentionQueue: [],
    wipCounts: stages.map((stage) => ({ lane: stage.lane, count: stage.count })),
    inFlightWip: stages.filter((stage) => IN_FLIGHT_WIP_LANES.has(stage.lane)).reduce((count, stage) => count + stage.count, 0),
    availableActions: [],
    operationLog: [],
    metrics: emptyMetrics,
    sourceFacts: [],
  };
}

/** Build `count` distinct cards in one lane, slugged task-0001…task-NNNN. */
export function makeCards(count: number, lane: BoardLane): MissionCard[] {
  return Array.from({ length: count }, (_unused, index) =>
    makeCard({
      id: `task-${String(index + 1).padStart(4, '0')}` as MissionId,
      lane,
      title: `Mission ${index + 1}`,
    }),
  );
}

/** Build an AttentionItem from a card, reason, and rank. */
export function makeAttentionItem(
  card: MissionCard,
  reason: AttentionReason,
  rank: number,
): AttentionItem {
  return {
    missionId: card.id,
    rank,
    reason,
    card,
    action: attentionAction(card, reason),
    dependsOnSources: attentionSources(reason),
  };
}
