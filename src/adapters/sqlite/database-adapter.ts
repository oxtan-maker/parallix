import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Configuration for a SQLite database connection.
 */
export interface DatabaseConfig {
  /** Absolute path to the SQLite database file. */
  readonly path: string;
  /** Maximum busy timeout in milliseconds (default 5000). */
  readonly busyTimeoutMs?: number;
  /** Enable WAL mode when supported (default true). */
  readonly enableWal?: boolean;
}

/**
 * A record of an applied migration in the ledger.
 */
export interface MigrationLedgerEntry {
  readonly id: string;
  readonly checksum: string;
  readonly appliedAt: string;
}

/**
 * A single migration definition.
 */
export interface Migration {
  /** Ordered, immutable identifier (e.g. "0001-initial-schema"). */
  readonly id: string;
  /** SHA-256 checksum of the migration SQL content. */
  readonly checksum: string;
  /** Forward SQL statements to apply. */
  readonly up: string;
  /** Optional backward SQL for reversible migrations. */
  readonly down?: string;
}

/**
 * Row type for query results.
 */
export type QueryRow = Record<string, unknown>;

/**
 * SQLite database adapter using `node:sqlite` (DatabaseSync).
 *
 * All application-facing methods return `Promise` values so the adapter
 * layer can route database work to a worker thread without changing callers.
 *
 * Every connection enables:
 * - Foreign keys (`PRAGMA foreign_keys = ON`)
 * - Bounded busy timeout (default 5000ms)
 * - WAL mode when supported (with safe fallback)
 * - Parameterized SQL (no string interpolation)
 * - Explicit transactions for multi-statement writes
 */
export class SqliteDatabaseAdapter {
  private db: DatabaseSync | null = null;
  private config: DatabaseConfig | null = null;
  private inTransaction = false;

  /**
   * Open (or create) the database.
   */
  async open(config: DatabaseConfig): Promise<void> {
    this.config = config;
    // Clamp busy timeout to 0–5000 ms per ADR 0044 bounded busy timeout rule.
    const rawTimeout = typeof config.busyTimeoutMs === 'number' ? config.busyTimeoutMs : 5000;
    const busyTimeout = Math.min(5000, Math.max(0, Math.floor(rawTimeout)));
    const enableWal = config.enableWal !== false;

    // Ensure parent directory exists
    const parentDir = path.dirname(config.path);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    this.db = new DatabaseSync(config.path);

    // Enable foreign keys
    this.db.exec('PRAGMA foreign_keys = ON;');

    // Set bounded busy timeout (clamped to 0–5000, no string interpolation of caller value)
    this.db.exec(`PRAGMA busy_timeout = ${busyTimeout};`);

    // Enable WAL mode with safe fallback
    if (enableWal) {
      try {
        this.db.exec('PRAGMA journal_mode = WAL;');
      } catch {
        // WAL not supported on this filesystem; continue with default journal mode.
      }
    }

    this.inTransaction = false;
  }

  /**
   * Close the database connection.
   */
  async close(): Promise<void> {
    if (this.inTransaction) {
      try {
        await this.rollbackTransaction();
      } catch {
        // Transaction rollback on close is best-effort.
      }
    }
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.config = null;
    this.inTransaction = false;
  }

  /**
   * Check whether the database connection is open.
   */
  isOpen(): boolean {
    return this.db !== null;
  }

  /**
   * Return the path of the database file, or undefined if not open.
   */
  getPath(): string | undefined {
    return this.config?.path;
  }

  /**
   * Execute a parameterized SQL statement.
   */
  async execute(sql: string, params?: readonly unknown[]): Promise<void> {
    this.assertOpen();
    if (params && params.length > 0) {
      this.db!.prepare(sql).run(...params as any);
    } else {
      this.db!.exec(sql);
    }
  }

  /**
   * Query and return rows as plain objects.
   */
  async query<T extends QueryRow>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<readonly T[]> {
    this.assertOpen();
    const stmt = this.db!.prepare(sql);
    const rows = (params && params.length > 0
      ? stmt.all(...params as any) as T[]
      : stmt.all() as T[]);
    return Object.freeze(rows);
  }

