import type { SqliteDatabaseAdapter } from './database-adapter.js';
import type { OperationalHistoryEntry, OperationalHistoryRepository } from '../../application/ports/operation-history.js';

/**
 * SQLite-backed operational history repository.
 *
 * Implements `OperationalHistoryRepository` using parameterized SQL.
 *
 * Authority mapping: operator-local source-of-truth for operational events.
 * Maps to architecture migration domain: local operational history.
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

  async findByTypeForMission(type: string, missionId: string): Promise<readonly OperationalHistoryEntry[]> {
    const rows = await this.db.query<{
      id: unknown;
      event_type: unknown;
      event_data: unknown;
      created_at: unknown;
    }>(
      `SELECT id, event_type, event_data, created_at FROM operational_history
       WHERE event_type = ? AND json_extract(event_data, '$.missionId') = ? ORDER BY id ASC;`,
      [type, missionId],
    );

    return rows.map((row) => ({
      id: Number(row.id),
      eventType: String(row.event_type),
      eventData: String(row.event_data),
      createdAt: String(row.created_at),
    }));
  }

  /**
   * Serves `ConcreteCurrentWorkReadAdapter.loadCurrentWork`: retain the newest
   * two facts so reconciliation can reject a late terminal event for an older
   * operation without reading the full audit history.
   */
  async findLatestByTypePerMission(type: string, limitPerMission: number): Promise<readonly OperationalHistoryEntry[]> {
    const rows = await this.db.query<{ id: unknown; event_type: unknown; event_data: unknown; created_at: unknown }>(
      `SELECT id, event_type, event_data, created_at FROM (
        SELECT id, event_type, event_data, created_at,
          ROW_NUMBER() OVER (PARTITION BY json_extract(event_data, '$.missionId') ORDER BY id DESC) AS position
        FROM operational_history WHERE event_type = ?
      ) WHERE position <= ? ORDER BY id ASC;`,
      [type, limitPerMission],
    );
    return rows.map((row) => ({ id: Number(row.id), eventType: String(row.event_type), eventData: String(row.event_data), createdAt: String(row.created_at) }));
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
