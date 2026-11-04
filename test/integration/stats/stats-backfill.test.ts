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
import { StatsRecoveryAdapter } from '../../../src/adapters/mission/stats-backfill-adapter.js';
import { closeIsolatedOperatorCopies } from '../../../src/adapters/sqlite/isolated-operator-copy.js';
import { SqliteOperationalHistoryRepository } from '../../../src/adapters/sqlite/operational-history-repository.js';
import { SqliteBoardLaneEventRepository } from '../../../src/adapters/sqlite/board-lane-event-repository.js';
import { StatsBackfillService } from '../../../src/application/stats-backfill-service.js';
import { statsBackfill } from '../../../src/adapters/cli/commands/stats-backfill.js';
import { resolveStatsRepoName } from '../../../src/adapters/cli/commands/stats.js';
import { repositoryId } from '../../../src/domain/repository.js';
import { missionLabels } from '../../../src/domain/mission.js';
import { collectForgejoStatsRecovery } from '../../../src/adapters/forgejo/forgejo-stats-recovery.js';
import type { ForgejoApiResult, ForgejoAsyncApiCall } from '../../../src/adapters/forgejo/forgejo-types.js';
import { reconcileRecoveryEvidence, recoveryIdentity } from '../../../src/application/stats-recovery-evidence.js';
import { collectLocalStatsRecovery } from '../../../src/adapters/review/stats-recovery-collector.js';

await prepareMigratedSchema();

test('provider recovery paginates closed PR evidence, collapses duplicates and resumes past source failure (TASK-2834)', async () => {
  const calls: string[] = [];
  const missionByPull = new Map([[729, 'task-2775'], [735, 'task-2776'], [743, 'task-2784'], [744, 'task-2785'],
    [779, 'task-2807'], [812, 'px-0028']]);
  const pulls = [...missionByPull].map(([number, mission]) => ({ id: number, number, state: 'closed', merged: true,
    created_at: `2026-10-${String(number % 20 + 1).padStart(2, '0')}T10:00:00+02:00`,
    head: { ref: `refs/pull/${number}/head`, label: `magnus:mission/${mission}`, sha: `sha-${number}` } }));
  const reviews: Record<number, object[]> = {
    735: [{ id: 7351, state: 'REQUEST_CHANGES', submitted_at: '2026-10-10T10:00:00Z' },
      { id: 7352, state: 'REQUEST_CHANGES', submitted_at: '2026-10-11T10:00:00Z' },
      { id: 7352, state: 'REQUEST_CHANGES', submitted_at: '2026-10-11T10:00:00Z' }],
    743: Array.from({ length: 7 }, (_, index) => ({ id: 7430 + index, state: 'APPROVED',
      submitted_at: `2026-10-${String(index + 1).padStart(2, '0')}T11:00:00Z` })),
  };
  const api = async <T>(method: string, endpoint: string): Promise<ForgejoApiResult<T>> => {
    calls.push(`${method} ${endpoint}`);
    if (endpoint.startsWith('/pulls?state=all')) {
      const page = Number(new URL(`http://x${endpoint}`).searchParams.get('page'));
      return ok(pulls.slice((page - 1) * 2, page * 2) as T);
    }
    const number = Number(endpoint.match(/(?:pulls|issues)\/(\d+)/)?.[1]);
    const page = Number(new URL(`http://x${endpoint}`).searchParams.get('page'));
    if (endpoint.startsWith('/pulls/735/reviews/7351/comments')) { return { ...ok(null as T), ok: false, statusCode: 503 }; }
    const values = /\/reviews\/\d+\/comments/.test(endpoint) ? [] : endpoint.includes('/reviews') ? reviews[number] ?? []
      : endpoint.startsWith('/issues/735/') ? [{ id: 9001, body: 'integration repair', created_at: '2026-10-12T10:00:00Z' }] : [];
    return ok(values.slice((page - 1) * 2, page * 2) as T);
  };
  const result = await collectForgejoStatsRecovery('repo', 'read-token', { apiCall: api, pageSize: 2 });
  assert.deepEqual([...new Set(result.evidence.filter(item => item.source === 'forgejo-pr').map(item => item.links.pullRequest))]
    .sort((left, right) => (left ?? 0) - (right ?? 0)),
    [729, 735, 743, 744, 779, 812]);
  assert.deepEqual(Object.fromEntries(result.evidence.filter(item => item.source === 'forgejo-pr')
    .map(item => [item.links.pullRequest, item.links.missionId])), Object.fromEntries(missionByPull),
  'deleted merged branches and px mission labels retain their Mission link');
  assert.equal(result.evidence.filter(item => item.source === 'forgejo-review' && item.links.pullRequest === 735
    && item.raw.state === 'REQUEST_CHANGES').length, 2);
  assert.equal(result.evidence.filter(item => item.source === 'forgejo-review' && item.links.pullRequest === 743
    && item.raw.state === 'APPROVED').length, 7);
  assert.equal(result.duplicateCount, 1);
  assert.ok(result.failures.some(item => item.source === 'forgejo-review-comment'));
  assert.ok(calls.every(endpoint => endpoint.startsWith('GET ') && endpoint.includes('page=') && endpoint.includes('limit=2')),
    'provider access stays read-only and paginated');
  assert.equal(calls.some(endpoint => endpoint.includes('/pulls?state=all&page=3')), true);
});

