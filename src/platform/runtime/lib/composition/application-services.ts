import * as path from 'node:path';

import { ActiveService } from '../../../../application/active-service.js';
import { StatsBackfillService } from '../../../../application/stats-backfill-service.js';
import { MissionCheckpointService } from '../../../../application/mission-checkpoint-service.js';
import { MissionHandoffService } from '../../../../application/mission-handoff-service.js';
import { MissionIntakeService } from '../../../../application/mission-intake-service.js';
import { MissionLifecycleService } from '../../../../application/mission-lifecycle-service.js';
import { MissionIntegrationService } from '../../../../application/mission-integration-service.js';
import { SqliteMissionStore } from '../../../../adapters/sqlite/mission-store.js';
import { MissionCompatibilityImporter } from '../../../../adapters/sqlite/mission-importer.js';
import { repositoryId, type RepositoryId } from '../../../../domain/repository.js';
import { git } from '../core/git.js';
import { LegacyActiveAdapter } from '../adapters/legacy-active-adapter.js';
import { LegacyStatsBackfillAdapter } from '../adapters/legacy-stats-backfill-adapter.js';
import type { ProgressPort } from '../../../../application/ports.js';
import type { OperatorBlocklistOverlay } from '../../../../adapters/sqlite/blocklist-snapshot.js';

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
}

/**
 * The checked Mission use cases, bound to the SQLite authority.
 *
 * After the TASK-2322.07 cutover, `SqliteMissionStore` is the sole production
 * authority. The preflight import gate (MissionCompatibilityImporter) runs at
 * construction time to ensure all legacy Missions have been imported before any
 * command path reads or writes through the store.
 */
export interface MissionApplicationServices {
  readonly store: SqliteMissionStore;
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
  /** Which authority the graph selected. */
  readonly authority: 'sqlite';
}

export interface ProductionApplicationServices {
  readonly active: ActiveService;
  readonly statsBackfill: StatsBackfillService;
  /** Operator-local SQLite state (blocklist authority + adapter handles). */
  readonly operatorState: OperatorStateServices;
  /**
   * Mission lifecycle, checkpoint, and handoff use cases. `null` when the
   * caller opted out of operator-local state: the Mission authority is that
   * same SQLite database, so building it would open (and create) it anyway.
   */
  readonly mission: MissionApplicationServices | null;
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
 * synchronous consumer graph is built (per ADR 0044 / TASK-2294). No hot-path
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
    ? { db: null, migrations: null, blocklist: null }
    : await materializeOperatorState();

  return {
    active: new ActiveService(
      new LegacyActiveAdapter(rootDir, undefined, { operatorBlocklist: operatorState.blocklist }),
      activeProgress,
    ),
    statsBackfill: new StatsBackfillService(new LegacyStatsBackfillAdapter(rootDir)),
    operatorState,
    mission: options.includeOperatorState === false
      ? null
      : await createMissionApplicationServices(rootDir, {
        skipImportGate: options.skipImportGate,
      }),
  };
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
  const { SqliteDatabaseAdapter } = await import('../../../../adapters/sqlite/database-adapter.js');
  const { SqliteMigrationRunner, loadDefaultMigrations } = await import(
    '../../../../adapters/sqlite/migration-runner.js'
  );
  const { resolveDatabasePath } = await import('../../../../adapters/sqlite/database-path-resolver.js');

  const db = new SqliteDatabaseAdapter();
  const dbPath = overrides.databasePath ?? resolveDatabasePath();
  await db.open({ path: dbPath });

  const migrations = new SqliteMigrationRunner(db);
  await migrations.applyPending(loadDefaultMigrations());

  // Preflight import gate: ensure all legacy Missions have been imported
  // before any command path reads or writes through the SQLite store.
  // SC2: inspect the returned report — throw when validation errors or
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
    authority: 'sqlite',
  };
}

async function materializeOperatorState(): Promise<OperatorStateServices> {
  try {
    // Dynamic imports keep the built-in SQLite module out of the statically
    // loaded runtime graph so the CJS rollback bundle (which lacks these
    // modules) degrades gracefully through the catch below rather than failing
    // to load. The adapter layer is the only place that binds the SQLite driver.
    const { SqliteDatabaseAdapter } = await import('../../../../adapters/sqlite/database-adapter.js');
    const { SqliteMigrationRunner, loadDefaultMigrations } = await import(
      '../../../../adapters/sqlite/migration-runner.js'
    );
    const { resolveDatabasePath } = await import('../../../../adapters/sqlite/database-path-resolver.js');
    const { SqliteBlocklistRepository } = await import('../../../../adapters/sqlite/blocklist-repository.js');
    const { materializeBlocklistSnapshot } = await import('../../../../adapters/sqlite/blocklist-snapshot.js');

    const db = new SqliteDatabaseAdapter();
    await db.open({ path: resolveDatabasePath() });

    const migrations = new SqliteMigrationRunner(db);
    await migrations.applyPending(loadDefaultMigrations());

    // Materialize the operator-local blocklist ONCE (single async read).
    const entries = await new SqliteBlocklistRepository(db).findAll();
    return { db, migrations, blocklist: materializeBlocklistSnapshot(entries) };
  } catch {
    return { db: null, migrations: null, blocklist: null };
  }
}
