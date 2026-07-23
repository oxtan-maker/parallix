import { ActiveService } from '../application/active-service.js';
import { StatsBackfillService } from '../application/stats-backfill-service.js';
import { LegacyActiveAdapter } from '../adapters/legacy-active-adapter.js';
import { LegacyStatsBackfillAdapter } from '../adapters/legacy-stats-backfill-adapter.js';
import type { ProgressPort } from '../application/ports.js';
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

export interface ProductionApplicationServices {
  readonly active: ActiveService;
  readonly statsBackfill: StatsBackfillService;
  /** Operator-local SQLite state (blocklist authority + adapter handles). */
  readonly operatorState: OperatorStateServices;
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
): Promise<ProductionApplicationServices> {
  const operatorState = await materializeOperatorState();

  return {
    active: new ActiveService(
      new LegacyActiveAdapter(rootDir, undefined, { operatorBlocklist: operatorState.blocklist }),
      activeProgress,
    ),
    statsBackfill: new StatsBackfillService(new LegacyStatsBackfillAdapter(rootDir)),
    operatorState,
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
