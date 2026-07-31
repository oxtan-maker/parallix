'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const stats = require('../.test-runtime/lib/commands/stats');

/**
 * TASK-2322.08 CP-3: the explicit legacy CSV import/analysis boundary.
 *
 * `px stats import-legacy --csv-file <path>` is the only way a stats.csv-shaped
 * file may enter the runtime. Every test uses a temporary CSV and a temporary
 * database — no PARALLIX_HOME, Forgejo, agent, or child process.
 */

const HEADERS = [
  'date', 'repo', 'mission', 'classification', 'implementer', 'pr_fix_rounds',
  'provider', 'model', 'implementer_agent', 'reviewer_agent', 'stage',
  'input_tokens', 'output_tokens', 'cached_tokens', 'context_tokens',
  'tool_calls', 'openai_usage_before', 'openai_usage_after',
  'openai_usage_delta', 'duration_minutes', 'cost_usd', 'closed',
].join(',');

function fixture(label: string, lines: string[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `px-legacy-import-${label}-`));
  const csvPath = path.join(dir, 'legacy-stats.csv');
  fs.writeFileSync(csvPath, `${lines.join('\n')}\n`, 'utf8');
  return { dir, csvPath, dbPath: path.join(dir, 'parallix.db') };
}

function digest(filePath: string) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function row(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    date: '2026-06-20', repo: 'parallix', mission: 'task-7001',
    classification: 'ai_sdlc', implementer: 'codex', pr_fix_rounds: '1',
    provider: 'openai', model: 'gpt-5.4', implementer_agent: 'codex',
    reviewer_agent: '', stage: 'active', input_tokens: '100',
    output_tokens: '20', cached_tokens: '5', context_tokens: '200',
    tool_calls: '7', openai_usage_before: '0', openai_usage_after: '12',
    openai_usage_delta: '0', duration_minutes: '3', cost_usd: '0.5',
    closed: 'yes',
    ...overrides,
  };
  return HEADERS.split(',').map(header => values[header]).join(',');
}

// `dbPath` is always injected so a command test can never reach the operator's
// real <PARALLIX_HOME>/parallix.db.
function runImport(args: string[], dbPath?: string) {
  const logs: string[] = [];
  const errors: string[] = [];
  let exitCode: number | null = null;
  stats(['import-legacy', ...args], {
    dbPath,
    log: (line: string) => logs.push(String(line)),
    error: (line: string) => errors.push(String(line)),
    exit: (code: number) => { exitCode = code; },
  });
  return { out: logs.join('\n'), err: errors.join('\n'), exitCode };
}

