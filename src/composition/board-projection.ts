import { createHumanReviewEpisodeReader, createMissionCohortMetadataReader, createReboundRepairReader, createWorkflowReturnReader } from '../adapters/review/review-statistics-evidence.js';
import { SqliteWorkflowOperationStore, workflowOperationCollectionDefects } from '../adapters/sqlite/workflow-operation-store.js';
import { createMissionTerminalCapability } from './mission-terminal-capability.js';
import { retainedRepositoryRunRecords } from '../adapters/filesystem/run-history-store.js';
import { retainedFlowRunRecords } from './verification-statistics.js';
import { failedExecution, type ProviderExecutionReader } from '../application/projections/provider-execution.js';
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
import { SqliteExecutionActivityStore } from '../adapters/sqlite/execution-activity-store.js';
import { processLivenessProbe } from '../adapters/process/process-liveness.js';
import { snapshotWorktreeTopology } from '../adapters/git/worktree.js';
import { BoardProjectionBuilder } from '../application/projections/board-readers.js';
import type { MissionReadAdapter } from '../application/projections/board-readers.js';
import { ConcreteMetricsReadAdapter } from '../application/projections/metrics-read-adapter.js';
import { verificationStatisticsReader } from './verification-statistics.js';
import type { VerificationStatisticsInput } from '../application/projections/verification-statistics.js';
import { MissionProjectionQuery } from '../application/projections/mission-query.js';
import type { SourceFact } from '../application/contracts.js';
import { BoardCommandController, type BoardMissionServices } from '../application/controller/board-controller.js';
import type { ExecuteMissionPorts } from '../application/ports/execute-mission.js';
import type { TuiCapabilities } from '../application/tui-capabilities.js';
import type { MissionStore } from '../application/domain-ports.js';
import type { Mission, MissionId } from '../domain/mission.js';
import type { ExecutionActivityPort } from '../application/recording/execution-activity-recorder.js';
import type { SqliteDatabaseAdapter } from '../adapters/sqlite/database-adapter.js';
import { SqliteReviewProjectionReader } from '../adapters/sqlite/review-projection-reader.js';
import { loadEffectiveConfig, resolveReviewActionLimit } from '../adapters/config/product-config.js';
import { parseReviewAction } from '../application/review-action-history.js';
import { REVIEW_ACTION_STARTED_EVENT, type ReviewActionStarted } from '../application/ports/review-action-history.js';
import { SqliteIntegrationValidationReader } from '../adapters/sqlite/integration-validation-reader.js';
import { VerificationGateEvidenceReader } from '../adapters/verification/gate-evidence-reader.js';
import { VerificationGateObserver } from '../application/projections/gate-observation.js';
import type { GateEvidenceReader } from '../application/ports/gate-evidence.js';

export interface BoardProjectionCompositionDeps {
  readonly configuration?: ParallixConfiguration;
  readonly rootDir: string;
  readonly missionStore: MissionStore | null;
  readonly database?: SqliteDatabaseAdapter | null;
  readonly executionActivity?: import('../application/ports/execution-activity.js').ExecutionActivityReadPort;
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
  /** Process table for the running-session scan; defaults to one live OS scan per build. */
  readonly listRunningProcesses?: () => Promise<readonly import('../adapters/agents/running-sessions.js').ProcessEntry[] | null>;
  /** Provider observation boundary; defaults to the repository's retained execution evidence. */
  readonly providerExecution?: ProviderExecutionReader;
  /** Authoritative workflow ownership and liveness facts for Review recovery. */
  readonly reviewExecution?: import('../application/projections/review-liveness.js').ReviewLivenessReader;
  /** Verification evidence boundary; defaults to proofs, failure evidence and validation history. */
  readonly gateEvidence?: GateEvidenceReader;
}

/** Event families one projection build shares across every analytical reader. */
export const BOARD_ANALYTICS_HISTORY_TYPES = [
  'mission.current-work', 'verification.attempt', 'flow.rebase', 'lead.operator-judgment',
  'stats.recovery.evidence',
] as const;

/**
 * A retained repair transcript is megabytes of audit text, so it never joins the
 * shared payload read; consumers take compact repair facts from
 * `findReboundRepairs` or a Mission-scoped read. Its row identity still bounds
 * analytical currency through the aggregate revision read.
 */
const REBOUND_REPAIR_HISTORY_TYPE = 'rebound.repair';

