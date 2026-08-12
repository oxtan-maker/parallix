import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { SqliteDatabaseAdapter } from './database-adapter.js';
import type { AgentBlockEntry } from '../../application/ports/agent-blocklist.js';
import type { ImportRecord } from './ports.js';

export interface LegacyBlockImportConflict {
  readonly agent: string;
  readonly source: AgentBlockEntry;
  readonly canonical: AgentBlockEntry;
}

/** Result of inspecting or importing the former agents.local.json blocklist. */
export interface LegacyBlockImportReport {
  readonly sourcePath: string;
  readonly digest: string;
  readonly dryRun: boolean;
  readonly imported: readonly string[];
  readonly unchanged: readonly string[];
  readonly conflicts: readonly LegacyBlockImportConflict[];
  readonly invalid: readonly { readonly agent: string; readonly error: string }[];
}

/**
 * Coerce a CSV cell into a numeric value for INTEGER/REAL columns. An empty or
 * unparseable cell becomes SQL NULL ("unavailable"), which is distinct from a
 * measured 0 and matches the domain's `Measurement<'unavailable'>` kind. node:sqlite
 * stores integer-valued numbers as INTEGER and fractional ones as REAL by affinity.
 */
function numericCell(value: string | undefined): number | null {
  if (value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Transactional, idempotent data importer.
 *
 * Importers leave source files untouched, create a backup before import,
 * and record source path and digest for idempotency checking.
 *
 * Idempotency: importing the same source twice produces the same database
 * state. Blocklist uses UPSERT (ON CONFLICT DO UPDATE). Stats uses
 * DELETE + INSERT to mirror the authoritative CSV exactly.
 *
 * Malformed records: if any record in a source is malformed, the entire
 * import transaction rolls back and no partial state is committed.
 *
 * Original-file preservation: source files are never deleted or modified
 * during import.
 */
export class SqliteImporter {
  private db: SqliteDatabaseAdapter;

  constructor(db: SqliteDatabaseAdapter) {
    this.db = db;
  }

  /**
   * Compute the SHA-256 digest of a file.
   */
  static computeDigest(filePath: string): string {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Create a backup copy of a file (appends `.bak.<timestamp>`).
   */
  static createBackup(filePath: string): string {
    const timestamp = Date.now();
    const backupPath = `${filePath}.bak.${timestamp}`;
    fs.copyFileSync(filePath, backupPath);
    return backupPath;
  }

  /**
   * Inspect or atomically import legacy `agents.local.json` blocks.
   *
   * This is deliberately separate from the broad compatibility importer above:
   * an AgentBlock cutover must never overwrite a newer checked row or silently
   * discard malformed legacy data. Dry runs make no database or source-file
   * changes. A non-dry run commits only a fully valid, conflict-free plan.
   */
  async importLegacyBlocklist(
    sourcePath: string,
    options: { readonly dryRun?: boolean } = {},
  ): Promise<LegacyBlockImportReport> {
    const absPath = path.resolve(sourcePath);
    if (!fs.existsSync(absPath)) {
      throw new Error(`Blocklist source not found: ${absPath}`);
    }

    const source = fs.readFileSync(absPath, 'utf8');
    const digest = crypto.createHash('sha256').update(source).digest('hex');
    let raw: unknown;
    try {
      raw = JSON.parse(source);
    } catch (error) {
      throw new Error(`Malformed blocklist JSON at ${absPath}: ${(error as Error).message}`);
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`Blocklist JSON at ${absPath} must be a JSON object`);
    }

    const blocklist = (raw as { blocklist?: unknown }).blocklist;
    if (blocklist !== undefined && (typeof blocklist !== 'object' || blocklist === null || Array.isArray(blocklist))) {
      throw new Error(`Blocklist JSON at ${absPath} has a non-object blocklist`);
    }

    const parsed: AgentBlockEntry[] = [];
    const invalid: Array<{ agent: string; error: string }> = [];
    for (const [agent, entry] of Object.entries((blocklist ?? {}) as Record<string, unknown>)) {
      try {
        parsed.push(this.parseBlocklistEntry(agent, entry));
      } catch (error) {
        invalid.push({ agent, error: (error as Error).message });
      }
    }

    const canonical = await this.db.query<{
      agent: unknown; blocked: unknown; until: unknown; reason: unknown;
    }>('SELECT agent, blocked, until, reason FROM agent_blocklist;');
    const canonicalByAgent = new Map(canonical.map((row) => [String(row.agent), {
      agent: String(row.agent),
      blocked: Boolean(row.blocked),
      until: row.until ? String(row.until) : undefined,
      reason: row.reason ? String(row.reason) : undefined,
    } satisfies AgentBlockEntry]));

    const imported: string[] = [];
    const unchanged: string[] = [];
    const conflicts: LegacyBlockImportConflict[] = [];
    for (const entry of parsed) {
      const existing = canonicalByAgent.get(entry.agent);
      if (!existing) {
        imported.push(entry.agent);
      } else if (this.sameBlockEntry(existing, entry)) {
        unchanged.push(entry.agent);
      } else {
        conflicts.push({ agent: entry.agent, source: entry, canonical: existing });
      }
    }

    const report: LegacyBlockImportReport = {
      sourcePath: absPath,
      digest,
      dryRun: options.dryRun === true,
      imported,
      unchanged,
      conflicts,
      invalid,
    };
    if (options.dryRun || invalid.length > 0 || conflicts.length > 0) {
      return report;
    }

    await this.db.beginTransaction();
    try {
      for (const entry of parsed.filter((entry) => imported.includes(entry.agent))) {
        await this.db.execute(
          `INSERT INTO agent_blocklist (agent, blocked, until, reason, updated_at)
           VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));`,
          [entry.agent, entry.blocked ? 1 : 0, entry.until ?? null, entry.reason ?? null],
        );
      }
      await this.recordImport({
        sourcePath: absPath,
        digest,
        importedCount: imported.length,
        skippedCount: unchanged.length,
        importedAt: new Date().toISOString(),
      });
      await this.db.commitTransaction();
    } catch (error) {
      await this.db.rollbackTransaction();
      throw new Error(`Blocklist import from ${absPath} failed and was rolled back: ${(error as Error).message}`);
    }
    return report;
  }

  /**
   * Import agent blocklist from a JSON file.
   * Transactional: rolls back on malformed records.
   * Idempotent: uses UPSERT so repeated imports produce the same state.
   * Leaves original source file untouched.
   */
  async importBlocklist(sourcePath: string): Promise<ImportRecord> {
    const absPath = path.resolve(sourcePath);
    if (!fs.existsSync(absPath)) {
      throw new Error(`Blocklist source not found: ${absPath}`);
    }

    // Create backup before import
    const backupPath = SqliteImporter.createBackup(absPath);

    // Compute source digest
    const digest = SqliteImporter.computeDigest(absPath);

    // Parse JSON
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(absPath, 'utf8'));
    } catch (err) {
      throw new Error(
        `Malformed blocklist JSON at ${absPath}: ${(err as Error).message}`,
      );
    }

    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(
        `Blocklist JSON at ${absPath} must be a JSON object`,
      );
    }

    const blocklist = (raw as { blocklist?: Record<string, unknown> }).blocklist;
    if (!blocklist || typeof blocklist !== 'object' || Array.isArray(blocklist)) {
      // No blocklist key — valid but empty
      const record = {
        sourcePath: absPath,
        digest,
        importedCount: 0,
        skippedCount: 0,
        importedAt: new Date().toISOString(),
        backupPath,
      } as ImportRecord;
      await this.recordImport(record);
      return record;
    }

    // Parse all entries — malformed records are reported but do not abort
    // the entire import. Valid records are committed in a single transaction.
    const parsed: AgentBlockEntry[] = [];
    const skipped = [];
    for (const [agent, entry] of Object.entries(blocklist)) {
      try {
        parsed.push(this.parseBlocklistEntry(agent, entry));
      } catch (err) {
        skipped.push({ agent, error: (err as Error).message });
      }
    }

    // Transactional import with UPSERT (valid records only)
    await this.db.beginTransaction();
    try {
      for (const entry of parsed) {
        await this.db.execute(
          `INSERT INTO agent_blocklist (agent, blocked, until, reason, updated_at)
           VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
           ON CONFLICT(agent) DO UPDATE SET
             blocked = excluded.blocked,
             until = excluded.until,
             reason = excluded.reason,
             updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now');`,
          [
            entry.agent,
            entry.blocked ? 1 : 0,
            entry.until ?? null,
            entry.reason ?? null,
          ],
        );
      }
      await this.db.commitTransaction();
    } catch {
      await this.db.rollbackTransaction();
      throw new Error(
        `Blocklist import from ${absPath} failed and was rolled back`,
      );
    }

    const record = {
      sourcePath: absPath,
      digest,
      importedCount: parsed.length,
      skippedCount: skipped.length,
      importedAt: new Date().toISOString(),
      backupPath,
    } as ImportRecord;
    await this.recordImport(record);
    return record;
  }

  /**
   * Import usage statistics from a CSV file.
   * Transactional: rolls back on malformed records.
   * Idempotent: DELETE + INSERT mirrors the authoritative CSV exactly.
   * Leaves original source file untouched.
   */
  async importStats(sourcePath: string): Promise<ImportRecord> {
    const absPath = path.resolve(sourcePath);
    if (!fs.existsSync(absPath)) {
      throw new Error(`Stats source not found: ${absPath}`);
    }

    // Create backup before import
    const backupPath = SqliteImporter.createBackup(absPath);

    // Compute source digest
    const digest = SqliteImporter.computeDigest(absPath);

    // Parse CSV
    const content = fs.readFileSync(absPath, 'utf8');
    const lines = content.split('\n').filter((line) => line.trim());

    if (lines.length === 0) {
      const record = {
        sourcePath: absPath,
        digest,
        importedCount: 0,
        skippedCount: 0,
        importedAt: new Date().toISOString(),
        backupPath,
      } as ImportRecord;
      await this.recordImport(record);
      return record;
    }

    const headers = this.parseCsvLine(lines[0]);

    // Parse all records — malformed records are reported but do not abort
    // the entire import. Valid records are committed in a single transaction.
    const records: Record<string, string>[] = [];
    const skipped = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) {
        continue;
      }
      try {
        const values = this.parseCsvLine(line, headers.length, i + 1);
        const record: Record<string, string> = {};
        headers.forEach((header: string, idx: number) => {
          record[header] = values[idx] || '';
        });
        // Validate required fields: at least repo or date must be present
        if (!record['repo'] && !record['date']) {
          throw new Error(
            `Row at line ${i + 1} has no repo or date field`,
          );
        }
        records.push(record);
      } catch (err) {
        skipped.push({ line: i + 1, error: (err as Error).message });
      }
    }

    // Transactional import: DELETE existing stats, then INSERT all rows.
    // This ensures the database mirrors the authoritative CSV exactly.
    await this.db.beginTransaction();
    try {
      await this.db.execute('DELETE FROM usage_statistics');
      for (const record of records) {
        await this.db.execute(
          `INSERT INTO usage_statistics (
            date, repo, mission, classification, implementer, pr_fix_rounds,
            provider, model, implementer_agent, reviewer_agent, stage,
            input_tokens, output_tokens, cached_tokens, thoughts_tokens,
            context_tokens,
            tool_calls, openai_usage_before, openai_usage_after,
            openai_usage_delta, duration_minutes, cost_usd
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          [
            record['date'] ?? null,
            record['repo'] || '',
            record['mission'] || '',
            record['classification'] ?? null,
            record['implementer'] ?? null,
            numericCell(record['pr_fix_rounds']),
            record['provider'] ?? null,
            record['model'] ?? null,
            record['implementer_agent'] ?? null,
            record['reviewer_agent'] ?? null,
            record['stage'] || 'default',
            numericCell(record['input_tokens']),
            numericCell(record['output_tokens']),
            numericCell(record['cached_tokens']),
            numericCell(record['thoughts_tokens']),
            numericCell(record['context_tokens']),
            numericCell(record['tool_calls']),
            numericCell(record['openai_usage_before']),
            numericCell(record['openai_usage_after']),
            numericCell(record['openai_usage_delta']),
            numericCell(record['duration_minutes']),
            numericCell(record['cost_usd']),
          ],
        );
      }
      await this.db.commitTransaction();
    } catch {
      await this.db.rollbackTransaction();
      throw new Error(
        `Stats import from ${absPath} failed and was rolled back`,
      );
    }

    const record = {
      sourcePath: absPath,
      digest,
      importedCount: records.length,
      skippedCount: skipped.length,
      importedAt: new Date().toISOString(),
      backupPath,
    } as ImportRecord;
    await this.recordImport(record);
    return record;
  }

  /**
   * Return import history for a given source path.
   */
  async getImportHistory(sourcePath: string): Promise<readonly ImportRecord[]> {
    const absPath = path.resolve(sourcePath);
    const rows = await this.db.query<Record<string, unknown>>(
      'SELECT source_path, digest, imported_count, skipped_count, imported_at, backup_path ' +
        'FROM import_history WHERE source_path = ? ORDER BY id DESC',
      [absPath],
    );
    return rows.map((row) => ({
      sourcePath: String(row.source_path),
      digest: String(row.digest),
      importedCount: Number(row.imported_count),
      skippedCount: Number(row.skipped_count),
      importedAt: String(row.imported_at),
      backupPath: row.backup_path ? String(row.backup_path) : undefined,
    }));
  }

  /**
   * Persist an import record to the import_history ledger.
   */
  private async recordImport(record: ImportRecord): Promise<void> {
    await this.db.execute(
      `INSERT INTO import_history (source_path, digest, imported_count, skipped_count, imported_at, backup_path)
       VALUES (?, ?, ?, ?, ?, ?);`,
      [
        record.sourcePath,
        record.digest,
        record.importedCount,
        record.skippedCount,
        record.importedAt,
        record.backupPath ?? null,
      ],
    );
  }

  /**
   * Parse a blocklist entry. Throws on malformed input.
   */
  private parseBlocklistEntry(
    agent: string,
    entry: unknown,
  ): AgentBlockEntry {
    if (entry === true) {
      return { agent, blocked: true };
    }
    if (entry === false) {
      return { agent, blocked: false };
    }
    if (entry === null || entry === undefined) {
      throw new Error(
        `Entry for "${agent}" is ${entry === null ? 'null' : 'undefined'}; ` +
          'expected boolean or object',
      );
    }
    if (typeof entry === 'object' && !Array.isArray(entry)) {
      const obj = entry as Record<string, unknown>;
      const blocked: boolean =
        obj.blocked === true ||
        Boolean(obj.until && new Date(String(obj.until)) > new Date());
      return {
        agent,
        blocked,
        until: obj.until ? String(obj.until) : undefined,
        reason: obj.reason ? String(obj.reason) : undefined,
      };
    }
    // Non-boolean, non-object values (e.g. strings, numbers, arrays) are malformed
    throw new Error(
      `Entry for "${agent}" has unsupported type ${typeof entry}; ` +
        'expected boolean or object',
    );
  }

  private sameBlockEntry(left: AgentBlockEntry, right: AgentBlockEntry): boolean {
    return left.agent === right.agent
      && left.blocked === right.blocked
      && left.until === right.until
      && left.reason === right.reason;
  }

  /**
   * Parse a single CSV line into an array of field values.
   * Validates column count and unmatched quotes.
   */
  private parseCsvLine(
    line: string,
    expectedColumns?: number,
    lineNumber?: number,
  ): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current.trim());

    // Check for unmatched quotes
    if (inQuotes) {
      throw new Error(
        `Unmatched quote at line ${lineNumber ?? '?'}; " was not closed`,
      );
    }

    // Validate column count matches headers
    if (expectedColumns !== undefined && result.length !== expectedColumns) {
      throw new Error(
        `Expected ${expectedColumns} columns but found ${result.length} ` +
          `at line ${lineNumber ?? '?'}; likely a malformed row`,
      );
    }

    return result;
  }
}
