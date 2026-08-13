// ---------------------------------------------------------------------------
// TASK-2369 — the four live correctness defects that survived TASK-2367.
//
// R1  backlog promotion cannot complete a Mission
// R2  an approved normal integration completes exactly once (retry stays one)
// R3  a review-origin integration completes only after the commit has landed
// R4  a resumed integration is stamped with the landed commit time, not retry time
// R5  the live review-fix writers keep known zero and unknown apart
// R6  the reported observation count excludes unknown review-fix rounds
// R7  telemetry cannot decide Mission completion
// R8  new telemetry writes use the canonical repository id
//
// R1-R4 drive the real `px integrate` orchestration (`integrate.default`) over
// the real `MissionLifecycleService` / `MissionIntegrationService` and the real
// domain state machine, because the defects are in the CLI's *ordering*, not in
// the services. Only the Git/Forgejo/worktree boundaries are doubled. No agent,
// LLM, mission runner, or network is involved.
// ---------------------------------------------------------------------------
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mockModule, installModuleMocks } from './lib/module-mock.js';

const git = mockModule<typeof import('../src/adapters/git/git.js')>('../src/adapters/git/git.js', import.meta.url);
const missionUtils = mockModule<typeof import('../src/adapters/filesystem/mission-utils.js')>('../src/adapters/filesystem/mission-utils.js', import.meta.url);
const backlog = mockModule<typeof import('../src/adapters/backlog/backlog.js')>('../src/adapters/backlog/backlog.js', import.meta.url);
const forgejo = mockModule<typeof import('../src/adapters/forgejo/forgejo.js')>('../src/adapters/forgejo/forgejo.js', import.meta.url);
const statsModule = mockModule<typeof import('../src/adapters/cli/commands/stats.js')>('../src/adapters/cli/commands/stats.js', import.meta.url);
const verification = mockModule<typeof import('../src/adapters/verification/verification.js')>('../src/adapters/verification/verification.js', import.meta.url);
const integrate = mockModule<typeof import('../src/adapters/cli/commands/integrate.js')>('../src/adapters/cli/commands/integrate.js', import.meta.url);
await installModuleMocks();