/**
 * The process table is read by a child that starts with the build, so it runs
 * beside the build's synchronous reads; one read answers every reader within
 * the build, and the next build starts from a fresh one.
 */
function createRunningSessionScan(
  deps: Pick<BoardProjectionCompositionDeps, 'rootDir' | 'detectRunningSessions' | 'listRunningProcesses'>,
  // The board build has already read the repository topology; the scan reuses that
  // listing instead of spawning a second `git worktree list` for the same build.
  worktrees: () => ReadonlyMap<string, MissionId> | null,
) {
  let processTable: Promise<readonly ProcessEntry[] | null> | undefined;
  let scan: Promise<readonly RunningMissionSession[] | null> | undefined;
  return {
    detect: () => {
      scan ??= (async () => {
        if (deps.detectRunningSessions) { return deps.detectRunningSessions(); }
        const table = await (processTable ??= deps.listRunningProcesses ? deps.listRunningProcesses() : startProcessTableRead());
        const listed = worktrees();
        return detectRunningMissionSessions({
          rootDir: deps.rootDir,
          listProcesses: () => table,
          listWorktrees: () => listed,
        });
      })();
      return scan;
    },
    beginRead: () => {
      scan = undefined;
      processTable = deps.detectRunningSessions || deps.listRunningProcesses
        ? undefined
        : startProcessTableRead();
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

function createCachedMissionReader(deps: BoardProjectionCompositionDeps,
  loadBoardMissions: () => Promise<readonly Mission[]>) {
  let cached: Promise<readonly Mission[]> | null = null;
  const missions: MissionReadAdapter = {
    async loadAllMissions() {
      cached ??= loadBoardMissions();
      return cached;
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
  return { missions, reset: () => { cached = null; } };
}

type OperationalHistoryEntry = import('../application/ports/operation-history.js').OperationalHistoryEntry;

function indexOperationalHistory(
  rows: readonly OperationalHistoryEntry[],
  missionIdFrom: (eventData: string) => string | null,
): ReadonlyMap<string, readonly OperationalHistoryEntry[]> {
  const indexed = new Map<string, OperationalHistoryEntry[]>();
  for (const row of rows) {
    try {
      const missionId = missionIdFrom(row.eventData);
      if (missionId === null) { continue; }
      const mission = indexed.get(missionId) ?? [];
      mission.push(row);
      indexed.set(missionId, mission);
    } catch { /* malformed history has no usable Mission identity */ }
  }
  return indexed;
}

/** One projection build shares its immutable analytical rows across every reader. */
function createMetricsReadSession(deps: BoardProjectionCompositionDeps) {
  const cachedHistoryTypes = new Set<string>(BOARD_ANALYTICS_HISTORY_TYPES);
  const revisionHistoryTypes = deps.historyRepo.revisionForTypes
    ? [...BOARD_ANALYTICS_HISTORY_TYPES, REBOUND_REPAIR_HISTORY_TYPE] : BOARD_ANALYTICS_HISTORY_TYPES;
  let historyRows: Promise<readonly OperationalHistoryEntry[]> | null = null;
  let laneRows: Promise<readonly import('../application/ports/operation-history.js').BoardLaneEventEntry[]> | null = null;
  let usageRows: Promise<readonly import('../application/ports/mission-measurements.js').UsageRecord[]> | null = null;
  let historyByMission: Promise<ReadonlyMap<string, readonly OperationalHistoryEntry[]>> | null = null;
  let scopedHistory: { readonly key: string;
    readonly rows: Promise<readonly import('../application/ports/operation-history.js').OperationalHistoryEntry[]> } | null = null;
  const history = () => historyRows ??= deps.historyRepo.findByTypes?.([...cachedHistoryTypes]) ?? deps.historyRepo.findAll();
  const lanes = () => laneRows ??= deps.laneEventRepo.findByRepositoryId(deps.repositoryId);
  const usage = () => usageRows ??= deps.usageRepo.findWhere({ repo: deps.repositoryId });
  const indexedHistory = () => historyByMission ??= history().then(rows => indexOperationalHistory(rows, eventData => {
    const missionId = (JSON.parse(eventData) as { missionId?: unknown }).missionId;
    return typeof missionId === 'string' ? missionId : null;
  }));
  const historyForMissions = (missions: ReadonlySet<string>) => {
    const missionIds = [...missions].sort((left, right) => left.localeCompare(right));
    const key = missionIds.join('\0');
    if (scopedHistory?.key === key) { return scopedHistory.rows; }
    const rows = deps.historyRepo.findByTypesForMissions
      ? deps.historyRepo.findByTypesForMissions([...cachedHistoryTypes], missionIds, deps.repositoryId)
      : history().then(values => values.filter(value => {
        try {
          const data = JSON.parse(value.eventData) as { missionId?: unknown; repositoryId?: unknown };
          return missions.has(String(data.missionId ?? ''))
            && (data.repositoryId === undefined || data.repositoryId === deps.repositoryId);
        }
        catch { return false; }
      }));
    scopedHistory = { key, rows };
    return rows;
  };
  const missionScopedHistory = (type: string, missionId: string): Promise<readonly OperationalHistoryEntry[]> =>
    deps.historyRepo.findByTypeForMission?.(type, missionId)
      ?? deps.historyRepo.findByType(type).then(rows => rows.filter(row => {
        try { return (JSON.parse(row.eventData) as { missionId?: unknown }).missionId === missionId; }
        catch { return false; }
      }));
  const scopedHistoryReader = (missions: ReadonlySet<string>) => {
    const indexed = historyForMissions(missions).then(rows => indexOperationalHistory(rows, eventData =>
      String((JSON.parse(eventData) as { missionId?: unknown }).missionId ?? '')));
    // Retained audit types stay out of the scoped analytical payload; they keep their own
    // Mission-scoped read, exactly as the unscoped reader delegates them.
    return { findByTypeForMission: (type: string, missionId: string) => cachedHistoryTypes.has(type)
      ? indexed.then(rows => rows.get(missionId)?.filter(row => row.eventType === type) ?? [])
      : missionScopedHistory(type, missionId) };
  };
  const laneEventRepo: BoardLaneEventRepository = {
    append: entry => deps.laneEventRepo.append(entry),
    findByMissionId: async missionId => (await lanes()).filter(row => row.missionId === missionId),
    findAll: () => deps.laneEventRepo.findAll(),
    findByRepositoryId: repositoryId => repositoryId === deps.repositoryId ? lanes() : deps.laneEventRepo.findByRepositoryId(repositoryId),
    clear: () => deps.laneEventRepo.clear(),
  };
  const historyRepo: OperationalHistoryRepository = {
    findAll: history,
    findByTypes: types => deps.historyRepo.findByTypes?.(types) ?? deps.historyRepo.findAll().then(rows => rows.filter(row => types.includes(row.eventType))),
    findByTypesForMissions: (types, missionIds, repositoryId) => deps.historyRepo.findByTypesForMissions?.(types, missionIds, repositoryId)
      ?? deps.historyRepo.findByTypes?.(types).then(rows => rows.filter(row => {
        try {
          const data = JSON.parse(row.eventData) as { missionId?: unknown; repositoryId?: unknown };
          return missionIds.includes(String(data.missionId ?? ''))
            && (data.repositoryId === undefined || data.repositoryId === repositoryId);
        }
        catch { return false; }
      })) ?? Promise.resolve([]),
    revisionForTypes: types => deps.historyRepo.revisionForTypes?.(types)
      ?? (deps.historyRepo.findByTypes?.(types) ?? deps.historyRepo.findAll().then(rows => rows.filter(row => types.includes(row.eventType))))
        .then(rows => JSON.stringify(rows.map(row => [row.id, row.eventType, row.createdAt, row.eventData]))),
    findEarliestForMissions: deps.historyRepo.findEarliestForMissions?.bind(deps.historyRepo),
    findReboundRepairs: deps.historyRepo.findReboundRepairs?.bind(deps.historyRepo),
    findRecentLogEntries: deps.historyRepo.findRecentLogEntries?.bind(deps.historyRepo),
    findByType: type => cachedHistoryTypes.has(type)
      ? history().then(rows => rows.filter(row => row.eventType === type)) : deps.historyRepo.findByType(type),
    findByTypeForMission: (type, missionId) => cachedHistoryTypes.has(type)
      ? indexedHistory().then(rows => rows.get(missionId)?.filter(row => row.eventType === type) ?? [])
      : missionScopedHistory(type, missionId),
    append: entry => deps.historyRepo.append(entry),
    clear: () => deps.historyRepo.clear(),
  };
  const usageRepo: UsageRepository = {
    findAll: usage,
    findWhere: filter => filter.repo !== undefined && filter.repo !== deps.repositoryId
      ? Promise.resolve([])
      : Object.keys(filter).every(key => key === 'repo')
        ? usage()
        : deps.usageRepo.findWhere({ ...filter, repo: deps.repositoryId }),
  };
  return { historyRepo, laneEventRepo, usageRepo, revisionHistoryTypes, historyForMissions, scopedHistoryReader,
    reset: () => { historyRows = null; laneRows = null; usageRows = null; historyByMission = null; scopedHistory = null; } };
}

function createBoardGateEvidence(
  deps: BoardProjectionCompositionDeps,
  resolveWorktree: (missionId: Mission['id']) => string | null,
): GateEvidenceReader {
  if (deps.gateEvidence) { return deps.gateEvidence; }
  const validations = deps.database ? new SqliteIntegrationValidationReader(deps.database) : null;
  return new VerificationGateEvidenceReader({
    gitRunner: deps.gitFn ?? undefined,
    configuration: deps.configuration,
    resolveWorktree,
    integrationValidation: validations ? mission => validations.read(mission) : null,
    isProcessAlive: processLivenessProbe,
  });
}

/**
 * The one verification input population a board build reads: the breakdown owns
 * every retained agent run in this repository, open or historical, while only
 * the per-Mission FLOW projection is limited to the delivery population.
 * Staged rebound repairs join the lifecycle events because they persist the same
 * validated return identity when their Mission transition emits no lane event.
 */
async function boardVerificationInput(deps: {
  readonly metricsSession: ReturnType<typeof createMetricsReadSession>,
  readonly workflowOperations: SqliteWorkflowOperationStore | undefined,
  readonly repositoryId: RepositoryId, readonly rootDir: string,
  readonly missionTerminal: () => ReturnType<typeof createMissionTerminalCapability>,
}, requestedMissions?: ReadonlySet<string>, flowRunMissions?: ReadonlySet<string>): Promise<VerificationStatisticsInput> {
  const [history, operationHistory, lifecycle, reboundRepairs] = await Promise.all([
    requestedMissions ? deps.metricsSession.historyForMissions(requestedMissions)
      : deps.metricsSession.historyRepo.findAll(),
    deps.workflowOperations?.readHistorical() ?? { operations: [], unreadableRowCount: 0 },
    deps.metricsSession.laneEventRepo.findByRepositoryId(deps.repositoryId),
    deps.metricsSession.historyRepo.findReboundRepairs?.() ?? [],
  ]);
  const operations = operationHistory.operations;
  const flowMissions = flowRunMissions ?? requestedMissions
    ?? new Set([...operations.map(value => value.missionId), ...lifecycle.map(value => value.missionId)]);
  return { repositoryId: deps.repositoryId, history, operations, lifecycle, reboundRepairs,
    runs: retainedRepositoryRunRecords(deps.rootDir),
    flowRuns: retainedFlowRunRecords(deps.missionTerminal(), flowMissions),
    repositoryDiagnostics: workflowOperationCollectionDefects(operationHistory.unreadableRowCount) };
}

async function loadRepositoryReviewActions(
  deps: Pick<BoardProjectionCompositionDeps, 'historyRepo' | 'repositoryId'>,
  missions: MissionReadAdapter,
): Promise<readonly ReviewActionStarted[]> {
  const missionIds = (await missions.loadAllMissions()).map(mission => String(mission.id));
  const rows = deps.historyRepo.findByTypesForMissions
    ? await deps.historyRepo.findByTypesForMissions([REVIEW_ACTION_STARTED_EVENT], missionIds, deps.repositoryId)
    : await deps.historyRepo.findByType(REVIEW_ACTION_STARTED_EVENT);
  const actions = rows.map(row => parseReviewAction(row, deps.repositoryId));
  if (actions.some(action => action === null)) {
    throw new Error('review action history contains an invalid record');
  }
  return actions.filter((action): action is ReviewActionStarted => action?.repositoryId === deps.repositoryId
    && missionIds.includes(action.missionId));
}

/** The sole production constructor for board reads and mission details. */
export function composeBoardProjection(deps: BoardProjectionCompositionDeps) {
  const catalog = createRepositoryMissionCatalog(deps);
  const missionReader = createCachedMissionReader(deps, () => catalog.loadAllMissions());
  const missions = missionReader.missions;
  const currentWork = deps.executionActivity ?? (deps.database ? new SqliteExecutionActivityStore(deps.database, deps.repositoryId) : undefined);
  const workflowOperations = deps.database ? new SqliteWorkflowOperationStore(deps.database, deps.repositoryId) : undefined;
  const metricsSession = createMetricsReadSession(deps);
  let topology: ReturnType<typeof snapshotWorktreeTopology> | null = null;
  const runningSessions = createRunningSessionScan(deps, () => topology?.missionWorktrees() ?? null);
  const changeIdentity = createGitChangeIdentity(deps.rootDir, deps.gitFn ?? undefined, { snapshotBranchHeads: true });
  const completedMissionRetentionDays = loadEffectiveConfig(deps.rootDir).adapters.web.completedMissionRetentionDays;
  const gateEvidence = createBoardGateEvidence(deps,
    mission => topology?.resolveWorktree(mission, { cwd: deps.rootDir }) ?? null);
  const gates = new VerificationGateObserver(gateEvidence);
  let terminal: ReturnType<typeof createMissionTerminalCapability> | undefined;
  const missionTerminal = () => terminal ??= createMissionTerminalCapability(deps.rootDir,
    deps.configuration ?? DEFAULT_CONFIGURATION, mission => topology?.resolveWorktree(mission) ?? null);
  const builder = new BoardProjectionBuilder(
    missions,
    new ConcreteReviewReadAdapter({
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
      workflowOperations,
      reviewExecution: deps.reviewExecution,
      providerExecution: deps.providerExecution ?? { observe: (scope, currentOperationId) => {
        const result = missionTerminal().execution?.(scope.missionId, currentOperationId);
        return result && 'invocations' in result ? result : failedExecution();
      } },
      prepareReads: () => {
        topology = snapshotWorktreeTopology({
          cwd: deps.rootDir,
          gitFn: deps.gitFn ?? null,
          currentBranch: deps.gitFn ? () => '' : undefined,
        });
        missionReader.reset();
        metricsSession.reset();
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
      reviewActions: {
        get limit() { return resolveReviewActionLimit(deps.rootDir); },
        loadActions: () => loadRepositoryReviewActions(deps, missions),
      },
      metricsAdapter: new ConcreteMetricsReadAdapter({
        verification: verificationStatisticsReader((requestedMissions, flowRunMissions) => boardVerificationInput(
          { metricsSession, workflowOperations, repositoryId: deps.repositoryId, rootDir: deps.rootDir, missionTerminal },
          requestedMissions, flowRunMissions)),
        laneEventRepo: metricsSession.laneEventRepo,
        usageRepo: metricsSession.usageRepo,
        repositoryId: deps.repositoryId,
        historyRepo: metricsSession.historyRepo,
        evidenceRevision: async () => JSON.stringify([
          await metricsSession.historyRepo.revisionForTypes!(metricsSession.revisionHistoryTypes),
          await workflowOperations?.analyticsRevision?.() ?? 'no-workflow-history',
        ]),
        // Net engineering lines are a mission fact, not telemetry, so the
        // cohort comparison reads them from the same adapter the board does.
        netEngineeringLines: async () => new Map(
          (await missions.loadAllMissions()).map((mission) => [mission.id, mission.netEngineeringLines]),
        ),
        cohortMetadata: async requestedMissions => {
          const allMissions = await missions.loadAllMissions();
          const history = requestedMissions ? metricsSession.scopedHistoryReader(requestedMissions) : metricsSession.historyRepo;
          return createMissionCohortMetadataReader(deps.rootDir,
            createWorkflowReturnReader(metricsSession.laneEventRepo, history,
              metricsSession.historyRepo.findReboundRepairs ? createReboundRepairReader(metricsSession.historyRepo) : undefined),
            createHumanReviewEpisodeReader(metricsSession.laneEventRepo))(
            requestedMissions ? allMissions.filter(mission => requestedMissions.has(mission.id)) : allMissions);
        },
      }),
    },
  );
  return { builder, missionQuery: new MissionProjectionQuery(missions) };
}

export function composeTuiCapabilities(
  deps: BoardProjectionCompositionDeps,
  executePorts: ExecuteMissionPorts,
  currentWork: ExecutionActivityPort,
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
