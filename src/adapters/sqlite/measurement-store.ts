import fs from 'node:fs';

import type {
  MeasurementRecord,
  MeasurementStorePort,
  MeasurementUpsertResult,
} from '../../application/measurement-ports.js';
import { MeasurementStoreUnavailableError } from '../../application/measurement-ports.js';
import type { Migration } from './database-adapter.js';
import { SqliteDatabaseAdapter } from './database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from './migration-runner.js';
import { resolveDatabasePath } from './database-path-resolver.js';

/**
 * SQLite-backed `MeasurementStorePort` over the `usage_statistics` table.
 *
 * This is the sole authority for `AgentRunMeasurement` and `MissionOutcome`
 * data (ADR 0053). It never reads or writes a CSV file, and it never derives
 * an identity: `(repo, mission, stage, actorKey)` arrives from the caller that
 * owns the attribution rule, matching the `Attempt`-excluded decision checked
 * by architecture migration.
 *
 * Synchronous by design — `node:sqlite` `DatabaseSync` is a synchronous
 * driver, and every measurement producer in the runtime is a synchronous call.
 */

/** The columns persisted for one measurement, in statement order. */
const MEASUREMENT_COLUMNS = [
  'date', 'repo', 'mission', 'classification', 'implementer', 'pr_fix_rounds',
  'provider', 'model', 'implementer_agent', 'reviewer_agent', 'stage',
  'actor_key',
  'input_tokens', 'output_tokens', 'cached_tokens', 'context_tokens',
  'tool_calls', 'openai_usage_before', 'openai_usage_after',
  'openai_usage_delta', 'duration_minutes', 'cost_usd', 'closed',
] as const;

/** Fields compared to decide whether an upsert actually changed the row. */
const COMPARED_FIELDS: readonly (keyof MeasurementRecord)[] = [
  'date', 'classification', 'implementer', 'pr_fix_rounds', 'provider',
  'model', 'implementer_agent', 'reviewer_agent', 'input_tokens',
  'output_tokens', 'cached_tokens', 'context_tokens', 'tool_calls',
  'openai_usage_before', 'openai_usage_after', 'openai_usage_delta',
  'duration_minutes', 'cost_usd', 'closed',
];

const SELECT_ALL =
  `SELECT ${MEASUREMENT_COLUMNS.join(', ')} FROM usage_statistics ` +
  'ORDER BY date ASC, repo ASC, mission ASC, stage ASC';

const UPSERT_SQL =
  `INSERT INTO usage_statistics (${MEASUREMENT_COLUMNS.join(', ')}) VALUES (${
    MEASUREMENT_COLUMNS.map(() => '?').join(', ')})
   ON CONFLICT(repo, mission, stage, actor_key) DO UPDATE SET
     date = excluded.date,
     classification = excluded.classification,
     implementer = excluded.implementer,
     pr_fix_rounds = excluded.pr_fix_rounds,
     provider = excluded.provider,
     model = excluded.model,
     implementer_agent = excluded.implementer_agent,
     reviewer_agent = excluded.reviewer_agent,
     input_tokens = excluded.input_tokens,
     output_tokens = excluded.output_tokens,
     cached_tokens = excluded.cached_tokens,
     context_tokens = excluded.context_tokens,
     tool_calls = excluded.tool_calls,
     openai_usage_before = excluded.openai_usage_before,
     openai_usage_after = excluded.openai_usage_after,
     openai_usage_delta = excluded.openai_usage_delta,
     duration_minutes = excluded.duration_minutes,
     cost_usd = excluded.cost_usd,
     closed = excluded.closed;`;

export class SqliteMeasurementStore implements MeasurementStorePort {
  private db: SqliteDatabaseAdapter;
  private readonly dbPath: string;

