import { configureRepairCheckpoints } from '../application/ports/repair-checkpoint.js';
import { RepairCheckpointService } from '../application/repair-checkpoint-service.js';
import { resolveProcessConfiguration } from './config.js';
import { createReviewClassification } from './review-classification.js';
import type { ParallixConfiguration } from '../application/ports/configuration.js';
import * as path from 'node:path';

import { ExecuteMissionService } from '../application/execute-mission-service.js';
import { IntegrateCommandUseCase } from '../application/integrate-command-use-case.js';
import { StatsBackfillService } from '../application/stats-backfill-service.js';
import { MissionCheckpointService, type CheckpointEvidenceReferences } from '../application/mission-checkpoint-service.js';
import { MissionBriefService } from '../application/mission-brief-service.js';
import { MissionAssignmentService } from '../application/mission-assignment-service.js';
import { MissionHandoffService } from '../application/mission-handoff-service.js';
import { MissionIntakeService } from '../application/mission-intake-service.js';
import { MissionLifecycleService } from '../application/mission-lifecycle-service.js';
import { MissionIntegrationService } from '../application/mission-integration-service.js';
import { KnownRepositoryService } from '../application/services/known-repository-service.js';
import { UIPreferencesService } from '../application/services/ui-preferences-service.js';
import { OperationalHistoryService } from '../application/services/operational-history-service.js';
import { CurrentWorkRecorder, NO_CURRENT_WORK_PORT, type CurrentWorkPort } from '../application/recording/current-work-recorder.js';
import { processStartIdentity } from '../adapters/process/process-liveness.js';
import { SqliteMissionStore } from '../adapters/sqlite/mission-store.js';
import { SqliteSessionMarkerAdapter } from '../adapters/sqlite/session-marker-adapter.js';
import { SqliteSessionMarkerRepository } from '../adapters/sqlite/session-marker-repository.js';
import type { SessionMarkerRepository } from '../application/ports/mission-store.js';
import { repositoryId, type RepositoryId } from '../domain/repository.js';
import { createStatsMissionFlowReader } from './stats.js';
import { missionId } from '../domain/mission.js';
import { configureReboundTelemetry } from '../application/rebound-telemetry.js';
import { resolveCanonicalRepositoryId } from '../adapters/git/repository-identity.js';
import { createDefaultExecuteMissionRuntime, createExecuteMissionPorts } from '../adapters/mission/execute-mission-adapters.js';
import { createHandoffPorts, performHandoff } from '../adapters/cli/commands/handoff.js';
import { resolveWorktree } from '../adapters/git/worktree.js';
import integrate from '../adapters/cli/commands/integrate.js';
import { createReviewLoopPorts, type ReviewLoopBindings, type ReviewLoopTarget } from '../adapters/review/review-loop.js';
import { reviewLoopBindings } from './review-persistence.js';
import { recoveryEvidenceFileSystem } from '../adapters/filesystem/recovery-evidence-fs.js';
import { setRecoveryEvidenceFileSystem } from '../application/recovery-evidence.js';
import { LegacyStatsBackfillAdapter } from '../adapters/mission/stats-backfill-adapter.js';
import type { ProgressPort } from '../application/ports.js';
import type { MissionNelRecorder, MissionStore, MissionTransitionStore } from '../application/domain-ports.js';
import type { ExecuteMissionPorts } from '../application/ports/execute-mission.js';
import type { OperatorBlocklistOverlay } from '../adapters/sqlite/blocklist-snapshot.js';
import type {
  AgentBlocklistRepository,
} from '../application/ports/agent-blocklist.js';
import type { KnownRepositoriesRepository } from '../application/ports/repository-catalog.js';
import type { UIPreferencesRepository } from '../application/ports/operator-preferences.js';
import type { OperationalHistoryRepository, BoardLaneEventRepository } from '../application/ports/operation-history.js';
import type { UsageRepository } from '../application/ports/mission-measurements.js';
import type { SqliteDatabaseAdapter } from '../adapters/sqlite/database-adapter.js';
import type { ProductionCapabilities } from './production-capabilities.js';

