import { auditMissionTimestamps, applyMissionTimestampMigration } from '../../../scripts/mission-timestamp-migration.js';
import { decisionWindowContains, weeklyDecisionWindows } from '../../../src/domain/decision-window.js';
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { missionVersion } from '../../../src/application/domain-ports.js';
import { RevokeReviewDecisionUseCase } from '../../../src/application/revoke-review-decision-use-case.js';
import { MissionLifecycleService } from '../../../src/application/mission-lifecycle-service.js';
import { agentFamily } from '../../../src/domain/agents.js';
import { missionId, missionLabels, type Mission } from '../../../src/domain/mission.js';
import { repositoryId } from '../../../src/domain/repository.js';
import {
  changeRevision,
  reviewFindingId,
  type Review,
} from '../../../src/domain/review.js';
import { SQLITE_ENTITY_AUTHORITY } from '../../../src/adapters/sqlite/authority-map.js';
import {
  type Migration,
  SqliteDatabaseAdapter,
} from '../../../src/adapters/sqlite/database-adapter.js';
import {
  loadDefaultMigrations,
  SqliteMigrationRunner,
} from '../../../src/adapters/sqlite/migration-runner.js';
import {
  MissionStaleWriteError,
  SqliteMissionStore,
} from '../../../src/adapters/sqlite/mission-store.js';
import { SqliteBoardLaneEventRepository } from '../../../src/adapters/sqlite/board-lane-event-repository.js';

const tempDirs: string[] = [];

function tempDatabasePath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-mission-store-'));
  tempDirs.push(dir);
  return path.join(dir, 'operator.db');
}

async function openDatabase(databasePath = tempDatabasePath()): Promise<SqliteDatabaseAdapter> {
  const database = new SqliteDatabaseAdapter();
  await database.open({ path: databasePath });
  return database;
}

async function migratedDatabase(
  databasePath = tempDatabasePath(),
): Promise<SqliteDatabaseAdapter> {
  const database = await openDatabase(databasePath);
  await new SqliteMigrationRunner(database).applyPending(loadDefaultMigrations());
  return database;
}

const testMissionId = missionId('task-mission-store');
const testRepositoryId = repositoryId('repo-parallix');

function completeReview(): Review {
  const findingId = reviewFindingId('finding-1');
  return {
    rounds: [{
      number: 1,
      subject: {
        change: {
          kind: 'pull-request',
          provider: 'forgejo',
          id: '42',
          url: 'http://forgejo.local/pulls/42',
          sourceBranch: 'mission/task-mission-store',
          targetBranch: 'main',
        },
        revision: changeRevision('abc123'),
      },
      reviewer: agentFamily('codex'),
      implementer: agentFamily('custom'),
      startedAt: '2026-07-29T10:00:00Z',
      decision: {
        kind: 'changes-requested',
        decidedAt: '2026-07-29T10:10:00Z',
        comment: 'Use the checked domain model',
        findings: [{
          id: findingId,
          summary: 'Persistence bypasses domain types',
          location: 'src/adapters/sqlite/mission-store.ts:1',
        }],
      },
      response: {
        kind: 'resolved',
        respondedAt: '2026-07-29T10:20:00Z',
        resolutions: [{
          findingId,
          kind: 'fixed',
          evidence: 'Normalized relational rows hydrate through domain factories',
        }],
        resultingRevision: changeRevision('def456'),
      },
      phase: 'pending-approval',
      disposition: 'CHANGES_MADE',
      reviewerRetryCount: 2,
      implementerRetryCount: 1,
    }, {
      number: 2,
      subject: {
        change: {
          kind: 'local-branch',
          sourceBranch: 'mission/task-mission-store',
          targetBranch: 'main',
        },
        revision: changeRevision('def456'),
        // TASK-2704: the baseline a round's mission diff was measured from survives reload; round 1 keeps none.
        baseline: changeRevision('0ldba5e'),
      },
      reviewer: agentFamily('codex'),
      implementer: agentFamily('custom'),
      startedAt: '2026-07-29T10:30:00Z',
      decision: {
        kind: 'approved',
        decidedAt: '2026-07-29T10:40:00Z',
        comment: null,
        source: { kind: 'provider', provider: 'forgejo' },
      },
      response: null,
      phase: 'approved',
      disposition: 'APPROVED',
      reviewerRetryCount: 0,
      implementerRetryCount: 0,
    }],
    intervention: {
      requestedAt: '2026-07-29T10:50:00Z',
      requestedBy: 'workflow',
      reason: 'Awaiting operator confirmation',
    },
    // Canonical (stage-key sorted) order, matching what a reload produces.
    stageLaunches: [
      { stageKey: 'fix:custom', fingerprints: ['custom|s3|t4|t5|0'] },
      { stageKey: 'review:codex', fingerprints: ['codex|s1|t0|t1|0', 'codex|s2|t2|t3|0'] },
    ],
    reviewEvents: [],
  };
}

