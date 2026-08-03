import type { SqliteDatabaseAdapter } from './database-adapter.js';
import type { UsageRecord, UsageRepository } from '../../application/ports/mission-measurements.js';

/**
 * SQLite-backed usage statistics repository.
 *
 * Implements `UsageRepository` using parameterized SQL and
 * explicit transactions for multi-statement writes.
 *
 * Authority mapping: each stored field is owned by operator-local authority.
 * Maps to TASK-2294 domain entities: `AgentRunMeasurement`,
 * `CompletedMissionStatistics` in `src/domain/usage.ts`.
 */
export class SqliteUsageRepository implements UsageRepository {
  private db: SqliteDatabaseAdapter;

  constructor(db: SqliteDatabaseAdapter) {
    this.db = db;
  }

  async findAll(): Promise<readonly UsageRecord[]> {
    const rows = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM usage_statistics ORDER BY id ASC',
    );
    return rows.map((row) => recordFromRow(row));
  }

  async findWhere(
    predicate: (_record: UsageRecord) => boolean,
  ): Promise<readonly UsageRecord[]> {
    const all = await this.findAll();
    return all.filter(predicate);
  }

  async save(record: UsageRecord): Promise<void> {
    await this.db.execute(
      `INSERT INTO usage_statistics (
        date, repo, mission, classification, implementer, pr_fix_rounds,
        provider, model, implementer_agent, reviewer_agent, stage,
        input_tokens, output_tokens, cached_tokens, context_tokens,
        tool_calls, openai_usage_before, openai_usage_after,
        openai_usage_delta, duration_minutes, cost_usd, closed
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        record.date ?? null,
        record.repo ?? '',
        record.mission ?? '',
        record.classification ?? null,
        record.implementer ?? null,
        record.pr_fix_rounds ?? null,
        record.provider ?? null,
        record.model ?? null,
        record.implementer_agent ?? null,
        record.reviewer_agent ?? null,
        record.stage ?? 'default',
        record.input_tokens ?? null,
        record.output_tokens ?? null,
        record.cached_tokens ?? null,
        record.context_tokens ?? null,
        record.tool_calls ?? null,
        record.openai_usage_before ?? null,
        record.openai_usage_after ?? null,
        record.openai_usage_delta ?? null,
        record.duration_minutes ?? null,
        record.cost_usd ?? null,
        record.closed ?? null,
      ],
    );
  }

  async saveAll(records: readonly UsageRecord[]): Promise<void> {
    if (records.length === 0) {
      return;
    }

    await this.db.beginTransaction();
    try {
      for (const record of records) {
        await this.save(record);
      }
      await this.db.commitTransaction();
    } catch {
      await this.db.rollbackTransaction();
      throw new Error('Failed to save usage records in batch');
    }
  }

  async clear(): Promise<void> {
    await this.db.execute('DELETE FROM usage_statistics;');
  }
}

/** SQL NULL → undefined (unavailable); otherwise coerce to a finite number. */
function num(value: unknown): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function recordFromRow(row: Record<string, unknown>): UsageRecord {
  return {
    id: row.id !== undefined && row.id !== null ? String(row.id) : undefined,
    date: row.date ? String(row.date) : undefined,
    repo: row.repo ? String(row.repo) : undefined,
    mission: row.mission ? String(row.mission) : undefined,
    classification: row.classification ? String(row.classification) : undefined,
    implementer: row.implementer ? String(row.implementer) : undefined,
    pr_fix_rounds: num(row.pr_fix_rounds),
    provider: row.provider ? String(row.provider) : undefined,
    model: row.model ? String(row.model) : undefined,
    implementer_agent: row.implementer_agent ? String(row.implementer_agent) : undefined,
    reviewer_agent: row.reviewer_agent ? String(row.reviewer_agent) : undefined,
    stage: row.stage ? String(row.stage) : undefined,
    input_tokens: num(row.input_tokens),
    output_tokens: num(row.output_tokens),
    cached_tokens: num(row.cached_tokens),
    context_tokens: num(row.context_tokens),
    tool_calls: num(row.tool_calls),
    openai_usage_before: num(row.openai_usage_before),
    openai_usage_after: num(row.openai_usage_after),
    openai_usage_delta: num(row.openai_usage_delta),
    duration_minutes: num(row.duration_minutes),
    cost_usd: num(row.cost_usd),
    closed: row.closed ? String(row.closed) : undefined,
  };
}