import { MissionIntegrationService } from '../src/application/mission-integration-service.js';
import { MissionLifecycleService } from '../src/application/mission-lifecycle-service.js';
import type { LaneTransitionEvent } from '../src/domain/board-event.js';
import type { Mission, MissionStatus } from '../src/domain/mission.js';
import { missionId } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';
import type { MissionVersion } from '../src/application/domain-ports.js';
import { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../src/adapters/sqlite/migration-runner.js';
import { SqliteUsageRepository } from '../src/adapters/sqlite/usage-repository.js';
import { SqliteBoardLaneEventRepository } from '../src/adapters/sqlite/board-lane-event-repository.js';
import { SqliteMeasurementStore } from '../src/adapters/sqlite/measurement-store.js';
import { ConcreteMetricsReadAdapter } from '../src/application/projections/metrics-read-adapter.js';
import { createPrimaryAndWorktree, laneEvent } from './fixtures/task-2357-statistics-fixture.js';

const SLUG = 'task-2369-fixture';
const LANDED_SHA = 'a11ced0000000000000000000000000000000001';
/** T1 — when the integration commit actually landed. */
const LANDED_AT = '2026-08-04T23:30:00+02:00';
/** T2 — when the operator resumed closeout, two days later. */
const RETRY_AT = '2026-08-06T10:00:00+02:00';

// --- shared fakes ----------------------------------------------------------

interface FakeStore {
  readonly events: LaneTransitionEvent[];
  mission(): Mission;
  load(): Promise<unknown>;
  save(_m: Mission, _v: MissionVersion | null): Promise<MissionVersion>;
  saveWithTransition(_m: Mission, _v: MissionVersion | null, _e: LaneTransitionEvent): Promise<MissionVersion>;
}

/** A MissionTransitionStore that records lane events, so completions are countable. */
function createFakeStore(status: MissionStatus): FakeStore {
  let current = {
    id: missionId(SLUG),
    repositoryId: repositoryId('parallix'),
    title: 'fixture',
    labels: [],
    assignee: 'codex',
    checkpoints: [],
    // An approved last round is what the CLI reads as its approval source when
    // no review provider is reachable (integrate.ts, "mission-store" approval).
    review: { rounds: [{ decision: { kind: 'approved' } }] },
    netEngineeringLines: null,
    status,
    closedAt: null,
  } as unknown as Mission;
  let version = 1;
  const events: LaneTransitionEvent[] = [];
  const keys = new Set<string>();
  return {
    events,
    mission: () => current,
    async load() { return { kind: 'found', mission: current, version: version as MissionVersion }; },
    async save(next: Mission) { current = next; version += 1; return version as MissionVersion; },
    async saveWithTransition(next: Mission, _expected, event: LaneTransitionEvent) {
      if (event.idempotencyKey && keys.has(event.idempotencyKey)) {
        throw new Error(`Duplicate idempotency key ${event.idempotencyKey}`);
      }
      if (event.idempotencyKey) { keys.add(event.idempotencyKey); }
      events.push(event);
      current = next;
      version += 1;
      return version as MissionVersion;
    },
  };
}

function servicesFor(store: FakeStore) {
  return {
    store,
    lifecycle: new MissionLifecycleService(store as never),
    integration: new MissionIntegrationService(store as never),
    handoff: { recordNel: async () => ({}) },
  };
}

function doneEvents(store: FakeStore) {
  return store.events.filter(event => event.to === 'done' && event.trigger === 'integrate');
}

interface Scenario {
  /** Backlog task status the CLI reads; `review` exercises the promotion path. */
  taskStatus: 'review' | 'approved';
  /** Authoritative Mission lane before integration starts. */
  missionStatus: MissionStatus;
  /** Make the landed squash commit fail, as a rejected hook or index error would. */
  commitFails?: boolean;
  /** Take the "squash commit already exists" resume branch instead of landing. */
  resume?: boolean;
  /** Make `git show` for the landed commit fail (metadata-read failure). */
  gitShowFails?: boolean;
}

const ok = (stdout = '') => ({ status: 0, stdout, stderr: '' });

/**
 * Run the production integrate command against doubled Git/Forgejo/worktree
 * boundaries and real lifecycle services.
 *
 * `order` records the observable sequence — promotion, landing, completion,
 * statistics — which is what R3 asserts on.
 */
async function runIntegrate(scenario: Scenario) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-task-2369-'));
  fs.mkdirSync(path.join(root, 'backlog', 'tasks'), { recursive: true });
  fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { verification: { command: 'true' } } }));
  const taskFile = path.join(root, 'backlog', 'tasks', 'task.md');
  fs.writeFileSync(taskFile, `status: ${scenario.taskStatus}\n`);
  const store = createFakeStore(scenario.missionStatus);
  const services = servicesFor(store);
  const order: string[] = [];
  const occurredAt: string[] = [];

  mock.method(missionUtils, 'inferSlug', () => SLUG);
  mock.method(missionUtils, 'getPrimaryBranch', () => 'main');
  mock.method(missionUtils, 'getPrimaryWorktree', () => root);
  mock.method(missionUtils, 'findMissionDir', () => path.join(root, 'missions', SLUG));
  mock.method(missionUtils, 'findMissionArea', () => 'all');
  mock.method(missionUtils, 'conventionalWorktreePath', () => path.join(root, '..', SLUG));
  mock.method(missionUtils, 'resolveMainRepo', () => root);
  mock.method(missionUtils, 'missionTitle', () => 'fixture');
  mock.method(missionUtils, 'updateGraphifyKnowledgeGraph', () => false);
  mock.method(git, 'getCurrentBranch', () => `mission/${SLUG}`);
  mock.method(git, 'git', (args: string[]) => {
    const joined = args.join(' ');
    if (joined.includes('branch --show-current')) { return ok('main\n'); }
    if (joined.includes('log --format=%H %s')) {
      return ok(scenario.resume ? `${LANDED_SHA} mission/${SLUG}: fixture\n` : 'other0 unrelated subject\n');
    }
    // Landed-commit metadata read: the timestamp must come from this commit.
    if (args.includes('show')) {
      if (scenario.gitShowFails) { return { status: 1, stdout: '', stderr: 'fatal: bad revision' }; }
      return args.includes(LANDED_SHA) ? ok(`${LANDED_AT}\n`) : { status: 1, stdout: '', stderr: 'unknown revision' };
    }
    if (args.includes('merge') && args.includes('--no-commit')) {
      return scenario.resume
        ? { status: 1, stdout: 'CONFLICT (content): Merge conflict in src/fixture.ts\n', stderr: '' }
        : ok('');
    }
    if (args.includes('diff') && args.includes('--quiet')) { return { status: 1, stdout: '', stderr: '' }; }
    if (args.includes('diff') && args.includes('--cached')) { return ok('fixture.ts\n'); }
    if (args.includes('commit')) {
      if (scenario.commitFails) { return { status: 1, stdout: '', stderr: 'fatal: could not write the index' }; }
      order.push('landed');
      return ok('');
    }
    if (args.includes('rev-parse')) { return ok(`${LANDED_SHA}\n`); }
    return ok('');
  });
  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true, taskFile }));
  mock.method(backlog, 'getTaskClassification', () => 'ai_sdlc');
  mock.method(backlog, 'getTaskStatus', () => scenario.taskStatus);
  mock.method(backlog, 'getTaskAssignee', () => 'codex');
  mock.method(backlog, 'completeTask', () => true);
  mock.method(backlog, 'setTaskStatus', () => { order.push('promoted'); return true; });
  mock.method(forgejo, 'getPrStatus', () => ({ exists: true, state: 'open', merged: false, number: 1 }));
  mock.method(forgejo, 'getLatestReviewDecision', () => ({ ok: true, reviewState: 'APPROVED' }));
  mock.method(forgejo, 'listOpenPrsForSlug', () => []);
  mock.method(forgejo, 'readToken', () => 'token');
  mock.method(forgejo, 'resolveTokenFile', () => 'token-file');
  mock.method(forgejo, 'syncMerged', () => ({ ok: true }));
  mock.method(statsModule, 'recordIntegrationStats', async () => {
    order.push('stats');
    return { changed: false, row: { mission: SLUG }, data: { rows: [] }, report: 'none' };
  });
  mock.method(statsModule, 'resolveMissionClassification', () => ({ classification: 'ai_sdlc' }));
  mock.method(verification, 'captureVerifiedTreeProof', () => ({ ok: true, proof: { rootDir: root } }));
  mock.method(verification, 'assertVerifiedTreeProof', () => ({ ok: true }));
  mock.method(process, 'cwd', () => root);
  let exitCode: number | undefined;
  mock.method(process, 'exit', (code?: number) => { exitCode = code; });

  // Observe what the CLI hands the completion authority, without replacing it.
  const decide = services.integration.decideIntegration.bind(services.integration);
  services.integration.decideIntegration = async (request) => {
    order.push('completed');
    occurredAt.push(String(request.occurredAt ?? '<none>'));
    return decide(request);
  };

  let error: Error | undefined;
  try {
    await integrate.default([SLUG, '--no-integration-gates'], { missionServicesFn: async () => services });
  } catch (e) {
    error = e as Error;
  } finally {
    mock.reset();
    fs.rmSync(root, { recursive: true, force: true });
  }
  return { store, order, occurredAt, mission: store.mission(), error, exitCode };
}