export interface OperatorStateServices {
  readonly db: unknown;
  readonly migrations: unknown;
  /**
   * Operator-local agent blocklist materialized once from SQLite at startup,
   * or `null` when the adapter is disabled/unavailable (rollback shim,
   * unsupported Node, or open/migration failure). SQLite is the sole authority
   * for this field; `null` means consumers use the untouched file readers.
   */
  readonly blocklist: OperatorBlocklistOverlay | null;
  /**
   * SQLite repositories for operator-local state. Provided so presentation
   * consumers (TUI, CLI status, web-board projection) can build their read
   * adapters from the single composition root rather than opening the database
   * independently. `null` when the adapter is unavailable.
   */
  readonly repositories: OperatorStateRepositories | null;
  /** Finish this service scope by draining its accepted Mission operations. */
  readonly close: () => Promise<void>;
}

/**
 * The concrete SQLite repositories materialized at composition time.
 * All presentation consumers receive these ports from the composition root.
 */
export interface OperatorStateRepositories {
  readonly agentBlocklist: AgentBlocklistRepository;
  readonly knownRepositories: KnownRepositoriesRepository;
  readonly uiPreferences: UIPreferencesRepository;
  readonly operationalHistory: OperationalHistoryRepository;
  readonly boardLaneEvents: BoardLaneEventRepository;
  readonly usage: UsageRepository;
}

/**
 * The checked Mission use cases, bound to the canonical repository.
 *
 * `SqliteMissionStore` is the sole production authority per ADR 0053.
 */
export interface MissionApplicationServices {
  readonly store: MissionStore & MissionTransitionStore & MissionNelRecorder;
  /**
   * The append-only operational-history store (TASK-2625): the integration gate
   * step records and reads the sha-keyed integration-validation marker here.
   * Bound to the same SQLite authority as `store`.
   */
  readonly operationalHistory: import('../application/services/operational-history-service.js').OperationalHistoryService;
  /**
   * The repository identity these use cases are bound to, canonicalized to the
   * primary checkout. Callers that build an intake request must read it from
   * here rather than deriving their own: a mission worktree and the checkout it
   * was branched from are the same repository, and a caller that keys off its
   * own `<repo>-<slug>` worktree path would persist a Mission under an identity
   * no other command resolves to.
   */
  readonly repositoryId: RepositoryId;
  /** Bound lifecycle population used by the post-integration statistics report. */
  readonly readStatsMissionFlow?: () => Promise<readonly import('../application/ports/cli-workflows.js').StatsMissionFlow[] | null>;
  readonly intake: MissionIntakeService;
  readonly lifecycle: MissionLifecycleService;
  readonly integration: MissionIntegrationService;
  readonly checkpoints: MissionCheckpointService;
  readonly brief: MissionBriefService;
  readonly assignment: MissionAssignmentService;
  readonly handoff: MissionHandoffService;
}

export interface ProductionApplicationServices {
  readonly executeMission: ExecuteMissionService;
  /** Shared execute mechanism set; presentation composition uses these exact instances. */
  readonly executePorts: ExecuteMissionPorts;
  /** Shared CLI/TUI board-read and active-dispatch capabilities from this graph. */
  readonly presentationCapabilities: ProductionCapabilities | null;
  readonly statsBackfill: StatsBackfillService;
  /** Operator-local SQLite state (blocklist authority + adapter handles). */
  readonly operatorState: OperatorStateServices;
  /**
   * Mission lifecycle, checkpoint, and handoff use cases. `null` when the
   * caller opted out of operator-local state: the Mission authority is that
   * same SQLite database, so building it would open (and create) it anyway.
   */
  readonly mission: MissionApplicationServices | null;
  /**
   * Application services for operator-local state. `null` when the caller
   * opted out of operator-local state. Supplies ports for KnownRepository
   * observations, UI preferences, and operational history.
   */
  readonly operatorServices: OperatorApplicationServices | null;
  /**
   * Publishes the mission-scoped current-work fact the board reads. Falls back
   * to the no-op port when operator-local state is unavailable, so a command
   * still runs — the board simply reports that mission's work as unrecorded.
   */
  readonly currentWork: CurrentWorkPort;
}

