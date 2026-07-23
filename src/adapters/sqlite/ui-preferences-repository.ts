import type { SqliteDatabaseAdapter } from './database-adapter.js';
import type {
  UIPreferenceEntry,
  UIPreferencesRepository,
} from './ports.js';

/**
 * SQLite-backed UI preferences repository.
 *
 * Implements `UIPreferencesRepository` using parameterized SQL.
 *
 * Authority mapping: operator-local source-of-truth for UI settings.
 * Maps to TASK-2294 domain: operator-local cache (board projections).
 */
export class SqliteUIPreferencesRepository implements UIPreferencesRepository {
  private db: SqliteDatabaseAdapter;

  constructor(db: SqliteDatabaseAdapter) {
    this.db = db;
  }

  async findAll(): Promise<readonly UIPreferenceEntry[]> {
    const rows = await this.db.query<{
      key: unknown;
      value: unknown;
      updated_at: unknown;
    }>('SELECT key, value, updated_at FROM ui_preferences ORDER BY key ASC');

    return rows.map((row) => ({
      key: String(row.key),
      value: String(row.value),
      updatedAt: String(row.updated_at),
    }));
  }

  async findByKey(key: string): Promise<UIPreferenceEntry | undefined> {
    const rows = await this.db.query<{
      key: unknown;
      value: unknown;
      updated_at: unknown;
    }>(
      'SELECT key, value, updated_at FROM ui_preferences WHERE key = ?;',
      [key],
    );

    if (rows.length === 0) {
      return undefined;
    }

    const row = rows[0];
    return {
      key: String(row.key),
      value: String(row.value),
      updatedAt: String(row.updated_at),
    };
  }

  async save(entry: UIPreferenceEntry): Promise<void> {
    await this.db.execute(
      `INSERT INTO ui_preferences (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at;`,
      [entry.key, entry.value, entry.updatedAt],
    );
  }

  async deleteByKey(key: string): Promise<void> {
    await this.db.execute(
      'DELETE FROM ui_preferences WHERE key = ?;',
      [key],
    );
  }

  async clear(): Promise<void> {
    await this.db.execute('DELETE FROM ui_preferences;');
  }
}