// --- R1 --------------------------------------------------------------------

// Old behavior that fails this test: `promoteTaskForIntegrationIfNeeded()` ran
// `lifecycle.transition({ command: { type: 'integrate' } })`, and `integrate`
// maps `review -> done` in the domain state machine. Promotion happens at
// Step 4, before the squash commit at Step 5, so a commit that never lands left
// the Mission `done` with one `integration -> done` lane event and no commit.
test('R1: backlog promotion cannot complete the Mission when landing fails', async () => {
  const result = await runIntegrate({ taskStatus: 'review', missionStatus: 'review', commitFails: true });

  assert.ok(result.order.includes('promoted'), 'the production promotion path must actually run');
  assert.notEqual(result.mission.status, 'done', 'a failed landing must leave the Mission incomplete');
  assert.equal(doneEvents(result.store).length, 0, 'no integration -> done event may exist without a landed commit');
  assert.ok(!result.order.includes('completed'), 'completion must not be reached without a landed commit');
});

// --- R2 --------------------------------------------------------------------

test('R2: an approved normal integration completes exactly once and a retry stays at one', async () => {
  const first = await runIntegrate({ taskStatus: 'approved', missionStatus: 'integration' });
  assert.equal(first.mission.status, 'done');
  assert.equal(doneEvents(first.store).length, 1);

  // Re-running closeout against an already-done Mission reconciles, never doubles.
  const services = servicesFor(first.store as FakeStore);
  const again = await services.integration.decideIntegration({
    operationId: 'retry', missionId: missionId(SLUG),
    expectedVersion: undefined as never,
    capabilities: new Set(['integration:decide']),
    occurredAt: LANDED_AT,
    facts: {
      git: { source: 'git', status: 'fresh', value: { merged: true } },
      verification: { source: 'git', status: 'fresh', value: { passed: true } },
    },
  });
  assert.equal(again.status, 'failed', 'a done Mission cannot integrate a second time');
  assert.equal(doneEvents(first.store).length, 1, 'the done event count stays 1, not 2');
});

