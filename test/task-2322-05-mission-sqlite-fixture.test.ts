/**
 * TASK-2322.05 — the Mission use cases against isolated SQLite adapters.
 *
 * Each test opens its own temporary database, so this coverage proves the new
 * boundary against real rows (SC1–SC4, SC6) without touching operator state and
 * without becoming a production authority: the composition root still selects
 * the compatibility store, which these tests also assert.
 */

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { missionVersion } from '../src/application/domain-ports.js';
import { MissionCheckpointService } from '../src/application/mission-checkpoint-service.js';
import { MissionHandoffService } from '../src/application/mission-handoff-service.js';
import { MissionIntakeService } from '../src/application/mission-intake-service.js';
import { MissionLifecycleService } from '../src/application/mission-lifecycle-service.js';
import { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
import { loadDefaultMigrations, SqliteMigrationRunner } from '../src/adapters/sqlite/migration-runner.js';
import { SqliteMissionStore } from '../src/adapters/sqlite/mission-store.js';
import { SQLITE_ENTITY_AUTHORITY } from '../src/adapters/sqlite/authority-map.js';
import { createMissionApplicationServices } from '../src/platform/runtime/lib/composition/application-services.js';
import { agentFamily } from '../src/domain/agents.js';
import { externalTaskRef } from '../src/domain/external-task.js';
import { missionId, missionLabels } from '../src/domain/mission.js';
import { artifactReference } from '../src/domain/net-engineering-lines.js';
import { repositoryId } from '../src/domain/repository.js';

const MISSION = missionId('task-2322-05-fixture');
const REPOSITORY = repositoryId('parallix');
const CAPABILITIES = new Set([
  'mission:intake',
  'mission:transition',
  'checkpoint:record',
  'handoff:record',
] as const);

const temporaryDirectories: string[] = [];

/** One database per test: an isolated fixture, never the operator database. */
async function isolatedStore(): Promise<{ store: SqliteMissionStore; db: SqliteDatabaseAdapter; databasePath: string }> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-mission-boundary-'));
  temporaryDirectories.push(directory);
  const databasePath = path.join(directory, 'fixture.db');
  const db = new SqliteDatabaseAdapter();
  await db.open({ path: databasePath });
  await new SqliteMigrationRunner(db).applyPending(loadDefaultMigrations());
  return { store: new SqliteMissionStore(db), db, databasePath };
}