function completeMission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: testMissionId,
    repositoryId: testRepositoryId,
    title: 'Persist the checked Mission aggregate',
    labels: missionLabels(['AI_SDLC', 'database']),
    assignee: agentFamily('codex'),
    status: 'review',
    rawStatus: 'request-changes',
    checkpoints: [{
      missionId: testMissionId,
      name: 'CP-1',
      rawFilename: 'CP-1.md',
      firstLine: '# CP-1: Persistence',
      goalCheck: [
        { criterion: 'Mission round trips', evidence: 'named adapter test' },
        { criterion: 'Writes are checked', evidence: 'same-status stale-writer test', recordedRound: 2, repairedGate: 'unit', repairedGates: ['unit', 'docs'] },
      ],
      nextActionText: 'Run the integration suite.',
    }],
    brief: {
      goal: 'Persist the mission brief',
      why: 'Agents must resume without a mission document.',
      scope: 'Mission aggregate persistence only.',
      outOfScope: ['Raw Markdown authority'],
    },
    declaredGates: ['./scripts/verify-local.sh all', 'npm test'],
    successCriteria: ['The aggregate survives a restart', 'Stale writes are rejected'],
    completedSuccessCriteria: [1],
    dependencies: ['task-2521.01', 'task-2521.03'],
    predictedNelBucket: 'Medium',
    reproductionTest: 'test/task-2294-repro.test.ts',
    review: completeReview(),
    netEngineeringLines: 321,
    closedAt: null,
    ...overrides,
  } as Mission;
}