/** Board integration keeps the CLI workflow but turns every non-zero exit into a typed failure. */
export function createBoardIntegrateService(mission: MissionApplicationServices, currentWork: CurrentWorkPort): IntegrateCommandUseCase {
  return new IntegrateCommandUseCase({
    async execute(args) {
      await integrate(args, {
        missionServicesFn: async () => mission,
        exitFn: (code) => {
          if (code !== 0) { throw new Error(`integration workflow exited with code ${code}`); }
        },
      });
    },
  }, currentWork);
}

/**
 * Application-layer services that operate over the operator-local SQLite
 * repositories. Provided by the composition root so presentation consumers
 * receive ports rather than adapter handles.
 */
export interface OperatorApplicationServices {
  readonly knownRepositories: KnownRepositoryService;
  readonly uiPreferences: UIPreferencesService;
  readonly operationalHistory: OperationalHistoryService;
}

export interface ProductionApplicationServiceOptions {
  readonly includeOperatorState?: boolean;
  /** Typed operator configuration resolved once at the composition root. */
  readonly configuration: ParallixConfiguration;
}

function performHandoffWithMissionServices(mission: MissionApplicationServices, configuration: ParallixConfiguration) {
  return (slug: string, options: Record<string, unknown>) => performHandoff(slug, {
    ...options, configuration,
    missionServicesFn: async () => mission,
  });
}

/**
 * Sole production construction point for the complete concrete graph.
 *
 * The one and only async boundary lives here: operator-local SQLite state is
 * opened, migrated, and materialized into a plain in-memory snapshot before the
 * synchronous consumer graph is built (per ADR 0044 / architecture migration). No hot-path
 * consumer (agent eligibility/selection) becomes async as a result. If SQLite
 * is unavailable — the CJS rollback shim, a Node build without the built-in
 * SQLite module, or any open/migration error — the snapshot is `null` and
 * consumers fall back to the untouched file-based readers.
 */
function bindOperatorServices(repositories: OperatorStateRepositories | null) {
  if (!repositories) { return null; }
  return {
    knownRepositories: new KnownRepositoryService(repositories.knownRepositories),
    uiPreferences: new UIPreferencesService(repositories.uiPreferences),
    operationalHistory: new OperationalHistoryService(repositories.operationalHistory),
  };
}

