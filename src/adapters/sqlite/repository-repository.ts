import type { SqliteDatabaseAdapter } from './database-adapter.js';
import type {
  KnownRepositoryEntry,
  KnownRepositoriesRepository,
} from './ports.js';

/**
 * SQLite-backed known repositories repository.
 *
 * Implements `KnownRepositoriesRepository` using parameterized SQL.
 *
 * Authority mapping: operator-local cache. Repository identity is ultimately
 * owned by the target repository (Git). Each stored field maps to:
 * - `id`: operator-local cache (derived from repository path)
 * - `path`: operator-local cache (filesystem observation)
 * - `last_accessed`: operator-local cache (runtime timestamp)
 *
 * Maps to TASK-2294 domain entity: `KnownRepository` in `src/domain/repository.ts`.
 */
export class SqliteKnownRepositoriesRepository implements KnownRepositoriesRepository {
  private db: SqliteDatabaseAdapter;

  constructor(db: SqliteDatabaseAdapter) {
    this.db = db;
  }

  async findAll(): Promise<readonly KnownRepositoryEntry[]> {
    const rows = await this.db.query<{
      id: unknown;
      path: unknown;
      last_accessed: unknown;
    }>('SELECT id, path, last_accessed FROM known_repositories ORDER BY last_accessed DESC');

    return rows.map((row) => ({
      id: String(row.id),
      path: String(row.path),
      lastAccessed: String(row.last_accessed),
    }));
  }

  async findById(id: string): Promise<KnownRepositoryEntry | undefined> {
    const rows = await this.db.query<{
      id: unknown;
      path: unknown;
      last_accessed: unknown;
    }>(
      'SELECT id, path, last_accessed FROM known_repositories WHERE id = ?;',
      [id],
    );

    if (rows.length === 0) {
      return undefined;
    }

    const row = rows[0];
    return {
      id: String(row.id),
      path: String(row.path),
      lastAccessed: String(row.last_accessed),
    };
  }

  async save(entry: KnownRepositoryEntry): Promise<void> {
    await this.db.execute(
      `INSERT INTO known_repositories (id, path, last_accessed)
       VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         path = excluded.path,
         last_accessed = excluded.last_accessed;`,
      [entry.id, entry.path, entry.lastAccessed],
    );
  }

  async deleteById(id: string): Promise<void> {
    await this.db.execute(
      'DELETE FROM known_repositories WHERE id = ?;',
      [id],
    );
  }

  async clear(): Promise<void> {
    await this.db.execute('DELETE FROM known_repositories;');
  }
}
