import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../src/adapters/sqlite/migration-runner.js';
import { repairTask2367 } from '../scripts/repair-task-2367.js';

test('TASK-2367: repair closes only the two approved historical missions before removing telemetry closed', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-task-2367-repair-'));
  const databasePath = path.join(directory, 'fixture.db');
  const db = new SqliteDatabaseAdapter();
  try {
    await db.open({ path: databasePath });
    await new SqliteMigrationRunner(db).applyPending(loadDefaultMigrations().filter((migration) => migration.id !== '0014-remove-usage-closed'));
    for (const id of ['task-2002', 'task-2322.07', 'task-2324', 'task-2329']) {
      await db.execute(`INSERT INTO missions (id, repository_id, title, status, raw_status, assignee, net_engineering_lines, closed_at, version)
        VALUES (?, 'parallix', ?, 'integration', 'ready-for-integration', 'codex', 0, NULL, 1)`, [id, id]);
    }
    await db.execute("INSERT INTO usage_statistics (repo, mission, closed) VALUES ('parallix', 'task-2322.07', 'yes'), ('parallix', 'task-2329', 'yes')");
    await db.close();
    const report = await repairTask2367(databasePath, () => true);
    assert.deepEqual(report, {
      scanned: 4, repairedCompletion: 2, alreadyCorrect: 0,
      skipped: ['task-2002', 'task-2324'], closedRemoved: true,
    });
    const second = await repairTask2367(databasePath, () => true);
    assert.deepEqual(second, {
      scanned: 4, repairedCompletion: 0, alreadyCorrect: 2,
      skipped: ['task-2002', 'task-2324'], closedRemoved: true,
    });

    await db.open({ path: databasePath });
    const missions = await db.query<{ id: string; status: string }>('SELECT id, status FROM missions ORDER BY id');
    assert.deepEqual(missions.map((mission) => ({ ...mission })), [
      { id: 'task-2002', status: 'integration' }, { id: 'task-2322.07', status: 'done' },
      { id: 'task-2324', status: 'integration' }, { id: 'task-2329', status: 'done' },
    ]);
    const events = await db.query<{ mission_id: string }>("SELECT mission_id FROM board_lane_events WHERE to_status = 'done' ORDER BY mission_id");
    assert.deepEqual(events.map((event) => ({ ...event })), [{ mission_id: 'task-2322.07' }, { mission_id: 'task-2329' }]);
    const columns = await db.query<{ name: string }>('PRAGMA table_info(usage_statistics)');
    assert.ok(!columns.some((column) => column.name === 'closed'));
  } finally {
    await db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