export async function createProductionApplicationServices(
  rootDir: string,
  activeProgress: ProgressPort | undefined,
  options: ProductionApplicationServiceOptions,
): Promise<ProductionApplicationServices> {
  const operatorState = options.includeOperatorState === false
    ? { db: null, migrations: null, blocklist: null, repositories: null, close: async () => {} }
    : await materializeOperatorState(options.configuration);

  const operatorServices = bindOperatorServices(operatorState.repositories);

  // Build a SessionMarkerPort from the shared database connection so that
  // startAgent reuses the composition root's SQLite handle instead of opening
  // a second independent connection (avoids "database is locked" contention
  // between DatabaseSync handles on the same file).
  let sessionMarkerPort: import('../application/domain-ports.js').SessionMarkerPort | null = null;
  // The board reads the same markers to attribute a running mission to the
  // family that launched it.
  let sessionMarkers: SessionMarkerRepository | null = null;
  if (operatorState.repositories) {
    const repoId = resolveCanonicalRepositoryId(rootDir);
    sessionMarkerPort = new SqliteSessionMarkerAdapter(
      operatorState.db as SqliteDatabaseAdapter,
      repoId,
    );
    sessionMarkers = new SqliteSessionMarkerRepository(
      operatorState.db as SqliteDatabaseAdapter,
      repoId,
    );
  }

  const mission = options.includeOperatorState === false
    ? null
    : await createMissionApplicationServices(rootDir, { configuration: options.configuration });
  // Shared Mission-authority injection used by both the handoff and the review
  const defaultExecuteRuntime = createDefaultExecuteMissionRuntime(options.configuration);
  const handoffWithMissionServices = mission && performHandoffWithMissionServices(mission, options.configuration);
  const executeRuntime = mission ? {
    ...defaultExecuteRuntime,
    performHandoff: (slug: string, handoffOptions: Record<string, unknown> = {}) =>
      handoffWithMissionServices!(slug, handoffOptions),
    validateCheckpointsBeforeHandoff: (slug: string, worktree: string, runtimeOptions: Record<string, unknown> = {}) =>
      defaultExecuteRuntime.validateCheckpointsBeforeHandoff!(slug, worktree, {
        ...runtimeOptions,
        loadRecordedCheckpointsFn: async (checkpointSlug: string) => {
          const loaded = await mission.store.load(missionId(checkpointSlug));
          if (loaded.kind !== 'found' || !loaded.mission.brief) { return null; }
          return {
            planned: loaded.mission.checkpoints.map(({ name }) => name),
            recorded: loaded.mission.checkpoints.filter(({ goalCheck, repair }) => goalCheck.length > 0 && (!repair || repair.evidenceRecorded)).map(({ name }) => name),
          };
        },
      }),
    reviewLoopMechanisms: (reviewSlug: string, target: ReviewLoopTarget, bindings: ReviewLoopBindings = {}) => createReviewLoopPorts(reviewSlug, target, {
      ...bindings,
      configuration: options.configuration,
      classification: createReviewClassification(reviewSlug, target.worktree ?? rootDir, options.configuration.decision, options.configuration),
      performHandoffFn: handoffWithMissionServices!,
      ...reviewLoopBindings(mission.store, mission.lifecycle, sessionMarkerPort),
    }),
  } : defaultExecuteRuntime;
  const executePorts = createExecuteMissionPorts(rootDir, {
    configuration: options.configuration,
    missionTransitionStore: mission?.store ?? unavailableMissionTransitionStore(),
    operatorBlocklist: operatorState.blocklist,
    sessionMarkerPort,
  }, executeRuntime);
  // One publisher per process. The recorder appends to the same operational
  // history the board reads, so there is no second current-work authority.
  const currentWork: CurrentWorkPort = operatorState.repositories
    ? new CurrentWorkRecorder(operatorState.repositories.operationalHistory, {
      processId: process.pid,
      // Pid plus start identity: a recycled pid must not keep a dead run's
      // work displayed as live (TASK-2373 SC13).
      processIdentity: processStartIdentity(process.pid),
    })
    : NO_CURRENT_WORK_PORT;
  // Bind the one production filesystem for the recovery store. The application
  // layer cannot import `node:fs`, so composition binds the `filesystem`
  // adapter here for every process (TASK-2642 boundary decision).
  bindRecoveryPorts(operatorState.repositories, mission, rootDir);
  const presentationCapabilities = operatorState.repositories
    ? (await import('./production-capabilities.js')).composeProductionCapabilities(
      rootDir,
      mission?.repositoryId ?? resolveCanonicalRepositoryId(rootDir),
      { ...operatorState.repositories, sessionMarkers },
      executePorts,
      mission?.store ?? null,
      currentWork,
      activeProgress,
      operatorState.db as SqliteDatabaseAdapter,
      { configuration: options.configuration },
      mission ? createBoardIntegrateService(mission, currentWork) : undefined,
    )
    : null;
  return {
    currentWork,
    executeMission: new ExecuteMissionService(executePorts, activeProgress, currentWork),
    executePorts,
    presentationCapabilities,
    // TASK-2378: the backfill derivation reads the authoritative Review
    // aggregate through the operator store when the mission services are
    // available; pre-cutover missions without a Review keep the historical
    // git-history fallback.
    statsBackfill: new StatsBackfillService(new LegacyStatsBackfillAdapter(rootDir, { configuration: options.configuration }, mission?.store ?? null)),
    // A nested review command can finish while integration still uses another
    // service graph backed by the same process-lifetime handle. Drain this
    // scope's accepted operations without invoking the process shutdown closer;
    // registerOperatorStateShutdown owns closing the shared connection.
    operatorState: {
      ...operatorState,
      close: async () => {
        await mission?.store.drain?.();
      },
    },
    mission,
    operatorServices,
  };
}

