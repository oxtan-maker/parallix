import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../src/adapters/sqlite/migration-runner.js';
import { SqliteBoardLaneEventRepository } from '../src/adapters/sqlite/board-lane-event-repository.js';
import { SqliteUsageRepository } from '../src/adapters/sqlite/usage-repository.js';
import { ConcreteMetricsReadAdapter } from '../src/application/projections/metrics-read-adapter.js';
import { missionId } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';
import { insertUsageRow, laneEvent } from './fixtures/task-2357-statistics-fixture.js';

test('TASK-2367: telemetry cannot complete an integration Mission and null review fixes stay null', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-task-2367-regression-'));
  const databasePath = path.join(directory, 'fixture.db');
  const db = new SqliteDatabaseAdapter();
  const repo = repositoryId('task-2367-regression');
  const id = missionId('task-2367-integration');
  try {
    await db.open({ path: databasePath });
    await new SqliteMigrationRunner(db).applyPending(loadDefaultMigrations());
    const events = new SqliteBoardLaneEventRepository(db);
    await events.append(laneEvent({ repositoryId: repo, missionId: id, from: 'active', to: 'integration', at: '2026-08-12T09:00:00.000Z' }));
    await insertUsageRow(db, { repo, mission: id, date: '2026-08-12', prFixRounds: null, durationMinutes: 4 });
    const adapter = new ConcreteMetricsReadAdapter({ laneEventRepo: events, usageRepo: new SqliteUsageRepository(db), repositoryId: repo });
    assert.deepEqual(await adapter.readOutcomes(), []);
    assert.equal((await new SqliteUsageRepository(db).findAll())[0]!.pr_fix_rounds, undefined);
    const columns = await db.query<{ name: string }>('PRAGMA table_info(usage_statistics)');
    assert.ok(!columns.some(column => column.name === 'closed'));
  } finally {
    await db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