// --- R3 --------------------------------------------------------------------

test('R3: a review-origin integration completes only after the commit has landed', async () => {
  const result = await runIntegrate({ taskStatus: 'review', missionStatus: 'review' });

  assert.equal(result.mission.status, 'done');
  assert.equal(doneEvents(result.store).length, 1);
  assert.deepEqual(
    result.order,
    ['promoted', 'landed', 'completed', 'stats'],
    'promotion precedes landing, and completion follows the landed commit',
  );
});

// --- R4 --------------------------------------------------------------------

// Old behavior that fails this test: `persistLandedIntegrationOrAbort()` called
// `decideIntegration()` with no `occurredAt`, so the service fell back to
// `new Date()` — the retry time — and a mission that landed on August 4 was
// counted in the decision window containing the August 6 rerun.
test('R4: a resumed integration is stamped with the landed commit time, not the retry time', async () => {
  const result = await runIntegrate({ taskStatus: 'approved', missionStatus: 'integration', resume: true });

  assert.equal(result.mission.status, 'done');
  assert.deepEqual(result.occurredAt, [LANDED_AT], 'the CLI must resolve and pass the landed commit timestamp');
  const [event] = doneEvents(result.store);
  assert.equal(event.occurredAt, LANDED_AT);
  assert.notEqual(event.occurredAt, RETRY_AT);
});

