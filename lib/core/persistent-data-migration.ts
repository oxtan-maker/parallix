import fs from 'node:fs';
import path from 'node:path';
import * as storage from './storage.js';
import { createRequire } from 'node:module';
const _require = createRequire(__filename);

/** Cached stats module — loaded lazily to break circular dependency with `../commands/stats.js`. */
let _stats: any = null;

/** Lazily load the stats module to break the circular dependency. */
function getStats(): any {
  if (!_stats) {_stats = _require('../commands/stats.js');}
  return _stats;
}

/** Resolve the canonical stats CSV headers. */
function getStatsHeaders(): string[] {
  return getStats().STATS_HEADERS;
}

const ESSENTIAL_STATS_COLUMNS = ['date', 'mission', 'classification', 'implementer', 'pr_fix_rounds'];

/**
 * Validate that a stats row has all essential columns populated.
 * Throws on the first missing column found.
 * @param row - Row object to validate
 * @param rowIndex - Zero-based row index (for error messages)
 * @param filePath - Source file path (for error messages)
 */
function validateStatsRow(row: Record<string, unknown>, rowIndex: number, filePath: string): void {
  const missing = ESSENTIAL_STATS_COLUMNS.filter(col => !(col in row) || row[col] === '');
  if (missing.length > 0) {
    throw new Error(
      `Malformed telemetry row ${rowIndex + 1} in ${path.resolve(filePath)}: ` +
      `missing essential columns: ${missing.join(', ')}`
    );
  }
}

/**
 * Parse a single CSV line, respecting quoted fields and escaped quotes.
 * @param line - Raw CSV line string
 * @returns Array of parsed field values
 */
function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      values.push(value);
      value = '';
    } else {
      value += char;
    }
  }
  values.push(value);
  return values;
}

/**
 * Escape a single CSV value — wraps in quotes if it contains commas, double-quotes, or newlines.
 * @param value - Value to escape
 * @returns Escaped CSV-safe string
 */