test('local recovery excludes measured verification and keeps observation identities distinct (TASK-2834 F3 F5)', () => {
  const base = repeatReview();
  const shared = base.rounds[0].subject;
  const mission = fixtureMission('task-2834', { repositoryId: repositoryId('repo'), labels: missionLabels(['ai_sdlc']),
    closedAt: '2026-10-01T12:00:00Z', review: { ...base, rounds: [base.rounds[0], { ...base.rounds[1], subject: shared }] } });
  const history = (eventType: string, createdAt: string, id: number) => ({ id, eventType, createdAt,
    eventData: JSON.stringify({ repositoryId: 'repo', missionId: mission.id, revision: shared.revision }) });
  const result = collectLocalStatsRecovery({ missions: [mission], laneMoves: [], operationalHistory: [
    history('integration.integration-validation', '2026-10-01T00:00:00Z', 1),
    history('verification.attempt', '2026-11-04T00:00:00Z', 2),
    history('flow.rebase', '2026-11-04T00:00:00Z', 3),
    history('workflow.unknown', '2026-10-01T00:00:00Z', 4),
  ] }, 'repo');
  assert.equal(result.evidence.some(item => item.provenance.includes('verification.attempt')), false);
  assert.equal(result.evidence.some(item => item.provenance.includes('workflow.unknown')), false);
  assert.equal(result.evidence.find(item => item.provenance.includes('integration.integration-validation'))?.collectionEra,
    'historical-reconstruction');
  assert.equal(result.evidence.find(item => item.provenance.includes('flow.rebase'))?.collectionEra, 'measured-workflow');
  assert.equal(result.conflicts.filter(item => item.retained.source === 'git').length, 0,
    'each round observation of one revision has its own stable identity');
});

function ok<T>(data: T): ForgejoApiResult<T> {
  return { ok: true, data, status: 0, statusCode: 200, stderr: null, error: null };
}