test('R4: decision-window membership follows the landed timestamp', async () => {
  const result = await runIntegrate({ taskStatus: 'approved', missionStatus: 'integration', resume: true });
  const [event] = doneEvents(result.store);

  const checkout = createPrimaryAndWorktree('task-2369-window');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-task-2369-window-'));
  const db = new SqliteDatabaseAdapter();
  try {
    await db.open({ path: path.join(directory, 'parallix.db') });
    await new SqliteMigrationRunner(db).applyPending(loadDefaultMigrations());
    const repo = repositoryId(path.basename(checkout.primary));
    const events = new SqliteBoardLaneEventRepository(db);
    await events.append(laneEvent({ repositoryId: repo, missionId: SLUG, from: null, to: 'backlog', at: '2026-08-01T09:00:00.000Z' }));
    await events.append(laneEvent({ repositoryId: repo, missionId: SLUG, from: 'integration', to: 'done', at: event.occurredAt }));

    // The rolling window is anchored on the retry day. A mission stamped with
    // the retry time would land in `current`; stamped with T1 it is `previous`.
    const metrics = await new ConcreteMetricsReadAdapter({
      laneEventRepo: events, usageRepo: new SqliteUsageRepository(db),
      repositoryId: repo, clock: () => '2026-08-11T10:00:00.000Z',
    }).buildMetrics(new Map([[missionId(SLUG), 'done' as MissionStatus]]));

    assert.equal(metrics.decisionWindow?.current.completedMissions, 0, 'T1 is outside the window anchored on the retry day');
    assert.equal(metrics.decisionWindow?.previous.completedMissions, 1, 'the mission belongs to the window containing T1');
  } finally {
    await db.close();
    checkout.cleanup();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

// Old behavior that fails this test: `persistLandedIntegrationOrAbort()` omitted
// `occurredAt` when `git show` failed, letting `decideIntegration()` fall back to
// `new Date()` — silently recording retry time as delivery completion.
test('R4: closeout aborts when landed commit timestamp cannot be resolved', async () => {
  const result = await runIntegrate({ taskStatus: 'approved', missionStatus: 'integration', resume: true, gitShowFails: true });
  assert.equal(result.exitCode, 1, 'integrate must exit with error code when timestamp unresolvable');
  assert.ok(!result.order.includes('completed'), 'decideIntegration must not run without a landed timestamp');
});

// --- R5 / R6 ---------------------------------------------------------------

/** A checkout the live stats writers can resolve a classification from. */
function createStatsRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-task-2369-stats-'));
  fs.mkdirSync(path.join(root, 'backlog', 'tasks'), { recursive: true });
  return root;
}

function writeTask(root: string, slug: string) {
  fs.mkdirSync(path.join(root, 'backlog', 'tasks'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'backlog', 'tasks', `${slug} - fixture.md`),
    ['---', `id: ${slug.toUpperCase()}`, 'labels: [ai_sdlc]', 'assignee: [claude]', 'status: active', '---', ''].join('\n'),
  );
}

// Old behavior that fails this test: `defaultPrFixRounds()` returned the string
// `'0'` whenever the caller supplied no count and no prior row carried one, and
// `measurementToStatsRow()` mapped SQL NULL to `'0'`. Both turn "we never
// measured this" into "we measured zero".
test('R5: the live review-fix writers keep known zero and unknown apart', async () => {
  const stats = await import('../src/adapters/cli/commands/stats.js');
  const root = createStatsRepo();
  const dbPath = path.join(root, 'parallix.db');
  try {
    writeTask(root, 'task-2369-known');
    writeTask(root, 'task-2369-unknown');

    stats.recordActiveStats({ slug: 'task-2369-known', rootDir: root, dbPath, implementer: 'claude', prFixRounds: '0', date: '2026-08-04' } as never);
    stats.recordReviewStats({ slug: 'task-2369-unknown', rootDir: root, dbPath, reviewer: 'claude', implementer: 'claude', date: '2026-08-04' } as never);

    const rows = stats.loadMeasurementRows({ dbPath }).rows;
    const known = rows.find(row => row.mission === 'task-2369-known');
    const unknown = rows.find(row => row.mission === 'task-2369-unknown');
    assert.equal(known?.pr_fix_rounds, '0', 'a known zero stays a real observed zero');
    assert.equal(unknown?.pr_fix_rounds, undefined, 'an unmeasured count stays unknown, never zero');

    // SQL NULL -> StatsRow unknown -> SQL NULL, without becoming zero. The
    // measurement record spells "no value" as `undefined` and binds it back as
    // SQL NULL, so the round trip is checked on both sides of the mapping.
    const store = new SqliteMeasurementStore(dbPath);
    try {
      const stored = store.listMeasurements().find(record => record.mission === 'task-2369-unknown');
      assert.equal(stored?.pr_fix_rounds, undefined, 'an unknown count reads back as no value, not zero');
      assert.equal(stats.statsRowToMeasurement(unknown as never).pr_fix_rounds, null, 'unknown writes back as SQL NULL');
      assert.equal(stats.statsRowToMeasurement(known as never).pr_fix_rounds, 0, 'a known zero writes back as a genuine 0');

      // Rewriting the row read back from the store must not manufacture a zero.
      stats.upsertMeasurementRow(unknown as never, { rootDir: root, store });
      const rewritten = store.listMeasurements().find(record => record.mission === 'task-2369-unknown');
      assert.equal(rewritten?.pr_fix_rounds, undefined, 'the round trip is stable — unknown stays unknown');
    } finally {
      store.close();
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// Old behavior that fails this test: `defaultPrFixRounds()` read prior rows as
// `Number.parseInt(String(record.pr_fix_rounds ?? 0))`, so a NULL row counted as
// a zero observation, and its `catch` returned `'0'` — a store that could not be
// read at all reported a measured zero.
test('R5: carrying a prior count forward skips NULL rows, and a read failure stays unknown', async () => {
  const stats = await import('../src/adapters/cli/commands/stats.js');
  const root = createStatsRepo();
  const dbPath = path.join(root, 'parallix.db');
  const store = new SqliteMeasurementStore(dbPath);
  try {
    for (const slug of ['task-2369-nulls', 'task-2369-carry', 'task-2369-broken']) { writeTask(root, slug); }

    // [NULL, NULL] -> unknown.
    stats.recordActiveStats({ slug: 'task-2369-nulls', rootDir: root, store, implementer: 'claude', date: '2026-08-04' } as never);
    const nulls = stats.recordReviewStats({ slug: 'task-2369-nulls', rootDir: root, store, reviewer: 'claude', implementer: 'claude', date: '2026-08-04' } as never);
    assert.equal(nulls.row.pr_fix_rounds, undefined, '[NULL, NULL] stays unknown');

    // [NULL, 2] -> the known 2 is carried forward past the NULL row.
    stats.recordActiveStats({ slug: 'task-2369-carry', rootDir: root, store, implementer: 'claude', date: '2026-08-04' } as never);
    stats.recordStageStats({ slug: 'task-2369-carry', stage: 'handoff', rootDir: root, store, implementer: 'claude', prFixRounds: '2', date: '2026-08-04' } as never);
    const carried = stats.recordReviewStats({ slug: 'task-2369-carry', rootDir: root, store, reviewer: 'claude', implementer: 'claude', date: '2026-08-04' } as never);
    assert.equal(carried.row.pr_fix_rounds, '2', 'a real known prior count is carried forward');

    // A measurement-store read failure yields unknown, never a manufactured zero.
    const unreadable = new Proxy(store, {
      get(target, property, receiver) {
        if (property === 'findByMission') { return () => { throw new Error('measurement store unavailable'); }; }
        return Reflect.get(target, property, receiver);
      },
    });
    const broken = stats.recordActiveStats({ slug: 'task-2369-broken', rootDir: root, store: unreadable, implementer: 'claude', date: '2026-08-04' } as never);
    assert.equal(broken.row.pr_fix_rounds, undefined, 'a read failure never manufactures zero');
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('R6: [0, 2, unknown, unknown] reports exactly two review-fix observations', async () => {
  const stats = await import('../src/adapters/cli/commands/stats.js');
  const checkout = createPrimaryAndWorktree('task-2369-observations');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-task-2369-cohort-'));
  const dbPath = path.join(directory, 'parallix.db');
  const db = new SqliteDatabaseAdapter();
  const missions = [
    { slug: 'task-2369-a', rounds: '0' },
    { slug: 'task-2369-b', rounds: '2' },
    { slug: 'task-2369-c', rounds: undefined },
    { slug: 'task-2369-d', rounds: undefined },
  ];
  try {
    await db.open({ path: dbPath });
    await new SqliteMigrationRunner(db).applyPending(loadDefaultMigrations());
    const repo = repositoryId(path.basename(checkout.primary));
    const events = new SqliteBoardLaneEventRepository(db);
    const store = new SqliteMeasurementStore(dbPath);
    try {
      for (const mission of missions) {
        writeTask(checkout.primary, mission.slug);
        // The LIVE convenience writer, not a direct repository insert.
        stats.recordActiveStats({
          slug: mission.slug, rootDir: checkout.primary, store,
          implementer: 'claude', prFixRounds: mission.rounds, date: '2026-08-04',
        } as never);
        await events.append(laneEvent({ repositoryId: repo, missionId: mission.slug, from: null, to: 'backlog', at: '2026-08-01T09:00:00.000Z' }));
        await events.append(laneEvent({ repositoryId: repo, missionId: mission.slug, from: 'integration', to: 'done', at: '2026-08-04T21:30:00.000Z' }));
      }
    } finally {
      store.close();
    }

    const metrics = await new ConcreteMetricsReadAdapter({
      laneEventRepo: events, usageRepo: new SqliteUsageRepository(db),
      repositoryId: repo, clock: () => '2026-08-05T10:00:00.000Z',
    }).buildMetrics(new Map(missions.map(mission => [missionId(mission.slug), 'done' as MissionStatus])));

    const cohort = metrics.cohorts?.cohorts.find(entry => entry.key === 'ai_sdlc');
    assert.equal(cohort?.n, 4, 'the completed population is all four missions');
    assert.equal(cohort?.observationCounts.reviewFixRounds, 2, 'only the two known counts are observations');
  } finally {
    await db.close();
    checkout.cleanup();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

// --- Part H: stats-surface agreement ---------------------------------------

// Removing the premature completion path must not break the correct post-landed
// reporting path. The integration-time report (recordIntegrationStats) and
// `px stats` both render through `renderWeeklyStatsReport` over the mission-flow
// population that `ConcreteMetricsReadAdapter` also feeds to BoardMetrics, so
// all three must observe the same newly completed missions.
test('the integration-time report, px stats, and BoardMetrics agree on the completed population', async () => {
  const stats = await import('../src/adapters/cli/commands/stats.js');
  const checkout = createPrimaryAndWorktree('task-2369-agreement');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-task-2369-agreement-'));
  const dbPath = path.join(directory, 'parallix.db');
  const db = new SqliteDatabaseAdapter();
  try {
    await db.open({ path: dbPath });
    await new SqliteMigrationRunner(db).applyPending(loadDefaultMigrations());
    const repo = repositoryId(path.basename(checkout.primary));
    const events = new SqliteBoardLaneEventRepository(db);
    const store = new SqliteMeasurementStore(dbPath);
    try {
      for (const [slug, completed] of [['task-2369-landed', true], ['task-2369-open', false]] as const) {
        writeTask(checkout.primary, slug);
        stats.recordActiveStats({ slug, rootDir: checkout.primary, store, implementer: 'claude', prFixRounds: '1', date: '2026-08-04' } as never);
        await events.append(laneEvent({ repositoryId: repo, missionId: slug, from: null, to: 'backlog', at: '2026-08-01T09:00:00.000Z' }));
        if (completed) {
          await events.append(laneEvent({ repositoryId: repo, missionId: slug, from: 'integration', to: 'done', at: '2026-08-04T21:30:00.000Z' }));
        }
      }
    } finally {
      store.close();
    }

    const adapter = new ConcreteMetricsReadAdapter({
      laneEventRepo: events, usageRepo: new SqliteUsageRepository(db),
      repositoryId: repo, clock: () => '2026-08-05T10:00:00.000Z',
    });
    const outcomes = await adapter.readOutcomes();
    const metrics = await adapter.buildMetrics(new Map([
      [missionId('task-2369-landed'), 'done' as MissionStatus],
      [missionId('task-2369-open'), 'integration' as MissionStatus],
    ]));
    const report = stats.renderWeeklyStatsReport(stats.loadMeasurementRows({ dbPath }).rows, {
      today: '2026-08-05',
      missionFlow: outcomes.map(outcome => ({ repo: String(repo), mission: outcome.missionId, closedAt: outcome.closedAt, labels: outcome.labels })),
    } as never);

    assert.deepEqual(outcomes.map(outcome => String(outcome.missionId)), ['task-2369-landed'], 'lifecycle owns the population');
    assert.equal(metrics.decisionWindow?.current.completedMissions, 1, 'BoardMetrics sees exactly the landed mission');
    assert.match(report, /# completed missions[\s\S]*\n1\s/, 'the report sees the same one completed mission');
  } finally {
    await db.close();
    checkout.cleanup();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

// --- R7 --------------------------------------------------------------------

test('R7: telemetry cannot decide Mission completion', async () => {
  const stats = await import('../src/adapters/cli/commands/stats.js');

  // No contemporary StatsRow column can express completion.
  for (const forbidden of ['closed', 'completed', 'is_final', 'is_closed']) {
    assert.ok(!stats.STATS_HEADERS.includes(forbidden), `${forbidden} must not be a live StatsRow column`);
  }

  const rows = [{
    date: '2026-08-04', repo: 'parallix', mission: 'task-2369-telemetry', classification: 'ai_sdlc',
    implementer: 'claude', pr_fix_rounds: '1', stage: 'default', closed: 'yes', completed: 'yes',
  }] as never[];
  const window = { start: new Date('2026-07-29T00:00:00Z'), end: new Date('2026-08-05T00:00:00Z') };

  // Lifecycle supplies the completed population; a final-looking row supplies none.
  assert.equal(stats.summarizeMissionWindow(rows, window, new Set()).total, 0);
  assert.equal(
    stats.summarizeMissionWindow(rows, window, new Set(['parallix::task-2369-telemetry'])).total,
    1,
    'only the lifecycle key admits the mission to the completed population',
  );
});

// --- R8 --------------------------------------------------------------------

// The full identity regression (worktree + product.name mismatch joining the
// authoritative Mission) lives in test/task-2363-repository-identity.test.ts.
// This keeps the TASK-2369 set self-contained on the write-side invariant.
test('R8: new telemetry writes use the canonical repository id, not product.name', async () => {
  const stats = await import('../src/adapters/cli/commands/stats.js');
  const identity = await import('../src/adapters/git/repository-identity.js');
  const checkout = createPrimaryAndWorktree('task-2369-canonical');
  try {
    for (const root of [checkout.primary, checkout.worktree]) {
      fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ product: { name: 'a-different-display-name' } }));
    }
    assert.equal(stats.resolveStatsRepoName(checkout.worktree), identity.resolveCanonicalRepositoryId(checkout.primary));
    assert.notEqual(stats.resolveStatsRepoName(checkout.worktree), 'a-different-display-name');
  } finally {
    checkout.cleanup();
  }
});
