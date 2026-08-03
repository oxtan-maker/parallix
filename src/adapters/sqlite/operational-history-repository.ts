import type { SqliteDatabaseAdapter } from './database-adapter.js';
import type { OperationalHistoryEntry, OperationalHistoryRepository } from '../../application/ports/operation-history.js';

/**
 * SQLite-backed operational history repository.
 *
 * Implements `OperationalHistoryRepository` using parameterized SQL.
 *
 * Authority mapping: operator-local source-of-truth for operational events.
 * Maps to TASK-2294 domain: local operational history.
 */
export class SqliteOperationalHistoryRepository implements OperationalHistoryRepository {
  private db: SqliteDatabaseAdapter;

  constructor(db: SqliteDatabaseAdapter) {
    this.db = db;
  }

  async findAll(): Promise<readonly OperationalHistoryEntry[]> {
    const rows = await this.db.query<{
      id: unknown;
      event_type: unknown;
      event_data: unknown;
      created_at: unknown;
    }>('SELECT id, event_type, event_data, created_at FROM operational_history ORDER BY id ASC');

    return rows.map((row) => ({
      id: Number(row.id),
      eventType: String(row.event_type),
      eventData: String(row.event_data),
      createdAt: String(row.created_at),
    }));
  }

  async findByType(type: string): Promise<readonly OperationalHistoryEntry[]> {
    const rows = await this.db.query<{
      id: unknown;
      event_type: unknown;
      event_data: unknown;
      created_at: unknown;
    }>(
      'SELECT id, event_type, event_data, created_at FROM operational_history WHERE event_type = ? ORDER BY id ASC;',
      [type],
    );

    return rows.map((row) => ({
      id: Number(row.id),
      eventType: String(row.event_type),
      eventData: String(row.event_data),
      createdAt: String(row.created_at),
    }));
  }

  async append(entry: OperationalHistoryEntry): Promise<void> {
    await this.db.execute(
      'INSERT INTO operational_history (event_type, event_data, created_at) VALUES (?, ?, ?);',
      [entry.eventType, entry.eventData, entry.createdAt],
    );
  }

  async clear(): Promise<void> {
    await this.db.execute('DELETE FROM operational_history;');
  }
}
