import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { SqliteMeasurementStore } from '../src/adapters/sqlite/measurement-store.js';
import { MeasurementStoreUnavailableError } from '../src/application/measurement-ports.js';

/**
 * TASK-2322.08 CP-2: the `MeasurementStorePort` / SQLite cut-over.
 *
 * Every test uses its own temporary database file. Nothing here touches
 * PARALLIX_HOME, Forgejo, an agent, or a child process.
 */

function tempDbPath(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `px-measure-${label}-`));
  return path.join(dir, 'parallix.db');
}

function measurement(overrides: Record<string, unknown> = {}) {
  return {
    repo: 'parallix',
    mission: 'task-9001',
    stage: 'active',
    actorKey: 'codex',
    date: '2026-07-20',
    classification: 'ai_sdlc',
    implementer: 'codex',
    pr_fix_rounds: 1,
    provider: 'openai',
    model: 'gpt-5.4',
    implementer_agent: 'codex',
    reviewer_agent: '',
    input_tokens: 100,
    output_tokens: 20,
    cached_tokens: 5,
    context_tokens: 200,
    tool_calls: 7,
    openai_usage_before: 0,
    openai_usage_after: 12,
    openai_usage_delta: 0,
    duration_minutes: 3,
    cost_usd: 0.5,
    ...overrides,
  };
}

test('measurement store persists an AgentRunMeasurement and reads it back with no CSV', () => {
  const dbPath = tempDbPath('roundtrip');
  const store = new SqliteMeasurementStore(dbPath);
  try {
    const result = store.upsertMeasurement(measurement());
    assert.equal(result.changed, true);

    const rows = store.listMeasurements();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].mission, 'task-9001');
    assert.equal(rows[0].input_tokens, 100);
    assert.equal(rows[0].cost_usd, 0.5);

    const dir = path.dirname(dbPath);
    assert.deepEqual(fs.readdirSync(dir).filter(f => f.endsWith('.csv')), []);
  } finally {
    store.close();
  }
});

test('measurement store keys rows by (repo, mission, stage, actorKey) and never invents a per-run identity', () => {
  const dbPath = tempDbPath('identity');
  const store = new SqliteMeasurementStore(dbPath);
  try {
    store.upsertMeasurement(measurement());
    store.upsertMeasurement(measurement({ stage: 'review', actorKey: 'claude', reviewer_agent: 'claude' }));
    store.upsertMeasurement(measurement({ actorKey: 'claude', implementer_agent: 'claude' }));
    // A second launch of the SAME (repo, mission, stage, actor) replaces the
    // existing row rather than creating a new per-launch record.
    store.upsertMeasurement(measurement({ input_tokens: 999 }));

    const rows = store.listMeasurements();
    assert.equal(rows.length, 3);
    const active = rows.filter(row => row.stage === 'active' && row.actorKey === 'codex');
    assert.equal(active.length, 1);
    assert.equal(active[0].input_tokens, 999);
  } finally {
    store.close();
  }
});

test('measurement store reports changed=false when an identical record is re-applied', () => {
  const dbPath = tempDbPath('idempotent');
  const store = new SqliteMeasurementStore(dbPath);
  try {
    assert.equal(store.upsertMeasurement(measurement()).changed, true);
    assert.equal(store.upsertMeasurement(measurement()).changed, false);
    assert.equal(store.upsertMeasurement(measurement({ tool_calls: 8 })).changed, true);
    assert.equal(store.listMeasurements().length, 1);
  } finally {
    store.close();
  }
});

test('a measurement remains available after the store is closed and reopened (restart)', () => {
  const dbPath = tempDbPath('restart');
  const first = new SqliteMeasurementStore(dbPath);
  first.upsertMeasurement(measurement({ mission: 'task-restart' }));
  first.close();

  const second = new SqliteMeasurementStore(dbPath);
  try {
    const rows = second.listMeasurements();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].mission, 'task-restart');
    assert.equal(rows[0].input_tokens, 100);
  } finally {
    second.close();
  }
});

test('concurrent measurement updates from two open connections retain every required record', () => {
  const dbPath = tempDbPath('concurrent');
  const writerA = new SqliteMeasurementStore(dbPath);
  const writerB = new SqliteMeasurementStore(dbPath);
  const reader = new SqliteMeasurementStore(dbPath);
  try {
    // Interleave the two writers so neither observes an empty table first.
    writerA.upsertMeasurement(measurement({ mission: 'task-a', actorKey: 'codex' }));
    writerB.upsertMeasurement(measurement({ mission: 'task-b', actorKey: 'claude', implementer_agent: 'claude' }));
    writerA.upsertMeasurement(measurement({ mission: 'task-a', stage: 'review', actorKey: 'claude' }));
    writerB.upsertMeasurement(measurement({ mission: 'task-b', stage: 'review', actorKey: 'codex' }));

    const missions = reader.listMeasurements().map(row => `${row.mission}:${row.stage}:${row.actorKey}`).sort();
    assert.deepEqual(missions, [
      'task-a:active:codex',
      'task-a:review:claude',
      'task-b:active:claude',
      'task-b:review:codex',
    ]);
  } finally {
    writerA.close();
    writerB.close();
    reader.close();
  }
});

test('upsertAll commits the whole batch or nothing, never a partial import', () => {
  const dbPath = tempDbPath('atomic');
  const store = new SqliteMeasurementStore(dbPath);
  try {
    assert.throws(
      () => store.upsertAll([
        measurement({ mission: 'task-good' }),
        // `repo` is NOT NULL in the schema — this record cannot be bound.
        measurement({ mission: 'task-bad', repo: null as unknown as string }),
      ]),
      MeasurementStoreUnavailableError,
    );
    assert.equal(store.listMeasurements().length, 0);
  } finally {
    store.close();
  }
});

test('database failure raises MeasurementStoreUnavailableError and accesses no CSV', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'px-measure-fail-'));
  const dbPath = path.join(dir, 'parallix.db');
  // A directory where the database file is expected cannot be opened.
  fs.mkdirSync(dbPath);
  // A CSV sitting right next to it must never be consulted as a fallback.
  fs.writeFileSync(path.join(dir, 'stats.csv'), 'date,mission,classification,implementer,pr_fix_rounds\n');

  const readsBefore = fs.readFileSync(path.join(dir, 'stats.csv'), 'utf8');
  assert.throws(() => new SqliteMeasurementStore(dbPath), MeasurementStoreUnavailableError);
  assert.equal(fs.readFileSync(path.join(dir, 'stats.csv'), 'utf8'), readsBefore);
});

test('measurement store preserves unavailable numeric measurements as undefined, not zero', () => {
  const dbPath = tempDbPath('unavailable');
  const store = new SqliteMeasurementStore(dbPath);
  try {
    store.upsertMeasurement({
      repo: 'parallix',
      mission: 'task-sparse',
      stage: 'default',
      actorKey: 'codex',
      classification: 'ai_sdlc',
      implementer: 'codex',
    });
    const [row] = store.listMeasurements();
    assert.equal(row.input_tokens, undefined);
    assert.equal(row.cost_usd, undefined);
  } finally {
    store.close();
  }
});
