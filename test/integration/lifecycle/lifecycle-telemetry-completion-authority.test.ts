import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { ConcreteMetricsReadAdapter } from '../../../src/application/projections/metrics-read-adapter.js';
import { missionId } from '../../../src/domain/mission.js';
import { repositoryId } from '../../../src/domain/repository.js';
import { insertUsageRow, laneEvent, withStatisticsDatabase } from '../../fixtures/statistics-database.js';
import { prepareMigratedSchema } from '../../fixtures/migrated-database.js';

// Reuse the current migrated schema; every case still owns its writable copy.
before(prepareMigratedSchema);

test('TASK-2367: telemetry cannot complete an integration Mission and null review fixes stay null', async () => {
  const repo = repositoryId('task-2367-regression');
  const id = missionId('task-2367-integration');
  await withStatisticsDatabase(async ({ db, laneEventRepo: events, usageRepo }) => {
    await events.append(laneEvent({ repositoryId: repo, missionId: id, from: 'active', to: 'integration', at: '2026-08-12T09:00:00.000Z' }));
    await insertUsageRow(db, { repo, mission: id, date: '2026-08-12', prFixRounds: null, durationMinutes: 4 });
    const adapter = new ConcreteMetricsReadAdapter({ laneEventRepo: events, usageRepo, repositoryId: repo });
    assert.deepEqual(await adapter.readOutcomes(), []);
    assert.equal((await usageRepo.findAll())[0]!.pr_fix_rounds, undefined);
    const columns = await db.query<{ name: string }>('PRAGMA table_info(usage_statistics)');
    assert.ok(!columns.some(column => column.name === 'closed'));
  });
});
