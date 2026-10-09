/**
 * Audited, idempotent normalization of persisted mission timestamps to the
 * canonical UTC ISO-8601 instant (TASK-2688).
 *
 * Mission lifecycle (`board_lane_events.occurred_at`) and administrative
 * closure (`missions.closed_at`) historically mixed two spellings: UTC `Z`
 * instants and explicit-offset instants (from `git show --format=%cI`). Mixed
 * spellings break the lexical-order == temporal-order invariant that the
 * `ORDER BY occurred_at` and string-compare readers rely on.
 *
 * This module owns the classification contract and the conversion write so the
 * CLI wrapper (`scripts/normalize-mission-timestamps.ts`) stays thin and the
 * logic is importable by tests. It never silently infers a timezone, discards
 * data or rounds away an instant:
 *
 *   * canonical UTC value            -> left as-is (idempotent)
 *   * valid explicit-offset instant  -> converted to UTC, instant preserved
 *   * naive value with no zone       -> reported by record+field, preserved
 *   * unparseable value              -> reported by record+field, preserved
 */
import type { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
import { isCanonicalUtcInstant, parseInstantMs, toCanonicalUtcInstant } from '../src/domain/instant.js';

export type InstantClassification = 'canonical' | 'convert' | 'ambiguous' | 'malformed';

export interface ClassifiedInstant {
  readonly id: string;
  readonly raw: string;
  readonly classification: InstantClassification;
  readonly instantMs: number;
}

/** A timestamp column, as [table, column]. Both are operator-local. */
export type TimestampColumn = readonly [table: string, column: string];

/**
 * Columns this migration normalizes. Kept explicit so the audit and the write
 * set share one source of truth. Both tables are operator-local (ADR 0053).
 */
export const MISSION_TIMESTAMP_COLUMNS: readonly TimestampColumn[] = [
  ['board_lane_events', 'occurred_at'],
  ['missions', 'closed_at'],
];

/**
 * Classify one stored timestamp string. `instantMs` is the parsed epoch for
 * `canonical`/`convert` values; `NaN` otherwise.
 *
 * Distinction the contract draws: a value that parses as a calendar date or
 * datetime but carries no explicit zone is `ambiguous` (converting it would
 * silently assign a timezone); a value that parses as neither is `malformed`.
 */
export function classifyInstant(raw: string): { classification: InstantClassification; instantMs: number } {
  if (isCanonicalUtcInstant(raw)) {
    return { classification: 'canonical', instantMs: parseInstantMs(raw) };
  }
  // Explicit zone (`Z` or `±hh:mm`/`±hhmm`) and a parseable instant, but not the
  // canonical spelling: convert to UTC, instant preserved.
  if (/[Zz]|[+-]\d{2}:?\d{2}$/.test(raw)) {
    const ms = parseInstantMs(raw);
    if (!Number.isNaN(ms)) {
      try {
        toCanonicalUtcInstant(raw);
        return { classification: 'convert', instantMs: ms };
      } catch {
        return { classification: 'malformed', instantMs: Number.NaN };
      }
    }
  }
  // Parseable as a calendar date or datetime but without a zone: the instant is
  // not determinable without guessing, so preserve and report rather than
  // assign one.
  const trimmed = raw.trim();
  if (/[Zz]|[+-]\d{2}:?\d{2}$/.test(trimmed)) {
    return { classification: 'malformed', instantMs: Number.NaN };
  }
  const dateMs = trimmed.length > 0 ? Date.parse(trimmed) : Number.NaN;
  if (!Number.isNaN(dateMs)) {
    return { classification: 'ambiguous', instantMs: Number.NaN };
  }
  return { classification: 'malformed', instantMs: Number.NaN };
}

/** True when the named table exists in the database. */
export async function tableExists(adapter: SqliteDatabaseAdapter, table: string): Promise<boolean> {
  const rows = await adapter.query<{ has_row: unknown }>(
    `SELECT 1 AS has_row FROM sqlite_master WHERE type = 'table' AND name = ?`,
    [table],
  );
  return rows.length > 0 && rows[0]!.has_row !== undefined;
}

/** Audit one column: classify every non-empty stored value. */
export async function auditTimestampColumn(
  adapter: SqliteDatabaseAdapter,
  table: string,
  column: string,
): Promise<readonly ClassifiedInstant[]> {
  if (!(await tableExists(adapter, table))) { return []; }
  const rows = await adapter.query<{ id: unknown; value: unknown }>(
    `SELECT id, ${column} AS value FROM ${table}`,
  );
  const classified: ClassifiedInstant[] = [];
  for (const row of rows) {
    const raw = (row.value)?.toString() ?? '';
    if (raw === '') { continue; }
    const { classification, instantMs } = classifyInstant(raw);
    classified.push({ id: String(row.id), raw, classification, instantMs });
  }
  return classified;
}

export interface MigrationAudit {
  readonly columns: readonly { readonly column: TimestampColumn; readonly values: readonly ClassifiedInstant[] }[];
  readonly toConvert: number;
  readonly ambiguous: number;
  readonly malformed: number;
}

/** Audit every managed column and aggregate the classification counts. */
export async function auditMissionTimestamps(
  adapter: SqliteDatabaseAdapter,
  columns: readonly TimestampColumn[] = MISSION_TIMESTAMP_COLUMNS,
): Promise<MigrationAudit> {
  let toConvert = 0;
  let ambiguous = 0;
  let malformed = 0;
  const columnsOut: { column: TimestampColumn; values: readonly ClassifiedInstant[] }[] = [];
  for (const column of columns) {
    const values = await auditTimestampColumn(adapter, column[0], column[1]);
    columnsOut.push({ column, values });
    for (const value of values) {
      if (value.classification === 'convert') { toConvert += 1; }
      else if (value.classification === 'ambiguous') { ambiguous += 1; }
      else if (value.classification === 'malformed') { malformed += 1; }
    }
  }
  return { columns: columnsOut, toConvert, ambiguous, malformed };
}

export interface MigrationResult {
  /** Backup file path written before the write set, when a conversion happened. */
  readonly backupPath: string | null;
  readonly converted: number;
  readonly preserved: number;
}

/**
 * Apply the conversion with an explicit, audited write set. Returns the audit
 * unchanged when nothing converts, so a second run is a no-op (idempotent).
 * A backup is written only when a conversion happens.
 */
export async function applyMissionTimestampMigration(
  adapter: SqliteDatabaseAdapter,
  audit: MigrationAudit,
  backup: () => Promise<string>,
): Promise<MigrationResult> {
  if (audit.toConvert === 0) {
    return { backupPath: null, converted: 0, preserved: audit.ambiguous + audit.malformed };
  }
  const backupPath = await backup();
  let converted = 0;
  await adapter.beginTransaction();
  try {
    for (const { column, values } of audit.columns) {
      const toConvert = values.filter((value) => value.classification === 'convert');
      for (const value of toConvert) {
        await adapter.execute(
          `UPDATE ${column[0]} SET ${column[1]} = ? WHERE id = ?`,
          [toCanonicalUtcInstant(value.raw), value.id],
        );
        converted += 1;
      }
    }
    await adapter.commitTransaction();
  } catch (error) {
    await adapter.rollbackTransaction();
    throw error;
  }
  return { backupPath, converted, preserved: audit.ambiguous + audit.malformed };
}
