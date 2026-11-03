import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp } from '../../helpers/temp-dir.js';
import path from 'node:path';
import { copyMigratedSchema, prepareMigratedSchema } from '../../fixtures/migrated-database.js';
import { fixtureMission } from '../../fixtures/mission-builders.js';
import { repeatReview } from '../../fixtures/repeat-review.js';
import { SqliteDatabaseAdapter } from '../../../src/adapters/sqlite/database-adapter.js';
import { SqliteMissionStore } from '../../../src/adapters/sqlite/mission-store.js';
import { SqliteMeasurementStore } from '../../../src/adapters/sqlite/measurement-store.js';
import { LegacyStatsBackfillAdapter } from '../../../src/adapters/mission/stats-backfill-adapter.js';
import { StatsBackfillService } from '../../../src/application/stats-backfill-service.js';
import { statsBackfill } from '../../../src/adapters/cli/commands/stats-backfill.js';
import { resolveStatsRepoName } from '../../../src/adapters/cli/commands/stats.js';
import { repositoryId } from '../../../src/domain/repository.js';
import { missionLabels } from '../../../src/domain/mission.js';

await prepareMigratedSchema();

test('reconstruction repairs existing rows, defaults to dry-run and preserves raw evidence (TASK-2818)', async t => {
  const root = mkdtemp('review-statistics-backfill-');
  let measurements: SqliteMeasurementStore | undefined;
  const db = new SqliteDatabaseAdapter();
  t.after(async () => { measurements?.close(); await db.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const dbPath = path.join(root, 'copy.db');
  copyMigratedSchema(dbPath);
  await db.open({ path: dbPath });
  const missions = new SqliteMissionStore(db);
  const repo = repositoryId(resolveStatsRepoName(root));
  const mission = fixtureMission('task-2818', { repositoryId: repo, labels: missionLabels(['ai_sdlc']),
    closedAt: '2026-10-01T12:00:00Z', review: repeatReview() });
  await missions.save(mission, null);
  measurements = new SqliteMeasurementStore(dbPath);
  measurements.upsertMeasurement({ repo, mission: mission.id, stage: 'default', actorKey: 'codex|legacy-rollup',
    implementer: 'codex', date: '2026-10-01', classification: 'ai_sdlc', pr_fix_rounds: 0 });
  const before = JSON.stringify((await missions.load(mission.id)));
  const service = new StatsBackfillService(new LegacyStatsBackfillAdapter(root, { store: measurements }, missions));
  const logs: string[] = [];
  const options = { service, log: (line: string) => logs.push(line), error: (line: string) => { throw new Error(line); },
    exit: (code?: number) => { throw new Error(`unexpected exit ${code}`); } };
  await statsBackfill(['--json'], options);
  const dry = JSON.parse(logs.pop()!);
  assert.equal(dry.changed, 0);
  assert.deepEqual(dry.changes[0].before, [0]);
  assert.equal(dry.changes[0].after, 1);
  assert.deepEqual(dry.coverage, { missions: 1, before: 1, after: 1 });
  assert.equal(measurements.listMeasurements()[0].pr_fix_rounds, 0, 'dry-run writes nothing');
  logs.length = 0;
  await statsBackfill(['--apply', '--json'], options);
  assert.equal(JSON.parse(logs.pop()!).changed, 1);
  assert.equal(measurements.listMeasurements().length, 1, 'the existing measurement identity is repaired in place');
  assert.equal(measurements.listMeasurements()[0].actorKey, 'codex|legacy-rollup');
  assert.equal(measurements.listMeasurements()[0].pr_fix_rounds, 1);
  assert.equal(measurements.listMeasurements()[0].duration_minutes, undefined, 'missing resource telemetry stays unavailable');
  assert.equal(measurements.listMeasurements()[0].cost_usd, undefined, 'reconstruction only updates review measurements');
  logs.length = 0;
  await statsBackfill(['--apply', '--json'], options);
  assert.equal(JSON.parse(logs.pop()!).changed, 0, 'reapplying is idempotent');
  assert.equal(JSON.stringify(await missions.load(mission.id)), before, 'raw Review evidence is unchanged');
  logs.length = 0;
  await statsBackfill(['--help'], options);
  assert.match(logs.join('\n'), /Dry-run is the default/);
  logs.length = 0;
  await statsBackfill([], options);
  assert.match(logs.join('\n'), /Reconciled mission coverage: 1 -> 1\/1/);
});

test('reconstruction discloses missing histories, skips active work and fails closed without authority', async t => {
  const root = mkdtemp('review-statistics-unknown-');
  let measurements: SqliteMeasurementStore | undefined;
  t.after(() => { measurements?.close(); fs.rmSync(root, { recursive: true, force: true }); });
  measurements = new SqliteMeasurementStore(path.join(root, 'copy.db'));
  const repo = repositoryId(resolveStatsRepoName(root));
  const missions = [fixtureMission('task-missing-review', { repositoryId: repo, closedAt: '2026-10-01T12:00:00Z' }),
    fixtureMission('task-active', { repositoryId: repo })];
  const adapter = new LegacyStatsBackfillAdapter(root, { store: measurements }, { loadByRepository: async () => missions });
  const report = await adapter.readProjection();
  assert.equal(report.rows[0].pr_fix_rounds, null);
  assert.equal(report.unresolved?.[0].reason, 'missing-review-history');
  assert.equal(report.skipped?.[0].reason, 'status=active');
  await assert.rejects(new LegacyStatsBackfillAdapter(root, { store: measurements }).readProjection(), /requires repository Mission history/);
});
