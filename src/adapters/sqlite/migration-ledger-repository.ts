import type { SqliteDatabaseAdapter } from './database-adapter.js';
import type { MigrationLedgerEntry, MigrationLedgerRepository } from './ports.js';

/**
 * SQLite-backed migration ledger repository.
 *
 * Implements `MigrationLedgerRepository` using parameterized SQL.
 *
 * Authority mapping: operator-local source-of-truth for migration metadata.
 * Maps to architecture migration domain: migration metadata.
 */
export class SqliteMigrationLedgerRepository implements MigrationLedgerRepository {
  private db: SqliteDatabaseAdapter;

  constructor(db: SqliteDatabaseAdapter) {
    this.db = db;
  }

  async findAll(): Promise<readonly MigrationLedgerEntry[]> {
    const rows = await this.db.query<{
      id: unknown;
      checksum: unknown;
      applied_at: unknown;
    }>('SELECT id, checksum, applied_at FROM schema_migrations ORDER BY id ASC');

    return rows.map((row) => ({
      id: String(row.id),
      checksum: String(row.checksum),
      appliedAt: String(row.applied_at),
    }));
  }

  async findById(id: string): Promise<MigrationLedgerEntry | undefined> {
    const rows = await this.db.query<{
      id: unknown;
      checksum: unknown;
      applied_at: unknown;
    }>(
      'SELECT id, checksum, applied_at FROM schema_migrations WHERE id = ?;',
      [id],
    );

    if (rows.length === 0) {
      return undefined;
    }

    const row = rows[0];
    return {
      id: String(row.id),
      checksum: String(row.checksum),
      appliedAt: String(row.applied_at),
    };
  }
}