test('recovery audits a dry-run, writes only an isolated copy and stays idempotent (TASK-2834)', async t => {
  const root = mkdtemp('review-statistics-backfill-');
  let measurements: SqliteMeasurementStore | undefined;
  const db = new SqliteDatabaseAdapter();
  t.after(async () => { closeIsolatedOperatorCopies(); measurements?.close(); await db.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const dbPath = path.join(root, 'operator.db');
  const isolatedPath = path.join(root, 'isolated', 'parallix.db');
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
  const history = new SqliteOperationalHistoryRepository(db);
  const lanes = new SqliteBoardLaneEventRepository(db);
  await history.append({ eventType: 'rebound.repair', createdAt: '2026-10-01T11:00:00Z',
    eventData: JSON.stringify({ repositoryId: repo, missionId: mission.id, sourceId: 'repair-1', durationMs: 250,
      agent: 'codex', model: 'gpt-6.1-sol', stage: 'integration', outcome: 'fixed' }) });
  const providerIdentity = recoveryIdentity('forgejo-issue-comment', [repo, 735, 9001]);
  const providerRecord = { identity: providerIdentity, source: 'forgejo-issue-comment' as const,
    kind: 'provider-comment' as const, observedAt: '2026-10-01T10:00:00.000Z',
    links: { repositoryId: repo, missionId: mission.id, revision: null, pullRequest: 735 },
    provenance: 'GET /issues/735/comments item 9001', collectionEra: 'historical-reconstruction' as const,
    classification: 'direct-observation' as const, raw: { id: 9001, body: 'first representation' } };
  const service = new StatsBackfillService(new StatsRecoveryAdapter(root, { store: measurements, dbPath }, missions, undefined,
    { operationalHistory: history, laneMoves: lanes, provider: async () => reconcileRecoveryEvidence([
      providerRecord, { ...providerRecord, raw: { id: 9001, body: 'conflicting representation' } },
    ]) }));
  const logs: string[] = [];
  const failures: string[] = [];
  const exits: (number | undefined)[] = [];
  const options = { service, log: (line: string) => logs.push(line), error: (line: string) => { failures.push(line); },
    exit: (code?: number) => { exits.push(code); } };
  await statsBackfill(['--json'], options);
  assert.deepEqual(failures, [], 'a dry-run reports no failure');
  const dry = JSON.parse(logs.pop()!);
  assert.equal(dry.changed, 0);
  assert.deepEqual(dry.changes[0].before, [0]);
  assert.equal(dry.changes[0].after, 1);
  assert.deepEqual(dry.coverage, { missions: 1, before: 1, after: 1 });
  assert.ok(dry.recovery.additions > 0 && dry.recovery.bySource['mission-review'].additions > 0);
  assert.ok(dry.recovery.byMission['task-2818'].sources.includes('git'));
  assert.ok(dry.recovery.inventory.reviewRounds > 0);
  assert.equal(dry.recovery.inventory.reviewRoundMissions, 1);
  assert.deepEqual(dry.recovery.unresolvedGaps, []);
  assert.equal(dry.analysis.schema, 'parallix.stats-recovery-analysis.v1');
  assert.deepEqual([dry.analysis.metrics.repairAttemptDuration.observationCount,
    dry.analysis.metrics.repairAttemptDuration.median], [1, 250]);
  assert.ok(dry.analysis.cohorts.some((item: { dimension: string; value: string }) => item.dimension === 'model'
    && item.value === 'gpt-6.1-sol'));
  assert.ok(dry.analysis.unavailable.some((item: { metric: string }) => item.metric === 'CPU'));
  assert.equal((await history.findByType('stats.recovery.evidence')).length, 0, 'dry-run writes nothing');
  assert.equal(measurements.listMeasurements()[0].pr_fix_rounds, 0, 'dry-run writes nothing');
  logs.length = 0;
  await statsBackfill(['--apply', '--json'], options);
  assert.match(failures.join('\n'), /requires an isolated consistent database copy/);
  assert.deepEqual(exits, [1], 'apply without an isolated copy fails closed');
  failures.length = 0;
  logs.length = 0;
  await statsBackfill(['--apply', '--isolated-copy', dbPath, '--json'], options);
  assert.match(failures.join('\n'), /refuses the live operator database/);
  assert.equal((await history.findByType('stats.recovery.evidence')).length, 0, 'the live operator database is never written');
  const symlinkPath = path.join(root, 'operator-link.db');
  const hardlinkPath = path.join(root, 'operator-hardlink.db');
  fs.symlinkSync(dbPath, symlinkPath);
  fs.linkSync(dbPath, hardlinkPath);
  for (const alias of [symlinkPath, hardlinkPath]) {
    failures.length = 0;
    logs.length = 0;
    await statsBackfill(['--apply', '--isolated-copy', alias, '--json'], options);
    assert.match(failures.join('\n'), /refuses the live operator database/,
      `filesystem alias ${path.basename(alias)} cannot bypass live-state refusal`);
  }
  failures.length = 0;
  logs.length = 0;
  await statsBackfill(['--apply', '--isolated-copy', isolatedPath, '--json'], options);
  assert.deepEqual(failures, []);
  const applied = JSON.parse(logs.pop()!);
  assert.ok(applied.changed > 0);
  assert.equal(applied.recovery.additions, applied.changed, 'the audit counts what the apply wrote');
  const stored = await recoveryRows(isolatedPath);
  assert.equal(stored.filter(row => row.eventType === 'stats.recovery.evidence').length, applied.changed);
  assert.equal(stored.filter(row => row.eventType === 'stats.recovery.audit').length, 1, 'the recovery audit is retained');
  assert.equal(stored.filter(row => row.eventType === 'stats.recovery.conflict').length, 1,
    'raw conflicting representations are durably retained');
  assert.equal((await history.findByType('stats.recovery.evidence')).length, 0, 'the live operator database is never written');
  assert.equal(measurements.listMeasurements().length, 1, 'existing measurement identities remain unchanged');
  assert.equal(measurements.listMeasurements()[0].actorKey, 'codex|legacy-rollup');
  assert.equal(measurements.listMeasurements()[0].pr_fix_rounds, 0, 'scalar-only repair path is removed');
  assert.equal(measurements.listMeasurements()[0].duration_minutes, undefined, 'missing resource telemetry stays unavailable');
  assert.equal(measurements.listMeasurements()[0].cost_usd, undefined, 'reconstruction only updates review measurements');
  await missions.save(fixtureMission('task-live-after-snapshot', { repositoryId: repo, labels: missionLabels(['ai_sdlc']),
    closedAt: '2026-10-02T12:00:00Z', review: repeatReview() }), null);
  logs.length = 0;
  await statsBackfill(['--apply', '--isolated-copy', isolatedPath, '--json'], options);
  assert.equal(JSON.parse(logs.pop()!).changed, 0,
    'reapply is idempotent and reads Missions from the isolated snapshot, not subsequently changed live state');
  assert.equal((await recoveryRows(isolatedPath)).length, stored.length, 'no duplicate evidence or audit rows');
  assert.equal(JSON.stringify(await missions.load(mission.id)), before, 'raw Review evidence is unchanged');
  logs.length = 0;
  await statsBackfill(['--help'], options);
  assert.match(logs.join('\n'), /Dry-run is the default/);
  logs.length = 0;
  await statsBackfill([], options);
  assert.match(logs.join('\n'), /Reconciled mission coverage: 1 -> 2\/2/,
    'a later live dry-run sees live state while isolated apply remains pinned to its snapshot');
  assert.match(logs.join('\n'), /Recovery audit: collected=\d+ additions=\d+/);
});

async function recoveryRows(databasePath: string) {
  const db = new SqliteDatabaseAdapter();
  db.openSync({ path: databasePath, enableWal: false });
  try {
    return await new SqliteOperationalHistoryRepository(db).findAll();
  } finally { db.closeSync(); }
}

test('recovery apply resumes past a failed source without duplicating applied evidence (TASK-2834)', async t => {
  const root = mkdtemp('review-statistics-resume-');
  const db = new SqliteDatabaseAdapter();
  t.after(async () => { closeIsolatedOperatorCopies(); await db.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const dbPath = path.join(root, 'operator.db');
  const isolatedPath = path.join(root, 'isolated.db');
  copyMigratedSchema(dbPath);
  await db.open({ path: dbPath });
  const missions = new SqliteMissionStore(db);
  const repo = repositoryId(resolveStatsRepoName(root));
  const mission = fixtureMission('task-2818', { repositoryId: repo, labels: missionLabels(['ai_sdlc']),
    closedAt: '2026-10-01T12:00:00Z', review: repeatReview() });
  await missions.save(mission, null);
  let reviewsAvailable = false;
  const provider = (repositoryId: string) => collectForgejoStatsRecovery(repositoryId, 'read-token', {
    apiCall: providerApi(() => reviewsAvailable), pageSize: 50,
  });
  const service = new StatsBackfillService(new StatsRecoveryAdapter(root, { dbPath }, missions, undefined,
    { operationalHistory: new SqliteOperationalHistoryRepository(db), laneMoves: new SqliteBoardLaneEventRepository(db), provider }));
  const logs: string[] = [];
  const options = { service, log: (line: string) => logs.push(line), error: (line: string) => { throw new Error(line); },
    exit: (code?: number) => { throw new Error(`unexpected exit ${code}`); } };
  await statsBackfill(['--apply', '--isolated-copy', isolatedPath, '--json'], options);
  const interrupted = JSON.parse(logs.pop()!);
  assert.ok(interrupted.recovery.unresolvedGaps.some((gap: string) => gap.includes('/pulls/735/reviews')));
  const first = (await recoveryRows(isolatedPath)).filter(row => row.eventType === 'stats.recovery.evidence');
  const firstIdentities = new Set(first.map(recoveryIdentityOf));
  assert.ok(firstIdentities.size === first.length && first.length > 0,
    'a resumed run never re-writes an identity it already stored');
  reviewsAvailable = true;
  logs.length = 0;
  await statsBackfill(['--apply', '--isolated-copy', isolatedPath, '--json'], options);
  const resumed = JSON.parse(logs.pop()!);
  assert.ok(resumed.changed > 0, 'the source that failed is collected on the next run');
  assert.deepEqual(resumed.recovery.unresolvedGaps, []);
  const second = (await recoveryRows(isolatedPath)).filter(row => row.eventType === 'stats.recovery.evidence');
  const secondIdentities = new Set(second.map(recoveryIdentityOf));
  assert.equal(secondIdentities.size, second.length, 'duplicate pages collapse by identity');
  assert.ok(second.length > first.length);
  for (const identity of firstIdentities) { assert.ok(secondIdentities.has(identity), 'applied evidence is preserved'); }
});

function recoveryIdentityOf(row: { readonly eventData: string }): string {
  return (JSON.parse(row.eventData) as { evidence: { identity: string } }).evidence.identity;
}

function providerApi(reviewsAvailable: () => boolean): ForgejoAsyncApiCall {
  const pull = { id: 735, number: 735, state: 'closed', merged: true, created_at: '2026-10-10T10:00:00+02:00',
    head: { ref: 'mission/task-2818', sha: 'sha-735' } };
  const reviews = [{ id: 7351, state: 'REQUEST_CHANGES', submitted_at: '2026-10-11T10:00:00Z', user: { login: 'human' } }];
  return async <T>(_method: string, endpoint: string): Promise<ForgejoApiResult<T>> => {
    if (endpoint.startsWith('/pulls?state=all')) { return ok([pull] as unknown as T); }
    if (/\/reviews\/\d+\/comments/.test(endpoint)) { return ok([] as unknown as T); }
    if (endpoint.includes('/reviews')) { return reviewsAvailable() ? ok(reviews as unknown as T) : unavailable<T>(); }
    return ok([] as unknown as T);
  };
}

function unavailable<T>(): ForgejoApiResult<T> {
  return { ok: false, data: null as T, status: 0, statusCode: 503, stderr: null, error: 'unavailable' };
}

test('reconstruction discloses missing histories, skips active work and fails closed without authority', async t => {
  const root = mkdtemp('review-statistics-unknown-');
  let measurements: SqliteMeasurementStore | undefined;
  t.after(() => { measurements?.close(); fs.rmSync(root, { recursive: true, force: true }); });
  measurements = new SqliteMeasurementStore(path.join(root, 'copy.db'));
  const repo = repositoryId(resolveStatsRepoName(root));
  const missions = [fixtureMission('task-missing-review', { repositoryId: repo, closedAt: '2026-10-01T12:00:00Z' }),
    fixtureMission('task-active', { repositoryId: repo })];
  const adapter = new StatsRecoveryAdapter(root, { store: measurements }, { loadByRepository: async () => missions });
  const report = await adapter.readProjection();
  assert.equal(report.rows[0].pr_fix_rounds, null);
  assert.equal(report.unresolved?.[0].reason, 'missing-review-history');
  assert.equal(report.skipped?.[0].reason, 'status=active');
  await assert.rejects(new StatsRecoveryAdapter(root, { store: measurements }).readProjection(), /requires repository Mission history/);
});
