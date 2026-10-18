import { SqliteWorkflowOperationStore } from '../adapters/sqlite/workflow-operation-store.js';
import { createMissionTerminalCapability } from './mission-terminal-capability.js';
import { unknownExecution, type ProviderExecutionReader } from '../application/projections/provider-execution.js';
import { DEFAULT_CONFIGURATION } from '../application/ports/configuration.js';
import type { AgentFamily } from '../domain/agents.js';
import type { ParallixConfiguration } from '../application/ports/configuration.js';
import { createGitChangeIdentity } from '../adapters/git/change-identity.js';
import type { RepositoryId } from '../domain/repository.js';
import type {
  AgentBlocklistRepository,
} from '../application/ports/agent-blocklist.js';
import type { BoardLaneEventRepository, OperationalHistoryRepository } from '../application/ports/operation-history.js';
import type { SessionMarkerRepository } from '../application/ports/mission-store.js';
import type { UsageRepository } from '../application/ports/mission-measurements.js';
import { createLauncherProbe, type LauncherProbeResult } from '../adapters/agents/launcher-availability.js';
import { detectRunningMissionSessions, startProcessTableRead, type ProcessEntry, type RunningMissionSession } from '../adapters/agents/running-sessions.js';
import { ConcreteAgentReadAdapter } from '../adapters/backlog/concrete-agent-read-adapter.js';
import { ConcreteGitReadAdapter } from '../adapters/backlog/concrete-git-read-adapter.js';
import { readBacklogInputs } from '../adapters/backlog/backlog-input-reader.js';
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
import type { Mission } from '../domain/mission.js';
import type { CurrentWorkPort } from '../application/recording/current-work-recorder.js';
import type { SqliteDatabaseAdapter } from '../adapters/sqlite/database-adapter.js';
import { SqliteReviewProjectionReader } from '../adapters/sqlite/review-projection-reader.js';
import { loadEffectiveConfig } from '../adapters/config/product-config.js';
import { SqliteIntegrationValidationReader } from '../adapters/sqlite/integration-validation-reader.js';
import { VerificationGateEvidenceReader } from '../adapters/verification/gate-evidence-reader.js';
import { VerificationGateObserver } from '../application/projections/gate-observation.js';
import type { GateEvidenceReader } from '../application/ports/gate-evidence.js';

export interface BoardProjectionCompositionDeps {
  readonly configuration?: ParallixConfiguration;
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
  /** Provider observation boundary; defaults to the repository's retained execution evidence. */
  readonly providerExecution?: ProviderExecutionReader;
  /** Verification evidence boundary; defaults to proofs, failure evidence and validation history. */
  readonly gateEvidence?: GateEvidenceReader;
}

/**
 * The process table is read by a child that starts with the build, so it runs
 * beside the build's synchronous reads; one read answers every reader within
 * the build, and the next build starts from a fresh one.
 */
function createRunningSessionScan(deps: Pick<BoardProjectionCompositionDeps, 'rootDir' | 'detectRunningSessions'>) {
  let processTable: Promise<readonly ProcessEntry[] | null> | undefined;
  let scan: Promise<readonly RunningMissionSession[] | null> | undefined;
  return {
    detect: () => {
      scan ??= (async () => {
        if (deps.detectRunningSessions) { return deps.detectRunningSessions(); }
        const table = await (processTable ??= startProcessTableRead());
        return detectRunningMissionSessions({ rootDir: deps.rootDir, listProcesses: () => table });
      })();
      return scan;
    },
    beginRead: () => {
      scan = undefined;
      processTable = deps.detectRunningSessions ? undefined : startProcessTableRead();
    },
  };
}

/**
 * Every Mission the repository's board shows: recorded aggregates plus Backlog
 * inputs not yet ingested. Uncached; the board adds its own per-build cache and
 * mission creation reads it fresh to validate dependencies.
 */
export function createRepositoryMissionCatalog(
  deps: Pick<BoardProjectionCompositionDeps, 'rootDir' | 'missionStore' | 'repositoryId'>,
) {
  // Recorded planning fields belong to the Mission store; Backlog is intake only.
  return {
    async loadAllMissions(): Promise<readonly Mission[]> {
      if (deps.missionStore && !deps.missionStore.loadByRepository) {
        throw new Error('Mission store cannot enumerate repository records');
      }
      const recorded = await deps.missionStore?.loadByRepository?.(deps.repositoryId) ?? [];
      const inputs = readBacklogInputs(deps.rootDir, deps.repositoryId, new Set(recorded.map(mission => mission.id)));
      return [...recorded, ...inputs];
    },
  };
}

