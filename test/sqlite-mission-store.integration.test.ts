import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { missionVersion } from '../src/application/domain-ports.js';
import { agentFamily } from '../src/domain/agents.js';
import { missionId, missionLabels, type Mission } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';
import {
  changeRevision,
  reviewFindingId,
  type Review,
} from '../src/domain/review.js';
import { SQLITE_ENTITY_AUTHORITY } from '../src/adapters/sqlite/authority-map.js';
import {
  type Migration,
  SqliteDatabaseAdapter,
} from '../src/adapters/sqlite/database-adapter.js';
import {
  loadDefaultMigrations,
  SqliteMigrationRunner,
} from '../src/adapters/sqlite/migration-runner.js';
import {
  MissionStaleWriteError,
  SqliteMissionStore,
} from '../src/adapters/sqlite/mission-store.js';
import { SqliteBoardLaneEventRepository } from '../src/adapters/sqlite/board-lane-event-repository.js';

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
    }, {
      number: 2,
      subject: {
        change: {
          kind: 'local-branch',
          sourceBranch: 'mission/task-mission-store',
          targetBranch: 'main',
        },
        revision: changeRevision('def456'),
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
    }],
    intervention: {
      requestedAt: '2026-07-29T10:50:00Z',
      requestedBy: 'workflow',
      reason: 'Awaiting operator confirmation',
    },
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
        { criterion: 'Writes are checked', evidence: 'same-status stale-writer test' },
      ],
      nextActionText: 'Run the integration suite.',
    }],
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
  it('uses normalized domain-shaped tables and keeps repository observations separate', async () => {
    const database = await migratedDatabase();
    try {
      const tables = await tableNames(database);
      for (const table of [
        'missions',
        'mission_labels',
        'mission_checkpoints',
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
        closedAt: '2026-07-29T11:00:00Z',
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
      sourceRoot, 'platform', 'runtime', 'lib', 'composition', 'application-services.ts',
    );
    const forbidden = files
      .filter((file) => !file.startsWith(sqliteRoot) && file !== compositionRoot)
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
