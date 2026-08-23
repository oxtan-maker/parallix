import type { AgentFamily } from '../domain/agents.js';
import type { RepositoryId } from '../domain/repository.js';
import type {
  AgentBlocklistRepository,
} from '../application/ports/agent-blocklist.js';
import type { BoardLaneEventRepository, OperationalHistoryRepository } from '../application/ports/operation-history.js';
import type { SessionMarkerRepository } from '../application/ports/mission-store.js';
import type { UsageRepository } from '../application/ports/mission-measurements.js';
import { createLauncherProbe, type LauncherProbeResult } from '../adapters/agents/launcher-availability.js';
import { ConcreteAgentReadAdapter } from '../adapters/backlog/concrete-agent-read-adapter.js';
import { ConcreteGateReadAdapter } from '../adapters/backlog/concrete-gate-read-adapter.js';
import { ConcreteGitReadAdapter } from '../adapters/backlog/concrete-git-read-adapter.js';
import { ConcreteMissionReadAdapter } from '../adapters/backlog/concrete-mission-read-adapter.js';
import { ConcreteOperationLogReadAdapter } from '../adapters/backlog/concrete-operation-log-read-adapter.js';
import { ConcreteReviewReadAdapter } from '../adapters/backlog/concrete-review-read-adapter.js';
import { ConcreteCurrentWorkReadAdapter } from '../adapters/backlog/concrete-current-work-read-adapter.js';
import { processLivenessProbe } from '../adapters/process/process-liveness.js';
import { snapshotWorktreeTopology } from '../adapters/git/worktree.js';
import { BoardProjectionBuilder } from '../application/projections/board-readers.js';
import type { MissionReadAdapter } from '../application/projections/board-readers.js';
import { ConcreteMetricsReadAdapter } from '../application/projections/metrics-read-adapter.js';
import { MissionProjectionQuery } from '../application/projections/mission-query.js';
import { BoardCommandController } from '../application/controller/board-controller.js';
import type { ExecuteMissionPorts } from '../application/ports/execute-mission.js';
import type { TuiCapabilities } from '../application/tui-capabilities.js';
import type { MissionStore } from '../application/domain-ports.js';
import type { CurrentWorkPort } from '../application/recording/current-work-recorder.js';
import type { SqliteDatabaseAdapter } from '../adapters/sqlite/database-adapter.js';
import { SqliteReviewProjectionReader } from '../adapters/sqlite/review-projection-reader.js';

export interface BoardProjectionCompositionDeps {
  readonly rootDir: string;
  readonly missionStore: MissionStore | null;
  readonly database?: SqliteDatabaseAdapter | null;
  readonly repositoryId: RepositoryId;
  readonly blocklistRepo: AgentBlocklistRepository;
  readonly historyRepo: OperationalHistoryRepository;
  readonly laneEventRepo: BoardLaneEventRepository;
  readonly usageRepo: UsageRepository;
  readonly knownAgentFamilies: readonly AgentFamily[];
  /** Launcher availability probe; defaults to the cached real probe. */
  readonly launcherProbe?: (_family: AgentFamily) => LauncherProbeResult;
  /** Session markers, used to attribute running missions to agent families. */
  readonly sessionMarkers?: SessionMarkerRepository | null;
}

/** The sole production constructor for board reads and mission details. */
export function composeBoardProjection(deps: BoardProjectionCompositionDeps) {
  const repositoryMissions = new ConcreteMissionReadAdapter({ rootDir: deps.rootDir, repositoryId: deps.repositoryId });
  const missions: MissionReadAdapter = {
    async loadAllMissions() {
      const loaded = await repositoryMissions.loadAllMissions();
      return Promise.all(loaded.map((mission) => withPersistedCheckpoints(mission)));
    },
    async loadMission(id) {
      const mission = await repositoryMissions.loadMission(id);
      return mission ? withPersistedCheckpoints(mission) : null;
    },
    getSourceFacts: () => repositoryMissions.getSourceFacts(),
  };

  async function withPersistedCheckpoints(mission: import('../domain/mission.js').Mission) {
    if (!deps.missionStore) { return mission; }
    try {
      const stored = await deps.missionStore.load(mission.id);
      return stored.kind === 'found' ? { ...mission, checkpoints: stored.mission.checkpoints } : mission;
    } catch {
      return mission;
    }
  }
  const currentWork = new ConcreteCurrentWorkReadAdapter(deps.historyRepo);
  const gates = new ConcreteGateReadAdapter({ rootDir: deps.rootDir });
  const builder = new BoardProjectionBuilder(
    missions,
    new ConcreteReviewReadAdapter({
      rootDir: deps.rootDir,
      missionStore: deps.missionStore,
      projectionReader: deps.database ? new SqliteReviewProjectionReader(deps.database) : null,
    }),
    gates,
    new ConcreteAgentReadAdapter({
      rootDir: deps.rootDir,
      blocklistRepo: deps.blocklistRepo,
      knownAgentFamilies: deps.knownAgentFamilies,
      // Without a probe the board would report every configured family as
      // available even when its CLI is absent from this workstation.
      launcherAvailable: deps.launcherProbe ?? createLauncherProbe(),
      // Attributes a live `px` process to the family that launched it. Without
      // it the strip cannot report running sessions and says so.
      sessionMarkers: deps.sessionMarkers ?? null,
      currentWork,
      isProcessAlive: processLivenessProbe,
    }),
    new ConcreteGitReadAdapter({ rootDir: deps.rootDir, repositoryId: deps.repositoryId }),
    new ConcreteOperationLogReadAdapter({ historyRepo: deps.historyRepo }),
    {
      prepareReads: () => {
        const topology = snapshotWorktreeTopology({ cwd: deps.rootDir });
        repositoryMissions.useWorktreeTopology(topology);
        gates.useWorktreeTopology(topology);
      },
      // The authoritative answer to "which mission is being worked on right
      // now", published by the operations themselves. The OS-process scan in
      // the agent adapter above is left in place only as bounded recovery.
      currentWork,
      isProcessAlive: processLivenessProbe,
      metricsAdapter: new ConcreteMetricsReadAdapter({
        laneEventRepo: deps.laneEventRepo,
        usageRepo: deps.usageRepo,
        repositoryId: deps.repositoryId,
        historyRepo: deps.historyRepo,
        // Net engineering lines are a mission fact, not telemetry, so the
        // cohort comparison reads them from the same adapter the board does.
        netEngineeringLines: async () => new Map(
          (await missions.loadAllMissions()).map((mission) => [mission.id, mission.netEngineeringLines]),
        ),
        cohortMetadata: async () => new Map(
          (await missions.loadAllMissions()).map((mission) => [mission.id, { labels: mission.labels, assignee: mission.assignee }]),
        ),
      }),
    },
  );
  return { builder, missionQuery: new MissionProjectionQuery(missions) };
}

export function composeTuiCapabilities(
  deps: BoardProjectionCompositionDeps,
  executePorts: ExecuteMissionPorts,
  currentWork: CurrentWorkPort,
  controller?: BoardCommandController,
): TuiCapabilities {
  const board = composeBoardProjection(deps);
  const sharedController = controller ?? new BoardCommandController(executePorts);
  return {
    boardProjection: board.builder,
    missionDetails: board.missionQuery,
    commandControllerFactory: (progress) => new BoardCommandController(executePorts, progress, {}, currentWork),
    commandController: sharedController,
  };
}
