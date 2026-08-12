import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../src/adapters/sqlite/migration-runner.js';
import { SqliteMissionStore } from '../src/adapters/sqlite/mission-store.js';
import { SqliteBoardLaneEventRepository } from '../src/adapters/sqlite/board-lane-event-repository.js';
import { SqliteUsageRepository } from '../src/adapters/sqlite/usage-repository.js';
import { MissionIntegrationService } from '../src/application/mission-integration-service.js';
import { ConcreteMetricsReadAdapter } from '../src/application/projections/metrics-read-adapter.js';
import { missionId } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';
import { resolveCanonicalRepositoryId } from '../src/adapters/git/repository-identity.js';
import { insertUsageRow, laneEvent, createPrimaryAndWorktree } from './fixtures/task-2357-statistics-fixture.js';
import { renderWeeklyStatsReport, measurementToStatsRow } from '../src/adapters/cli/commands/stats.js';

test('TASK-2367 certification: persisted lifecycle owns success, failure, retry, telemetry, BoardMetrics, and report', async () => {
  const checkout = createPrimaryAndWorktree('task-2367-certification');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-task-2367-certification-'));
  const databasePath = path.join(directory, 'parallix.db');
  const db = new SqliteDatabaseAdapter();
  const repo = resolveCanonicalRepositoryId(checkout.worktree);
  assert.equal(repo, repositoryId(path.basename(checkout.primary)));
  const landed = missionId('task-2367-landed');
  const failed = missionId('task-2367-failed');
  const telemetryOnly = missionId('task-2367-telemetry-only');
  try {
    await db.open({ path: databasePath });
    await new SqliteMigrationRunner(db).applyPending(loadDefaultMigrations());
    for (const id of [landed, failed, telemetryOnly]) {
      await db.execute(`INSERT INTO missions (id, repository_id, title, status, raw_status, assignee, net_engineering_lines, closed_at, version)
        VALUES (?, ?, ?, 'integration', 'integration', 'codex', 0, NULL, 1)`, [id, repo, id]);
    }
    const events = new SqliteBoardLaneEventRepository(db);
    await events.append(laneEvent({ repositoryId: repo, missionId: landed, from: 'active', to: 'integration', at: '2026-08-10T10:00:00.000Z' }));
    await events.append(laneEvent({ repositoryId: repo, missionId: failed, from: 'active', to: 'integration', at: '2026-08-10T10:00:00.000Z' }));
    await events.append(laneEvent({ repositoryId: repo, missionId: telemetryOnly, from: 'active', to: 'integration', at: '2026-08-10T10:00:00.000Z' }));
    await insertUsageRow(db, { repo, mission: landed, date: '2026-08-12', prFixRounds: 2, durationMinutes: 5 });
    await insertUsageRow(db, { repo, mission: telemetryOnly, date: '2026-08-12', prFixRounds: 0, durationMinutes: 9 });

    const store = new SqliteMissionStore(db);
    const service = new MissionIntegrationService(store);
    const before = await new ConcreteMetricsReadAdapter({ laneEventRepo: events, usageRepo: new SqliteUsageRepository(db), repositoryId: repo, clock: () => '2026-08-12T12:00:00.000Z' })
      .buildMetrics(new Map([[landed, 'integration'], [failed, 'integration'], [telemetryOnly, 'integration']]));
    assert.equal(before.decisionWindow?.current.completedMissions, 0);

    const loaded = await store.load(landed);
    assert.equal(loaded.kind, 'found');
    const success = await service.decideIntegration({
      operationId: 'certify-landed', missionId: landed, expectedVersion: loaded.version,
      capabilities: new Set(['integration:decide']), occurredAt: '2026-08-11T11:00:00.000Z',
      facts: { git: { source: 'git', status: 'fresh', value: { merged: true } }, verification: { source: 'git', status: 'fresh', value: { passed: true } } },
    });
    assert.equal(success.status, 'completed');
    const failedLoaded = await store.load(failed);
    assert.equal(failedLoaded.kind, 'found');
    const failure = await service.decideIntegration({
      operationId: 'certify-failure', missionId: failed, expectedVersion: failedLoaded.version,
      capabilities: new Set(['integration:decide']),
      facts: { git: { source: 'git', status: 'fresh', value: { merged: false } }, verification: { source: 'git', status: 'fresh', value: { passed: true } } },
    });
    assert.equal(failure.status, 'failed');

    const usage = new SqliteUsageRepository(db);
    const adapter = new ConcreteMetricsReadAdapter({ laneEventRepo: events, usageRepo: usage, repositoryId: repo, clock: () => '2026-08-12T12:00:00.000Z' });
    const after = await adapter.buildMetrics(new Map([[landed, 'done'], [failed, 'integration'], [telemetryOnly, 'integration']]));
    assert.equal(after.decisionWindow?.current.completedMissions, 1);
    const doneEvents = (await events.findByMissionId(landed)).filter(event => event.fromStatus === 'integration' && event.toStatus === 'done');
    assert.equal(doneEvents.length, 1);
    assert.equal((await store.load(failed) as any).mission.status, 'integration');
    assert.deepEqual((await adapter.readOutcomes()).map(outcome => outcome.missionId), [landed]);
    const retry = await store.load(landed);
    assert.equal((retry as any).mission.status, 'done');
    const repeated = await service.decideIntegration({
      operationId: 'certify-landed-retry', missionId: landed, expectedVersion: (retry as any).version,
      capabilities: new Set(['integration:decide']), occurredAt: '2026-08-11T11:00:00.000Z',
      facts: { git: { source: 'git', status: 'fresh', value: { merged: true } }, verification: { source: 'git', status: 'fresh', value: { passed: true } } },
    });
    assert.equal(repeated.status, 'failed');
    assert.equal((await events.findByMissionId(landed)).filter(event => event.toStatus === 'done').length, 1);
    assert.equal((await adapter.buildMetrics(new Map([[landed, 'done'], [failed, 'integration'], [telemetryOnly, 'integration']]))).decisionWindow?.current.completedMissions, 1);
    const report = renderWeeklyStatsReport((await usage.findAll()).map(measurementToStatsRow), {
      today: '2026-08-12', missionFlow: (await adapter.readOutcomes()).map(outcome => ({ repo, mission: outcome.missionId, closedAt: outcome.closedAt, labels: outcome.labels })),
    });
    assert.match(report, /# completed missions[\s\S]*\n1\s/);
  } finally {
    await db.close();
    checkout.cleanup();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
