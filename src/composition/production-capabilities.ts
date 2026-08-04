import type { ExecuteMissionPorts } from '../application/ports/execute-mission.js';
import type { TuiCapabilities } from '../application/tui-capabilities.js';
import type { BoardProjectionBuilder } from '../application/projections/board-readers.js';
import type { MissionProjectionQuery } from '../application/projections/mission-query.js';
import { repositoryId } from '../domain/repository.js';
import { resolveKnownAgentFamilies } from '../interfaces/tui/agent-config-resolver.js';
import type {
  AgentBlocklistRepository,
} from '../application/ports/agent-blocklist.js';
import type { BoardLaneEventRepository, OperationalHistoryRepository } from '../application/ports/operation-history.js';
import type { UsageRepository } from '../application/ports/mission-measurements.js';
import type { MissionStore } from '../application/domain-ports.js';
import { composeTuiCapabilities } from './board-projection.js';

export interface ProductionBoardRepositories {
  readonly agentBlocklist: AgentBlocklistRepository;
  readonly operationalHistory: OperationalHistoryRepository;
  readonly boardLaneEvents: BoardLaneEventRepository;
  readonly usage: UsageRepository;
}

/** Shared presentation capabilities from one production composition graph. */
export interface ProductionCapabilities {
  readonly tui: TuiCapabilities;
  readonly boardProjection: BoardProjectionBuilder;
  readonly missionDetails: MissionProjectionQuery;
  readonly executePorts: ExecuteMissionPorts;
}

/**
 * Compose board reads and active dispatch once, then hand the exact TUI
 * capability object to every presentation consumer in this CLI process.
 */
export function composeProductionCapabilities(
  rootDir: string,
  repositories: ProductionBoardRepositories,
  executePorts: ExecuteMissionPorts,
  missionStore: MissionStore | null,
): ProductionCapabilities {
  const tui = composeTuiCapabilities({
    rootDir,
    missionStore,
    repositoryId: repositoryId(rootDir),
    blocklistRepo: repositories.agentBlocklist,
    historyRepo: repositories.operationalHistory,
    laneEventRepo: repositories.boardLaneEvents,
    usageRepo: repositories.usage,
    knownAgentFamilies: resolveKnownAgentFamilies(rootDir),
  }, executePorts);
  return {
    tui,
    boardProjection: tui.boardProjection,
    missionDetails: tui.missionDetails,
    executePorts,
  };
}
