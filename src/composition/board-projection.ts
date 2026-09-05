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
import { resolveBaseWorktree, snapshotWorktreeTopology } from '../adapters/git/worktree.js';
import { BoardProjectionBuilder } from '../application/projections/board-readers.js';
import type { MissionReadAdapter } from '../application/projections/board-readers.js';
import { ConcreteMetricsReadAdapter } from '../application/projections/metrics-read-adapter.js';
import { MissionProjectionQuery } from '../application/projections/mission-query.js';
import type { SourceFact } from '../application/contracts.js';
import { BoardCommandController, type BoardMissionServices } from '../application/controller/board-controller.js';
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
  // Only used when a gitFn double is injected; the branch-name fallback must
  // not reach the real CLI either.
  const topologyFor = (cwd: string) => snapshotWorktreeTopology({
    cwd,
    gitFn: deps.gitFn,
    currentBranch: () => '',
  });
  const repositoryMissions = new ConcreteMissionReadAdapter({
    rootDir: deps.rootDir,
    repositoryId: deps.repositoryId,
    resolveWorktree: deps.gitFn
      ? (slug, options) => topologyFor(options?.cwd ?? deps.rootDir).resolveWorktree(slug, options)
      : undefined,
    resolveBaseWorktree: deps.gitFn
      ? (slug) => resolveBaseWorktree(slug, { rootDir: deps.rootDir, gitFn: deps.gitFn })
      : undefined,
  });
  let cachedMissions: Promise<readonly import('../domain/mission.js').Mission[]> | null = null;
  const persistedMissions = deps.missionStore?.loadByRepository;
  const missions: MissionReadAdapter = {
    async loadAllMissions() {
      cachedMissions ??= loadBoardMissions();
      return cachedMissions;
    },
    async loadMission(id) {
      if (persistedMissions && deps.missionStore) {
        const stored = await deps.missionStore.load(id);
        return stored.kind === 'found' && stored.mission.repositoryId === deps.repositoryId
          ? withRepositoryTitle(stored.mission, await repositoryMissions.loadMission(id))
          : loadMarkdownMission(id);
      }
      return loadMarkdownMission(id);
    },
    getSourceFacts: (): readonly SourceFact<string>[] => persistedMissions
      ? [...repositoryMissions.getSourceFacts(), { source: 'mission-store', status: 'fresh', value: deps.repositoryId }]
      : repositoryMissions.getSourceFacts(),
  };

  /**
   * `title` is `target-repository` authority (`MISSION_FIELD_AUTHORITY`), so the
   * Backlog task keeps it even when the persisted aggregate supplies lifecycle.
   * The stored title is written at `px draft` intake, when MISSION.md is still
   * the scaffold, so it is the literal `<Title> (slug)` placeholder; taking the
   * whole aggregate published that placeholder to every persisted board card.
   */
  function withRepositoryTitle(
    stored: import('../domain/mission.js').Mission,
    markdown: import('../domain/mission.js').Mission | null,
  ): import('../domain/mission.js').Mission {
    return { ...stored, title: markdown?.title ?? stored.id };
  }

  async function loadBoardMissions(): Promise<readonly import('../domain/mission.js').Mission[]> {
    const markdown = await repositoryMissions.loadAllMissions();
    if (!persistedMissions || !deps.missionStore) {
      return Promise.all(markdown.map((mission) => withPersistedCheckpoints(mission)));
    }
    const persisted = await deps.missionStore.loadByRepository!(deps.repositoryId);
    const byId = new Map(persisted.map((mission) => [mission.id, mission]));
    const catalog = new Map(markdown.flatMap((mission) => {
      const stored = byId.get(mission.id);
      return stored ? [withRepositoryTitle(stored, mission)] : mission.status === 'done' ? [] : [mission];
    }).map((mission) => [mission.id, mission]));
    // SQLite supplies current sibling-worktree missions; a local archive record
    // remains authoritative for exclusion.
    for (const stored of persisted) {
      if (stored.status !== 'done' && !repositoryMissions.isArchivedMission(stored.id)) {
        catalog.set(stored.id, withRepositoryTitle(stored, catalog.get(stored.id) ?? null));
      }
    }
    return [...catalog.values()];
  }

  async function loadMarkdownMission(id: import('../domain/mission.js').MissionId) {
    const mission = await repositoryMissions.loadMission(id);
    return mission ? withPersistedCheckpoints(mission) : null;
  }

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
        repositoryMissions.useWorktreeTopology(topology);
        cachedMissions = null;
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