function escapeCsvValue(value: unknown): string {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Minimal CSV loader — avoids circular dependency with stats module (which
 * imports this module at the top). Defined locally so `migrateStats()` can
 * read any schema without triggering a require-cycle.
 */
function loadCsv(filePath: string): { headers: string[]; rows: Record<string, unknown>[] } {
  if (!fs.existsSync(filePath)) {
    return { headers: [], rows: [] };
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n').filter(line => line.trim());
  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }
  const headers = parseCsvLine(lines[0]);
  const rows: Record<string, unknown>[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCsvLine(lines[i]);
    const row: Record<string, unknown> = {};
    headers.forEach((header, idx) => {
      row[header] = values[idx] || '';
    });
    rows.push(row);
  }
  return { headers, rows };
}

/**
 * Read a stats CSV file with any schema (legacy 5-col or extended 21-col).
 * Returns rows as arrays keyed by the 21-column STATS_HEADERS, with missing
 * columns filled by normalizeStatsRow defaults.
 */
function readStatsRows(filePath: string, options: { defaultRepo?: string } = {}): string[][] {
  if (!filePath || !fs.existsSync(filePath)) {return [];}
  const data = loadCsv(filePath);
  if (data.headers.length === 0) {return [];}
  const headers = getStatsHeaders();
  const opts = options;
  const validated = data.rows.map((row, idx) => {
    validateStatsRow(row, idx, filePath);
    return row;
  });
  return validated
    .map(row => getStats().normalizeStatsRow(row, { repo: opts.defaultRepo }))
    .map((row: Record<string, unknown>) => headers.map((h: string) => String(row[h] || '')));
}

/**
 * Serialize an array of stats rows back to CSV format with canonical headers.
 * @param rows - Array of row arrays (each row is an array of string values)
 * @returns CSV string with headers and data rows
 */
function serializeStatsRows(rows: string[][]): string {
  const headers = getStatsHeaders();
  return `${[
    headers.join(','),
    ...rows.map(row => row.map(escapeCsvValue).join(','))
  ].join('\n')}\n`;
}

/**
 * Merge stats from one or more source CSV files into the destination file.
 * Deduplicates full rows. Creates the destination directory if needed.
 * When no source data is available, returns early without writing a header-only file.
 * @param options - Migration configuration (sourcePaths, sourcePath, destinationPath)
 * @returns Result with destination path, import counts, and optional warning
 */
function migrateStats(options: { sourcePaths?: string[]; sourcePath?: string; destinationPath?: string } = {}): { destinationPath: string; imported: number; rows: number; warn?: string } {
  const opts = options;
  const sourcePaths = (opts.sourcePaths || [opts.sourcePath].filter(Boolean)) as string[];
  const destinationPath = opts.destinationPath || storage.resolveStatsPath({ ensureDir: true });
  const sourceRows = sourcePaths.map((sourcePath: string) => readStatsRows(sourcePath, {})).flat();

  // Fresh-install guard: when no source file exists or all sources are empty,
  // there is no telemetry to import. Returning early prevents writing a
  // header-only destination file that would masquerade as valid stats.
  if (sourceRows.length === 0) {
    return { destinationPath, imported: 0, rows: 0, warn: 'no source data available' };
  }

  const destinationRows = readStatsRows(destinationPath, {});
  const rows: string[][] = [];
  const seen = new Set<string>();

  for (const row of [...destinationRows, ...sourceRows]) {
    const key = JSON.stringify(row);
    if (!seen.has(key)) {
      seen.add(key);
      rows.push(row);
    }
  }

  const content = serializeStatsRows(rows);
  const current = fs.existsSync(destinationPath) ? fs.readFileSync(destinationPath, 'utf8') : null;
  if (current !== content) {storage.writeFileAtomic(destinationPath, content);}
  return { destinationPath, imported: rows.length - destinationRows.length, rows: rows.length };
}

interface BlocklistSource { filePath: string; payload: Record<string, unknown>; blocklist: Record<string, unknown>; }

function readBlocklistSource(filePath: string, warn: (...args: unknown[]) => void, hardFailure = false): BlocklistSource | null {
  if (!filePath || !fs.existsSync(filePath)) {return null;}
  try {
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('expected a JSON object at the file root');
    }
    if (
      payload.blocklist !== undefined &&
      (!payload.blocklist || typeof payload.blocklist !== 'object' || Array.isArray(payload.blocklist))
    ) {
      throw new Error('expected blocklist to be a JSON object');
    }
    return { filePath, payload, blocklist: (payload.blocklist as Record<string, unknown>) || {} };
  } catch (error) {
    if (hardFailure) {throw error;}
    warn(`Skipping malformed legacy agent blocklist ${path.resolve(filePath)}: ${(error as Error).message}`);
    return null;
  }
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Merge agent blocklists from legacy sources into the destination file.
 * Reports conflicts via `warn` when the same agent appears in multiple sources
 * with different values. Existing destination entries take lowest precedence.
 * @param options - Migration configuration (warn callback, destinationPath, sourcePaths)
 * @returns Result with destination path, merged blocklist, and conflict details
 */
function migrateAgentBlocklists(options: { warn?: (...args: unknown[]) => void; destinationPath?: string; sourcePaths?: string[] } = {}): { destinationPath: string; blocklist: Record<string, unknown>; conflicts: unknown[] } {
  const opts = options;
  const warn = opts.warn || (() => {});
  const destinationPath = opts.destinationPath || storage.resolveAgentsLocalPath({ ensureDir: true });
  const sources = (opts.sourcePaths || [])
    .map(filePath => readBlocklistSource(filePath, warn))
    .filter(Boolean) as BlocklistSource[];
  const destination = readBlocklistSource(destinationPath, warn, true);
  const selected: Record<string, unknown> = {};
  const selectedFrom: Record<string, string> = {};
  const conflicts: unknown[] = [];

  for (const s of [...sources, ...(destination ? [destination] : [])]) {
    if (!s) {continue;}
    for (const [agent, value] of Object.entries(s.blocklist)) {
      if (Object.prototype.hasOwnProperty.call(selected, agent) && !sameValue(selected[agent], value)) {
        const conflict = {
          agent,
          previousSource: selectedFrom[agent],
          previousValue: selected[agent],
          selectedSource: s.filePath,
          selectedValue: value
        };
        conflicts.push(conflict);
        warn(
          `Agent blocklist conflict for "${agent}": ${path.resolve(s.filePath)} takes precedence over ` +
          `${path.resolve(selectedFrom[agent])}; selected=${JSON.stringify(value)} previous=${JSON.stringify(selected[agent])}`
        );
      }
      selected[agent] = value;
      selectedFrom[agent] = s.filePath;
    }
  }

  const payload: Record<string, unknown> = destination ? { ...destination.payload } : {};
  payload.blocklist = selected;
  const content = `${JSON.stringify(payload, null, 2)}\n`;
  const current = fs.existsSync(destinationPath) ? fs.readFileSync(destinationPath, 'utf8') : null;
  if (current !== content) {storage.writeFileAtomic(destinationPath, content);}
  return { destinationPath, blocklist: selected, conflicts };
}

export {
  migrateStats,
  migrateAgentBlocklists
};
export const _internals = { parseCsvLine, readStatsRows, serializeStatsRows };
