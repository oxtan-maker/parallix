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
import { measurementCorrectionIdentity, StatsBackfillService } from '../../../src/application/stats-backfill-service.js';
import { statsBackfill } from '../../../src/adapters/cli/commands/stats-backfill.js';
import { readStatsRecoveryInventory } from '../../../src/adapters/cli/commands/stats-recovery-input.js';
import { resolveStatsRepoName } from '../../../src/adapters/cli/commands/stats.js';
import { repositoryId } from '../../../src/domain/repository.js';
import { missionLabels } from '../../../src/domain/mission.js';
import { agentFamily } from '../../../src/domain/agents.js';
import { collectForgejoStatsRecovery } from '../../../src/adapters/forgejo/forgejo-stats-recovery.js';
import type { ForgejoApiResult, ForgejoAsyncApiCall } from '../../../src/adapters/forgejo/forgejo-types.js';
import { reconcileRecoveryEvidence, recoveryIdentity } from '../../../src/application/stats-recovery-evidence.js';
import { collectLocalStatsRecovery } from '../../../src/adapters/review/stats-recovery-collector.js';
import type { RunSummary } from '../../../src/application/run-history.js';

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

test('recovery inventory rejects malformed and duplicate identities (px-0036.03)', t => {
  const root = mkdtemp('review-statistics-recovery-inventory-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const inventoryPath = path.join(root, 'inventory.json');
  const rejects = (value: unknown, expected: RegExp) => {
    fs.writeFileSync(inventoryPath, JSON.stringify(value));
    assert.throws(() => readStatsRecoveryInventory(inventoryPath), expected);
  };
  rejects({}, /JSON array or an object with a measurements array/);
  rejects([null], /recovery target 1 must be an object/);
  rejects([{ mission: '', actorKey: 'custom' }], /recovery target 1 requires mission and actorKey/);
  rejects([{ mission: 'task-1', actorKey: 'custom' }, { mission: 'task-1', actorKey: 'custom' }],
    /duplicate recovery target task-1/);
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

test('recovery refuses configured model and zero usage without provider-run evidence (px-0036.03)', async t => {
  const root = mkdtemp('review-statistics-native-gap-');
  let measurements: SqliteMeasurementStore | undefined;
  const db = new SqliteDatabaseAdapter();
  t.after(async () => { closeIsolatedOperatorCopies(); measurements?.close(); await db.close();
    fs.rmSync(root, { recursive: true, force: true }); });
  const dbPath = path.join(root, 'operator.db');
  const isolatedPath = path.join(root, 'isolated.db');
  copyMigratedSchema(dbPath);
  await db.open({ path: dbPath });
  const missions = new SqliteMissionStore(db);
  const repo = repositoryId(resolveStatsRepoName(root));
  const mission = fixtureMission('task-2839', { repositoryId: repo, labels: missionLabels(['ai_sdlc']),
    closedAt: '2026-11-10T12:00:00Z', review: repeatReview() });
  await missions.save(mission, null);
  const runId = 'review-custom-a1-missingfacts';
  measurements = new SqliteMeasurementStore(dbPath);
  measurements.upsertMeasurement({ repo, mission: mission.id, stage: 'review', actorKey: 'custom\u001fcodex',
    runId, date: '2026-11-10', classification: 'ai_sdlc', implementer: 'custom', reviewer_agent: 'custom',
    provider: 'codex', model: 'codex', input_tokens: 0, output_tokens: 0, cached_tokens: 0, context_tokens: 0,
    tool_calls: 0, cost_usd: 0 });
  const sourceBefore = measurements.listMeasurements()[0];
  const run = unsupportedProviderRun(mission.id, runId);
  const recoverySources = {
    operationalHistory: new SqliteOperationalHistoryRepository(db),
    laneMoves: new SqliteBoardLaneEventRepository(db),
    runs: { history: () => ({ ok: true as const, runs: [run], unattributed: [] }) },
  };
  const adapter = new StatsRecoveryAdapter(root, { store: measurements, dbPath }, missions, undefined, recoverySources);
  const inventory = [{ mission: mission.id, actorKey: 'custom\u001fcodex' }];
  const preview = await adapter.readProjection(undefined, inventory);
  const native = (preview as typeof preview & { measurementRecovery: {
    inventory: readonly { disposition: string; gaps: readonly string[]; proposed: unknown }[] } }).measurementRecovery;
  assert.equal(native.inventory.length, 1);
  assert.equal(native.inventory[0].disposition, 'gap');
  assert.equal(native.inventory[0].proposed, null);
  assert.ok(native.inventory[0].gaps.some(gap => gap.includes('provider observation')),
    'configuredModel is not accepted as provider model evidence');
  await adapter.applyProjection(preview, { databasePath: isolatedPath, materialize: true });
  const copied = new SqliteMeasurementStore(isolatedPath);
  try { assert.deepEqual(copied.listMeasurements()[0], sourceBefore, 'unsupported model and usage stay unchanged'); }
  finally { copied.close(); }
  assert.deepEqual(measurements.listMeasurements()[0], sourceBefore, 'source operator state is never changed');
});

test('native-run correction preview preserves conflicts and resumes an interrupted typed apply (px-0036.03)', async t => {
  const root = mkdtemp('review-statistics-native-correction-');
  let measurements: SqliteMeasurementStore | undefined;
  const db = new SqliteDatabaseAdapter();
  const copyDb = new SqliteDatabaseAdapter();
  t.after(async () => { closeIsolatedOperatorCopies(); measurements?.close(); await db.close(); await copyDb.close();
    fs.rmSync(root, { recursive: true, force: true }); });
  const dbPath = path.join(root, 'operator.db');
  const isolatedPath = path.join(root, 'isolated.db');
  copyMigratedSchema(dbPath);
  await db.open({ path: dbPath });
  const missions = new SqliteMissionStore(db);
  const repo = repositoryId(resolveStatsRepoName(root));
  for (const slug of ['task-2839', 'task-2842', 'px-0035']) {
    await missions.save(fixtureMission(slug, { repositoryId: repo, labels: missionLabels(['ai_sdlc']),
      closedAt: '2026-11-10T12:00:00Z', review: repeatReview() }), null);
  }
  measurements = new SqliteMeasurementStore(dbPath);
  const correctionRun = 'review-custom-a1-correction';
  const conflictRun = 'review-custom-a1-conflict';
  measurements.upsertAll([
    { repo, mission: 'task-2839', stage: 'review', actorKey: 'custom\u001fcodex', runId: correctionRun,
      date: '2026-11-10', reviewer_agent: 'custom', provider: 'codex', model: 'codex', input_tokens: 0,
      output_tokens: 0, cached_tokens: 0, context_tokens: 0, tool_calls: 0, cost_usd: 0 },
    { repo, mission: 'task-2842', stage: 'review', actorKey: 'custom\u001fqwen', runId: conflictRun,
      date: '2026-11-10', reviewer_agent: 'custom', provider: 'pi', model: 'qwen', input_tokens: 55 },
    { repo, mission: 'px-0035', stage: 'review', actorKey: 'custom\u001fcodex', date: '2026-11-10',
      reviewer_agent: 'custom', provider: 'codex', model: 'codex', input_tokens: 0 },
  ]);
  const sourceBefore = measurements.listMeasurements();
  const runs = new Map([
    ['task-2839', [providerRun('task-2839', correctionRun, 101)]],
    ['task-2842', [providerRun('task-2842', conflictRun, 99)]],
  ]);
  const adapter = new StatsRecoveryAdapter(root, { store: measurements, dbPath }, missions, undefined, {
    operationalHistory: new SqliteOperationalHistoryRepository(db), laneMoves: new SqliteBoardLaneEventRepository(db),
    runs: { history: mission => ({ ok: true, runs: runs.get(mission) ?? [], unattributed: [] }) },
  });
  const inventory = [
    { mission: 'task-2839', actorKey: 'custom\u001fcodex' },
    { mission: 'task-2842', actorKey: 'custom\u001fqwen' },
    { mission: 'px-0035', actorKey: 'custom\u001fcodex' },
  ];
  const preview = await adapter.readProjection(undefined, inventory);
  assert.deepEqual(preview.measurementRecovery?.summary,
    { candidates: 3, corrections: 1, verified: 0, gaps: 1, conflicts: 1 });
  const correction = preview.measurementRecovery!.inventory.find(item => item.disposition === 'correction')!;
  assert.match(correction.evidence?.sha256 ?? '', /^[a-f0-9]{64}$/);
  assert.deepEqual([correction.proposed?.provider, correction.proposed?.model, correction.proposed?.input_tokens],
    ['pi', 'qwen-observed', 101]);
  assert.ok(preview.measurementRecovery!.inventory.find(item => item.disposition === 'conflict')?.conflicts
    .some(detail => detail.includes('input_tokens retained=55 observed=99')), 'nonzero usage is never overwritten');
  assert.deepEqual(measurements.listMeasurements(), sourceBefore, 'preview writes neither measurements nor recovery plans');
  assert.equal((await new SqliteOperationalHistoryRepository(db).findByType('stats.recovery.measurement-plan')).length, 0);
  const logs: string[] = [];
  const inventoryPath = path.join(root, 'recovery-inventory.json');
  fs.writeFileSync(inventoryPath, JSON.stringify({ measurements: inventory }));
  await statsBackfill(['--recovery-inventory', inventoryPath, '--json'], {
    service: new StatsBackfillService(adapter), log: line => logs.push(line),
    error: line => assert.fail(line), exit: code => assert.fail(`unexpected exit ${code}`) });
  const publicPreview = JSON.parse(logs.pop()!);
  assert.deepEqual(publicPreview.recovery.measurementRecovery.summary, preview.measurementRecovery?.summary,
    'public dry-run JSON identifies every correction, conflict and gap');

  await adapter.readProjection({ databasePath: isolatedPath, materialize: true });
  copyDb.openSync({ path: isolatedPath, enableWal: false });
  const copyHistory = new SqliteOperationalHistoryRepository(copyDb);
  const correctionId = measurementCorrectionIdentity(correction);
  await copyHistory.append({ eventType: 'stats.recovery.measurement-plan', createdAt: correction.evidence!.observedAt,
    eventData: JSON.stringify({ repositoryId: repo, missionId: correction.original.mission,
      correctionIdentity: correctionId, correction }) });
  await adapter.applyProjection(preview, { databasePath: isolatedPath });
  const copied = new SqliteMeasurementStore(isolatedPath);
  const applied = copied.findByMission('task-2839')[0];
  assert.deepEqual([applied.provider, applied.model, applied.input_tokens], ['pi', 'qwen-observed', 101],
    'resume applies a correction even when its durable plan predates an interrupted write');
  assert.equal(copied.findByMission('task-2842')[0].input_tokens, 55, 'conflicting nonzero usage is preserved');
  assert.equal(copied.findByMission('px-0035')[0].model, 'codex', 'an unlinked value remains an explicit gap');
  copied.close();
  const second = await adapter.readProjection({ databasePath: isolatedPath }, inventory);
  assert.equal(second.measurementRecovery?.summary.corrections, 0);
  await adapter.applyProjection(second, { databasePath: isolatedPath });
  assert.equal((await copyHistory.findByType('stats.recovery.measurement-plan')).length, 1,
    'retry is idempotent and does not duplicate the retained original/provenance plan');
  assert.deepEqual(measurements.listMeasurements(), sourceBefore, 'copy-only apply leaves source state unchanged');
});

test('native-run inventory rejects duplicate, stale and mismatched evidence (px-0036.03)', async t => {
  const root = mkdtemp('review-statistics-native-conflicts-');
  let measurements: SqliteMeasurementStore | undefined;
  const db = new SqliteDatabaseAdapter();
  t.after(async () => { measurements?.close(); await db.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const dbPath = path.join(root, 'operator.db');
  copyMigratedSchema(dbPath);
  await db.open({ path: dbPath });
  const missions = new SqliteMissionStore(db);
  const repo = repositoryId(resolveStatsRepoName(root));
  for (const slug of ['px-0030', 'px-0031', 'task-2836']) {
    await missions.save(fixtureMission(slug, { repositoryId: repo, labels: missionLabels(['ai_sdlc']),
      closedAt: '2026-11-10T12:00:00Z', review: repeatReview() }), null);
  }
  measurements = new SqliteMeasurementStore(dbPath);
  measurements.upsertAll([
    { repo, mission: 'px-0030', stage: 'review', actorKey: 'custom\u001fqwen', runId: 'review-custom-a1-duplicate', date: '2026-11-10', reviewer_agent: 'custom' },
    { repo, mission: 'px-0031', stage: 'review', actorKey: 'custom\u001fqwen', runId: 'review-custom-a1-stale', date: '2026-11-10', reviewer_agent: 'custom' },
    { repo, mission: 'task-2836', stage: 'review', actorKey: 'custom\u001fqwen', runId: 'review-custom-a1-mismatch', date: '2026-11-10', reviewer_agent: 'custom' },
  ]);
  const duplicate = providerRun('px-0030', 'review-custom-a1-duplicate', 1);
  const mismatch = providerRun('another-mission', 'review-custom-a1-mismatch', 1);
  const adapter = new StatsRecoveryAdapter(root, { store: measurements }, missions, undefined, { runs: {
    history: mission => ({ ok: true, runs: mission === 'px-0030' ? [duplicate, duplicate]
      : mission === 'task-2836' ? [mismatch] : [], unattributed: [] }),
  } });
  const inventory = [
    { mission: 'px-0030', actorKey: 'custom\u001fqwen' },
    { mission: 'px-0031', actorKey: 'custom\u001fqwen' },
    { mission: 'task-2836', actorKey: 'custom\u001fqwen' },
  ];
  const report = (await adapter.readProjection(undefined, inventory)).measurementRecovery!;
  assert.deepEqual(report.summary, { candidates: 3, corrections: 0, verified: 0, gaps: 1, conflicts: 2 });
  assert.ok(report.inventory.some(item => item.conflicts.some(detail => detail.includes('duplicate retained native run'))));
  assert.ok(report.inventory.some(item => item.gaps.some(detail => detail.includes('is unavailable'))));
  assert.ok(report.inventory.some(item => item.conflicts.some(detail => detail.includes('another-mission/review'))));
});

test('consistent-copy inventory accounts for 21 custom-origin missions plus a generic Codex row (px-0036.03)', async t => {
  const root = mkdtemp('review-statistics-frozen-inventory-');
  let measurements: SqliteMeasurementStore | undefined;
  const db = new SqliteDatabaseAdapter();
  t.after(async () => { measurements?.close(); await db.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const dbPath = path.join(root, 'operator.db');
  copyMigratedSchema(dbPath);
  await db.open({ path: dbPath });
  const missions = new SqliteMissionStore(db);
  const repo = repositoryId(resolveStatsRepoName(root));
  const customOrigins = Array.from({ length: 21 }, (_, index) => `custom-origin-${index + 1}`);
  for (const slug of [...customOrigins, 'generic-codex-review', 'later-attributed-review']) {
    await missions.save(fixtureMission(slug, { repositoryId: repo, labels: missionLabels(['ai_sdlc']),
      closedAt: '2026-11-10T12:00:00Z', review: repeatReview() }), null);
  }
  measurements = new SqliteMeasurementStore(dbPath);
  measurements.upsertAll([
    ...customOrigins.map(mission => ({ repo, mission, stage: 'review',
      actorKey: 'custom', reviewer_agent: 'custom', provider: 'mixed', model: 'mixed' })),
    { repo, mission: 'generic-codex-review', stage: 'review', actorKey: 'codex', reviewer_agent: 'codex',
      provider: 'mixed', model: 'mixed' },
    { repo, mission: 'later-attributed-review', stage: 'review', actorKey: 'custom\u001fclaude', reviewer_agent: 'custom',
      provider: 'claude', model: 'claude' },
  ]);
  const inventory = [
    ...customOrigins.map(mission => ({ mission, actorKey: 'custom' })),
    { mission: 'generic-codex-review', actorKey: 'codex' },
  ];
  const report = (await new StatsRecoveryAdapter(root, { store: measurements }, missions)
    .readProjection(undefined, inventory)).measurementRecovery!;
  assert.deepEqual(report.summary, { candidates: 22, corrections: 0, verified: 0, gaps: 22, conflicts: 0 });
  assert.equal(new Set(report.inventory.filter(item => item.original.reviewer_agent === 'custom')
    .map(item => item.original.mission)).size, 21);
  assert.equal(report.inventory.some(item => item.original.mission === 'generic-codex-review'
    && item.original.actorKey === 'codex'), true);
  assert.equal(report.inventory.some(item => item.original.mission === 'later-attributed-review'), false,
    'a measurement absent from the operator-supplied frozen inventory is outside recovery');
  assert.ok(report.inventory.every(item => item.gaps.includes('missing exact run link; mission/date matching is forbidden')));
});

function unsupportedProviderRun(mission: string, runId: string): RunSummary {
  return { state: 'exited', execution: 'stopped', coverage: [], record: {
    version: 1, runId, missionId: mission, sourceId: runId, revision: 'revision-1', configuredModel: 'codex',
    dependencies: [], execution: null, resources: { localProcessTreeCpu: null, provider: null }, role: 'review',
    family: agentFamily('custom'), attempt: 1, terminalHost: 'pipe', hostFallbackReason: null, tmux: null, supervisorPid: 1,
    state: 'exited', startedAt: '2026-11-10T10:00:00Z', endedAt: '2026-11-10T10:01:00Z', exitCode: 0,
    signal: null, providerSessionId: null, redacted: false,
    streams: { stdout: { bytes: 0, retainedBytes: 0, omitted: [] }, stderr: { bytes: 0, retainedBytes: 0, omitted: [] } },
    sources: [], omissions: [],
  } };
}

function providerRun(mission: string, runId: string, input: number): RunSummary {
  const run = unsupportedProviderRun(mission, runId);
  return { ...run, record: { ...run.record, resources: { localProcessTreeCpu: null, provider: {
    provenance: 'provider-reported', provider: 'pi', model: 'qwen-observed', values: [
      { name: 'input', value: input, unit: 'tokens' }, { name: 'output', value: 12, unit: 'tokens' },
      { name: 'cached', value: 34, unit: 'tokens' }, { name: 'context', value: input + 46, unit: 'tokens' },
      { name: 'tool-calls', value: 3, unit: 'count' }, { name: 'cost', value: 0, unit: 'usd' },
    ],
  } } } };
}

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