  /**
   * Begin an explicit transaction.
   */
  async beginTransaction(): Promise<void> {
    this.assertOpen();
    this.db!.exec('BEGIN TRANSACTION;');
    this.inTransaction = true;
  }

  /**
   * Commit the current transaction.
   */
  async commitTransaction(): Promise<void> {
    this.assertOpen();
    if (!this.inTransaction) {
      throw new Error('Cannot commit: no active transaction');
    }
    this.db!.exec('COMMIT;');
    this.inTransaction = false;
  }

  /**
   * Roll back the current transaction.
   */
  async rollbackTransaction(): Promise<void> {
    this.assertOpen();
    if (!this.inTransaction) {
      throw new Error('Cannot rollback: no active transaction');
    }
    this.db!.exec('ROLLBACK;');
    this.inTransaction = false;
  }

  /**
   * Run `PRAGMA integrity_check` and report whether the database is healthy.
   *
   * A malformed image causes the check to throw (`SQLITE_CORRUPT`); that is
   * treated as an integrity failure rather than propagated, so callers can
   * branch into recovery without a try/catch of their own.
   */
  async checkIntegrity(): Promise<boolean> {
    this.assertOpen();
    try {
      const rows = this.db!.prepare('PRAGMA integrity_check;').all() as Array<{
        integrity_check?: unknown;
      }>;
      return rows.length === 1 && String(rows[0]?.integrity_check) === 'ok';
    } catch {
      // A corrupted database image throws here; report it as unhealthy.
      return false;
    }
  }

  /**
   * Checkpoint WAL and copy the database file to `<path>.bak.<timestamp>`,
   * producing a self-contained snapshot of the current committed state.
   * Returns the backup file path.
   */
  async backup(): Promise<string> {
    const dbPath = this.getPath();
    if (!dbPath) {
      throw new Error('Cannot back up: database is not open.');
    }
    // Flush any WAL pages into the main file so the copy is self-contained.
    try {
      this.db?.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    } catch {
      // Not in WAL mode or checkpoint unsupported; the plain copy still works.
    }
    const backupPath = `${dbPath}.bak.${Date.now()}`;
    fs.copyFileSync(dbPath, backupPath);
    return backupPath;
  }

  /**
   * Recover a corrupted database by restoring the most recent
   * `<path>.bak.*` backup. Closes the (possibly corrupt) connection, removes
   * stale WAL/SHM sidecars, replaces the main file with the backup, reopens,
   * and re-runs the integrity check.
   *
   * Returns `true` when a backup was found and the restored database passes
   * the integrity check; `false` when no backup is available to restore.
   */
  async recoverFromBackup(): Promise<boolean> {
    const config = this.config;
    if (!config) {
      throw new Error('Cannot recover: database path is unknown (never opened).');
    }
    const dbPath = config.path;
    const dir = path.dirname(dbPath);
    const base = path.basename(dbPath);
    const backups = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith(`${base}.bak.`))
      .sort(); // fixed-width millisecond suffixes sort lexically == chronologically
    if (backups.length === 0) {
      return false;
    }
    const latest = path.join(dir, backups[backups.length - 1]);

    // Drop the corrupt connection before touching files on disk.
    try {
      this.db?.close();
    } catch {
      // Closing a connection over a malformed image is best-effort.
    }
    this.db = null;
    this.inTransaction = false;
    for (const sidecar of ['-wal', '-shm']) {
      const sidecarPath = `${dbPath}${sidecar}`;
      if (fs.existsSync(sidecarPath)) {
        fs.rmSync(sidecarPath);
      }
    }
    fs.copyFileSync(latest, dbPath);
    await this.open(config);
    return this.checkIntegrity();
  }

  private assertOpen(): void {
    if (!this.db) {
      throw new Error('Database is not open. Call open() before using the adapter.');
    }
  }
}