function unavailableMissionTransitionStore(): import('../application/domain-ports.js').MissionTransitionStore {
  const unavailable = async () => ({ kind: 'missing' as const });
  return { load: unavailable, save: async () => { throw new Error('Mission authority is unavailable'); }, saveWithTransition: async () => { throw new Error('Mission authority is unavailable'); } };
}

/**
 * Build the Mission use cases over the single selected SQLite authority.
 *
 * Opens the operator-local database, applies pending migrations, and constructs
 * the checked use cases. SQLite is the sole authority per ADR 0053.
 *
 * Callers that need only the Mission boundary (the handoff command, a future
 * board host) use this instead of materializing operator-local SQLite state.
 *
 * Fail-closed: if the database cannot be opened or migrations fail, the
 * returned store will fail on operations rather than falling back to files.
 */
export interface MissionApplicationServiceOverrides {
  readonly configuration?: ParallixConfiguration;
  /** Repository ID override (for test fixtures). */
  readonly repositoryId?: string;
  /** Database path override (for test fixtures). */
  readonly databasePath?: string;
}

/** Recording resolves evidence references in the Mission's checkout, as handoff does. */
export function checkpointEvidenceReferences(): CheckpointEvidenceReferences {
  return { fileSystem: createHandoffPorts().fileSystem, rootFor: (id) => resolveWorktree(id) };
}

export async function createMissionApplicationServices(
  rootDir: string,
  overrides: MissionApplicationServiceOverrides = {},
): Promise<MissionApplicationServices> {
  // A mission worktree and the checkout it was branched from are the same
  // repository: the Mission row a handoff writes from `<repo>-<slug>` is the
  // one integrate reads from `<repo>`. Anchor the repository identity to the
  // primary worktree so callers key consistent rows.
  const repoId = overrides.repositoryId
    ? repositoryId(overrides.repositoryId)
    : resolveCanonicalRepositoryId(rootDir);

  // Dynamic imports keep the built-in SQLite module out of the statically
  // loaded runtime graph so the CJS rollback bundle degrades gracefully.
  const { initOperatorState } = await import('../adapters/sqlite/adapter-factory.js');
  const { resolveDatabasePath } = await import('../adapters/sqlite/database-path-resolver.js');

  // Use the shared singleton connection from initOperatorState so that the
  // mission store, session markers, and blocklist all converge on the same
  // DatabaseSync handle. This avoids "database is locked" contention between
  // independent connections on the same file.
  const configuration = overrides.configuration ?? resolveProcessConfiguration();
  const dbPath = overrides.databasePath ?? resolveDatabasePath({ configuration });
  const { db } = await initOperatorState({
    configuration,
    homeDir: overrides.databasePath
      ? path.dirname(dbPath)
      : undefined,
  });

  const { SqliteOperationalHistoryRepository } = await import('../adapters/sqlite/operational-history-repository.js');
  const store = new SqliteMissionStore(db);
  const { SqliteBoardLaneEventRepository } = await import('../adapters/sqlite/board-lane-event-repository.js');
  const { SqliteUsageRepository } = await import('../adapters/sqlite/usage-repository.js');
  const readStatsMissionFlow = createStatsMissionFlowReader({
    rootDir, missionStore: store, repositoryId: repoId,
    laneEventRepo: new SqliteBoardLaneEventRepository(db), usageRepo: new SqliteUsageRepository(db),
  });
  const lifecycle = new MissionLifecycleService(store);
  const operationalHistory = new (await import('../application/services/operational-history-service.js')).OperationalHistoryService(new SqliteOperationalHistoryRepository(db));
  return {
    store,
    operationalHistory,
    readStatsMissionFlow,
    repositoryId: repoId,
    intake: new MissionIntakeService(store),
    lifecycle,
    integration: new MissionIntegrationService(store),
    checkpoints: new MissionCheckpointService(store, checkpointEvidenceReferences()),
    brief: new MissionBriefService(store, new SqliteOperationalHistoryRepository(db)),
    assignment: new MissionAssignmentService(store),
    handoff: new MissionHandoffService(store, store),
  };
}

