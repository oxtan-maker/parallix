import type { ExecuteMissionPorts } from '../application/ports/execute-mission.js';
import type { TuiCapabilities } from '../application/tui-capabilities.js';
import type { BoardCommandDispatcher, BoardProgressSink } from '../application/controller/board-command.js';
import { BoardCommandController } from '../application/controller/board-controller.js';
import type { BoardProjectionBuilder } from '../application/projections/board-readers.js';
import type { MissionProjectionQuery } from '../application/projections/mission-query.js';
import type { RepositoryId } from '../domain/repository.js';
import { resolveKnownAgentFamilies } from '../interfaces/tui/agent-config-resolver.js';
import type {
  AgentBlocklistRepository,
} from '../application/ports/agent-blocklist.js';
import type { BoardLaneEventRepository, OperationalHistoryRepository } from '../application/ports/operation-history.js';
import type { SessionMarkerRepository } from '../application/ports/mission-store.js';
import type { UsageRepository } from '../application/ports/mission-measurements.js';
import type { MissionStore } from '../application/domain-ports.js';
import type { CurrentWorkPort } from '../application/recording/current-work-recorder.js';
import type { SqliteDatabaseAdapter } from '../adapters/sqlite/database-adapter.js';
import { composeTuiCapabilities } from './board-projection.js';

export interface ProductionBoardRepositories {
  readonly agentBlocklist: AgentBlocklistRepository;
  readonly operationalHistory: OperationalHistoryRepository;
  readonly boardLaneEvents: BoardLaneEventRepository;
  readonly usage: UsageRepository;
  /** Optional: attributes running missions to the family that launched them. */
  readonly sessionMarkers?: SessionMarkerRepository | null;
}

/** Shared presentation capabilities from one production composition graph. */
export interface ProductionCapabilities {
  readonly tui: TuiCapabilities;
  readonly boardProjection: BoardProjectionBuilder;
  readonly missionDetails: MissionProjectionQuery;
  readonly executePorts: ExecuteMissionPorts;
  /** Single dispatcher instance shared by CLI and TUI. */
  readonly commandController: BoardCommandDispatcher;
}

/**
 * Compose board reads and active dispatch once, then hand the exact TUI
 * capability object to every presentation consumer in this CLI process.
 */
export function composeProductionCapabilities(
  rootDir: string,
  owningRepositoryId: RepositoryId,
  repositories: ProductionBoardRepositories,
  executePorts: ExecuteMissionPorts,
  missionStore: MissionStore | null,
  currentWork: CurrentWorkPort,
  progress?: BoardProgressSink,
  database?: SqliteDatabaseAdapter | null,
): ProductionCapabilities {
  // Single dispatcher instance shared by CLI and TUI (TASK-2332.05)
  const controller = new BoardCommandController(executePorts, progress, {}, currentWork, missionStore);
  const tui = composeTuiCapabilities({
    rootDir,
    missionStore,
    database,
    repositoryId: owningRepositoryId,
    blocklistRepo: repositories.agentBlocklist,
    historyRepo: repositories.operationalHistory,
    laneEventRepo: repositories.boardLaneEvents,
    usageRepo: repositories.usage,
    knownAgentFamilies: resolveKnownAgentFamilies(rootDir),
    sessionMarkers: repositories.sessionMarkers ?? null,
  }, executePorts, currentWork, controller);
  return {
    tui,
    boardProjection: tui.boardProjection,
    missionDetails: tui.missionDetails,
    executePorts,
    commandController: controller,
  };
}
