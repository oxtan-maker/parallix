// @ts-nocheck -- TASK-2328: partial test doubles from ESM seam migration; resolve in follow-up

// TASK-2377.04 CP-4 (SC6): the forward-only drop migration for the persisted
// review-level retry counters.
//
// Asserts the migration runs on a pre-existing 0015-or-older database (the
// columns are absent afterwards, other review data survives) and on a fresh
// database (the columns never exist), and that a mission round-trips through
// the store (serialize → reload) without the removed fields while historical
// round-level retry counts — which the mission explicitly preserves —
// round-trip unchanged.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
import {
  SqliteMigrationRunner,
  loadDefaultMigrations,
} from '../src/adapters/sqlite/migration-runner.js';
import { SqliteMissionStore } from '../src/adapters/sqlite/mission-store.js';
import { missionId, missionLabels } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';
import { agentFamily } from '../src/domain/agents.js';
import { changeRevision } from '../src/domain/review.js';
import { reviewFromState } from '../src/adapters/sqlite/mission-import-parsing.js';

const MIGRATION_ID = '0016-review-drop-retry-counters';

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-0016-mig-'));
}

function cleanup(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

async function openDb(dir: string): Promise<SqliteDatabaseAdapter> {
  const db = new SqliteDatabaseAdapter();
  await db.open({ path: path.join(dir, 'test.db') });
  return db;
}

async function columnNames(db: SqliteDatabaseAdapter, tableName: string): Promise<string[]> {
  const rows = await db.query<{ name: unknown }>(`PRAGMA table_info(${tableName});`);
  return rows.map((row) => String(row.name));
}

function missionWithRoundRetryCounts(slug: string, rootDir: string) {
  return {
    id: missionId(slug),
    repositoryId: repositoryId(rootDir),
    title: `Mission ${slug}`,
    labels: missionLabels([]),
    assignee: agentFamily('claude'),
    status: 'review',
    rawStatus: 'review',
    checkpoints: [],
    netEngineeringLines: null,
    closedAt: null,
    externalTaskRef: null,
    intakeTrace: null,
    review: {
      rounds: [{
        number: 1,
        subject: {
          change: { kind: 'local-branch', sourceBranch: `mission/${slug}`, targetBranch: 'main' },
          revision: changeRevision('rev-1'),
        },
        reviewer: agentFamily('codex'),
        implementer: agentFamily('claude'),
        startedAt: '2026-08-02T10:00:00.000Z',
        decision: null,
        response: null,
        phase: 'reviewing',
        disposition: null,
        // Historical round-level retry counts: these columns stay (0008) and
        // must round-trip unchanged after the review-level columns are gone.
        reviewerRetryCount: 2,
        implementerRetryCount: 1,
      }],
      intervention: null,
      stageLaunches: [],
      reviewEvents: [],
    },
  };
}

describe('0016-review-drop-retry-counters migration (SC6)', () => {
  it('is discovered by loadDefaultMigrations with a stable checksum and is forward-only', () => {
    const migrations = loadDefaultMigrations();
    const migration = migrations.find((m) => m.id === MIGRATION_ID);
    assert.ok(migration, 'migration 0016-review-drop-retry-counters should be loaded');
    assert.equal(
      migration.checksum,
      SqliteMigrationRunner.computeChecksum(migration.up),
      'checksum must be the SHA-256 of the migration SQL',
    );
    assert.equal(migration.down, undefined, 'migration must be forward-only (no down SQL)');
    const ids = migrations.map((m) => m.id);
    assert.ok(ids.indexOf(MIGRATION_ID) > ids.indexOf('0015-current-work-latest-per-mission'),
      '0016 must apply after 0015');
  });

  it('runs on a pre-existing 0015-or-older database: columns absent afterwards, other review data survives', async () => {
    const dir = createTempDir();
    const db = await openDb(dir);
    try {
      const runner = new SqliteMigrationRunner(db);
      const migrations = loadDefaultMigrations();

      // Pre-existing database: everything except 0016 applied.
      const prior = migrations.filter((m) => m.id !== MIGRATION_ID);
      await runner.applyPending(prior);
      const before = await columnNames(db, 'mission_reviews');
      assert.ok(before.includes('gate_failure_retry_count'), 'pre-0016 schema still has the gate column');
      assert.ok(before.includes('hook_failure_retry_count'), 'pre-0016 schema still has the hook column');

      // A live mission plus a review row carrying the cumulative budgets
      // plus intervention state.
      await db.execute(
        `INSERT INTO missions (id, repository_id, title, status, version)
         VALUES ('task-0016', 'repo-0016', 'Task 0016', 'review', 1);`,
      );
      await db.execute(
        `INSERT INTO mission_reviews
           (mission_id, intervention_requested_at, intervention_requested_by, intervention_reason,
            gate_failure_retry_count, hook_failure_retry_count)
         VALUES ('task-0016', '2026-08-02T12:00:00.000Z', 'workflow', 'operator check', 2, 1);`,
      );

      // The drop runs on the pre-existing database.
      await runner.applyPending(migrations);

      const after = await columnNames(db, 'mission_reviews');
      assert.ok(!after.includes('gate_failure_retry_count'), 'gate column must be dropped');
      assert.ok(!after.includes('hook_failure_retry_count'), 'hook column must be dropped');

      // The rest of the row survives the drop.
      const row = await db.query<{ reason: unknown; at: unknown }>(
        'SELECT intervention_reason AS reason, intervention_requested_at AS at FROM mission_reviews WHERE mission_id = ?',
        ['task-0016'],
      );
      assert.equal(String(row[0].reason), 'operator check', 'intervention reason survives the drop');
      assert.equal(String(row[0].at), '2026-08-02T12:00:00.000Z', 'intervention time survives the drop');

      // The ledger records the new migration.
      const applied = await runner.getAppliedMigrations();
      assert.ok(applied.some((entry) => entry.id === MIGRATION_ID), 'ledger records 0016');
    } finally {
      await db.close();
      cleanup(dir);
    }
  });

  it('applies on a fresh database: mission_reviews never carries the retry columns', async () => {
    const dir = createTempDir();
    const db = await openDb(dir);
    try {
      const runner = new SqliteMigrationRunner(db);
      await runner.applyPending(loadDefaultMigrations());
      const columns = await columnNames(db, 'mission_reviews');
      assert.ok(!columns.includes('gate_failure_retry_count'), 'fresh schema has no gate column');
      assert.ok(!columns.includes('hook_failure_retry_count'), 'fresh schema has no hook column');
      assert.ok(columns.includes('intervention_reason'), 'the surviving review-level columns stay');
    } finally {
      await db.close();
      cleanup(dir);
    }
  });

  it('mission round-trips (store serialize → reload) without the removed fields; historical round counts stay', async () => {
    const dir = createTempDir();
    const db = await openDb(dir);
    try {
      await new SqliteMigrationRunner(db).applyPending(loadDefaultMigrations());
      const store = new SqliteMissionStore(db);
      const slug = 'task-0016-roundtrip';

      const mission = missionWithRoundRetryCounts(slug, dir);
      await store.save(mission, null);
      const reloaded = await store.load(missionId(slug));
      assert.equal(reloaded.kind, 'found', 'the mission round-trips through the store');
      assert.ok(reloaded.mission.review, 'the review round-trips');
      const review = reloaded.mission.review;
      assert.equal(review.gateFailureRetryCount, undefined, 'the removed gate field is gone after a round-trip');
      assert.equal(review.hookFailureRetryCount, undefined, 'the removed hook field is gone after a round-trip');
      const round = review.rounds[review.rounds.length - 1];
      assert.equal(round.reviewerRetryCount, 2, 'historical round-level retry counts round-trip unchanged');
      assert.equal(round.implementerRetryCount, 1, 'historical round-level retry counts round-trip unchanged');
    } finally {
      await db.close();
      cleanup(dir);
    }
  });

  it('legacy import parsing: a pre-cutover review-state.json with the removed counters imports without them', () => {
    const { review, errors } = reviewFromState({
      reviewer: 'codex',
      implementer: 'claude',
      round: 1,
      startedAt: '2026-08-02T10:00:00.000Z',
      phase: 'reviewing',
      disposition: null,
      reviewerRetryCount: 1,
      metadata: { gateFailureRetryCount: 3, hookFailureRetryCount: 2 },
    }, missionId('task-0016-import'), 'review-state.json');
    assert.deepEqual(errors, [], 'legacy keys no longer produce import errors');
    assert.ok(review, 'the legacy state still imports');
    assert.equal(review.gateFailureRetryCount, undefined, 'the import no longer materializes the removed gate field');
    assert.equal(review.hookFailureRetryCount, undefined, 'the import no longer materializes the removed hook field');
    assert.equal(review.rounds[review.rounds.length - 1].reviewerRetryCount, 1, 'legacy round-level counts still import');
  });
});
