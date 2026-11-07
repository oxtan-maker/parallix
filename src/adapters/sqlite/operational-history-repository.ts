import { authorizedOperationId } from '../../application/ports/mission-write-authorization.js';
import { authorizeSqliteMissionWrite } from './workflow-write-guard.js';
import type { SqliteDatabaseAdapter } from './database-adapter.js';
import type { OperationLogSummary, OperationalHistoryEntry, OperationalHistoryRepository,
  ReboundRepairHistoryEntry } from '../../application/ports/operation-history.js';

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

  async findByTypes(types: readonly string[]): Promise<readonly OperationalHistoryEntry[]> {
    if (types.length === 0) { return []; }
    const rows = await this.db.query<{ id: unknown; event_type: unknown; event_data: unknown; created_at: unknown }>(
      `SELECT id, event_type, event_data, created_at FROM operational_history
       WHERE event_type IN (${types.map(() => '?').join(',')}) ORDER BY id ASC`, types);
    return rows.map(row => ({ id: Number(row.id), eventType: String(row.event_type),
      eventData: String(row.event_data), createdAt: String(row.created_at) }));
  }

  async findEarliestForMissions(missionIds: readonly string[], repositoryId: string): Promise<readonly OperationalHistoryEntry[]> {
    if (missionIds.length === 0) { return []; }
    const rows = await this.db.query<{ mission_id: unknown; created_at: unknown }>(
      `SELECT json_extract(event_data, '$.missionId') AS mission_id, MIN(created_at) AS created_at
       FROM operational_history
       WHERE json_valid(event_data)
         AND json_extract(event_data, '$.repositoryId') = ?
         AND json_extract(event_data, '$.missionId') IN (${missionIds.map(() => '?').join(',')})
       GROUP BY json_extract(event_data, '$.missionId')`, [repositoryId, ...missionIds]);
    return rows.map((row, index) => ({ id: index, eventType: 'mission.first-observation',
      eventData: JSON.stringify({ repositoryId, missionId: String(row.mission_id) }), createdAt: String(row.created_at) }));
  }

  async findReboundRepairs(): Promise<readonly ReboundRepairHistoryEntry[]> {
    const rows = await this.db.query<{ mission_id: unknown; occurrence_id: unknown; reason_kind: unknown;
      area: unknown; agent: unknown; duration_ms: unknown; created_at: unknown }>(
      `SELECT json_extract(event_data, '$.missionId') AS mission_id,
              json_extract(event_data, '$.occurrenceId') AS occurrence_id,
              json_extract(event_data, '$.reasonKind') AS reason_kind,
              json_extract(event_data, '$.area') AS area,
              json_extract(event_data, '$.agent') AS agent,
              json_extract(event_data, '$.durationMs') AS duration_ms,
              created_at
       FROM operational_history
       WHERE event_type = 'rebound.repair' AND json_valid(event_data)
         AND json_extract(event_data, '$.missionId') IS NOT NULL
         AND json_extract(event_data, '$.occurrenceId') IS NOT NULL
       ORDER BY created_at`);
    return rows.map(row => ({ missionId: String(row.mission_id), occurrenceId: String(row.occurrence_id),
      reasonKind: String(row.reason_kind ?? ''), area: typeof row.area === 'string' ? row.area : null,
      agent: String(row.agent ?? ''), durationMs: typeof row.duration_ms === 'number' && Number.isFinite(row.duration_ms)
        ? Math.max(0, row.duration_ms) : null, occurredAt: String(row.created_at) }));
  }

  async findRecentLogEntries(limit: number): Promise<readonly OperationLogSummary[]> {
    const rows = await this.db.query<{
      id: unknown;
      event_type: unknown;
      created_at: unknown;
      message: unknown;
      agent: unknown;
      raw_data: unknown;
      operation_id: unknown;
      sequence: unknown;
    }>(
      `SELECT id, event_type, created_at,
              CASE WHEN is_object THEN json_extract(event_data, '$.message') END AS message,
              CASE WHEN is_object THEN json_extract(event_data, '$.agent') END AS agent,
              CASE WHEN is_object THEN json_extract(event_data, '$.operationId') END AS operation_id,
              CASE WHEN is_object THEN json_extract(event_data, '$.sequence') END AS sequence,
              CASE WHEN is_object THEN NULL ELSE event_data END AS raw_data
       FROM (
         SELECT id, event_type, created_at, event_data,
                CASE WHEN json_valid(event_data) THEN json_type(event_data) = 'object' ELSE 0 END AS is_object
         FROM (SELECT id, event_type, event_data, created_at FROM operational_history ORDER BY id DESC LIMIT ?)
       ) ORDER BY id ASC`,
      [limit],
    );

    return rows.map((row) => ({
      id: Number(row.id),
      eventType: String(row.event_type),
      createdAt: String(row.created_at),
      message: typeof row.message === 'string' ? row.message : null,
      agent: typeof row.agent === 'string' ? row.agent : null,
      ...(typeof row.operation_id === 'string' && typeof row.sequence === 'number' && Number.isFinite(row.sequence) ? { operationId: row.operation_id, sequence: row.sequence } : {}),
      rawData: row.raw_data === null || row.raw_data === undefined ? null : String(row.raw_data),
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

  async append(entry: OperationalHistoryEntry): Promise<void> {
    if (!authorizedOperationId()) {
      await this.db.execute(
        'INSERT INTO operational_history (event_type, event_data, created_at) VALUES (?, ?, ?);',
        [entry.eventType, entry.eventData, entry.createdAt],
      );
      return;
    }
    const data = JSON.parse(entry.eventData) as { missionId?: string };
    await this.db.beginWriteTransaction();
    try {
      if (data.missionId) { await authorizeSqliteMissionWrite(this.db, data.missionId); }
      await this.db.execute(
        'INSERT INTO operational_history (event_type, event_data, created_at) VALUES (?, ?, ?);',
        [entry.eventType, entry.eventData, entry.createdAt],
      );
      await this.db.commitTransaction();
    } catch (error) { await this.db.rollbackTransaction(); throw error; }
  }

  async clear(): Promise<void> {
    await this.db.execute('DELETE FROM operational_history;');
  }
}
