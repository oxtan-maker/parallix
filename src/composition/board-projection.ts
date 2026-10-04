import type { AgentFamily } from '../domain/agents.js';
import { createGitChangeIdentity } from '../adapters/git/change-identity.js';
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
import { readBacklogInputs } from '../adapters/backlog/backlog-input-reader.js';
import { resolveTaskFile, getTaskFrontmatterValue } from '../adapters/backlog/task-file-io.js';
import { ConcreteOperationLogReadAdapter } from '../adapters/backlog/concrete-operation-log-read-adapter.js';
import { ConcreteReviewReadAdapter } from '../adapters/backlog/concrete-review-read-adapter.js';
import { ConcreteCurrentWorkReadAdapter } from '../adapters/backlog/concrete-current-work-read-adapter.js';
import { processLivenessProbe } from '../adapters/process/process-liveness.js';
import { snapshotWorktreeTopology } from '../adapters/git/worktree.js';
import { BoardProjectionBuilder } from '../application/projections/board-readers.js';
import type { MissionReadAdapter } from '../application/projections/board-readers.js';
import { ConcreteMetricsReadAdapter, missionCohortMetadata } from '../application/projections/metrics-read-adapter.js';
import { MissionProjectionQuery } from '../application/projections/mission-query.js';
import type { SourceFact } from '../application/contracts.js';
import { BoardCommandController, type BoardMissionServices } from '../application/controller/board-controller.js';
import type { ExecuteMissionPorts } from '../application/ports/execute-mission.js';
import type { TuiCapabilities } from '../application/tui-capabilities.js';
import type { MissionStore } from '../application/domain-ports.js';
import type { CurrentWorkPort } from '../application/recording/current-work-recorder.js';
import type { SqliteDatabaseAdapter } from '../adapters/sqlite/database-adapter.js';
import { SqliteReviewProjectionReader } from '../adapters/sqlite/review-projection-reader.js';
import { loadEffectiveConfig } from '../adapters/config/product-config.js';

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
  /**
   * Git CLI runner for board reads (worktree topology, repository identity,
   * HEAD commit). Defaults to the real git; tests inject an in-memory double.
   */
  readonly gitFn?:
    | ((_args: string[], _options?: { cwd?: string }) => { status: number | null; stdout: string; stderr: string })
    | null;
  /** Agent config reader for the agent strip; defaults to the operator-local config. */
  readonly readAgentConfig?: () => import('../adapters/agents/agent-config.js').AgentConfig | null;
  /** Running-session detection for the agent strip; defaults to the live process scan. */
  readonly detectRunningSessions?: () => readonly import('../adapters/agents/running-sessions.js').RunningMissionSession[] | null;
}

/** The sole production constructor for board reads and mission details. */
export function composeBoardProjection(deps: BoardProjectionCompositionDeps) {
  let cachedMissions: Promise<readonly import('../domain/mission.js').Mission[]> | null = null;
  const missions: MissionReadAdapter = {
    async loadAllMissions() {
      cachedMissions ??= loadBoardMissions();
      return cachedMissions;
    },
    async loadMission(id) {
      if (deps.missionStore) {
        const stored = await deps.missionStore.load(id);
        if (stored.kind === 'found') {
          return stored.mission.repositoryId === deps.repositoryId ? withRepositoryTitle(stored.mission) : null;
        }
      }
      return (await missions.loadAllMissions()).find(mission => mission.id === id) ?? null;
    },
    getSourceFacts: (): readonly SourceFact<string>[] => [
      { source: 'task-markdown', status: 'fresh', value: 'Uningested Backlog inputs' },
      { source: 'mission-store', status: deps.missionStore ? 'fresh' : 'unavailable', value: deps.repositoryId },
    ],
  };

  async function loadBoardMissions(): Promise<readonly import('../domain/mission.js').Mission[]> {
    if (deps.missionStore && !deps.missionStore.loadByRepository) {
      throw new Error('Mission store cannot enumerate repository records');
    }
    const recorded = await deps.missionStore?.loadByRepository?.(deps.repositoryId) ?? [];
    const inputs = readBacklogInputs(deps.rootDir, deps.repositoryId, new Set(recorded.map(mission => mission.id)));
    return [...recorded.map(withRepositoryTitle), ...inputs];
  }

  // Backlog owns its descriptive title; the aggregate owns all operational fields.
  function withRepositoryTitle(mission: import('../domain/mission.js').Mission) {
    const task = resolveTaskFile(mission.id, deps.rootDir);
    const title = task.ok && task.taskFile ? getTaskFrontmatterValue(task.taskFile, 'title') : null;
    return title ? { ...mission, title } : mission;
  }
  const currentWork = new ConcreteCurrentWorkReadAdapter(deps.historyRepo);
  const completedMissionRetentionDays = loadEffectiveConfig(deps.rootDir).adapters.web.completedMissionRetentionDays;
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
      readAgentConfig: deps.readAgentConfig,
      detectRunningSessions: deps.detectRunningSessions,
    }),
    new ConcreteGitReadAdapter({ rootDir: deps.rootDir, repositoryId: deps.repositoryId, gitRunner: deps.gitFn ?? undefined }),
    new ConcreteOperationLogReadAdapter({ historyRepo: deps.historyRepo }),
    {
      prepareReads: () => {
        const topology = snapshotWorktreeTopology({
          cwd: deps.rootDir,
          gitFn: deps.gitFn ?? null,
          currentBranch: deps.gitFn ? () => '' : undefined,
        });
        cachedMissions = null;
        gates.useWorktreeTopology(topology);
      },
      // The authoritative answer to "which mission is being worked on right
      // now", published by the operations themselves. The OS-process scan in
      // the agent adapter above is left in place only as bounded recovery.
      currentWork,
      isProcessAlive: processLivenessProbe,
      changeIdentity: createGitChangeIdentity(deps.rootDir, deps.gitFn ?? undefined),
      completedMissionRetentionDays,
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
        cohortMetadata: async () => missionCohortMetadata(await missions.loadAllMissions()),
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
  missionServices: BoardMissionServices = {},
): TuiCapabilities {
  const board = composeBoardProjection(deps);
  const sharedController = controller ?? new BoardCommandController(executePorts, undefined, missionServices, currentWork, deps.missionStore);
  return {
    boardProjection: board.builder,
    missionDetails: board.missionQuery,
    commandControllerFactory: (progress) => new BoardCommandController(executePorts, progress, missionServices, currentWork, deps.missionStore),
    commandController: sharedController,
  };
}