async function tableNames(database: SqliteDatabaseAdapter): Promise<string[]> {
  const rows = await database.query<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  );
  return rows.map(({ name }) => name);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('SQLite Mission aggregate integration', () => {
  it('migrates stored success criteria as incomplete and keeps their text (TASK-2631)', async () => {
    const database = await openDatabase();
    try {
      const migrations = loadDefaultMigrations();
      const before = migrations.filter((migration) => !migration.id.startsWith('0029-'));
      assert.ok(before.length < migrations.length, 'the completion migration must exist');
      await new SqliteMigrationRunner(database).applyPending(before);
      const store = new SqliteMissionStore(database);
      await store.save(completeMission({ successCriteria: [], completedSuccessCriteria: [] }), null);
      for (const [position, criterion] of ['The aggregate survives a restart', 'Stale writes are rejected'].entries()) {
        await database.execute(
          'INSERT INTO mission_success_criteria (mission_id, position, criterion) VALUES (?, ?, ?)',
          [testMissionId, position, criterion],
        );
      }
      await new SqliteMigrationRunner(database).applyPending(migrations);
      const loaded = await store.load(testMissionId);
      assert.equal(loaded.kind, 'found');
      assert.deepEqual(loaded.mission.successCriteria, ['The aggregate survives a restart', 'Stale writes are rejected']);
      assert.deepEqual(loaded.mission.completedSuccessCriteria, []);
    } finally {
      await database.close();
    }
  });

  it('persists completed success criteria by position (TASK-2631)', async () => {
    const database = await migratedDatabase();
    try {
      const store = new SqliteMissionStore(database);
      const version = await store.save(completeMission({ completedSuccessCriteria: [0] }), null);
      const loaded = await store.load(testMissionId);
      assert.equal(loaded.kind, 'found');
      assert.deepEqual(loaded.mission.completedSuccessCriteria, [0]);
      await assert.rejects(store.save(completeMission({ completedSuccessCriteria: [2] }), version), /out of range/);
    } finally {
      await database.close();
    }
  });

  it('uses normalized domain-shaped tables and keeps repository observations separate', async () => {
    const database = await migratedDatabase();
    try {
      const tables = await tableNames(database);
      for (const table of [
        'missions',
        'mission_labels',
        'mission_checkpoints',
        'mission_dependencies',
        'mission_checkpoint_goal_checks',
        'mission_reviews',
        'mission_review_rounds',
        'mission_review_findings',
        'mission_review_resolutions',
      ]) {
        assert.ok(tables.includes(table), `${table} should exist`);
        assert.ok(table in SQLITE_ENTITY_AUTHORITY, `${table} needs an authority mapping`);
      }

      const columns = await database.query<{ name: string }>('PRAGMA table_info(missions)');
      assert.deepEqual(
        columns.map(({ name }) => name),
        [
          'id',
          'repository_id',
          'title',
          'status',
          'raw_status',
          'assignee',
          'net_engineering_lines',
          'closed_at',
          'version',
          'reproduction_test',
          'predicted_nel_bucket',
          'description',
        ],
      );
      assert.ok(!columns.some(({ name }) => ['labels', 'checkpoints', 'review'].includes(name)));

      const repositoryColumns = await database.query<{ name: string }>(
        'PRAGMA table_info(known_repositories)',
      );
      assert.ok(repositoryColumns.some(({ name }) => name === 'display_name'));

      await assert.rejects(
        database.execute(
          `INSERT INTO missions
             (id, repository_id, title, status, net_engineering_lines, version)
           VALUES (?, ?, ?, ?, ?, ?)`,
          ['task-invalid', 'repo-parallix', 'Invalid', 'schema-invented-status', -1, 1],
        ),
        /CHECK constraint failed/,
      );
    } finally {
      await database.close();
    }
  });

  it('round trips every checked Mission, CheckpointData, and Review value through real rows', async () => {
    const database = await migratedDatabase();
    try {
      const store = new SqliteMissionStore(database);
      const mission = completeMission();
      const version = await store.save(mission, null);
      assert.equal(version, 1);

      const loaded = await store.load(mission.id);
      assert.equal(loaded.kind, 'found');
      assert.deepEqual(loaded.mission, mission);
      assert.equal(loaded.version, version);

      const labels = await database.query<{ label: string }>(
        'SELECT label FROM mission_labels WHERE mission_id = ? ORDER BY position',
        [mission.id],
      );
      assert.deepEqual(labels.map(({ label }) => label), ['ai_sdlc', 'database']);
      const reviewKinds = await database.query<{ change_kind: string; decision_kind: string }>(
        `SELECT change_kind, decision_kind FROM mission_review_rounds
         WHERE mission_id = ? ORDER BY position`,
        [mission.id],
      );
      assert.deepEqual(reviewKinds.map((row) => ({ ...row })), [
        { change_kind: 'pull-request', decision_kind: 'changes-requested' },
        { change_kind: 'local-branch', decision_kind: 'approved' },
      ]);
    } finally {
      await database.close();
    }
  });

  it('use case persists a revoked approval and opens a reviewable round', async () => {
    const database = await migratedDatabase();
    try {
      const store = new SqliteMissionStore(database);
      const recorded = completeMission({ status: 'integration', rawStatus: 'integration' });
      const version = await store.save(recorded, null);
      const useCase = new RevokeReviewDecisionUseCase(store, new MissionLifecycleService(store));
      const result = await useCase.execute({
        slug: recorded.id, round: 2, reason: 'The approval was unfounded', operator: 'operator',
        occurredAt: '2026-09-25T00:00:00Z', expectedVersion: version,
      });
      assert.equal(result.status, 'completed');
      const loaded = await store.load(recorded.id);
      assert.equal(loaded.kind, 'found');
      assert.equal(loaded.mission.status, 'review');
      assert.equal(loaded.mission.review?.rounds.length, 3);
      const decision = loaded.mission.review?.rounds[1]?.decision;
      assert.equal(decision?.kind, 'approved');
      assert.deepEqual(decision.revocation, {
        revokedAt: '2026-09-25T00:00:00Z', revokedBy: 'operator', reason: 'The approval was unfounded',
        cause: { kind: 'operator' },
      });
    } finally {
      await database.close();
    }
  });

  it('persists an integration-gate rebound cause with its failed gate (TASK-2620)', async () => {
    const database = await migratedDatabase();
    try {
      const store = new SqliteMissionStore(database);
      const recorded = completeMission({ status: 'integration', rawStatus: 'integration' });
      const version = await store.save(recorded, null);
      const result = await new MissionLifecycleService(store).transition({
        operationId: 'rebound', missionId: recorded.id, expectedVersion: version,
        capabilities: new Set(['mission:transition']),
        command: { type: 'rebound-to-active', agent: recorded.assignee!, cause: { kind: 'integration-gate-failure', gate: 'agent-smoke', command: 'npm run test:agent-e2e', log: 'model slot busy' }, occurredAt: '2026-09-25T00:00:00Z' },
        actor: 'workflow', occurredAt: '2026-09-25T00:00:00Z', idempotencyKey: 'rebound:1',
      });
      assert.equal(result.status, 'completed');
      const loaded = await store.load(recorded.id);
      assert.equal(loaded.kind, 'found');
      const decision = loaded.mission.review?.rounds[1]?.decision;
      assert.equal(decision?.kind, 'approved');
      assert.deepEqual(decision.revocation?.cause, { kind: 'integration-gate-failure', gate: 'agent-smoke', command: 'npm run test:agent-e2e', log: 'model slot busy' });
    } finally {
      await database.close();
    }
  });

  it('refuses an invalid brief before it can make a Mission unloadable', async () => {
    const database = await migratedDatabase();
    try {
      const store = new SqliteMissionStore(database);
      await assert.rejects(
        store.save(completeMission({ brief: { ...completeMission().brief!, goal: '  ' } }), null),
        /goal must be trimmed/,
      );
      assert.deepEqual(await store.load(testMissionId), { kind: 'missing' });
    } finally { await database.close(); }
  });

  it('refuses a duplicate declared gate before it can make a Mission unloadable', async () => {
    const database = await migratedDatabase();
    try {
      const store = new SqliteMissionStore(database);
      await assert.rejects(
        store.save(completeMission({ declaredGates: ['npm test', 'npm test'] }), null),
        /gate is already declared: npm test/,
      );
      assert.deepEqual(await store.load(testMissionId), { kind: 'missing' });
    } finally { await database.close(); }
  });

  it('reopens the brief, the declared gates and checkpoint evidence without repository files', async () => {
    const databasePath = tempDatabasePath();
    const first = await migratedDatabase(databasePath);
    const mission = completeMission({ review: null });
    await new SqliteMissionStore(first).save(mission, null);
    await first.close();
    const second = await migratedDatabase(databasePath);
    try {
      const loaded = await new SqliteMissionStore(second).load(mission.id);
      assert.equal(loaded.kind, 'found');
      assert.deepEqual(loaded.mission.brief, mission.brief);
      assert.deepEqual(loaded.mission.declaredGates, mission.declaredGates);
      assert.deepEqual(loaded.mission.checkpoints, mission.checkpoints);
    } finally { await second.close(); }
  });

  it('omits blank goal checks instead of failing Mission loads (TASK-2633)', async () => {
    const database = await migratedDatabase();
    try {
      const store = new SqliteMissionStore(database);
      const mission = completeMission({ review: null });
      await store.save(mission, null);
      assert.ok(mission.checkpoints.length > 0, 'fixture must carry a checkpoint');
      await database.execute(
        `INSERT INTO mission_checkpoint_goal_checks
           (mission_id, checkpoint_position, position, criterion, evidence)
         VALUES (?, 0, 998, '', 'has evidence'), (?, 0, 999, 'has criterion', '  ')`,
        [mission.id, mission.id],
      );
      const loaded = await store.load(mission.id);
      assert.equal(loaded.kind, 'found');
      assert.deepEqual(loaded.mission.checkpoints, mission.checkpoints);
      const byRepository = await store.loadByRepository(testRepositoryId);
      assert.equal(byRepository.length, 1);
    } finally { await database.close(); }
  });

  it('loadByRepository returns each mission of the repository exactly as load does and follows later writes and removals (TASK-2681)', async () => {
    const databasePath = tempDatabasePath();
    const database = await migratedDatabase(databasePath);
    try {
      const store = new SqliteMissionStore(database);
      const first = completeMission();
      const second = completeMission({ id: missionId('task-mission-store-two'), review: null, checkpoints: [] });
      const foreign = completeMission({ id: missionId('task-mission-store-other'), repositoryId: repositoryId('repo-other'), review: null, checkpoints: [] });
      await store.save(first, null);
      await store.save(second, null);
      await store.save(foreign, null);

      const listed = await store.loadByRepository(testRepositoryId);
      assert.deepEqual(listed.map((mission) => mission.id), [first.id, second.id].sort());
      for (const mission of listed) {
        const loaded = await store.load(mission.id);
        assert.equal(loaded.kind, 'found');
        assert.deepEqual(mission, loaded.mission);
      }

      const version = await store.save({ ...second, title: 'Renamed after the first list' }, missionVersion(1));
      assert.ok(version > 1);
      const refreshed = await store.loadByRepository(testRepositoryId);
      assert.equal(refreshed.find((mission) => mission.id === second.id)?.title, 'Renamed after the first list');

      // A write from another connection (another px process) is seen as well.
      const otherDatabase = await openDatabase(databasePath);
      try {
        await new SqliteMissionStore(otherDatabase).save({ ...second, title: 'Renamed elsewhere' }, version);
      } finally { await otherDatabase.close(); }
      const seen = await store.loadByRepository(testRepositoryId);
      assert.equal(seen.find((mission) => mission.id === second.id)?.title, 'Renamed elsewhere');

      await store.cancel(second.id);
      assert.deepEqual((await store.loadByRepository(testRepositoryId)).map((mission) => mission.id), [first.id]);
    } finally { await database.close(); }
  });

  it('loads legacy requested-changes rounds that have no persisted findings', async () => {
    const database = await migratedDatabase();
    try {
      const store = new SqliteMissionStore(database);
      const mission = completeMission();
      await store.save(mission, null);
      await database.execute(
        'DELETE FROM mission_review_resolutions WHERE mission_id = ? AND round_position = ?',
        [mission.id, 0],
      );
      await database.execute(
        'DELETE FROM mission_review_findings WHERE mission_id = ? AND round_position = ?',
        [mission.id, 0],
      );

      const loaded = await store.load(mission.id);
      assert.equal(loaded.kind, 'found');
      assert.equal(loaded.mission.review?.rounds[0].decision, null);
    } finally {
      await database.close();
    }
  });

  it('round trips null optionals, pre-closure done, and closed Mission variants', async () => {
    const database = await migratedDatabase();
    try {
      const store = new SqliteMissionStore(database);
      const closed = completeMission({
        status: 'done',
        rawStatus: undefined,
        assignee: null,
        checkpoints: [],
        review: null,
        netEngineeringLines: null,
        // Canonical UTC ISO-8601 instant (TASK-2688): the store persists this
        // fixed-width spelling, so the round-tripped value keeps millisecond
        // precision and lexical order equals temporal order.
        closedAt: '2026-07-29T11:00:00.000Z',
      });
      await store.save(closed, null);
      const loaded = await store.load(closed.id);
      assert.equal(loaded.kind, 'found');
      assert.deepEqual(loaded.mission, closed);

      const preClosure = completeMission({
        id: missionId('task-pre-closure'),
        status: 'done',
        rawStatus: 'done',
        checkpoints: [],
        review: null,
        closedAt: null,
      });
      await store.save(preClosure, null);
      const loadedPreClosure = await store.load(preClosure.id);
      assert.equal(loadedPreClosure.kind, 'found');
      assert.deepEqual(loadedPreClosure.mission, preClosure);
    } finally {
      await database.close();
    }
  });

  it('uses exact version compare-and-swap and rejects stale transitions without appending events', async () => {
    const databasePath = tempDatabasePath();
    const firstDatabase = await migratedDatabase(databasePath);
    const secondDatabase = await openDatabase(databasePath);
    try {
      const firstStore = new SqliteMissionStore(firstDatabase);
      const secondStore = new SqliteMissionStore(secondDatabase);
      const eventStore = new SqliteBoardLaneEventRepository(firstDatabase);
      const initialVersion = await firstStore.save(
        completeMission({ status: 'active', review: null }),
        null,
      );
      const firstRead = await firstStore.load(testMissionId);
      const secondRead = await secondStore.load(testMissionId);
      assert.equal(firstRead.kind, 'found');
      assert.equal(secondRead.kind, 'found');

      const firstUpdate = {
        ...firstRead.mission,
        title: 'First writer',
        status: 'review',
        closedAt: null,
      } as Mission;
      const secondUpdate = {
        ...secondRead.mission,
        title: 'Second writer',
        status: 'review',
        closedAt: null,
      } as Mission;
      await firstStore.saveWithTransition(firstUpdate, initialVersion, {
        missionId: testMissionId,
        repositoryId: testRepositoryId,
        from: 'active',
        to: 'review',
        trigger: 'submit-for-review',
        agent: 'codex',
        occurredAt: '2026-07-29T11:00:00Z',
        idempotencyKey: 'first-writer-transition',
      });
      await assert.rejects(
        secondStore.saveWithTransition(secondUpdate, secondRead.version, {
          missionId: testMissionId,
          repositoryId: testRepositoryId,
          from: 'active',
          to: 'review',
          trigger: 'submit-for-review',
          agent: 'codex',
          occurredAt: '2026-07-29T11:01:00Z',
          idempotencyKey: 'stale-writer-transition',
        }),
        (error: unknown) => error instanceof MissionStaleWriteError
          && error.expectedVersion === missionVersion(1)
          && error.actualVersion === missionVersion(2),
      );

      const final = await firstStore.load(testMissionId);
      assert.equal(final.kind, 'found');
      assert.equal(final.mission.title, 'First writer');
      assert.equal(final.version, missionVersion(2));
      assert.deepEqual(
        (await eventStore.findByMissionId(testMissionId)).map((event) => event.idempotencyKey),
        ['first-writer-transition'],
      );
    } finally {
      await secondDatabase.close();
      await firstDatabase.close();
    }
  });

  it('commits a Mission transition and LaneTransitionEvent atomically', async () => {
    const database = await migratedDatabase();
    try {
      const store = new SqliteMissionStore(database);
      const eventStore = new SqliteBoardLaneEventRepository(database);
      const version = await store.save(completeMission({ status: 'active', review: null }), null);
      const transitioned = completeMission({ status: 'review' });
      const event = {
        missionId: transitioned.id,
        repositoryId: transitioned.repositoryId,
        from: 'active' as const,
        to: 'review' as const,
        trigger: 'submit-for-review' as const,
        agent: 'codex',
        occurredAt: '2026-07-29T12:00:00Z',
        idempotencyKey: 'transition-1',
      };

      const nextVersion = await store.saveWithTransition(transitioned, version, event);
      assert.equal(nextVersion, missionVersion(2));
      assert.equal((await eventStore.findByMissionId(transitioned.id)).length, 1);

      const secondTransition = {
        ...transitioned,
        title: 'Must roll back',
        status: 'integration' as const,
        closedAt: null,
      } as Mission;
      await assert.rejects(
        store.saveWithTransition(
          secondTransition,
          nextVersion,
          { ...event, from: 'review', to: 'integration', trigger: 'approve' },
        ),
        /Duplicate idempotency key/,
      );
      const loaded = await store.load(transitioned.id);
      assert.equal(loaded.kind, 'found');
      assert.equal(loaded.mission.title, transitioned.title);
      assert.equal(loaded.mission.status, 'review');
      assert.equal(loaded.version, nextVersion);
      assert.equal((await eventStore.findByMissionId(transitioned.id)).length, 1);
    } finally {
      await database.close();
    }
  });

  it('replaces KnownRepository cache data without changing Mission identity or version', async () => {
    const database = await migratedDatabase();
    try {
      const store = new SqliteMissionStore(database);
      const version = await store.save(completeMission(), null);
      await store.saveKnownRepository({
        repository: { id: testRepositoryId, displayName: 'Parallix old' },
        path: '/old/parallix',
        lastAccessed: '2026-07-29T12:00:00Z',
      });
      await store.saveKnownRepository({
        repository: { id: testRepositoryId, displayName: 'Parallix' },
        path: '/new/parallix',
        lastAccessed: '2026-07-29T13:00:00Z',
      });

      assert.deepEqual(await store.loadKnownRepository(testRepositoryId), {
        repository: { id: testRepositoryId, displayName: 'Parallix' },
        path: '/new/parallix',
        lastAccessed: '2026-07-29T13:00:00Z',
      });
      const loaded = await store.load(testMissionId);
      assert.equal(loaded.kind, 'found');
      assert.equal(loaded.mission.repositoryId, testRepositoryId);
      assert.equal(loaded.version, version);
    } finally {
      await database.close();
    }
  });

  it('upgrades 0003 data and fails closed on checksum mismatch or interruption', async () => {
    const database = await openDatabase();
    try {
      const runner = new SqliteMigrationRunner(database);
      const migrations = loadDefaultMigrations();
      await runner.applyPending(migrations.slice(0, 3));
      await database.execute(
        `INSERT INTO board_lane_events
           (mission_id, from_status, to_status, trigger, agent, occurred_at, idempotency_key)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ['task-existing', 'active', 'review', 'submit-for-review', 'codex',
          '2026-07-29T00:00:00Z', 'existing-event'],
      );

      const realMissionMigration = migrations[3];
      assert.ok(realMissionMigration);
      const interrupted: Migration = {
        id: realMissionMigration.id,
        checksum: SqliteMigrationRunner.computeChecksum(
          `${realMissionMigration.up}\nTHIS IS NOT SQL;`,
        ),
        up: `${realMissionMigration.up}\nTHIS IS NOT SQL;`,
      };
      await assert.rejects(runner.applyPending([interrupted]), /failed and was rolled back/);
      assert.ok(!(await tableNames(database)).includes('missions'));

      await runner.applyPending(migrations);
      const events = await database.query<{ idempotency_key: string }>(
        'SELECT idempotency_key FROM board_lane_events',
      );
      assert.deepEqual(events.map((row) => ({ ...row })), [{ idempotency_key: 'existing-event' }]);

      const modified = migrations.map((migration) =>
        migration.id === realMissionMigration.id
          ? { ...migration, checksum: 'not-the-committed-checksum' }
          : migration,
      );
      await assert.rejects(runner.applyPending(modified), /Checksum mismatch/);
    } finally {
      await database.close();
    }
  });

  it('backs up and restores committed Mission rows', async () => {
    const databasePath = tempDatabasePath();
    const database = await migratedDatabase(databasePath);
    const store = new SqliteMissionStore(database);
    const firstVersion = await store.save(completeMission({ title: 'Backed up' }), null);
    await database.backup();
    await store.save(completeMission({ title: 'After backup' }), firstVersion);
    await database.close();

    fs.writeFileSync(databasePath, 'corrupt');
    const recovery = await openDatabase(databasePath);
    try {
      assert.equal(await recovery.checkIntegrity(), false);
      assert.equal(await recovery.recoverFromBackup(), true);
      const restored = await new SqliteMissionStore(recovery).load(testMissionId);
      assert.equal(restored.kind, 'found');
      assert.equal(restored.mission.title, 'Backed up');
      assert.equal(restored.version, firstVersion);
    } finally {
      await recovery.close();
    }
  });

  it('keeps application and UI code behind ports and leaves production authority unchanged', () => {
    const sourceRoot = path.resolve('src');
    const sqliteRoot = path.join(sourceRoot, 'adapters', 'sqlite');
    const files: string[] = [];
    const collect = (directory: string): void => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          collect(entryPath);
        } else if (entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name)) {
          files.push(entryPath);
        }
      }
    };
    collect(sourceRoot);
    // The composition root is the one place allowed to name the concrete
    // adapter: after the TASK-2322.07 cutover it constructs SqliteMissionStore
    // as the sole production authority. Everything else stays behind the ports.
    const compositionRoot = path.join(
      sourceRoot, 'composition', 'application-services.ts',
    );
    const statisticsCompositionRoot = path.join(sourceRoot, 'composition', 'stats.ts');
    const forbidden = files
      .filter((file) => !file.startsWith(sqliteRoot) && file !== compositionRoot && file !== statisticsCompositionRoot)
      .filter((file) => /(?:from\s+|import\s*\()['"](?:node:sqlite|[^'"]*adapters\/sqlite\/mission-store)/.test(
        fs.readFileSync(file, 'utf8'),
      ));
    assert.deepEqual(forbidden, []);

    const authority = fs.readFileSync(
      path.join(sourceRoot, 'application', 'mission-authority.ts'),
      'utf8',
    );
    assert.match(authority, /target-repository/);
    assert.doesNotMatch(authority, /SqliteMissionStore/);
  });
});

it('retains persisted report membership through migration and recovery at local boundaries (TASK-2688)', async () => {
  const database = await migratedDatabase();
  try {
    const values = ['2026-10-01T23:59:59.999+02:00', '2026-10-02T00:00:00+02:00',
      '2026-03-29T01:59:59.999+01:00', '2026-03-29T03:00:00+02:00',
      '2026-10-25T02:30:00+02:00', '2026-10-25T02:30:00+01:00',
      '2025-12-31T23:59:59.999+01:00', '2026-01-01T00:00:00+01:00'];
    for (const [index, raw] of values.entries()) {
      await database.execute(`INSERT INTO missions (id, repository_id, title, status, closed_at, version)
        VALUES (?, 'repo', 'boundary', 'done', ?, 1)`, [`task-boundary-${index}`, raw]);
    }
    const read = () => database.query<{ id: string; closed_at: string }>('SELECT id, closed_at FROM missions ORDER BY id');
    const report = (rows: readonly { id: string; closed_at: string }[]) =>
      ['2026-10-08', '2026-03-29', '2026-10-25', '2026-01-01'].map(today => {
        const windows = weeklyDecisionWindows(today, 'Europe/Stockholm');
        return [windows.current, windows.previous].map(window =>
          rows.filter(row => decisionWindowContains(window, row.closed_at)).map(row => row.id));
      });
    const before = await read();
    const expected = report(before);
    assert.ok(expected.flat(2).length > 0);
    assert.equal((await applyMissionTimestampMigration(database, await auditMissionTimestamps(database), () => database.backup())).converted, values.length);
    assert.deepEqual(report(await read()), expected);
    assert.equal(await database.recoverFromBackup(), true);
    assert.deepEqual(await read(), before);
    assert.deepEqual(report(await read()), expected);
  } finally { await database.close(); }
});

it('re-saves migrated historical closures without rewriting preserved values (TASK-2688)', async () => {
  const database = await migratedDatabase();
  try {
    const store = new SqliteMissionStore(database);
    const values = ['malformed', '2026-10-09T07:00:00', '2026-10-09T07:00:00.123456Z'];
    for (const [index, raw] of values.entries()) {
      const mission = completeMission({ id: missionId(`task-preserved-${index}`), status: 'done', checkpoints: [], review: null, closedAt: '2026-10-09T07:00:00.000Z' });
      await store.save(mission, null);
      await database.execute('UPDATE missions SET closed_at = ? WHERE id = ?', [raw, mission.id]);
    }
    const audit = await auditMissionTimestamps(database);
    assert.equal(audit.ambiguous, 1);
    assert.equal(audit.malformed, 2);
    await applyMissionTimestampMigration(database, audit, () => database.backup());
    for (const [index, raw] of values.entries()) {
      const id = missionId(`task-preserved-${index}`);
      const loaded = await store.load(id);
      assert.equal(loaded.kind, 'found');
      const next = await store.save({ ...loaded.mission, title: 'Edited historical mission' }, loaded.version);
      assert.equal(next, missionVersion(2));
      const reloaded = await store.load(id);
      assert.equal(reloaded.kind, 'found');
      assert.equal(reloaded.mission.closedAt, raw);
      assert.equal(reloaded.mission.title, 'Edited historical mission');
      await assert.rejects(store.save({ ...reloaded.mission, title: 'Stale edit' }, loaded.version));
      await assert.rejects(store.save({ ...reloaded.mission, id: missionId(`task-copy-${index}`) }, null), /parseable ISO-8601 instant/);
      await assert.rejects(store.save({ ...reloaded.mission, status: 'done', closedAt: 'new-invalid-value' }, reloaded.version), /parseable ISO-8601 instant/);
      const unchanged = await store.load(id);
      assert.equal(unchanged.kind, 'found');
      assert.equal(unchanged.version, reloaded.version);
      assert.equal(unchanged.mission.closedAt, raw);
      await store.save({ ...reloaded.mission, status: 'done', closedAt: '2026-10-09T09:07:00+02:00' }, reloaded.version);
      const repaired = await store.load(id);
      assert.equal(repaired.kind, 'found');
      assert.equal(repaired.mission.closedAt, '2026-10-09T07:07:00.000Z');
    }
    await assert.rejects(store.save(completeMission({ id: missionId('task-new-invalid'), status: 'done', checkpoints: [], review: null, closedAt: 'new-invalid-value' }), null), /parseable ISO-8601 instant/);
    assert.equal((await store.load(missionId('task-new-invalid'))).kind, 'missing');
  } finally { await database.close(); }
});
