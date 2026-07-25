import type { RepositoryId } from '../../domain/repository.js';
import type { AgentFamily } from '../../domain/agents.js';
import type {
  AgentBlocklistRepository,
  BoardLaneEventRepository,
  OperationalHistoryRepository,
  UsageRepository,
} from '../../adapters/sqlite/ports.js';
import { BoardProjectionBuilder } from './board-readers.js';
import { ConcreteMissionReadAdapter } from '../../adapters/backlog/concrete-mission-read-adapter.js';
import { ConcreteReviewReadAdapter } from '../../adapters/backlog/concrete-review-read-adapter.js';
import { ConcreteGateReadAdapter } from '../../adapters/backlog/concrete-gate-read-adapter.js';
import { ConcreteAgentReadAdapter } from '../../adapters/backlog/concrete-agent-read-adapter.js';
import { ConcreteOperationLogReadAdapter } from '../../adapters/backlog/concrete-operation-log-read-adapter.js';
import { ConcreteGitReadAdapter } from '../../adapters/backlog/concrete-git-read-adapter.js';
import { ConcreteMetricsReadAdapter } from './metrics-read-adapter.js';

// ---------------------------------------------------------------------------
// Composition root — wires concrete adapters into BoardProjectionBuilder
// ---------------------------------------------------------------------------

export interface BoardProjectionBuilderDeps {
  /** Root directory of the target repository. */
  readonly rootDir: string;
  /** Stable repository identifier (from git config or config). */
  readonly repositoryId: RepositoryId;
  /** SQLite blocklist repository (TASK-2295 snapshot). */
  readonly blocklistRepo: AgentBlocklistRepository;
  /** SQLite operational history repository (TASK-2295 snapshot). */
  readonly historyRepo: OperationalHistoryRepository;
  /** SQLite board lane-events repository (TASK-2303). */
  readonly laneEventRepo: BoardLaneEventRepository;
  /** SQLite usage statistics repository (TASK-2294). */
  readonly usageRepo: UsageRepository;
  /** Known agent families to report availability for. */
  readonly knownAgentFamilies: readonly AgentFamily[];
}

/**
 * Composition root: instantiate the full `BoardProjectionBuilder` over all six
 * concrete read adapters.
 *
 * This is the single place where the projection pipeline is assembled. All
 * board/mission materialisation flows through this builder.
 */
export function createBoardProjectionBuilder(
  deps: BoardProjectionBuilderDeps,
): BoardProjectionBuilder {
  const missionAdapter = new ConcreteMissionReadAdapter({
    rootDir: deps.rootDir,
    repositoryId: deps.repositoryId,
  });

  const reviewAdapter = new ConcreteReviewReadAdapter({
    rootDir: deps.rootDir,
  });

  const gateAdapter = new ConcreteGateReadAdapter({
    rootDir: deps.rootDir,
  });

  const agentAdapter = new ConcreteAgentReadAdapter({
    rootDir: deps.rootDir,
    blocklistRepo: deps.blocklistRepo,
    knownAgentFamilies: deps.knownAgentFamilies,
  });

  const operationLogAdapter = new ConcreteOperationLogReadAdapter({
    historyRepo: deps.historyRepo,
  });

  const metricsAdapter = new ConcreteMetricsReadAdapter({
    laneEventRepo: deps.laneEventRepo,
    usageRepo: deps.usageRepo,
  });

  const gitAdapter = new ConcreteGitReadAdapter({
    rootDir: deps.rootDir,
    repositoryId: deps.repositoryId,
  });

  return new BoardProjectionBuilder(
    missionAdapter,
    reviewAdapter,
    gateAdapter,
    agentAdapter,
    gitAdapter,
    operationLogAdapter,
    { metricsAdapter },
  );
}
