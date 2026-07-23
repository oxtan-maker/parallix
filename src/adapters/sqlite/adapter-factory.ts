import type { Migration } from './database-adapter.js';
import { SqliteDatabaseAdapter } from './database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from './migration-runner.js';
import { resolveDatabasePath } from './database-path-resolver.js';

/**
 * Configuration for initializing the SQLite operator-state adapter.
 */
export interface AdapterInitOptions {
  /**
   * PARALLIX_HOME directory. If not provided, uses process.env.PARALLIX_HOME.
   */
  homeDir?: string;

  /**
   * Custom busy timeout in milliseconds (default 5000).
   */
  busyTimeoutMs?: number;

  /**
   * Enable WAL mode when supported (default true).
   */
  enableWal?: boolean;

  /**
   * List of migration definitions to apply on initialization.
   * If not provided, loads from the default migrations directory.
   */
  migrations?: readonly Migration[];
}

/**
 * The fully initialized SQLite operator-state adapter.
 */
export interface OperatorStateAdapter {
  /** The database adapter instance. */
  db: SqliteDatabaseAdapter;
  /** Migration runner for schema management. */
  migrations: SqliteMigrationRunner;
}

/**
 * Initialize the SQLite operator-state adapter with all components.
 *
 * This is the primary entry point for connecting the SQLite adapter.
 * It:
 * 1. Resolves the database path under PARALLIX_HOME
 * 2. Opens the database connection with FK, busy timeout, WAL
 * 3. Applies pending migrations
 * 4. Returns the adapter components for use by callers
 *
 * @example
 * ```ts
 * const adapter = await initOperatorState({ homeDir: process.env.PARALLIX_HOME });
 * const db = adapter.db;
 * ```
 */
export async function initOperatorState(
  options: AdapterInitOptions = {},
): Promise<OperatorStateAdapter> {
  const dbPath = resolveDatabasePath({ home: options.homeDir });

  // Open database with configured settings
  const db = new SqliteDatabaseAdapter();
  await db.open({
    path: dbPath,
    busyTimeoutMs: options.busyTimeoutMs ?? 5000,
    enableWal: options.enableWal !== false,
  });

  // Create migration runner and apply pending migrations
  const migrations = new SqliteMigrationRunner(db);
  const migrationList = options.migrations ?? loadDefaultMigrations();
  await migrations.applyPending(migrationList);

  return { db, migrations };
}