async function materializeOperatorState(configuration: ParallixConfiguration): Promise<OperatorStateServices> {
  try {
    // Dynamic imports keep the built-in SQLite module out of the statically
    // loaded runtime graph so the CJS rollback bundle (which lacks these
    // modules) degrades gracefully through the catch below rather than failing
    // to load. The adapter layer is the only place that binds the SQLite driver.
    const { initOperatorState, clearOperatorStateCache, clearOperatorStateCacheSync } = await import('../adapters/sqlite/adapter-factory.js');
    const { registerOperatorStateShutdown } = await import('./operator-state-lifecycle.js');
    const { SqliteBlocklistRepository } = await import('../adapters/sqlite/blocklist-repository.js');
    const { SqliteKnownRepositoriesRepository } = await import('../adapters/sqlite/repository-repository.js');
    const { SqliteUIPreferencesRepository } = await import('../adapters/sqlite/ui-preferences-repository.js');
    const { SqliteOperationalHistoryRepository } = await import('../adapters/sqlite/operational-history-repository.js');
    const { SqliteBoardLaneEventRepository } = await import('../adapters/sqlite/board-lane-event-repository.js');
    const { SqliteUsageRepository } = await import('../adapters/sqlite/usage-repository.js');
    const { materializeBlocklistSnapshot } = await import('../adapters/sqlite/blocklist-snapshot.js');

    // Use the shared singleton connection from initOperatorState so that the
    // composition root, session markers, and blocklist all converge on the
    // same DatabaseSync handle. This avoids "database is locked" contention
    // between independent connections on the same file.
    const { db, migrations } = await initOperatorState({ configuration });

    // Materialize the operator-local blocklist ONCE (single async read).
    const entries = await new SqliteBlocklistRepository(db).findAll();

    // Create all operator-state repositories from the shared database connection.
    const repositories = {
      agentBlocklist: new SqliteBlocklistRepository(db),
      knownRepositories: new SqliteKnownRepositoriesRepository(db),
      uiPreferences: new SqliteUIPreferencesRepository(db),
      operationalHistory: new SqliteOperationalHistoryRepository(db),
      boardLaneEvents: new SqliteBoardLaneEventRepository(db),
      usage: new SqliteUsageRepository(db),
    };

    return {
      db,
      migrations,
      blocklist: materializeBlocklistSnapshot(entries),
      repositories,
      close: registerOperatorStateShutdown(clearOperatorStateCache, clearOperatorStateCacheSync),
    };
  } catch {
    return { db: null, migrations: null, blocklist: null, repositories: null, close: async () => {} };
  }
}

/**
 * Process-wide recovery ports: the evidence filesystem, and one durable sink
 * for every rebound consumer so each completed repair attempt lands in the
 * operational history the board already reads (TASK-2653).
 */
function bindRecoveryPorts(
  repositories: { operationalHistory: OperationalHistoryRepository } | null | undefined,
  mission: { repositoryId: string; store: MissionStore } | null | undefined,
  rootDir: string,
): void {
  setRecoveryEvidenceFileSystem(recoveryEvidenceFileSystem);
  configureRepairCheckpoints(new RepairCheckpointService(mission?.store ?? unavailableMissionTransitionStore()));
  configureReboundTelemetry(repositories ? { repositoryId: mission?.repositoryId ?? resolveCanonicalRepositoryId(rootDir), history: repositories.operationalHistory } : null);
}