test('import-legacy dry run reports the importable rows and writes nothing', () => {
  const { dir, csvPath, dbPath } = fixture('dryrun', [HEADERS, row(), row({ mission: 'task-7002' })]);
  try {
    const analysis = stats.analyzeLegacyStatsCsv(csvPath, { rootDir: dir });
    assert.equal(analysis.totalRows, 2);
    assert.equal(analysis.importable.length, 2);
    assert.deepEqual(analysis.malformed, []);
    assert.deepEqual(analysis.ambiguous, []);

    // Dry run created no database at all.
    assert.equal(fs.existsSync(dbPath), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('import-legacy apply is atomic and idempotent: re-applying the same CSV creates no duplicate records', () => {
  const { dir, csvPath, dbPath } = fixture('idempotent', [HEADERS, row(), row({ mission: 'task-7002' })]);
  try {
    const analysis = stats.analyzeLegacyStatsCsv(csvPath, { rootDir: dir });

    const first = stats.applyLegacyStatsCsv(analysis, { dbPath, rootDir: dir });
    assert.equal(first.applied, 2);
    assert.equal(first.changed, 2);
    assert.equal(stats.loadMeasurementRows({ dbPath }).rows.length, 2);

    // Second and third application of the SAME file.
    const second = stats.applyLegacyStatsCsv(
      stats.analyzeLegacyStatsCsv(csvPath, { rootDir: dir }), { dbPath, rootDir: dir });
    assert.equal(second.applied, 2);
    assert.equal(second.changed, 0, 'a repeated import must change nothing');
    stats.applyLegacyStatsCsv(
      stats.analyzeLegacyStatsCsv(csvPath, { rootDir: dir }), { dbPath, rootDir: dir });

    const rows = stats.loadMeasurementRows({ dbPath }).rows;
    assert.equal(rows.length, 2, 'repeated import must not duplicate records');
    assert.deepEqual(rows.map((r: any) => r.mission).sort(), ['task-7001', 'task-7002']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('import-legacy leaves the source CSV byte-for-byte unchanged after a successful apply', () => {
  const { dir, csvPath, dbPath } = fixture('readonly', [HEADERS, row()]);
  try {
    const before = digest(csvPath);
    const beforeMtime = fs.statSync(csvPath).mtimeMs;

    stats.applyLegacyStatsCsv(
      stats.analyzeLegacyStatsCsv(csvPath, { rootDir: dir }), { dbPath, rootDir: dir });

    assert.equal(digest(csvPath), before, 'the source CSV content must not change');
    assert.equal(fs.statSync(csvPath).mtimeMs, beforeMtime, 'the source CSV must not be rewritten');
    assert.equal(stats.loadMeasurementRows({ dbPath }).rows.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('import-legacy reports malformed rows and commits no partial import', () => {
  const { dir, csvPath, dbPath } = fixture('malformed', [
    HEADERS,
    row(),
    row({ mission: 'task-bad-date', date: 'yesterday' }),
    row({ mission: '' }),
    row({ mission: 'task-bad-class', classification: 'not-a-classification' }),
    row({ mission: 'task-bad-tokens', input_tokens: 'lots' }),
  ]);
  try {
    const analysis = stats.analyzeLegacyStatsCsv(csvPath, { rootDir: dir });
    assert.equal(analysis.importable.length, 1);
    assert.equal(analysis.malformed.length, 4);

    const reasons = analysis.malformed.flatMap((entry: any) => entry.reasons).join(' | ');
    assert.match(reasons, /unparseable date "yesterday"/);
    assert.match(reasons, /missing mission/);
    assert.match(reasons, /unknown classification "not-a-classification"/);
    assert.match(reasons, /non-numeric input_tokens "lots"/);
    // Line numbers point at the real CSV lines (header is line 1).
    assert.deepEqual(analysis.malformed.map((entry: any) => entry.line), [3, 4, 5, 6]);

    assert.throws(
      () => stats.applyLegacyStatsCsv(analysis, { dbPath, rootDir: dir }),
      /Refusing to import .*4 malformed and 0 ambiguous rows\. No records were written\./,
    );
    // Not one row of the good remainder was committed.
    assert.equal(fs.existsSync(dbPath), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('import-legacy reports ambiguous rows that claim one identity with conflicting values', () => {
  const { dir, csvPath, dbPath } = fixture('ambiguous', [
    HEADERS,
    row({ input_tokens: '100' }),
    // Same (repo, mission, stage, actor) but a different measurement.
    row({ input_tokens: '999' }),
  ]);
  try {
    const analysis = stats.analyzeLegacyStatsCsv(csvPath, { rootDir: dir });
    assert.equal(analysis.ambiguous.length, 1);
    assert.equal(analysis.ambiguous[0].mission, 'task-7001');
    assert.equal(analysis.ambiguous[0].stage, 'active');
    assert.deepEqual(analysis.ambiguous[0].conflictingLines, [3]);

    assert.throws(
      () => stats.applyLegacyStatsCsv(analysis, { dbPath, rootDir: dir }),
      /0 malformed and 1 ambiguous rows\. No records were written\./,
    );
    assert.equal(fs.existsSync(dbPath), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('import-legacy treats an exactly repeated row as a benign duplicate, not an ambiguity', () => {
  const { dir, csvPath, dbPath } = fixture('duplicate', [HEADERS, row(), row()]);
  try {
    const analysis = stats.analyzeLegacyStatsCsv(csvPath, { rootDir: dir });
    assert.deepEqual(analysis.ambiguous, []);
    assert.equal(analysis.importable.length, 1);

    stats.applyLegacyStatsCsv(analysis, { dbPath, rootDir: dir });
    assert.equal(stats.loadMeasurementRows({ dbPath }).rows.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('import-legacy rejects a file that is not a stats dataset', () => {
  const { dir, csvPath } = fixture('notstats', ['a,b,c', '1,2,3']);
  try {
    assert.throws(
      () => stats.analyzeLegacyStatsCsv(csvPath, { rootDir: dir }),
      /Not a stats dataset/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('analyzeLegacyStatsCsv refuses an empty path so no default stats.csv can be resolved', () => {
  assert.throws(() => stats.analyzeLegacyStatsCsv(''), /requires an explicit --csv-file path/);
  assert.throws(() => stats.analyzeLegacyStatsCsv(undefined), /requires an explicit --csv-file path/);
});

test('px stats import-legacy requires --csv-file and exits 1 without it', () => {
  const { err, exitCode } = runImport([], path.join(os.tmpdir(), 'px-never-created.db'));
  assert.equal(exitCode, 1);
  assert.match(err, /requires --csv-file/);
});

test('px stats import-legacy dry run prints the read-only notice and does not apply', () => {
  const { dir, csvPath, dbPath } = fixture('cmd-dryrun', [HEADERS, row()]);
  try {
    const { out, exitCode } = runImport(['--csv-file', csvPath], dbPath);
    assert.equal(exitCode, null);
    assert.match(out, /Legacy stats CSV: .*legacy-stats\.csv \(read-only\)/);
    assert.match(out, /1 rows read, 1 importable/);
    assert.match(out, /Dry run: nothing was written/);
    assert.equal(fs.existsSync(dbPath), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('px stats import-legacy --apply reports the import and leaves the source unchanged', () => {
  const { dir, csvPath, dbPath } = fixture('cmd-apply', [HEADERS, row()]);
  try {
    const before = digest(csvPath);
    const { out, exitCode } = runImport(['--csv-file', csvPath, '--apply', '--json'], dbPath);
    assert.equal(exitCode, null);
    const payload = JSON.parse(out);
    assert.equal(payload.importable, 1);
    assert.deepEqual(payload.malformed, []);
    assert.equal(payload.applied.applied, 1);
    assert.equal(digest(csvPath), before);
    assert.equal(stats.loadMeasurementRows({ dbPath }).rows.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
