import * as path from 'node:path';

import { ExecuteMissionService } from '../application/execute-mission-service.js';
import { StatsBackfillService } from '../application/stats-backfill-service.js';
import { MissionCheckpointService } from '../application/mission-checkpoint-service.js';
import { MissionHandoffService } from '../application/mission-handoff-service.js';
import { MissionIntakeService } from '../application/mission-intake-service.js';
import { MissionLifecycleService } from '../application/mission-lifecycle-service.js';
import { MissionIntegrationService } from '../application/mission-integration-service.js';
import { KnownRepositoryService } from '../application/services/known-repository-service.js';
import { UIPreferencesService } from '../application/services/ui-preferences-service.js';
import { OperationalHistoryService } from '../application/services/operational-history-service.js';
import { SqliteMissionStore } from '../adapters/sqlite/mission-store.js';
import { MissionCompatibilityImporter } from '../adapters/sqlite/mission-importer.js';
import { SqliteSessionMarkerAdapter } from '../adapters/sqlite/session-marker-adapter.js';
import { SqliteSessionMarkerRepository } from '../adapters/sqlite/session-marker-repository.js';
import type { SessionMarkerRepository } from '../application/ports/mission-store.js';
import { repositoryId, type RepositoryId } from '../domain/repository.js';
import { git } from '../adapters/git/git.js';
import { createDefaultExecuteMissionRuntime, createExecuteMissionPorts } from '../adapters/mission/execute-mission-adapters.js';
import { performHandoff } from '../adapters/cli/commands/handoff.js';
import { startReviewLoop } from '../adapters/review/review-loop.js';
import { reviewLoopBindings } from './review-persistence.js';
import { LegacyStatsBackfillAdapter } from '../adapters/mission/stats-backfill-adapter.js';
import type { ProgressPort } from '../application/ports.js';
import type { MissionTransitionStore } from '../application/domain-ports.js';
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
  /** Idempotent, composition-owned close operation for process shutdown. */
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
 * After the architecture migration cutover, `SqliteMissionStore` is the sole production
 * authority. The preflight import gate (MissionCompatibilityImporter) runs at
 * construction time to ensure all legacy Missions have been imported before any
 * command path reads or writes through the store.
 */
