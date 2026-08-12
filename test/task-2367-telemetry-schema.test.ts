import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../src/adapters/sqlite/migration-runner.js';
import { SqliteMeasurementStore } from '../src/adapters/sqlite/measurement-store.js';

test('TASK-2367: migrated telemetry has no completion column and preserves legacy repair evidence', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-task-2367-schema-'));
  const databasePath = path.join(directory, 'fixture.db');
  const db = new SqliteDatabaseAdapter();
  try {
    await db.open({ path: databasePath });
    await new SqliteMigrationRunner(db).applyPending(loadDefaultMigrations());
    const columns = await db.query<{ name: string }>('PRAGMA table_info(usage_statistics)');
    assert.ok(!columns.some((column) => column.name === 'closed'));
    const evidence = await db.query('SELECT name FROM sqlite_master WHERE type = \'table\' AND name = \'legacy_usage_completion_evidence\'');
    assert.equal(evidence.length, 1);
  } finally {
    await db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('TASK-2367: telemetry writes reject no completion field', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-task-2367-store-'));
  try {
    const store = new SqliteMeasurementStore(path.join(directory, 'fixture.db'));
    store.upsertMeasurement({ repo: 'repo', mission: 'task-2367', stage: 'integration', actorKey: 'codex' });
    assert.equal('closed' in store.listMeasurements()[0]!, false);
    store.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
