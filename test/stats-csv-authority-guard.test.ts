// @ts-nocheck -- TASK-2328: partial test doubles from ESM seam migration; resolve in follow-up
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const _require = createRequire(import.meta.url);

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

import stats, { createStatsCommand, createStatsWorkflowAdapter } from '../src/adapters/cli/commands/stats.js';
import { StatsCommandUseCase } from '../src/application/stats-command-use-case.js';
import { SqliteMeasurementStore } from '../src/adapters/sqlite/measurement-store.js';

// Render-only `px stats` command: the tested paths read measurement rows and
// never consult the Mission authority, so a store placeholder satisfies the
// required wiring (SC13).
const statsCommand = createStatsCommand(
  new StatsCommandUseCase(createStatsWorkflowAdapter({} as never)),
);
import { ADR0053_PERSISTENCE_INVENTORY } from './fixtures/durable-state-inventory';
/**
 * TASK-2322.08 CP-4: prove no UNCLASSIFIED `stats.csv` read or write survives.
 *
 * Statistics are SQLite-owned; source code must not retain a stats CSV path.
 */

const SRC_ROOT = path.resolve(__dirname, '..', 'src');

/** Every `.ts` file under `src/`, excluding the checked inventory itself. */
function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      sourceFiles(full, acc);
    } else if (entry.name.endsWith('.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

/** Strip line and block comments so a doc mention is not counted as access. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

test('no source file references stats.csv in executable code', () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(SRC_ROOT)) {
    const code = stripComments(fs.readFileSync(file, 'utf8'));
    if (/stats\.csv/.test(code)) {
      offenders.push(path.relative(SRC_ROOT, file));
    }
  }
  assert.deepEqual(offenders, [], `unclassified stats.csv reference in: ${offenders.join(', ')}`);
});

test('no source file resolves a default stats CSV path or writes CSV for statistics', () => {
  const removedHelpers = [
    'resolveStatsPath',
    'resolveStatsFilePath',
    'resolveStatsCsvPath',
    'resolveRepoStatsCsvPath',
    'saveStatsCsv',
    'loadStatsCsv',
    'upsertStatsRow',
    'migrateStats',
  ];
  const offenders: string[] = [];
  for (const file of sourceFiles(SRC_ROOT)) {
    const code = stripComments(fs.readFileSync(file, 'utf8'));
    for (const helper of removedHelpers) {
      if (new RegExp(`\\b${helper}\\s*\\(`).test(code)) {
        offenders.push(`${path.relative(SRC_ROOT, file)}: ${helper}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `removed CSV helper still called: ${offenders.join(', ')}`);
});

test('the ADR 0053 inventory has no stats CSV compatibility boundary', () => {
  const statsEntries = ADR0053_PERSISTENCE_INVENTORY.filter(
    (entry: any) => entry.fileLocation === 'src/adapters/cli/commands/stats.ts'
      && (entry.concept === 'AgentRunMeasurement' || entry.concept === 'MissionOutcome'),
  );
  assert.deepEqual(
    statsEntries.map((entry: any) => [entry.id, entry.operation, entry.classification]),
    [],
  );

  // The default measurement authority is the SQLite store, for both concepts.
  const defaults = ADR0053_PERSISTENCE_INVENTORY
    .filter((entry: any) => (entry.concept === 'AgentRunMeasurement' || entry.concept === 'MissionOutcome')
      && entry.pathType === 'default')
    .map((entry: any) => entry.fileLocation);
  assert.ok(defaults.includes('src/adapters/sqlite/measurement-store.ts'));
});

test('px stats fails with the database error instead of reading a CSV when the store is unavailable', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'px-stats-dbfail-'));
  const dbPath = path.join(dir, 'parallix.db');
  // The database path is a directory: it cannot be opened.
  fs.mkdirSync(dbPath);
  // A perfectly valid stats CSV sits right beside it and must be ignored.
  const decoy = path.join(dir, 'stats.csv');
  fs.writeFileSync(decoy, [
    'date,mission,classification,implementer,pr_fix_rounds',
    '2026-06-23,task-decoy,ai_sdlc,codex,1',
  ].join('\n'), 'utf8');
  const decoyBefore = fs.readFileSync(decoy, 'utf8');

  const logs: string[] = [];
  const errors: string[] = [];
  let exitCode: number | null = null;
  try {
    statsCommand(['--today', '2026-06-23'], {
      rootDir: dir,
      dbPath,
      log: (line: string) => logs.push(String(line)),
      error: (line: string) => errors.push(String(line)),
      exit: (code: number) => { exitCode = code; },
    });

    assert.equal(exitCode, 1);
    assert.match(errors.join('\n'), /Measurement database unavailable/);
    assert.doesNotMatch(logs.join('\n'), /task-decoy/);
    assert.equal(fs.readFileSync(decoy, 'utf8'), decoyBefore);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a recorded measurement survives a full store restart and is still reported by px stats', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'px-stats-restart-'));
  const dbPath = path.join(dir, 'parallix.db');
  try {
    stats.upsertMeasurementRow(
      {
        date: '2026-06-23', repo: 'parallix', mission: 'task-restart',
        classification: 'ai_sdlc', implementer: 'codex', pr_fix_rounds: '2',
      },
      { dbPath, rootDir: dir },
    );

    // Simulate a process restart: a brand-new store handle over the same file.
    const reopened = new SqliteMeasurementStore(dbPath);
    try {
      const rows = reopened.listMeasurements();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].mission, 'task-restart');
    } finally {
      reopened.close();
    }

    const logs: string[] = [];
    statsCommand(['--today', '2026-06-23'], {
      rootDir: dir,
      dbPath,
      log: (line: string) => logs.push(String(line)),
      error: (line: string) => logs.push(`ERR:${String(line)}`),
      exit: (code: number) => { throw new Error(`unexpected exit ${code}`); },
    });
    assert.match(logs.join('\n'), /Loaded 1 measurements from the statistics database/);
    assert.deepEqual(fs.readdirSync(dir).filter(name => name.endsWith('.csv')), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('concurrent measurement updates through the command layer retain every required record', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'px-stats-concurrent-'));
  const dbPath = path.join(dir, 'parallix.db');
  // Two independent store handles stand in for two runtime processes writing
  // the same database file.
  const writerA = new SqliteMeasurementStore(dbPath);
  const writerB = new SqliteMeasurementStore(dbPath);
  try {
    const base = {
      date: '2026-06-23', repo: 'parallix', classification: 'ai_sdlc',
      implementer: 'codex', pr_fix_rounds: '0',
    };
    stats.upsertMeasurementRow({ ...base, mission: 'task-one', stage: 'active' }, { store: writerA, rootDir: dir });
    stats.upsertMeasurementRow({ ...base, mission: 'task-two', stage: 'active' }, { store: writerB, rootDir: dir });
    stats.upsertMeasurementRow({ ...base, mission: 'task-one', stage: 'review', implementer: 'claude' }, { store: writerB, rootDir: dir });
    stats.upsertMeasurementRow({ ...base, mission: 'task-two', stage: 'draft' }, { store: writerA, rootDir: dir });

    const rows = stats.loadMeasurementRows({ dbPath }).rows;
    assert.deepEqual(
      rows.map((r: any) => `${r.mission}:${r.stage}`).sort(),
      ['task-one:active', 'task-one:review', 'task-two:active', 'task-two:draft'],
    );
  } finally {
    writerA.close();
    writerB.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
