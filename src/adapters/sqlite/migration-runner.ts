import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Migration, MigrationLedgerEntry } from './database-adapter.js';
import { SqliteDatabaseAdapter } from './database-adapter.js';

/**
 * Ordered, forward-only migration runner with immutable checksums.
 *
 * Migrations are applied in the order they are provided. Each migration has
 * a stable identifier and a SHA-256 checksum of its `up` SQL content.
 * A checksum mismatch for an already-applied migration fails closed — the
 * adapter will not proceed with state changes.
 *
 * The migration ledger is stored in a `schema_migrations` table with columns:
 * - `id` TEXT PRIMARY KEY — ordered immutable migration identifier
 * - `checksum` TEXT NOT NULL — SHA-256 of the migration SQL
 * - `applied_at` TEXT NOT NULL — ISO timestamp of application
 *
 * Pre-migration backup: before applying an irreversible migration (one without
 * a `down` SQL), a backup copy of the database file is created. This allows
 * recovery if the migration fails or corrupts the database.
 */
export class SqliteMigrationRunner {
  private db: SqliteDatabaseAdapter;

  constructor(db: SqliteDatabaseAdapter) {
    this.db = db;
  }

  /**
   * Compute the SHA-256 checksum of migration SQL content.
   */
  static computeChecksum(sql: string): string {
    return crypto.createHash('sha256').update(sql).digest('hex');
  }

  /**
   * Return all applied migrations from the ledger.
   */
  async getAppliedMigrations(): Promise<readonly MigrationLedgerEntry[]> {
    try {
      const rows = await this.db.query<Record<string, unknown>>(
        'SELECT id, checksum, applied_at FROM schema_migrations ORDER BY id ASC',
      );
      return rows.map((row) => ({
        id: String(row.id),
        checksum: String(row.checksum),
        appliedAt: String(row.applied_at),
      }));
    } catch {
      // Ledger table does not exist yet (fresh database before migrations).
      return [];
    }
  }

  /**
   * Apply pending migrations in order.
   * Fails if a previously applied migration's checksum does not match.
   */
  async applyPending(
    migrations: readonly Migration[],
  ): Promise<readonly MigrationLedgerEntry[]> {
    const applied = await this.getAppliedMigrations();
    const appliedMap = new Map<string, MigrationLedgerEntry>();
    for (const entry of applied) {
      appliedMap.set(entry.id, entry);
    }

    // Verify checksums of already-applied migrations.
    for (const migration of migrations) {
      const existing = appliedMap.get(migration.id);
      if (existing) {
        if (existing.checksum !== migration.checksum) {
          throw new Error(
            `Checksum mismatch for migration ${migration.id}: ` +
              `expected ${migration.checksum}, found ${existing.checksum}. ` +
              'Migration file may have been modified after application.',
          );
        }
      }
    }

    // Determine pending migrations (not yet applied).
    const pending = migrations.filter((m) => !appliedMap.has(m.id));

    if (pending.length === 0) {
      return applied;
    }

    // Apply each pending migration in its own transaction.
    const newEntries: MigrationLedgerEntry[] = [];
    for (const migration of pending) {
      await this.applyMigration(migration);
      newEntries.push({
        id: migration.id,
        checksum: migration.checksum,
        appliedAt: new Date().toISOString(),
      });
    }

    return [...applied, ...newEntries];
  }

  /**
   * Return the current schema version (highest applied migration ID), or `null`.
   */
  async getCurrentVersion(): Promise<string | null> {
    const applied = await this.getAppliedMigrations();
    if (applied.length === 0) {
      return null;
    }
    return applied[applied.length - 1].id;
  }

  private async applyMigration(migration: Migration): Promise<void> {
    // For irreversible migrations, create a pre-migration database backup so a
    // failed or corrupting migration can be recovered from a known-good copy.
    const dbPath = this.db.getPath();
    if (dbPath && !migration.down) {
      await this.db.backup();
    }

    await this.db.beginTransaction();
    try {
      // Execute the migration SQL
      await this.db.execute(migration.up);

      // Record in the ledger (table created by 0001 migration or ensured here)
      await this.db.execute(
        `INSERT INTO schema_migrations (id, checksum, applied_at) VALUES (?, ?, ?);`,
        [migration.id, migration.checksum, new Date().toISOString()],
      );

      await this.db.commitTransaction();
    } catch (error) {
      await this.db.rollbackTransaction();
      throw new Error(
        `Migration ${migration.id} failed and was rolled back: ` +
          (migration.down ? 'reversible' : 'irreversible') +
          ` — ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

}

/**
 * Load the default migration SQL files from the migrations directory.
 *
 * Migrations are normally loaded in alphabetical order. The SessionMarker
 * table creation is an explicit prerequisite of repository scoping: the two
 * immutable migrations acquired their current identifiers on separate mission
 * branches, so lexical order alone would run the scoping migration first on a
 * fresh database.
 */
export function loadDefaultMigrations(): readonly Migration[] {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const migrationsDir = path.resolve(__dirname, 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    return [];
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const sessionMarkerBase = '0006-session-markers.sql';
  const repositoryScope = '0005-repository-scoped-session-markers.sql';
  const baseIndex = files.indexOf(sessionMarkerBase);
  const scopeIndex = files.indexOf(repositoryScope);
  if (baseIndex > scopeIndex && scopeIndex !== -1) {
    files.splice(baseIndex, 1);
    files.splice(scopeIndex, 0, sessionMarkerBase);
  }

  return files.map((file) => {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const id = path.basename(file, '.sql');
    const checksum = SqliteMigrationRunner.computeChecksum(sql);
    return { id, checksum, up: sql };
  });
}
