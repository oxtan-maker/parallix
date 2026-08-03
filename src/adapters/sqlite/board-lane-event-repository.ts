import type { SqliteDatabaseAdapter } from './database-adapter.js';
import type { BoardLaneEventEntry, BoardLaneEventRepository } from '../../application/ports/operation-history.js';

/**
 * SQLite-backed board lane-event repository.
 *
 * Implements `BoardLaneEventRepository` using parameterized SQL over the
 * dedicated `board_lane_events` table (migration 0003). Follows the same
 * analytical pattern as `usage_statistics` — typed columns, proper indexes,
 * no JSON encoding.
 *
 * Authority mapping: operator-local event history (ADR 0053).
 * Maps to TASK-2303 domain: `LaneTransitionEvent` in `src/domain/board-event.ts`.
 */
export class SqliteBoardLaneEventRepository implements BoardLaneEventRepository {
  private db: SqliteDatabaseAdapter;

  constructor(db: SqliteDatabaseAdapter) {
    this.db = db;
  }

  async append(entry: BoardLaneEventEntry): Promise<boolean> {
    try {
      await this.db.execute(
        `INSERT INTO board_lane_events
          (mission_id, from_status, to_status, trigger, agent, occurred_at, idempotency_key)
          VALUES (?, ?, ?, ?, ?, ?, ?);`,
        [
          entry.missionId,
          entry.fromStatus ?? null,
          entry.toStatus,
          entry.trigger,
          entry.agent,
          entry.occurredAt,
          entry.idempotencyKey,
        ],
      );
      return true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('UNIQUE constraint failed')) {
        return false;
      }
      throw error;
    }
  }

  async findByMissionId(missionId: string): Promise<readonly BoardLaneEventEntry[]> {
    const rows = await this.db.query<{
      id: unknown;
      mission_id: unknown;
      from_status: unknown;
      to_status: unknown;
      trigger: unknown;
      agent: unknown;
      occurred_at: unknown;
      idempotency_key: unknown;
    }>(
      `SELECT id, mission_id, from_status, to_status, trigger, agent, occurred_at, idempotency_key
       FROM board_lane_events
       WHERE mission_id = ?
       ORDER BY occurred_at ASC;`,
      [missionId],
    );

    return rows.map((row) => rowToEntry(row));
  }

  async findAll(): Promise<readonly BoardLaneEventEntry[]> {
    const rows = await this.db.query<{
      id: unknown;
      mission_id: unknown;
      from_status: unknown;
      to_status: unknown;
      trigger: unknown;
      agent: unknown;
      occurred_at: unknown;
      idempotency_key: unknown;
    }>(
      `SELECT id, mission_id, from_status, to_status, trigger, agent, occurred_at, idempotency_key
       FROM board_lane_events
       ORDER BY occurred_at ASC;`,
    );

    return rows.map((row) => rowToEntry(row));
  }

  async clear(): Promise<void> {
    await this.db.execute('DELETE FROM board_lane_events;');
  }
}

function rowToEntry(row: Record<string, unknown>): BoardLaneEventEntry {
  return {
    id: Number(row.id),
    missionId: String(row.mission_id),
    fromStatus: row.from_status === null || row.from_status === undefined
      ? null
      : String(row.from_status),
    toStatus: String(row.to_status),
    trigger: String(row.trigger),
    agent: String(row.agent),
    occurredAt: String(row.occurred_at),
    idempotencyKey: String(row.idempotency_key),
  };
}