export interface MissionApplicationServices {
  readonly store: MissionTransitionStore;
  /**
   * The repository identity these use cases are bound to, canonicalized to the
   * primary checkout. Callers that build an intake request must read it from
   * here rather than deriving their own: a mission worktree and the checkout it
   * was branched from are the same repository, and a caller that keys off its
   * own `<repo>-<slug>` worktree path would persist a Mission under an identity
   * no other command resolves to.
   */
  readonly repositoryId: RepositoryId;
  readonly intake: MissionIntakeService;
  readonly lifecycle: MissionLifecycleService;
  readonly integration: MissionIntegrationService;
  readonly checkpoints: MissionCheckpointService;
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
  /** Skip the preflight import gate (for test fixtures). */
  readonly skipImportGate?: boolean;
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
export async function createProductionApplicationServices(
  rootDir: string,
  activeProgress?: ProgressPort,
  options: ProductionApplicationServiceOptions = {},
): Promise<ProductionApplicationServices> {
  const operatorState = options.includeOperatorState === false
    ? { db: null, migrations: null, blocklist: null, repositories: null, close: async () => {} }
    : await materializeOperatorState();

  const operatorServices = options.includeOperatorState === false
    ? null
    : operatorState.repositories
      ? {
          knownRepositories: new KnownRepositoryService(operatorState.repositories.knownRepositories),
          uiPreferences: new UIPreferencesService(operatorState.repositories.uiPreferences),
          operationalHistory: new OperationalHistoryService(operatorState.repositories.operationalHistory),
        }
      : null;

  // Build a SessionMarkerPort from the shared database connection so that
  // startAgent reuses the composition root's SQLite handle instead of opening
  // a second independent connection (avoids "database is locked" contention
  // between DatabaseSync handles on the same file).
  let sessionMarkerPort: import('../application/domain-ports.js').SessionMarkerPort | null = null;
  // The board reads the same markers to attribute a running mission to the
  // family that launched it.
  let sessionMarkers: SessionMarkerRepository | null = null;
  if (operatorState.repositories) {
    const sourceRoot = resolvePrimaryRoot(rootDir);
    const repoId = repositoryId(path.basename(sourceRoot) || sourceRoot);
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
    : await createMissionApplicationServices(rootDir, {
      skipImportGate: options.skipImportGate,
    });
  const defaultExecuteRuntime = createDefaultExecuteMissionRuntime();
  const executeRuntime = mission ? {
    ...defaultExecuteRuntime,
    runHandoffAndReview: (slug: string, worktree: string, agent: string, runtimeOptions: Record<string, unknown> = {}) =>
      defaultExecuteRuntime.runHandoffAndReview(slug, worktree, agent, {
        ...runtimeOptions,
        performHandoff: (handoffSlug: string, handoffOptions: Record<string, unknown>) => performHandoff(handoffSlug, {
          ...handoffOptions,
          missionServicesFn: async () => mission,
        }),
        startReviewLoop: (reviewSlug: string, loopOptions: Record<string, unknown>) => startReviewLoop(reviewSlug, {
          ...loopOptions,
          // Every Mission-authority injection the loop needs, including the
          // artifact consumers that persist review events: an omitted binding
          // leaves the adapter default, which resolves no store and reports the
          // mission as having no Review.
          ...reviewLoopBindings(mission.store),
        } as any),
      }),
  } : defaultExecuteRuntime;
  const executePorts = createExecuteMissionPorts(rootDir, {
    missionTransitionStore: mission?.store ?? unavailableMissionTransitionStore(),
    operatorBlocklist: operatorState.blocklist,
    sessionMarkerPort,
  }, executeRuntime);
  const presentationCapabilities = operatorState.repositories
    ? (await import('./production-capabilities.js')).composeProductionCapabilities(
      rootDir,
      mission?.repositoryId ?? repositoryId(path.basename(resolvePrimaryRoot(rootDir)) || resolvePrimaryRoot(rootDir)),
      { ...operatorState.repositories, sessionMarkers },
      executePorts,
      mission?.store ?? null,
    )
    : null;
  return {
    executeMission: new ExecuteMissionService(executePorts, activeProgress),
    executePorts,
    presentationCapabilities,
    statsBackfill: new StatsBackfillService(new LegacyStatsBackfillAdapter(rootDir)),
    // Closing the shared handle is the last thing a command does, but a Mission
    // write can still be settling when it happens — that is how a review-loop
    // stats write ended up reporting "Database is not open. Call open() before
    // using the adapter." Drain the store first so every accepted write reaches
    // the database it was accepted by.
    operatorState: {
      ...operatorState,
      close: async () => {
        await mission?.store.drain?.();
        await operatorState.close();
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
 * Opens the operator-local database, applies pending migrations, runs the
 * preflight import gate (MissionCompatibilityImporter) to ensure all legacy
 * Missions have been imported, and constructs the checked use cases.
 *
 * Callers that need only the Mission boundary (the handoff command, a future
 * board host) use this instead of materializing operator-local SQLite state.
 *
 * Fail-closed: if the database cannot be opened or migrations fail, the
 * returned store will fail on operations rather than falling back to files.
 */
export interface MissionApplicationServiceOverrides {
  /** Repository ID override (for test fixtures). */
  readonly repositoryId?: string;
  /** Database path override (for test fixtures). */
  readonly databasePath?: string;
  /** Skip the preflight import gate (for test fixtures). */
  readonly skipImportGate?: boolean;
}

/**
 * The checkout that owns a repository's Mission rows. Mission worktrees resolve
 * back to the checkout they were created from; anything else is its own root.
 */
function resolvePrimaryRoot(rootDir: string): string {
  try {
    // `git worktree list` always reports the main working tree first.
    const listed = git(['-C', rootDir, 'worktree', 'list', '--porcelain'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (listed.status !== 0) {
      return rootDir;
    }
    const first = (listed.stdout || '').split('\n').find((line) => line.startsWith('worktree '));
    return first ? first.slice('worktree '.length).trim() : rootDir;
  } catch {
    return rootDir;
  }
}

export async function createMissionApplicationServices(
  rootDir: string,
  overrides: MissionApplicationServiceOverrides = {},
): Promise<MissionApplicationServices> {
  // A mission worktree and the checkout it was branched from are the same
  // repository: the Mission row a handoff writes from `<repo>-<slug>` is the
  // one integrate reads from `<repo>`. Anchor both the repository identity and
  // the importer's source root to the primary worktree, or the two callers
  // would key different rows and every post-handoff import would look like a
  // divergence conflict.
  const sourceRoot = resolvePrimaryRoot(rootDir);
  const repoId = overrides.repositoryId
    ? repositoryId(overrides.repositoryId)
    : repositoryId(path.basename(sourceRoot) || sourceRoot);

  // Dynamic imports keep the built-in SQLite module out of the statically
  // loaded runtime graph so the CJS rollback bundle degrades gracefully.
  const { initOperatorState } = await import('../adapters/sqlite/adapter-factory.js');
  const { resolveDatabasePath } = await import('../adapters/sqlite/database-path-resolver.js');

  // Use the shared singleton connection from initOperatorState so that the
  // mission store, session markers, and blocklist all converge on the same
  // DatabaseSync handle. This avoids "database is locked" contention between
  // independent connections on the same file.
  const dbPath = overrides.databasePath ?? resolveDatabasePath();
  const { db } = await initOperatorState({
    homeDir: overrides.databasePath
      ? path.dirname(dbPath)
      : undefined,
  });

  // Preflight import gate: ensure all legacy Missions have been imported
  // before any command path reads or writes through the SQLite store.
  // architecture invariant: inspect the returned report — throw when validation errors or
  // unresolved conflicts remain so that a malformed or divergent legacy
  // Mission blocks construction of the SQLite authority.
  //
  // The gate runs once per source root: it guards the cutover, it is not a
  // steady-state reconciler. Once this root has been imported, SQLite is the
  // authority and later edits to the retired legacy files are ignored by
  // design — re-importing them would resurrect the dual-write ADR 0053 forbids
  // (and would report every post-cutover checkpoint as an import conflict).
  const alreadyImported = await db.query<{ count: number }>(
    'SELECT COUNT(*) AS count FROM import_history WHERE source_path = ?;',
    [sourceRoot],
  ).then((rows) => (rows[0]?.count ?? 0) > 0).catch(() => false);

  if (!overrides.skipImportGate && !alreadyImported) {
    const store = new SqliteMissionStore(db);
    const importer = new MissionCompatibilityImporter(db, store, sourceRoot, repoId);
    const report = await importer.apply();
    if (report.conflicts.length > 0) {
      const detailLines = report.conflicts
        .map((c) => `  - ${c.missionId} (${c.sourcePath}): ${c.details || c.reason}`)
        .join('\n');
      throw new Error(
        `Preflight import gate failed: ${report.conflicts.length} conflict(s) detected.\n${detailLines}`,
      );
    }
  }

  const store = new SqliteMissionStore(db);
  return {
    store,
    repositoryId: repoId,
    intake: new MissionIntakeService(store),
    lifecycle: new MissionLifecycleService(store),
    integration: new MissionIntegrationService(store),
    checkpoints: new MissionCheckpointService(store),
    handoff: new MissionHandoffService(store, store),
  };
}

async function materializeOperatorState(): Promise<OperatorStateServices> {
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
    const { db, migrations } = await initOperatorState();

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