  constructor(dbPath: string, options: { readonly migrations?: readonly Migration[] } = {}) {
    this.dbPath = dbPath;
    this.db = new SqliteDatabaseAdapter();
    try {
      this.db.openSync({ path: dbPath, busyTimeoutMs: 5000, enableWal: true });
      applyPendingMigrationsSync(this.db, dbPath, options.migrations ?? loadDefaultMigrations());
    } catch (error) {
      throw new MeasurementStoreUnavailableError(
        `Measurement database unavailable at ${dbPath}: ${
          error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }
  }

  listMeasurements(): readonly MeasurementRecord[] {
    return this.selectRows(SELECT_ALL, []);
  }

  findByMission(mission: string): readonly MeasurementRecord[] {
    const key = String(mission || '').trim().toLowerCase();
    return this.selectRows(
      `SELECT ${MEASUREMENT_COLUMNS.join(', ')} FROM usage_statistics WHERE mission = ? ` +
        'ORDER BY date ASC, repo ASC, mission ASC, stage ASC',
      [key],
    );
  }

  upsertMeasurement(record: MeasurementRecord): MeasurementUpsertResult {
    return this.upsertAll([record])[0];
  }

  upsertAll(records: readonly MeasurementRecord[]): MeasurementUpsertResult[] {
    if (records.length === 0) {
      return [];
    }
    try {
      // IMMEDIATE takes the write lock up front so a competing writer waits on
      // `busy_timeout` instead of failing mid-batch with SQLITE_BUSY.
      this.db.executeSync('BEGIN IMMEDIATE;');
    } catch (error) {
      throw new MeasurementStoreUnavailableError(
        `Could not begin a measurement transaction: ${
          error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }
    try {
      const results = records.map((record) => this.applyOne(record));
      this.db.executeSync('COMMIT;');
      return results;
    } catch (error) {
      try {
        this.db.executeSync('ROLLBACK;');
      } catch {
        // The transaction was already unwound; the rollback is a no-op.
      }
      throw new MeasurementStoreUnavailableError(
        `Measurement write failed and was rolled back: ${
          error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }
  }

  close(): void {
    try {
      this.db.closeSync();
    } catch {
      // Already closed.
    }
  }

  /** Absolute path of the database backing this store. */
  getPath(): string {
    return this.dbPath;
  }

  private applyOne(record: MeasurementRecord): MeasurementUpsertResult {
    const existing = this.db.querySync<Record<string, unknown>>(
      `SELECT ${MEASUREMENT_COLUMNS.join(', ')} FROM usage_statistics ` +
        'WHERE repo = ? AND mission = ? AND stage = ? AND actor_key = ?',
      [record.repo, record.mission, record.stage, record.actorKey],
    );

    const previous = existing.length > 0 ? rowToRecord(existing[0]) : null;
    this.db.executeSync(UPSERT_SQL, bindValues(record));
    const changed = previous === null || COMPARED_FIELDS.some(
      (field) => normalizeForCompare(previous[field]) !== normalizeForCompare(record[field]),
    );
    return { changed };
  }

  private selectRows(sql: string, params: readonly unknown[]): readonly MeasurementRecord[] {
    try {
      const rows = this.db.querySync<Record<string, unknown>>(sql, params);
      return rows.map((row) => rowToRecord(row));
    } catch (error) {
      throw new MeasurementStoreUnavailableError(
        `Measurement read failed: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }
  }
}

/** SQL NULL → `undefined` (unavailable); otherwise a finite number. */
function num(value: unknown): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function text(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}

function rowToRecord(row: Record<string, unknown>): MeasurementRecord {
  return {
    date: text(row.date),
    repo: String(row.repo ?? ''),
    mission: String(row.mission ?? ''),
    classification: text(row.classification),
    implementer: text(row.implementer),
    pr_fix_rounds: num(row.pr_fix_rounds),
    provider: text(row.provider),
    model: text(row.model),
    implementer_agent: text(row.implementer_agent),
    reviewer_agent: text(row.reviewer_agent),
    stage: String(row.stage ?? 'default'),
    actorKey: String(row.actor_key ?? ''),
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
    closed: text(row.closed),
  };
}

function bindValues(record: MeasurementRecord): (string | number | null)[] {
  return [
    record.date ?? null,
    record.repo,
    record.mission,
    record.classification ?? null,
    record.implementer ?? null,
    record.pr_fix_rounds ?? null,
    record.provider ?? null,
    record.model ?? null,
    record.implementer_agent ?? null,
    record.reviewer_agent ?? null,
    record.stage,
    record.actorKey,
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
  ];
}

/** `undefined` and `''`/`null` compare equal so "unset" never looks changed. */
function normalizeForCompare(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value);
}

/**
 * Apply pending migrations synchronously against the same `schema_migrations`
 * ledger the async `SqliteMigrationRunner` uses, with the same immutable
 * checksum rule and the same pre-migration backup for irreversible migrations.
 */
function applyPendingMigrationsSync(
  db: SqliteDatabaseAdapter,
  dbPath: string,
  migrations: readonly Migration[],
): void {
  const applied = new Map<string, string>();
  try {
    const rows = db.querySync<Record<string, unknown>>(
      'SELECT id, checksum FROM schema_migrations ORDER BY id ASC',
    );
    for (const row of rows) {
      applied.set(String(row.id), String(row.checksum));
    }
  } catch {
    // Ledger table does not exist yet (fresh database before migration 0001).
  }

  for (const migration of migrations) {
    const existing = applied.get(migration.id);
    if (existing !== undefined && existing !== migration.checksum) {
      throw new Error(
        `Checksum mismatch for migration ${migration.id}: ` +
          `expected ${migration.checksum}, found ${existing}. ` +
          'Migration file may have been modified after application.',
      );
    }
  }

  const pending = migrations.filter((migration) => !applied.has(migration.id));
  if (pending.length === 0) {
    return;
  }

  for (const migration of pending) {
    if (!migration.down && fs.existsSync(dbPath)) {
      try {
        db.executeSync('PRAGMA wal_checkpoint(TRUNCATE);');
      } catch {
        // Not in WAL mode; the plain copy is still self-contained.
      }
      fs.copyFileSync(dbPath, `${dbPath}.bak.${Date.now()}`);
    }
    // IMMEDIATE, not deferred: a deferred BEGIN takes the write lock lazily on
    // the first DDL statement and fails outright ("database is locked") when a
    // concurrent connection holds it, instead of waiting out `busy_timeout`.
    db.executeSync('BEGIN IMMEDIATE;');
    try {
      db.executeSync(migration.up);
      db.executeSync(
        'INSERT INTO schema_migrations (id, checksum, applied_at) VALUES (?, ?, ?);',
        [migration.id, migration.checksum, new Date().toISOString()],
      );
      db.executeSync('COMMIT;');
    } catch (error) {
      try {
        db.executeSync('ROLLBACK;');
      } catch {
        // Already unwound.
      }
      throw new Error(
        `Migration ${migration.id} failed and was rolled back: ` +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }
}

/** Checksum helper kept aligned with the async runner. */
export const computeMeasurementMigrationChecksum = SqliteMigrationRunner.computeChecksum;

const openStores = new Map<string, SqliteMeasurementStore>();

/**
 * Resolve the process-wide measurement store for `<PARALLIX_HOME>/parallix.db`
 * (or an explicit path). Handles are cached per path so repeated synchronous
 * producers do not reopen the database on every call.
 *
 * Throws `MeasurementStoreUnavailableError` when the database cannot be
 * opened — there is no CSV fallback.
 */
export function resolveMeasurementStore(options: { readonly dbPath?: string; readonly home?: string } = {}): SqliteMeasurementStore {
  const dbPath = options.dbPath ?? resolveDatabasePath({ home: options.home });
  const cached = openStores.get(dbPath);
  if (cached) {
    return cached;
  }
  const store = new SqliteMeasurementStore(dbPath);
  openStores.set(dbPath, store);
  return store;
}

/** Close and forget every cached store. Intended for test isolation. */
export function closeMeasurementStores(): void {
  for (const store of openStores.values()) {
    store.close();
  }
  openStores.clear();
}
