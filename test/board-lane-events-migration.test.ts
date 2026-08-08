import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
import {
  SqliteMigrationRunner,
  loadDefaultMigrations,
} from '../src/adapters/sqlite/migration-runner.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MIGRATION_ID = '0003-board-lane-events';

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-lane-events-mig-'));
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

async function indexNames(db: SqliteDatabaseAdapter): Promise<string[]> {
  const rows = await db.query<{ name: unknown }>(
    "SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name;",
  );
  return rows.map((row) => String(row.name));
}

async function tableNames(db: SqliteDatabaseAdapter): Promise<string[]> {
  const rows = await db.query<{ name: unknown }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name;",
  );
  return rows.map((row) => String(row.name));
}

async function columnNames(db: SqliteDatabaseAdapter, tableName: string): Promise<string[]> {
  const rows = await db.query<{ name: unknown }>(
    `PRAGMA table_info(${tableName});`,
  );
  return rows.map((row) => String(row.name));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('0003-board-lane-events migration — schema and ledger', () => {
  it('is discovered by loadDefaultMigrations with a stable checksum', () => {
    const migrations = loadDefaultMigrations();
    const migration = migrations.find((m) => m.id === MIGRATION_ID);
    assert.ok(migration, 'migration 0003-board-lane-events should be loaded');
    assert.equal(
      migration.checksum,
      SqliteMigrationRunner.computeChecksum(migration.up),
      'checksum must be the SHA-256 of the migration SQL',
    );
    // Forward-only: no down migration.
    assert.equal(migration.down, undefined, 'migration must be forward-only (no down SQL)');
  });

  it('clean install applies all migrations and creates the board_lane_events table', async () => {
    const dir = createTempDir();
    const db = await openDb(dir);
    try {
      const runner = new SqliteMigrationRunner(db);
      await runner.applyPending(loadDefaultMigrations());

      // Verify the dedicated table exists (not JSON blobs in operational_history)
      const tables = await tableNames(db);
      assert.ok(
        tables.includes('board_lane_events'),
        'board_lane_events table should exist after clean install',
      );

      // Verify the typed columns exist (following usage_statistics pattern)
      const columns = await columnNames(db, 'board_lane_events');
      assert.ok(columns.includes('id'), 'should have id column');
      assert.ok(columns.includes('repository_id'), 'should have repository_id column (migration 0011)');
      assert.ok(columns.includes('mission_id'), 'should have mission_id column');
      assert.ok(columns.includes('from_status'), 'should have from_status column');
      assert.ok(columns.includes('to_status'), 'should have to_status column');
      assert.ok(columns.includes('trigger'), 'should have trigger column');
      assert.ok(columns.includes('agent'), 'should have agent column');
      assert.ok(columns.includes('occurred_at'), 'should have occurred_at column');
      assert.ok(columns.includes('idempotency_key'), 'should have idempotency_key column');

      // Verify indexes were created (scoped by repository after migration 0011)
      const names = await indexNames(db);
      assert.ok(
        names.includes('idx_board_lane_events_repo_idempotency'),
        'unique idempotency index (scoped by repo) should exist after clean install',
      );
      assert.ok(
        names.includes('idx_board_lane_events_repo_mission'),
        'mission query index (scoped by repo) should exist after clean install',
      );
      assert.ok(
        names.includes('idx_board_lane_events_time'),
        'time query index should exist after clean install',
      );

      // The migration runner records the new migration in the ledger with a
      // matching checksum (SC1).
      const applied = await runner.getAppliedMigrations();
      const ledgerEntry = applied.find((entry) => entry.id === MIGRATION_ID);
      assert.ok(ledgerEntry, 'ledger should record the 0003 migration');
      const migration = loadDefaultMigrations().find((m) => m.id === MIGRATION_ID);
      assert.ok(migration);
      assert.equal(
        ledgerEntry.checksum,
        migration.checksum,
        'ledger checksum must match the migration checksum',
      );
    } finally {
      await db.close();
      cleanup(dir);
    }
  });

  it('the unique index rejects a duplicate idempotency key at the storage layer', async () => {
    const dir = createTempDir();
    const db = await openDb(dir);
    try {
      const runner = new SqliteMigrationRunner(db);
      await runner.applyPending(loadDefaultMigrations());

      await db.execute(
        `INSERT INTO board_lane_events
          (repository_id, mission_id, from_status, to_status, trigger, agent, occurred_at, idempotency_key)
          VALUES ('test-repo', 'task-1', 'backlog', 'active', 'activate', 'codex', '2026-07-24T00:00:00Z', 'op-1');`,
      );

      await assert.rejects(
        db.execute(
          `INSERT INTO board_lane_events
            (repository_id, mission_id, from_status, to_status, trigger, agent, occurred_at, idempotency_key)
            VALUES ('test-repo', 'task-1', 'backlog', 'active', 'activate', 'codex', '2026-07-24T00:00:01Z', 'op-1');`,
        ),
        /UNIQUE constraint failed/,
        'the unique index must reject a duplicate idempotency key within same repo',
      );

      const rows = await db.query<{ c: unknown }>(
        'SELECT COUNT(*) AS c FROM board_lane_events;',
      );
      assert.equal(Number(rows[0].c), 1, 'only one row should persist');
    } finally {
      await db.close();
      cleanup(dir);
    }
  });

  it('typed columns store correct values (no JSON encoding)', async () => {
    const dir = createTempDir();
    const db = await openDb(dir);
    try {
      const runner = new SqliteMigrationRunner(db);
      await runner.applyPending(loadDefaultMigrations());

      await db.execute(
        `INSERT INTO board_lane_events
          (repository_id, mission_id, from_status, to_status, trigger, agent, occurred_at, idempotency_key)
          VALUES ('test-repo', 'task-1', 'backlog', 'active', 'activate', 'codex', '2026-07-24T00:00:00Z', 'op-1');`,
      );

      // Read back typed columns directly (no JSON parsing needed)
      const rows = await db.query<{
        repository_id: unknown;
        mission_id: unknown;
        from_status: unknown;
        to_status: unknown;
        trigger: unknown;
        agent: unknown;
      }>(
        'SELECT repository_id, mission_id, from_status, to_status, trigger, agent FROM board_lane_events;',
      );

      assert.equal(String(rows[0].repository_id), 'test-repo');

      assert.equal(String(rows[0].mission_id), 'task-1');
      assert.equal(String(rows[0].from_status), 'backlog');
      assert.equal(String(rows[0].to_status), 'active');
      assert.equal(String(rows[0].trigger), 'activate');
      assert.equal(String(rows[0].agent), 'codex');
    } finally {
      await db.close();
      cleanup(dir);
    }
  });

  it('from_status can be NULL (new missions with unknown prior state)', async () => {
    const dir = createTempDir();
    const db = await openDb(dir);
    try {
      const runner = new SqliteMigrationRunner(db);
      await runner.applyPending(loadDefaultMigrations());

      await db.execute(
        `INSERT INTO board_lane_events
          (repository_id, mission_id, from_status, to_status, trigger, agent, occurred_at, idempotency_key)
          VALUES ('test-repo', 'task-new', NULL, 'active', 'activate', 'codex', '2026-07-24T00:00:00Z', 'op-new');`,
      );

      const rows = await db.query<{ from_status: unknown }>(
        'SELECT from_status FROM board_lane_events;',
      );
      assert.ok(rows[0].from_status === null, 'from_status should be NULL');
    } finally {
      await db.close();
      cleanup(dir);
    }
  });

  it('is idempotent when re-applied (already-applied migration is a no-op)', async () => {
    const dir = createTempDir();
    const db = await openDb(dir);
    try {
      const runner = new SqliteMigrationRunner(db);
      await runner.applyPending(loadDefaultMigrations());
      // Re-run: must not throw (checksum matches) and must not re-apply.
      const applied = await runner.applyPending(loadDefaultMigrations());
      const count = applied.filter((entry) => entry.id === MIGRATION_ID).length;
      assert.equal(count, 1, 'the migration must appear exactly once in the ledger');
    } finally {
      await db.close();
      cleanup(dir);
    }
  });

  // SC10: previous-schema upgrade test — starts from the prior migration state
  // (0001 + 0002 applied) and applies the new 0003 migration successfully.
  it('SC10: previous-schema upgrade applies 0003 migration from prior state', async () => {
    const dir = createTempDir();
    const db = await openDb(dir);
    try {
      const runner = new SqliteMigrationRunner(db);
      const migrations = loadDefaultMigrations();

      // Start from prior schema: apply only 0001 and 0002
      const priorMigrations = migrations.filter(
        (m) => m.id === '0001-initial-schema' || m.id === '0002-import-history',
      );
      const appliedPrior = await runner.applyPending(priorMigrations);
      assert.equal(appliedPrior.length, 2, 'prior state should have 2 migrations');

      // Verify board_lane_events table does not exist yet
      const tablesBefore = await tableNames(db);
      assert.ok(
        !tablesBefore.includes('board_lane_events'),
        'board_lane_events table should not exist before 0003 migration',
      );

      // Apply all migrations (0003 is pending)
      const appliedAll = await runner.applyPending(migrations);
      assert.equal(appliedAll.length, migrations.length, 'should have all migrations after upgrade');

      // Verify 0003 migration is in the ledger
      const ledgerEntry = appliedAll.find((entry) => entry.id === MIGRATION_ID);
      assert.ok(ledgerEntry, 'ledger should record the 0003 migration after upgrade');

      // Verify table and indexes were created by the upgrade
      const tablesAfter = await tableNames(db);
      assert.ok(
        tablesAfter.includes('board_lane_events'),
        'board_lane_events table should exist after 0003 upgrade',
      );

      const namesAfter = await indexNames(db);
      assert.ok(
        namesAfter.includes('idx_board_lane_events_repo_idempotency'),
        'idempotency index (scoped by repo) should exist after upgrade',
      );

      // Verify the table works with typed inserts after upgrade
      await db.execute(
        `INSERT INTO board_lane_events
          (repository_id, mission_id, from_status, to_status, trigger, agent, occurred_at, idempotency_key)
          VALUES ('test-repo', 'task-1', 'backlog', 'active', 'activate', 'codex', '2026-07-24T00:00:00Z', 'op-upgrade');`,
      );

      const rows = await db.query<{ c: unknown }>(
        'SELECT COUNT(*) AS c FROM board_lane_events;',
      );
      assert.equal(Number(rows[0].c), 1, 'insert should work after upgrade');
    } finally {
      await db.close();
      cleanup(dir);
    }
  });
});