/** The sole production constructor for board reads and mission details. */
export function composeBoardProjection(deps: BoardProjectionCompositionDeps) {
  let cachedMissions: Promise<readonly Mission[]> | null = null;
  const missions: MissionReadAdapter = {
    async loadAllMissions() {
      cachedMissions ??= loadBoardMissions();
      return cachedMissions;
    },
    async loadMission(id) {
      if (deps.missionStore) {
        const stored = await deps.missionStore.load(id);
        if (stored.kind === 'found') {
          return stored.mission.repositoryId === deps.repositoryId ? stored.mission : null;
        }
      }
      return (await missions.loadAllMissions()).find(mission => mission.id === id) ?? null;
    },
    getSourceFacts: (): readonly SourceFact<string>[] => [
      { source: 'task-markdown', status: 'fresh', value: 'Uningested Backlog inputs' },
      { source: 'mission-store', status: deps.missionStore ? 'fresh' : 'unavailable', value: deps.repositoryId },
    ],
  };

  const catalog = createRepositoryMissionCatalog(deps);
  const loadBoardMissions = () => catalog.loadAllMissions();
  const currentWork = new ConcreteCurrentWorkReadAdapter(deps.historyRepo);
  const runningSessions = createRunningSessionScan(deps);
  const changeIdentity = createGitChangeIdentity(deps.rootDir, deps.gitFn ?? undefined, { snapshotBranchHeads: true });
  const completedMissionRetentionDays = loadEffectiveConfig(deps.rootDir).adapters.web.completedMissionRetentionDays;
  let topology: ReturnType<typeof snapshotWorktreeTopology> | null = null;
  const validations = deps.database ? new SqliteIntegrationValidationReader(deps.database) : null;
  const gateEvidence = deps.gateEvidence ?? new VerificationGateEvidenceReader({
    configuration: deps.configuration,
    resolveWorktree: mission => topology?.resolveWorktree(mission, { cwd: deps.rootDir }) ?? null,
    integrationValidation: validations ? mission => validations.read(mission) : null,
  });
  const gates = new VerificationGateObserver(gateEvidence);
  let terminal: ReturnType<typeof createMissionTerminalCapability> | undefined;
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
      launcherAvailable: deps.launcherProbe ?? createLauncherProbe({ configuration: deps.configuration, worktree: deps.rootDir }),
      // Attributes a live `px` process to the family that launched it. Without
      // it the strip cannot report running sessions and says so.
      sessionMarkers: deps.sessionMarkers ?? null,
      currentWork,
      isProcessAlive: processLivenessProbe,
      readAgentConfig: deps.readAgentConfig,
      detectRunningSessions: runningSessions.detect,
    }),
    new ConcreteGitReadAdapter({ rootDir: deps.rootDir, repositoryId: deps.repositoryId, gitRunner: deps.gitFn ?? undefined }),
    new ConcreteOperationLogReadAdapter({ historyRepo: deps.historyRepo }),
    {
      workflowOperations: deps.database ? new SqliteWorkflowOperationStore(deps.database, deps.repositoryId) : undefined,
      providerExecution: deps.providerExecution ?? { observe: (scope, currentOperationId) => {
        terminal ??= createMissionTerminalCapability(deps.rootDir, deps.configuration ?? DEFAULT_CONFIGURATION, mission => topology?.resolveWorktree(mission) ?? null);
        const result = terminal.execution?.(scope.missionId, currentOperationId);
        return result && 'invocations' in result ? result : unknownExecution();
      } },
      prepareReads: () => {
        topology = snapshotWorktreeTopology({
          cwd: deps.rootDir,
          gitFn: deps.gitFn ?? null,
          currentBranch: deps.gitFn ? () => '' : undefined,
        });
        cachedMissions = null;
        gateEvidence.beginRead?.();
        changeIdentity.beginRead();
        runningSessions.beginRead();
      },
      // The authoritative answer to "which mission is being worked on right
      // now", published by the operations themselves. The OS-process scan in
      // the agent adapter above is left in place only as bounded recovery.
      currentWork,
      isProcessAlive: processLivenessProbe,
      changeIdentity,
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
