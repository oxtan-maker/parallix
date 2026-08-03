import type { AgentFamily } from '../domain/agents.js';
import type { RepositoryId } from '../domain/repository.js';
import type {
  AgentBlocklistRepository,
  BoardLaneEventRepository,
  OperationalHistoryRepository,
  UsageRepository,
} from '../adapters/sqlite/ports.js';
import { ConcreteAgentReadAdapter } from '../adapters/backlog/concrete-agent-read-adapter.js';
import { ConcreteGateReadAdapter } from '../adapters/backlog/concrete-gate-read-adapter.js';
import { ConcreteGitReadAdapter } from '../adapters/backlog/concrete-git-read-adapter.js';
import { ConcreteMissionReadAdapter } from '../adapters/backlog/concrete-mission-read-adapter.js';
import { ConcreteOperationLogReadAdapter } from '../adapters/backlog/concrete-operation-log-read-adapter.js';
import { ConcreteReviewReadAdapter } from '../adapters/backlog/concrete-review-read-adapter.js';
import { BoardProjectionBuilder } from '../application/projections/board-readers.js';
import { ConcreteMetricsReadAdapter } from '../application/projections/metrics-read-adapter.js';
import { MissionProjectionQuery } from '../application/projections/mission-query.js';
import { BoardCommandController } from '../application/controller/board-controller.js';
import type { ActivePort } from '../application/ports.js';
import type { TuiCapabilities } from '../application/tui-capabilities.js';

export interface BoardProjectionCompositionDeps {
  readonly rootDir: string;
  readonly repositoryId: RepositoryId;
  readonly blocklistRepo: AgentBlocklistRepository;
  readonly historyRepo: OperationalHistoryRepository;
  readonly laneEventRepo: BoardLaneEventRepository;
  readonly usageRepo: UsageRepository;
  readonly knownAgentFamilies: readonly AgentFamily[];
}

/** The sole production constructor for board reads and mission details. */
export function composeBoardProjection(deps: BoardProjectionCompositionDeps) {
  const missions = new ConcreteMissionReadAdapter({ rootDir: deps.rootDir, repositoryId: deps.repositoryId });
  const builder = new BoardProjectionBuilder(
    missions,
    new ConcreteReviewReadAdapter({ rootDir: deps.rootDir }),
    new ConcreteGateReadAdapter({ rootDir: deps.rootDir }),
    new ConcreteAgentReadAdapter({ rootDir: deps.rootDir, blocklistRepo: deps.blocklistRepo, knownAgentFamilies: deps.knownAgentFamilies }),
    new ConcreteGitReadAdapter({ rootDir: deps.rootDir, repositoryId: deps.repositoryId }),
    new ConcreteOperationLogReadAdapter({ historyRepo: deps.historyRepo }),
    { metricsAdapter: new ConcreteMetricsReadAdapter({ laneEventRepo: deps.laneEventRepo, usageRepo: deps.usageRepo }) },
  );
  return { builder, missionQuery: new MissionProjectionQuery(missions) };
}

export function composeTuiCapabilities(
  deps: BoardProjectionCompositionDeps,
  activePort: ActivePort,
): TuiCapabilities {
  const board = composeBoardProjection(deps);
  return {
    boardProjection: board.builder,
    missionDetails: board.missionQuery,
    commandControllerFactory: (progress) => new BoardCommandController(activePort, progress),
  };
}
