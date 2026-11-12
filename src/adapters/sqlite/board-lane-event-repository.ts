import type { SqliteDatabaseAdapter } from './database-adapter.js';
import { parseInstantMs, toCanonicalUtcInstant } from '../../domain/instant.js';
import type { BoardLaneEventEntry, BoardLaneEventRepository } from '../../application/ports/operation-history.js';
import { parseWorkflowReturnIdentity } from '../../domain/board-event.js';

const BOARD_LANE_EVENT_COLUMNS = `id, repository_id, mission_id, from_status, to_status,
  trigger, agent, occurred_at, idempotency_key, return_stage, workflow_operation_id, workflow_generation`;

interface BoardLaneEventRow {
  readonly id: unknown;
  readonly repository_id: unknown;
  readonly mission_id: unknown;
  readonly from_status: unknown;
  readonly to_status: unknown;
  readonly trigger: unknown;
  readonly agent: unknown;
  readonly occurred_at: unknown;
  readonly idempotency_key: unknown;
  readonly return_stage: unknown;
  readonly workflow_operation_id: unknown;
  readonly workflow_generation: unknown;
}

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
          (repository_id, mission_id, from_status, to_status, trigger, agent, occurred_at, idempotency_key,
           return_stage, workflow_operation_id, workflow_generation)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          entry.repositoryId,
          entry.missionId,
          entry.fromStatus ?? null,
          entry.toStatus,
          entry.trigger,
          entry.agent,
          toCanonicalUtcInstant(entry.occurredAt),
          entry.idempotencyKey,
          entry.returnIdentity?.stage ?? null,
          entry.returnIdentity?.operationId ?? null,
          entry.returnIdentity?.operationGeneration ?? null,
        ],
      );
      return true;
    } catch (error: unknown) {
      if ((error as { errcode?: number })?.errcode === 2067) { return false; }
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
    return collapseHistoricalDuplicateTransitions(await this.findPersistedByMissionId(missionId));
  }

  /** Exact persisted history for write-path replay and recovery decisions. */
  async findPersistedByMissionId(missionId: string): Promise<readonly BoardLaneEventEntry[]> {
    const rows = await this.db.query<BoardLaneEventRow>(
      `SELECT ${BOARD_LANE_EVENT_COLUMNS}
       FROM board_lane_events
       WHERE mission_id = ?
       ORDER BY occurred_at ASC;`,
      [missionId],
    );

    return rows.map((row) => rowToEntry(row)).sort(compareEntries);
  }

  async findAll(): Promise<readonly BoardLaneEventEntry[]> {
    const rows = await this.db.query<BoardLaneEventRow>(
      `SELECT ${BOARD_LANE_EVENT_COLUMNS}
       FROM board_lane_events
       ORDER BY occurred_at ASC;`,
    );

    return collapseHistoricalDuplicateTransitions(rows.map((row) => rowToEntry(row)).sort(compareEntries));
  }

  async findByRepositoryId(repositoryId: string): Promise<readonly BoardLaneEventEntry[]> {
    const rows = await this.db.query<BoardLaneEventRow>(
      `SELECT ${BOARD_LANE_EVENT_COLUMNS}
       FROM board_lane_events
       WHERE repository_id = ?
       ORDER BY occurred_at ASC;`,
      [repositoryId],
    );

    return collapseHistoricalDuplicateTransitions(rows.map((row) => rowToEntry(row)).sort(compareEntries));
  }

  async clear(): Promise<void> {
    await this.db.execute('DELETE FROM board_lane_events;');
  }
}

function rowToEntry(row: BoardLaneEventRow): BoardLaneEventEntry {
  const retainedReturn = { stage: row.return_stage, operationId: row.workflow_operation_id,
    operationGeneration: row.workflow_generation };
  const returnIdentity = parseWorkflowReturnIdentity(retainedReturn);
  const hasReturnIdentity = Object.values(retainedReturn).some(value => value !== null && value !== undefined);
  const repositoryId = String(row.repository_id), missionId = String(row.mission_id);
  const idempotencyKey = String(row.idempotency_key);
  return {
    id: Number(row.id),
    repositoryId,
    missionId,
    fromStatus: row.from_status === null || row.from_status === undefined
      ? null
      : String(row.from_status),
    toStatus: String(row.to_status),
    trigger: String(row.trigger),
    agent: String(row.agent),
    occurredAt: String(row.occurred_at),
    idempotencyKey,
    ...(returnIdentity ? { returnIdentity } : {}),
    ...(hasReturnIdentity && !returnIdentity ? { returnIdentityDefect:
      `Workflow return identity invalid for ${repositoryId}/${missionId} lane event ${idempotencyKey}` } : {}),
  };
}

function compareEntries(left: BoardLaneEventEntry, right: BoardLaneEventEntry): number {
  const a = parseInstantMs(left.occurredAt);
  const b = parseInstantMs(right.occurredAt);
  return (Number.isFinite(a) ? a : Infinity) - (Number.isFinite(b) ? b : Infinity)
    || (left.id ?? 0) - (right.id ?? 0);
}

const HISTORICAL_PAIR_WINDOW_MS = 5_000;

function transitionSignature(entry: BoardLaneEventEntry): string {
  return JSON.stringify([
    entry.repositoryId, entry.missionId, entry.fromStatus, entry.toStatus, entry.trigger,
  ]);
}

function isHistoricalPair(
  entries: readonly BoardLaneEventEntry[],
  earlierIndex: number,
  laterIndex: number,
): boolean {
  const left = entries[earlierIndex]!;
  const right = entries[laterIndex]!;
  const leftAt = parseInstantMs(left.occurredAt);
  const rightAt = parseInstantMs(right.occurredAt);
  const fieldsMatch = left.repositoryId === right.repositoryId
    && left.missionId === right.missionId
    && left.fromStatus === right.fromStatus
    && left.toStatus === right.toStatus
    && left.trigger === right.trigger
    && Number.isFinite(leftAt)
    && Number.isFinite(rightAt)
    && Math.abs(leftAt - rightAt) <= HISTORICAL_PAIR_WINDOW_MS;
  if (!fieldsMatch || right.fromStatus === null) { return fieldsMatch; }
  return !entries.slice(earlierIndex + 1, laterIndex).some((between) =>
    between.repositoryId === right.repositoryId
    && between.missionId === right.missionId
    && between.toStatus === right.fromStatus);
}

/** Collapse duplicate lifecycle facts on reads only; persisted rows stay untouched. */
function collapseHistoricalDuplicateTransitions(entries: readonly BoardLaneEventEntry[]): BoardLaneEventEntry[] {
  const earlierByTransition = new Map<string, number[]>();
  const removed = new Set<number>();
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]!;
    const signature = transitionSignature(entry);
    const candidates = earlierByTransition.get(signature) ?? [];
    if (candidates.findLast((candidate) => isHistoricalPair(entries, candidate, index)) !== undefined) {
      removed.add(index);
      continue;
    }
    candidates.push(index);
    earlierByTransition.set(signature, candidates);
  }
  return entries.filter((_entry, index) => !removed.has(index));
}
