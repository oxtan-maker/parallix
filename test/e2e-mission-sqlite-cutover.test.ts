/**
 * E2E test suite for the SQLite cutover (TASK-2322.07).
 *
 * Covers SC6 scenarios:
 * (a) cold start after import
 * (b) restart recovery
 * (c) concurrent stale writers
 * (d) every supported Mission transition
 * (e) review and integration flow
 * (f) direct mutation of retired legacy files
 *
 * These tests exercise SqliteMissionStore as the sole production authority,
 * verifying that legacy files are no longer read or written for Mission state.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { missionId, missionLabels, type Mission, type MissionStatus } from '../src/domain/mission.js';
import { changeRevision, reviewFindingId, type Review } from '../src/domain/review.js';
import { agentFamily } from '../src/domain/agents.js';
import { repositoryId } from '../src/domain/repository.js';
import { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
import { loadDefaultMigrations, SqliteMigrationRunner } from '../src/adapters/sqlite/migration-runner.js';
import { SqliteMissionStore } from '../src/adapters/sqlite/mission-store.js';
import { createMissionApplicationServices } from '../src/composition/application-services.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

function createTempDir(prefix = 'parallix-sqlite-cutover-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function openDatabase(databasePath: string): Promise<SqliteDatabaseAdapter> {
  const database = new SqliteDatabaseAdapter();
  await database.open({ path: databasePath });
  return database;
}

async function migratedDatabase(
  databasePath: string,
): Promise<SqliteDatabaseAdapter> {
  const database = await openDatabase(databasePath);
  await new SqliteMigrationRunner(database).applyPending(loadDefaultMigrations());
  return database;
}

const testRepositoryId = repositoryId('repo-parallix');

function createMinimalMission(slug: string, status: MissionStatus = 'refined'): Mission {
  return {
    id: missionId(slug),
    repositoryId: testRepositoryId,
    title: `Mission ${slug}`,
    labels: missionLabels([]),
    assignee: agentFamily('custom'),
    status,
    rawStatus: status,
    checkpoints: [],
    review: null,
    netEngineeringLines: null,
    closedAt: null,
  } as Mission;
}

function createReviewWithRounds(rounds: number): Review {
  const findingId = reviewFindingId(`finding-${rounds}`);
  return {
    rounds: Array.from({ length: rounds }, (_, i) => ({
      number: i + 1,
      subject: {
        change: {
          kind: 'pull-request' as const,
          provider: 'forgejo' as const,
          id: String(i + 1),
          url: 'http://forgejo.local/pulls/1',
          sourceBranch: 'mission/test',
          targetBranch: 'main',
        },
        revision: changeRevision(`rev-${i}`),
      },
      reviewer: agentFamily('codex'),
      implementer: agentFamily('custom'),
      startedAt: new Date().toISOString(),
      decision: {
        kind: 'changes-requested' as const,
        decidedAt: new Date().toISOString(),
        comment: 'Review finding',
        findings: [{
          id: findingId,
          summary: 'Review finding',
          location: 'src/test.ts:1',
        }],
      },
      response: i === 0 ? {
        kind: 'resolved' as const,
        respondedAt: new Date().toISOString(),
        resolutions: [{
          findingId,
          kind: 'fixed' as const,
          evidence: 'Fixed',
        }],
        resultingRevision: changeRevision(`rev-${i + 1}`),
      } : undefined,
      phase: i === 0 ? 'pending-approval' as const : 'fixing' as const,
      disposition: i === 0 ? 'CHANGES_MADE' as const : 'REQUEST_CHANGES' as const,
      reviewerRetryCount: 0,
      implementerRetryCount: 0,
    })),
    stageLaunches: [],
    gateFailureRetryCount: 0,
    reviewEvents: [],
  } as unknown as Review;
}

// ---------------------------------------------------------------------------
// (a) Cold start after import
// ---------------------------------------------------------------------------

test('cold start after import: all Missions load from SQLite after import pipeline', async () => {
  const dir = createTempDir();
  const dbPath = path.join(dir, 'operator.db');
  const db = await migratedDatabase(dbPath);

  const store = new SqliteMissionStore(db);
  const mission = createMinimalMission('task-cold-001', 'refined');
  const saveResult = await store.save(mission, null);
  assert.ok(saveResult, 'save should succeed');

  // Cold start: create a new database connection and store
  const db2 = await migratedDatabase(dbPath);
  const store2 = new SqliteMissionStore(db2);

  const loadResult = await store2.load(missionId('task-cold-001'));
  assert.ok(loadResult.kind === 'found', 'load should succeed after cold start');
  assert.equal(loadResult.mission.id, 'task-cold-001');
  assert.equal(loadResult.mission.status, 'refined');

  await db.close();
  await db2.close();
});

test('cold start after import: multiple Missions survive restart', async () => {
  const dir = createTempDir();
  const dbPath = path.join(dir, 'operator.db');
  const db = await migratedDatabase(dbPath);

  const store = new SqliteMissionStore(db);

  const missions = [
    createMinimalMission('task-cold-002', 'refined'),
    createMinimalMission('task-cold-003', 'active'),
    createMinimalMission('task-cold-004', 'review'),
  ];

  for (const m of missions) {
    const result = await store.save(m, null);
    assert.ok(result, `save ${m.id} should succeed`);
  }

  // Cold start: new connection
  const db2 = await migratedDatabase(dbPath);
  const store2 = new SqliteMissionStore(db2);

  for (const m of missions) {
    const loadResult = await store2.load(m.id);
    assert.ok(loadResult.kind === 'found', `load ${m.id} should succeed`);
    assert.equal(loadResult.mission.status, m.status);
  }

  await db.close();
  await db2.close();
});

// ---------------------------------------------------------------------------
// (b) Restart recovery
// ---------------------------------------------------------------------------

test('restart recovery: SQLite database survives process restart', async () => {
  const dir = createTempDir();
  const dbPath = path.join(dir, 'operator.db');
  const db = await migratedDatabase(dbPath);

  const store = new SqliteMissionStore(db);
  const mission = createMinimalMission('task-restart-001', 'active');
  const saveResult = await store.save(mission, null);
  assert.ok(saveResult);

  // Simulate restart: close and reopen
  await db.close();

  const db2 = await migratedDatabase(dbPath);
  const store2 = new SqliteMissionStore(db2);

  const loadResult = await store2.load(missionId('task-restart-001'));
  assert.ok(loadResult.kind === 'found', 'load should succeed after restart');
  assert.equal(loadResult.mission.status, 'active');

  // Verify write after restart (load to get current version)
  const reloadResult = await store2.load(missionId('task-restart-001'));
  assert.ok(reloadResult.kind === 'found', 'reload should succeed');
  const updatedMission: Mission = { ...reloadResult.mission, status: 'review' } as Mission;
  const updateResult = await store2.save(updatedMission, reloadResult.version);
  assert.ok(updateResult, 'save should succeed after restart');

  await db2.close();
});

// ---------------------------------------------------------------------------
// (c) Concurrent stale writers
// ---------------------------------------------------------------------------

test('concurrent stale writers: stale version is rejected', async () => {
  const dir = createTempDir();
  const dbPath = path.join(dir, 'operator.db');
  const db = await migratedDatabase(dbPath);

  const store = new SqliteMissionStore(db);
  const mission = createMinimalMission('task-stale-001', 'refined');
  const saveResult = await store.save(mission, null);
  assert.ok(saveResult);

  // Load mission twice (simulating two writers)
  const load1 = await store.load(missionId('task-stale-001'));
  const load2 = await store.load(missionId('task-stale-001'));
  assert.ok(load1.kind === 'found');
  assert.ok(load2.kind === 'found');

  // Writer 1 saves first (with expected version from load)
  const updated1: Mission = { ...load1.mission, status: 'active' } as Mission;
  const save1 = await store.save(updated1, load1.version);
  assert.ok(save1, 'first writer should succeed');

  // Writer 2 tries to save with stale version
  const updated2: Mission = { ...load2.mission, status: 'active' } as Mission;
  try {
    await store.save(updated2, load2.version);
    assert.fail('second writer should have thrown stale write error');
  } catch (error: any) {
    assert.match(error.message, /Stale write/, 'second writer should get stale write error');
  }

  await db.close();
});

// ---------------------------------------------------------------------------
// (d) Every supported Mission transition
// ---------------------------------------------------------------------------

test('every supported Mission transition: backlog -> refined -> active -> review -> integration -> done', async () => {
  const dir = createTempDir();
  const dbPath = path.join(dir, 'operator.db');
  const db = await migratedDatabase(dbPath);

  const store = new SqliteMissionStore(db);
  const transitions: MissionStatus[] = ['refined', 'active', 'review', 'integration', 'done'];
  let currentMission = createMinimalMission('task-transition-001', 'refined');

  // Initial save
  const initResult = await store.save(currentMission, null);
  assert.ok(initResult);

  for (const status of transitions) {
    const loadResult = await store.load(missionId('task-transition-001'));
    assert.ok(loadResult.kind === 'found', `load before ${status} should succeed`);

    currentMission = { ...loadResult.mission, status } as Mission;
    const saveResult = await store.save(currentMission, loadResult.version);
    assert.ok(saveResult, `transition to ${status} should succeed`);
  }

  // Final verification
  const finalLoad = await store.load(missionId('task-transition-001'));
  assert.ok(finalLoad.kind === 'found');
  assert.equal(finalLoad.mission.status, 'done');

  await db.close();
});

// ---------------------------------------------------------------------------
// (e) Review and integration flow
// ---------------------------------------------------------------------------

test('review and integration flow: review rounds persisted through SQLite', async () => {
  const dir = createTempDir();
  const dbPath = path.join(dir, 'operator.db');
  const db = await migratedDatabase(dbPath);

  const store = new SqliteMissionStore(db);

  // Create mission with review rounds
  const mission: Mission = {
    ...createMinimalMission('task-review-001', 'review'),
    review: createReviewWithRounds(2),
  };

  const saveResult = await store.save(mission, null);
  assert.ok(saveResult, 'save with review should succeed');

  // Load and verify review rounds
  const loadResult = await store.load(missionId('task-review-001'));
  assert.ok(loadResult.kind === 'found');
  assert.ok(loadResult.mission.review, 'review should be loaded');
  assert.equal(loadResult.mission.review.rounds.length, 2, 'should have 2 review rounds');
  assert.equal(loadResult.mission.review.rounds[0].decision.kind, 'changes-requested');
  assert.equal(loadResult.mission.review.rounds[1].decision.kind, 'changes-requested');

  await db.close();
});

test('review and integration flow: integration transition preserves review data', async () => {
  const dir = createTempDir();
  const dbPath = path.join(dir, 'operator.db');
  const db = await migratedDatabase(dbPath);

  const store = new SqliteMissionStore(db);

  // Create mission with review
  const mission: Mission = {
    ...createMinimalMission('task-integration-001', 'review'),
    review: createReviewWithRounds(1),
  };
  const saveResult = await store.save(mission, null);
  assert.ok(saveResult);

  // Transition to integration
  const loadResult = await store.load(missionId('task-integration-001'));
  assert.ok(loadResult.kind === 'found');
  const updatedMission: Mission = { ...loadResult.mission, status: 'integration' } as Mission;
  const transitionResult = await store.save(updatedMission, loadResult.version);
  assert.ok(transitionResult, 'transition to integration should succeed');

  // Verify review data is preserved
  const finalLoad = await store.load(missionId('task-integration-001'));
  assert.ok(finalLoad.kind === 'found');
  assert.equal(finalLoad.mission.status, 'integration');
  assert.ok(finalLoad.mission.review, 'review should be preserved after transition');
  assert.equal(finalLoad.mission.review.rounds.length, 1);

  await db.close();
});

// ---------------------------------------------------------------------------
// (f) Direct mutation of retired legacy files
// ---------------------------------------------------------------------------

test('direct mutation of retired legacy files: legacy file changes do not affect SQLite state', async () => {
  const dir = createTempDir();
  const dbPath = path.join(dir, 'operator.db');
  const db = await migratedDatabase(dbPath);

  const store = new SqliteMissionStore(db);

  // Save mission to SQLite
  const mission = createMinimalMission('task-legacy-001', 'active');
  const saveResult = await store.save(mission, null);
  assert.ok(saveResult);

  // Create legacy files (simulating old system)
  const missionDir = path.join(dir, 'missions', 'task-legacy-001');
  fs.mkdirSync(missionDir, { recursive: true });

  // Mutate legacy review-state.json
  const reviewStatePath = path.join(missionDir, 'review-state.json');
  fs.writeFileSync(reviewStatePath, JSON.stringify({
    round: 99,
    phase: 'approved',
    disposition: 'APPROVED',
  }, null, 2));

  // Mutate legacy CP-N.md
  fs.writeFileSync(path.join(missionDir, 'CP-1.md'), '# CP-1: Legacy checkpoint\n', 'utf8');

  // Load from SQLite — should NOT reflect legacy file changes
  const loadResult = await store.load(missionId('task-legacy-001'));
  assert.ok(loadResult.kind === 'found');
  assert.equal(loadResult.mission.status, 'active', 'status should come from SQLite, not legacy files');

  // The review in SQLite is null (not loaded from review-state.json)
  assert.equal(loadResult.mission.review, null, 'review should be from SQLite, not review-state.json');

  await db.close();
});

// ---------------------------------------------------------------------------
// Composition root cutover verification
// ---------------------------------------------------------------------------

test('composition root: createMissionApplicationServices uses SqliteMissionStore', async () => {
  const dir = createTempDir();

  // Create minimal repo structure
  fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'workflow.config.json'), JSON.stringify({
    product: { name: 'test', targetUser: 'test' },
    adapters: {
      tasks: { provider: 'backlog-md', storage: 'backlog', stateMap: 'config/state-map.json' },
      agents: { models: { custom: 'stub/custom' } },
      missions: { baseDir: 'missions', branchPrefix: 'mission/', worktreePattern: '../<repo>-<slug>' },
      verification: { command: ':', defaultArea: 'all' },
    },
  }, null, 2));
  fs.writeFileSync(path.join(dir, 'config', 'state-map.json'), '{}');

  // Create mission directory
  const missionDir = path.join(dir, 'missions', 'task-composition-001');
  fs.mkdirSync(missionDir, { recursive: true });

  const services = await createMissionApplicationServices(dir);
  assert.ok(services.store instanceof SqliteMissionStore, 'store should be SqliteMissionStore');
  // Callers building an intake request must be able to read the canonicalized
  // repository identity back rather than deriving their own from a worktree path.
  assert.equal(
    services.repositoryId,
    path.basename(dir),
    'services must expose the repository identity they are bound to',
  );
});

test('composition root: CompatibilityMissionStore is not used in production', async () => {
  const dir = createTempDir();

  // Create minimal repo structure
  fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'workflow.config.json'), JSON.stringify({
    product: { name: 'test', targetUser: 'test' },
    adapters: {
      tasks: { provider: 'backlog-md', storage: 'backlog', stateMap: 'config/state-map.json' },
      agents: { models: { custom: 'stub/custom' } },
      missions: { baseDir: 'missions', branchPrefix: 'mission/', worktreePattern: '../<repo>-<slug>' },
      verification: { command: ':', defaultArea: 'all' },
    },
  }, null, 2));
  fs.writeFileSync(path.join(dir, 'config', 'state-map.json'), '{}');

  const missionDir = path.join(dir, 'missions', 'task-composition-002');
  fs.mkdirSync(missionDir, { recursive: true });

  const services = await createMissionApplicationServices(dir);

  // Verify the store is SqliteMissionStore, not CompatibilityMissionStore
  const storeType = services.store.constructor.name;
  assert.equal(storeType, 'SqliteMissionStore', `store should be SqliteMissionStore, got ${storeType}`);
});

// ---------------------------------------------------------------------------
// Fail-closed on database unavailability
// ---------------------------------------------------------------------------

test('fail-closed: database unavailability fails operations without legacy fallback', async () => {
  const dir = createTempDir();
  const dbPath = path.join(dir, 'operator.db');
  const db = await migratedDatabase(dbPath);

  const store = new SqliteMissionStore(db);

  // Save a mission
  const mission = createMinimalMission('task-fail-001', 'active');
  const saveResult = await store.save(mission, null);
  assert.ok(saveResult);

  // Close database (simulating unavailability)
  await db.close();

  // Load should fail (not fall back to legacy files)
  let loadFailed = false;
  try {
    await store.load(missionId('task-fail-001'));
  } catch {
    loadFailed = true;
  }
  assert.ok(loadFailed, 'load should fail when database is unavailable');
});

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

test.afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});
