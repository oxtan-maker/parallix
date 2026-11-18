import { authorizedOperationId } from '../../application/ports/mission-write-authorization.js';
import { authorizeSqliteMissionWrite } from './workflow-write-guard.js';
import type { SqliteDatabaseAdapter } from './database-adapter.js';
import { parseReboundRepairHistoryEntry, type OperationLogSummary, type OperationalHistoryEntry,
  type OperationalHistoryRepository, type ReboundRepairHistoryEntry } from '../../application/ports/operation-history.js';

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

  async findByTypesForMissions(types: readonly string[], missionIds: readonly string[], repositoryId: string): Promise<readonly OperationalHistoryEntry[]> {
    if (types.length === 0 || missionIds.length === 0) { return []; }
    const rows = await this.db.query<{ id: unknown; event_type: unknown; event_data: unknown; created_at: unknown }>(
      `SELECT id, event_type, event_data, created_at FROM operational_history
       WHERE event_type IN (${types.map(() => '?').join(',')})
         AND json_valid(event_data)
         AND json_extract(event_data, '$.missionId') IN (${missionIds.map(() => '?').join(',')})
         AND (json_extract(event_data, '$.repositoryId') = ?
           OR json_extract(event_data, '$.repositoryId') IS NULL)
       ORDER BY id ASC`, [...types, ...missionIds, repositoryId]);
    return rows.map(row => ({ id: Number(row.id), eventType: String(row.event_type),
      eventData: String(row.event_data), createdAt: String(row.created_at) }));
  }

  async revisionForTypes(types: readonly string[]): Promise<string> {
    if (types.length === 0) { return '0:0:'; }
    const rows = await this.db.query<{ row_count: unknown; newest_id: unknown; newest_at: unknown }>(
      `SELECT COUNT(*) AS row_count, COALESCE(MAX(id), 0) AS newest_id,
              COALESCE(MAX(created_at), '') AS newest_at
       FROM operational_history WHERE event_type IN (${types.map(() => '?').join(',')})`, types);
    const row = rows[0];
    return `${Number(row?.row_count ?? 0)}:${Number(row?.newest_id ?? 0)}:${String(row?.newest_at ?? '')}`;
  }

  async findEarliestForMissions(missionIds: readonly string[], repositoryId: string): Promise<readonly OperationalHistoryEntry[]> {
    if (missionIds.length === 0) { return []; }
    const remaining = new Set(missionIds);
    const earliest = new Map<string, string>();
    let cursor: { createdAt: string; id: number } | null = null;
    // Walk the existing chronological index and stop reading a Mission as soon
    // as its first repository-scoped row is known. A GROUP BY has to JSON-parse
    // every retained payload, including legacy repair transcripts, even though
    // the caller needs only one compact identity and timestamp per Mission. The
    // composite cursor preserves timestamp ties while ensuring each index range
    // is visited at most once.
    while (remaining.size > 0) {
      const wanted = [...remaining];
      const rows: readonly { id: unknown; mission_id: unknown; created_at: unknown }[] = await this.db.query(
        `SELECT id, json_extract(event_data, '$.missionId') AS mission_id, created_at
         FROM operational_history INDEXED BY idx_operational_history_created
         WHERE json_valid(event_data)
           AND json_extract(event_data, '$.repositoryId') = ?
           ${cursor ? 'AND (created_at, id) > (?, ?)' : ''}
           AND json_extract(event_data, '$.missionId') IN (${wanted.map(() => '?').join(',')})
         ORDER BY created_at ASC, id ASC
         LIMIT 1024`, [repositoryId, ...(cursor ? [cursor.createdAt, cursor.id] : []), ...wanted]);
      if (rows.length === 0) { break; }
      for (const row of rows) {
        const missionId = String(row.mission_id);
        if (!remaining.delete(missionId)) { continue; }
        earliest.set(missionId, String(row.created_at));
      }
      const last = rows[rows.length - 1]!;
      cursor = { createdAt: String(last.created_at), id: Number(last.id) };
    }
    return [...earliest].sort(([left], [right]) => left.localeCompare(right)).map(([missionId, createdAt], index) => ({
      id: index, eventType: 'mission.first-observation',
      eventData: JSON.stringify({ repositoryId, missionId }), createdAt,
    }));
  }

  async findReboundRepairs(): Promise<readonly ReboundRepairHistoryEntry[]> {
    const rows = await this.db.query<{ mission_id: unknown; occurrence_id: unknown; reason_kind: unknown;
      area: unknown; agent: unknown; head_before: unknown; duration_ms: unknown;
      return_identity_json: unknown; repository_id: unknown; created_at: unknown }>(
      `SELECT json_extract(event_data, '$.missionId') AS mission_id,
              json_extract(event_data, '$.occurrenceId') AS occurrence_id,
              json_extract(event_data, '$.reasonKind') AS reason_kind,
              json_extract(event_data, '$.area') AS area,
              json_extract(event_data, '$.agent') AS agent,
              json_extract(event_data, '$.headBefore') AS head_before,
              json_extract(event_data, '$.durationMs') AS duration_ms,
              json_extract(event_data, '$.returnIdentity') AS return_identity_json,
              json_extract(event_data, '$.repositoryId') AS repository_id,
              created_at
       FROM operational_history
       WHERE event_type = 'rebound.repair' AND json_valid(event_data)
         AND json_extract(event_data, '$.missionId') IS NOT NULL
         AND json_extract(event_data, '$.occurrenceId') IS NOT NULL
       ORDER BY created_at`);
    return rows.flatMap(row => {
      const parsed = parseReboundRepairHistoryEntry({ missionId: row.mission_id,
        occurrenceId: row.occurrence_id, reasonKind: row.reason_kind, area: row.area,
        agent: row.agent, headBefore: row.head_before, durationMs: row.duration_ms,
        returnIdentity: row.return_identity_json, repositoryId: row.repository_id }, String(row.created_at));
      return parsed ? [parsed] : [];
    });
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
      await this.insert(entry);
      return;
    }
    await this.db.beginWriteTransaction();
    try {
      await this.insert(entry);
      await this.db.commitTransaction();
    } catch (error) { await this.db.rollbackTransaction(); throw error; }
  }

  async appendIdempotent(entry: OperationalHistoryEntry, idempotencyKey: string): Promise<boolean> {
    await this.db.beginWriteTransaction();
    try {
      const existing = await this.db.query<{ found: unknown }>(
        `SELECT 1 AS found FROM operational_history
         WHERE event_type = ? AND json_valid(event_data)
           AND json_extract(event_data, '$.idempotencyKey') = ? LIMIT 1`,
        [entry.eventType, idempotencyKey],
      );
      if (existing.length > 0) { await this.db.commitTransaction(); return false; }
      await this.insert(entry);
      await this.db.commitTransaction();
      return true;
    } catch (error) { await this.db.rollbackTransaction(); throw error; }
  }

  private async insert(entry: OperationalHistoryEntry): Promise<void> {
    if (authorizedOperationId()) {
      const data = JSON.parse(entry.eventData) as { missionId?: string };
      if (data.missionId) { await authorizeSqliteMissionWrite(this.db, data.missionId); }
    }
    await this.db.execute(
      'INSERT INTO operational_history (event_type, event_data, created_at) VALUES (?, ?, ?);',
      [entry.eventType, entry.eventData, entry.createdAt],
    );
  }

  async clear(): Promise<void> {
    await this.db.execute('DELETE FROM operational_history;');
  }
}