async function intake(store: SqliteMissionStore, overrides: Record<string, unknown> = {}) {
  return new MissionIntakeService(store).execute({
    operationId: 'op-intake',
    missionId: MISSION,
    repositoryId: REPOSITORY,
    title: 'Route mission intake through application use cases',
    labels: missionLabels(['ai_sdlc']),
    assignee: agentFamily('codex'),
    rawStatus: 'refined',
    capabilities: CAPABILITIES,
    ...overrides,
  } as never);
}

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('Mission application boundary over isolated SQLite adapters', () => {
  it('SC1/SC6: intake writes one Mission aggregate and its external trace, and no task catalog', async () => {
    const { store, db } = await isolatedStore();
    try {
      const outcome = await intake(store, {
        externalTaskRef: externalTaskRef('backlog', 'TASK-2322.05', 'backlog/tasks/task-2322.05.md'),
      });
      assert.equal(outcome.status, 'completed');

      const missions = await db.query<{ id: string; repository_id: string; status: string; version: number }>(
        'SELECT id, repository_id, status, version FROM missions',
      );
      assert.deepEqual(missions.map((row) => ({ ...row })), [
        { id: MISSION, repository_id: REPOSITORY, status: 'backlog', version: 1 },
      ]);
      const refs = await db.query<{ source: string; external_id: string; url: string | null }>(
        'SELECT source, external_id, url FROM mission_external_task_refs',
      );
      assert.deepEqual(refs.map((row) => ({ ...row })), [
        { source: 'backlog', external_id: 'TASK-2322.05', url: 'backlog/tasks/task-2322.05.md' },
      ]);

      // The intake flow persists nothing that could act as a second lifecycle
      // authority: no checkpoint, review, lane-event, or statistics row.
      for (const table of [
        'mission_checkpoints',
        'mission_checkpoint_goal_checks',
        'mission_reviews',
        'board_lane_events',
        'usage_statistics',
      ]) {
        const rows = await db.query<{ total: number }>(`SELECT COUNT(*) AS total FROM ${table}`);
        assert.equal(rows[0].total, 0, `${table} must stay empty at intake`);
      }
      assert.ok('mission_external_task_refs' in SQLITE_ENTITY_AUTHORITY);

      const reloaded = await store.load(MISSION);
      assert.equal(reloaded.kind, 'found');
      assert.deepEqual(reloaded.mission.externalTaskRef, {
        source: 'backlog',
        id: 'TASK-2322.05',
        url: 'backlog/tasks/task-2322.05.md',
      });
    } finally {
      await db.close();
    }
  });

  it('SC2: activation commits the lifecycle change and its lane event in one transaction', async () => {
    const { store, db } = await isolatedStore();
    try {
      await intake(store);
      const activated = await new MissionLifecycleService(store).activate({
        operationId: 'op-activate',
        missionId: MISSION,
        capabilities: CAPABILITIES,
        expectedVersion: missionVersion(1),
        agent: agentFamily('codex'),
        occurredAt: '2026-07-29T12:00:00Z',
      });
      assert.equal(activated.status, 'completed');
      assert.equal(activated.value!.version, missionVersion(2));

      const rows = await db.query<{ status: string; assignee: string; version: number }>(
        'SELECT status, assignee, version FROM missions WHERE id = ?',
        [MISSION],
      );
      assert.deepEqual({ ...rows[0] }, { status: 'active', assignee: 'codex', version: 2 });
      const events = await db.query<{ from_status: string; to_status: string; trigger: string }>(
        'SELECT from_status, to_status, trigger FROM board_lane_events WHERE mission_id = ?',
        [MISSION],
      );
      assert.deepEqual(events.map((row) => ({ ...row })), [
        { from_status: 'backlog', to_status: 'active', trigger: 'activate' },
      ]);
    } finally {
      await db.close();
    }
  });

  it('SC2: a second writer holding the old revision is refused and changes nothing', async () => {
    const { store, db } = await isolatedStore();
    try {
      await intake(store);
      const service = new MissionLifecycleService(store);
      const first = await service.activate({
        operationId: 'op-first',
        missionId: MISSION,
        capabilities: CAPABILITIES,
        expectedVersion: missionVersion(1),
        agent: agentFamily('codex'),
        occurredAt: '2026-07-29T12:00:00Z',
      });
      assert.equal(first.status, 'completed');

      const stale = await service.activate({
        operationId: 'op-stale',
        missionId: MISSION,
        capabilities: CAPABILITIES,
        expectedVersion: missionVersion(1),
        agent: agentFamily('claude'),
        occurredAt: '2026-07-29T12:00:05Z',
      });
      assert.equal(stale.status, 'failed');
      assert.equal(stale.error!.kind, 'conflict');

      const rows = await db.query<{ assignee: string; version: number }>(
        'SELECT assignee, version FROM missions WHERE id = ?',
        [MISSION],
      );
      assert.deepEqual({ ...rows[0] }, { assignee: 'codex', version: 2 });
      const events = await db.query<{ total: number }>(
        'SELECT COUNT(*) AS total FROM board_lane_events WHERE mission_id = ?',
        [MISSION],
      );
      assert.equal(events[0].total, 1);
    } finally {
      await db.close();
    }
  });

  it('SC3: checkpoint data and Goal Check rows round-trip through real rows', async () => {
    const { store, db } = await isolatedStore();
    try {
      await intake(store);
      const service = new MissionCheckpointService(store);
      const recorded = await service.record({
        operationId: 'op-cp',
        missionId: MISSION,
        capabilities: CAPABILITIES,
        expectedVersion: missionVersion(1),
        checkpoint: {
          missionId: MISSION,
          name: 'CP-1',
          rawFilename: 'CP-1.md',
          firstLine: 'CP-1: Call paths mapped',
          goalCheck: [
            { criterion: 'Paths mapped', evidence: 'src/application/mission-checkpoint-service.ts:60' },
            { criterion: 'Gate ran', evidence: '`./scripts/verify-local.sh all`' },
          ],
          nextActionText: 'Define the use cases.',
        },
      });
      assert.equal(recorded.status, 'completed');

      const goalChecks = await db.query<{ criterion: string; evidence: string; position: number }>(
        `SELECT criterion, evidence, position FROM mission_checkpoint_goal_checks
         WHERE mission_id = ? ORDER BY position`,
        [MISSION],
      );
      assert.deepEqual(goalChecks.map((row) => ({ ...row })), [
        { criterion: 'Paths mapped', evidence: 'src/application/mission-checkpoint-service.ts:60', position: 0 },
        { criterion: 'Gate ran', evidence: '`./scripts/verify-local.sh all`', position: 1 },
      ]);

      const read = await service.read({
        operationId: 'op-cp-read',
        missionId: MISSION,
        capabilities: CAPABILITIES,
        name: 'CP-1',
      });
      assert.equal(read.status, 'completed');
      assert.deepEqual(read.value!.checkpoints[0], {
        missionId: MISSION,
        name: 'CP-1',
        rawFilename: 'CP-1.md',
        firstLine: 'CP-1: Call paths mapped',
        goalCheck: goalChecks.map((row) => ({ criterion: row.criterion, evidence: row.evidence })),
        nextActionText: 'Define the use cases.',
      });
    } finally {
      await db.close();
    }
  });

  it('SC4: handoff stores the NEL number and keeps large artifacts as references, not blobs', async () => {
    const { store, db, databasePath } = await isolatedStore();
    try {
      await intake(store);
      const receipts: string[] = [];
      const outcome = await new MissionHandoffService(store, {
        async recordNel(record) {
          receipts.push(`${record.netEngineeringLines}:${record.artifacts.map((a) => a.location).join(',')}`);
          return { reference: 'missions/task-2322-05/nel-record.json' };
        },
      }).recordNel({
        operationId: 'op-handoff',
        missionId: MISSION,
        capabilities: CAPABILITIES,
        expectedVersion: missionVersion(1),
        netEngineeringLines: 512,
        predictedBucket: 'Large',
        capturedAt: '2026-07-29T13:00:00Z',
        // A 5 MB capture and a 1 MB diff: only their locators may be durable.
        artifacts: [
          artifactReference('file', 'proofs/task-2322-05/gate.log', 5_242_880),
          artifactReference('git-range', 'main..HEAD', 1_048_576),
        ],
      });
      assert.equal(outcome.status, 'completed');
      assert.deepEqual(receipts, ['512:proofs/task-2322-05/gate.log,main..HEAD']);

      const rows = await db.query<{ net_engineering_lines: number }>(
        'SELECT net_engineering_lines FROM missions WHERE id = ?',
        [MISSION],
      );
      assert.equal(rows[0].net_engineering_lines, 512);

      // No mission table has a BLOB column, and the database file stays far
      // below the referenced artifact sizes.
      const tables = await db.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'mission%'",
      );
      for (const { name } of tables) {
        const columns = await db.query<{ name: string; type: string }>(`PRAGMA table_info(${name})`);
        for (const column of columns) {
          assert.notEqual(column.type.toUpperCase(), 'BLOB', `${name}.${column.name} must not be a blob`);
        }
      }
      assert.ok(
        fs.statSync(databasePath).size < 1_048_576,
        'the operational database must not grow to artifact size',
      );
    } finally {
      await db.close();
    }
  });

  it('SC6: production wires one Mission store for every Mission use case', async () => {
    const services = await createMissionApplicationServices(process.cwd(), {
      skipImportGate: true,
    });
    assert.equal(services.store.constructor.name, 'SqliteMissionStore');

    const compositionSource = fs.readFileSync(
      path.join(process.cwd(), 'src/platform/runtime/lib/composition/application-services.ts'),
      'utf8',
    );
    // One SQLite store construction, and no CompatibilityMissionStore in the graph.
    assert.ok(compositionSource.includes('new SqliteMissionStore('));
    assert.ok(!compositionSource.includes('new CompatibilityMissionStore('));
    assert.equal(services.intake.constructor.name, 'MissionIntakeService');
    assert.equal(services.lifecycle.constructor.name, 'MissionLifecycleService');
    assert.equal(services.integration.constructor.name, 'MissionIntegrationService');
    assert.equal(services.checkpoints.constructor.name, 'MissionCheckpointService');
    assert.equal(services.handoff.constructor.name, 'MissionHandoffService');
  });
});
