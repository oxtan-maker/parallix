import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { SqliteMeasurementStore } from '../../../../src/adapters/sqlite/measurement-store.js';
import { MeasurementStoreUnavailableError } from '../../../../src/application/measurement-ports.js';
import { mkdtemp as registeredMkdtemp } from '../../../helpers/temp-dir.js';

/**
 * TASK-2322.08 CP-2: the `MeasurementStorePort` / SQLite cut-over.
 *
 * Every test uses its own temporary database file. Nothing here touches
 * PARALLIX_HOME, Forgejo, an agent, or a child process.
 */

interface MeasureFixture {
  readonly dir: string;
  readonly dbPath: string;
}

function createMeasureFixture(label: string): MeasureFixture {
  const dir = registeredMkdtemp(`px-measure-${label}-`);
  return { dir, dbPath: path.join(dir, 'parallix.db') };
}

/**
 * TASK-2577: fixture teardown. Close the store first — that releases the
 * SQLite handle and removes the WAL and SHM sidecar files — then delete the
 * whole fixture root so a focused run leaves no px-measure-* directory in
 * os.tmpdir(). `close()` is idempotent, so already-closed stores are safe.
 */
function disposeMeasureFixture(dir: string, ...stores: Array<SqliteMeasurementStore | undefined>) {
  for (const store of stores) {
    store?.close();
  }
  fs.rmSync(dir, { recursive: true, force: true });
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
  const fixture = createMeasureFixture('roundtrip');
  let store: SqliteMeasurementStore | undefined;
  try {
    store = new SqliteMeasurementStore(fixture.dbPath);
    const result = store.upsertMeasurement(measurement());
    assert.equal(result.changed, true);

    const rows = store.listMeasurements();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].mission, 'task-9001');
    assert.equal(rows[0].input_tokens, 100);
    assert.equal(rows[0].cost_usd, 0.5);

    const dir = path.dirname(fixture.dbPath);
    assert.deepEqual(fs.readdirSync(dir).filter(f => f.endsWith('.csv')), []);
  } finally {
    disposeMeasureFixture(fixture.dir, store);
  }
});

test('measurement store keys rows by (repo, mission, stage, actorKey) and never invents a per-run identity', () => {
  const fixture = createMeasureFixture('identity');
  let store: SqliteMeasurementStore | undefined;
  try {
    store = new SqliteMeasurementStore(fixture.dbPath);
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
    disposeMeasureFixture(fixture.dir, store);
  }
});

test('measurement store reports changed=false when an identical record is re-applied', () => {
  const fixture = createMeasureFixture('idempotent');
  let store: SqliteMeasurementStore | undefined;
  try {
    store = new SqliteMeasurementStore(fixture.dbPath);
    assert.equal(store.upsertMeasurement(measurement()).changed, true);
    assert.equal(store.upsertMeasurement(measurement()).changed, false);
    assert.equal(store.upsertMeasurement(measurement({ tool_calls: 8 })).changed, true);
    assert.equal(store.listMeasurements().length, 1);
  } finally {
    disposeMeasureFixture(fixture.dir, store);
  }
});

test('a measurement remains available after the store is closed and reopened (restart)', () => {
  const fixture = createMeasureFixture('restart');
  let first: SqliteMeasurementStore | undefined;
  let second: SqliteMeasurementStore | undefined;
  try {
    first = new SqliteMeasurementStore(fixture.dbPath);
    first.upsertMeasurement(measurement({ mission: 'task-restart' }));
    first.close();
    first = undefined;

    second = new SqliteMeasurementStore(fixture.dbPath);
    const rows = second.listMeasurements();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].mission, 'task-restart');
    assert.equal(rows[0].input_tokens, 100);
  } finally {
    disposeMeasureFixture(fixture.dir, first, second);
  }
});

test('concurrent measurement updates from two open connections retain every required record', () => {
  const fixture = createMeasureFixture('concurrent');
  let writerA: SqliteMeasurementStore | undefined;
  let writerB: SqliteMeasurementStore | undefined;
  let reader: SqliteMeasurementStore | undefined;
  try {
    writerA = new SqliteMeasurementStore(fixture.dbPath);
    writerB = new SqliteMeasurementStore(fixture.dbPath);
    reader = new SqliteMeasurementStore(fixture.dbPath);
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
    disposeMeasureFixture(fixture.dir, writerA, writerB, reader);
  }
});

test('upsertAll commits the whole batch or nothing, never a partial import', () => {
  const fixture = createMeasureFixture('atomic');
  let store: SqliteMeasurementStore | undefined;
  try {
    store = new SqliteMeasurementStore(fixture.dbPath);
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
    disposeMeasureFixture(fixture.dir, store);
  }
});

test('database failure raises MeasurementStoreUnavailableError and accesses no CSV', () => {
  const fixture = createMeasureFixture('fail');
  const dbPath = fixture.dbPath;
  try {
    // A directory where the database file is expected cannot be opened.
    fs.mkdirSync(dbPath);
    // A CSV sitting right next to it must never be consulted as a fallback.
    fs.writeFileSync(path.join(fixture.dir, 'stats.csv'), 'date,mission,classification,implementer,pr_fix_rounds\n');

    const readsBefore = fs.readFileSync(path.join(fixture.dir, 'stats.csv'), 'utf8');
    assert.throws(() => new SqliteMeasurementStore(dbPath), MeasurementStoreUnavailableError);
    assert.equal(fs.readFileSync(path.join(fixture.dir, 'stats.csv'), 'utf8'), readsBefore);
  } finally {
    disposeMeasureFixture(fixture.dir);
  }
});

test('measurement store preserves unavailable numeric measurements as undefined, not zero', () => {
  const fixture = createMeasureFixture('unavailable');
  let store: SqliteMeasurementStore | undefined;
  try {
    store = new SqliteMeasurementStore(fixture.dbPath);
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
    disposeMeasureFixture(fixture.dir, store);
  }
});
