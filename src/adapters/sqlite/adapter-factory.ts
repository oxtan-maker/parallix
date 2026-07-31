import type { Migration } from './database-adapter.js';
import { SqliteDatabaseAdapter } from './database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from './migration-runner.js';
import { resolveDatabasePath } from './database-path-resolver.js';

/**
 * Module-level singleton cache keyed by resolved database path.
 *
 * Multiple callers — the composition root, defaultSessionMarkerPort,
 * updateAgentBlockChecked, and the review loop — all converge on this
 * single DatabaseSync handle per PARALLIX_HOME. Without this cache each
 * caller opens an independent connection to the same file and SQLite's
 * file-level write lock causes "database is locked" contention between
 * the handles.
 *
 * Callers must not close the returned adapter; the connection lives for
 * the duration of the process. Use clearOperatorStateCache() in test
 * fixtures that need a fresh connection.
 */
const operatorStateCache = new Map<string, Promise<OperatorStateAdapter>>();

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

  let adapter = operatorStateCache.get(dbPath);
  const debug = process.env.PARALLIX_DEBUG_SQL;
  if (!adapter) {
    adapter = createOperatorState(dbPath, options);
    operatorStateCache.set(dbPath, adapter);
    if (debug) {
      process.stderr.write(`[sql-cache] MISS ${dbPath} (pid=${process.pid})\n`);
    }
  } else {
    if (debug) {
      process.stderr.write(`[sql-cache] HIT ${dbPath} (pid=${process.pid})\n`);
    }
  }
  try {
    return await adapter;
  } catch (error) {
    operatorStateCache.delete(dbPath);
    if (debug) {
      process.stderr.write(`[sql-cache] EVICT ${dbPath} (${(error as Error).message})\n`);
    }
    throw error;
  }
}

async function createOperatorState(
  dbPath: string,
  options: AdapterInitOptions,
): Promise<OperatorStateAdapter> {
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

/**
 * Clear the singleton cache. Intended for test fixtures that need a fresh
 * database connection after closing a cached adapter.
 */
export function clearOperatorStateCache(): void {
  operatorStateCache.clear();
}

/**
 * Return the number of cached entries (for diagnostics).
 */
export function getOperatorStateCacheSize(): number {
  return operatorStateCache.size;
}
