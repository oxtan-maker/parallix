import type { SqliteDatabaseAdapter } from './database-adapter.js';
import { parseInstantMs, toCanonicalUtcInstant } from '../../domain/instant.js';
import type { BoardLaneEventEntry, BoardLaneEventRepository } from '../../application/ports/operation-history.js';

/**
 * SQLite-backed board lane-event repository.
 *
 * Stores `occurred_at` as the canonical UTC ISO-8601 instant (TASK-2688): a
 * single storage-boundary normalization keeps the column on one fixed-width
 * spelling, so `ORDER BY occurred_at` stays lexically == temporally ordered
 * regardless of the spelling a writer supplied.
 *
 * Implements `BoardLaneEventRepository` using parameterized SQL over the
 * dedicated `board_lane_events` table (migration 0003). Follows the same
 * analytical pattern as `usage_statistics` — typed columns, proper indexes,
 * no JSON encoding.
 *
 * Authority mapping: operator-local event history (ADR 0053).
 * Maps to architecture migration domain: `LaneTransitionEvent` in `src/domain/board-event.ts`.
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
          (repository_id, mission_id, from_status, to_status, trigger, agent, occurred_at, idempotency_key)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          entry.repositoryId,
          entry.missionId,
          entry.fromStatus ?? null,
          entry.toStatus,
          entry.trigger,
          entry.agent,
          toCanonicalUtcInstant(entry.occurredAt),
          entry.idempotencyKey,
        ],
      );
      return true;
    } catch (error: unknown) {
      // SQLite exposes uniqueness only through its driver diagnostic. This is
      // adapter-owned parsing; callers receive the boolean port result.
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('UNIQUE constraint failed')) {
        return false;
      }
      throw error;
    }
  }

  async findMissionIdByIdempotencyKey(repositoryId: string, key: string): Promise<string | null> {
    const rows = await this.db.query<{ mission_id: unknown }>(
      'SELECT mission_id FROM board_lane_events WHERE repository_id = ? AND idempotency_key = ? LIMIT 1;',
      [repositoryId, key],
    );
    return rows.length === 0 ? null : String(rows[0].mission_id);
  }

  async findByMissionId(missionId: string): Promise<readonly BoardLaneEventEntry[]> {
    const rows = await this.db.query<{
      id: unknown;
      repository_id: unknown;
      mission_id: unknown;
      from_status: unknown;
      to_status: unknown;
      trigger: unknown;
      agent: unknown;
      occurred_at: unknown;
      idempotency_key: unknown;
    }>(
      `SELECT id, repository_id, mission_id, from_status, to_status, trigger, agent, occurred_at, idempotency_key
       FROM board_lane_events
       WHERE mission_id = ?
       ORDER BY occurred_at ASC;`,
      [missionId],
    );

    return rows.map((row) => rowToEntry(row)).sort(compareEntries);
  }

  async findAll(): Promise<readonly BoardLaneEventEntry[]> {
    const rows = await this.db.query<{
      id: unknown;
      repository_id: unknown;
      mission_id: unknown;
      from_status: unknown;
      to_status: unknown;
      trigger: unknown;
      agent: unknown;
      occurred_at: unknown;
      idempotency_key: unknown;
    }>(
      `SELECT id, repository_id, mission_id, from_status, to_status, trigger, agent, occurred_at, idempotency_key
       FROM board_lane_events
       ORDER BY occurred_at ASC;`,
    );

    return rows.map((row) => rowToEntry(row)).sort(compareEntries);
  }

  async findByRepositoryId(repositoryId: string): Promise<readonly BoardLaneEventEntry[]> {
    const rows = await this.db.query<{
      id: unknown;
      repository_id: unknown;
      mission_id: unknown;
      from_status: unknown;
      to_status: unknown;
      trigger: unknown;
      agent: unknown;
      occurred_at: unknown;
      idempotency_key: unknown;
    }>(
      `SELECT id, repository_id, mission_id, from_status, to_status, trigger, agent, occurred_at, idempotency_key
       FROM board_lane_events
       WHERE repository_id = ?
       ORDER BY occurred_at ASC;`,
      [repositoryId],
    );

    return rows.map((row) => rowToEntry(row)).sort(compareEntries);
  }

  async clear(): Promise<void> {
    await this.db.execute('DELETE FROM board_lane_events;');
  }
}

function rowToEntry(row: Record<string, unknown>): BoardLaneEventEntry {
  return {
    id: Number(row.id),
    repositoryId: String(row.repository_id),
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

function compareEntries(left: BoardLaneEventEntry, right: BoardLaneEventEntry): number {
  const a = parseInstantMs(left.occurredAt);
  const b = parseInstantMs(right.occurredAt);
  return (Number.isFinite(a) ? a : Infinity) - (Number.isFinite(b) ? b : Infinity)
    || (left.id ?? 0) - (right.id ?? 0);
}
