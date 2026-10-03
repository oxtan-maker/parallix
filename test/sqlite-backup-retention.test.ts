// Historical regression provenance: TASK-2530, TASK-2569.
import { mkdtemp as registeredMkdtemp } from './helpers/temp-dir.js';
import { type Migration } from '../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner } from '../src/adapters/sqlite/migration-runner.js';
import { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { it } from 'node:test';
import { MAX_RETAINED_BACKUPS } from '../src/adapters/sqlite/database-adapter.js';

// Regression group from test/sqlite-backup-retention.test.ts
{
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTempDir(name: string): string {
  return registeredMkdtemp(`parallix-task-2530-${name}-`);
}

function cleanupTempDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Best effort cleanup
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// Irreversible migrations (no `down`). The first creates the migration ledger
// table so the runner can record each applied migration; the rest each create a
// distinct marker table so the newest applied state is identifiable after
// recovery. Every one of these routes through `SqliteDatabaseAdapter.backup()`.
function retentionMigrations(): readonly Migration[] {
  return [
    {
      id: '0001-retention-ledger',
      checksum: '',
      up: 'CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL);',
    },
    { id: '0002-marker-1', checksum: '', up: 'CREATE TABLE marker_1 (id INTEGER);' },
    { id: '0003-marker-2', checksum: '', up: 'CREATE TABLE marker_2 (id INTEGER);' },
    { id: '0004-marker-3', checksum: '', up: 'CREATE TABLE marker_3 (id INTEGER);' },
    { id: '0005-marker-4', checksum: '', up: 'CREATE TABLE marker_4 (id INTEGER);' },
    { id: '0006-marker-5', checksum: '', up: 'CREATE TABLE marker_5 (id INTEGER);' },
    { id: '0007-marker-6', checksum: '', up: 'CREATE TABLE marker_6 (id INTEGER);' },
  ];
}

// Count the `<database-path>.bak.*` sidecars the adapter would prune.
function countBackups(dbPath: string): number {
  const base = path.basename(dbPath);
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    return 0;
  }
  return fs.readdirSync(dir).filter((f) => f.startsWith(`${base}.bak.`)).length;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("bounded SQLite backup retention (repro)", () => {
  it('does not accumulate unbounded .bak.* files beyond the retention cap', async () => {
    const dir = createTempDir('retention');
    const dbPath = path.join(dir, 'parallix.db');
    const db = new SqliteDatabaseAdapter();
    db.open({ path: dbPath });
    try {
      const runner = new SqliteMigrationRunner(db);

      // Apply each irreversible migration separately with a small gap so every
      // Date.now() suffix is distinct; the chokepoint writes one .bak.* per
      // irreversible migration.
      for (const migration of retentionMigrations()) {
        await runner.applyPending([migration]);
        await sleep(5);
      }

      // Seven irreversible migrations produce seven snapshots. The production
      // retention cap must bound this count; on the unfixed parent commit the
      // count is unbounded and this assertion fails.
      assert.ok(
        countBackups(dbPath) <= 3,
        `.bak.* count ${countBackups(dbPath)} must not exceed the retention cap`,
      );
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  it('recoverFromBackup restores the newest retained backup', async () => {
    const dir = createTempDir('retention-recover');
    const dbPath = path.join(dir, 'parallix.db');
    const db = new SqliteDatabaseAdapter();
    db.open({ path: dbPath });
    try {
      const runner = new SqliteMigrationRunner(db);

      for (const migration of retentionMigrations()) {
        await runner.applyPending([migration]);
        await sleep(5);
      }

      // `backup()` is a pre-migration snapshot: the newest retained backup
      // captures state *before* the final irreversible migration, so it holds
      // marker_5 but not marker_6. A pruned older backup would restore
      // marker_3 or earlier instead. Corrupt the live image, then recover.
      fs.writeFileSync(dbPath, 'corrupted-not-a-sqlite-file');

      const ok = await db.recoverFromBackup();
      assert.ok(ok, 'recoverFromBackup should restore a valid backup');

      const tables = await db.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'marker_%';",
      );
      const names = tables.map((t) => t.name);
      assert.ok(
        names.includes('marker_5'),
        `newest retained backup should restore marker_5; got ${names.join(', ')}`,
      );
      assert.ok(
        !names.includes('marker_6'),
        'recovery must restore the pre-last-migration snapshot, not the live image',
      );
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });
});
}

// Regression group from test/sqlite-backup-legacy-sidecars.test.ts
{
describe("backup retention ignores legacy sidecars", () => {
  it('keeps and restores the returned snapshot when legacy sidecars sort later', async () => {
    const dir = registeredMkdtemp('parallix-task-2569-');
    const dbPath = path.join(dir, 'parallix.db');
    const db = new SqliteDatabaseAdapter();
    await db.open({ path: dbPath, enableWal: false });
    try {
      await db.execute('CREATE TABLE captured (value TEXT NOT NULL);');
      await db.execute("INSERT INTO captured (value) VALUES ('at-backup');");

      const now = Date.now();
      for (const suffix of [now - 3, now - 2, now - 1]) {
        fs.copyFileSync(dbPath, `${dbPath}.bak.${suffix}`);
      }
      for (const suffix of ['pre-fix-a', 'pre-fix-b', 'pre-fix-c']) {
        fs.copyFileSync(dbPath, `${dbPath}.bak.${suffix}`);
      }

      const backupPath = await db.backup();
      assert.ok(fs.existsSync(backupPath), 'the returned backup must be retained');

      await db.close();
      fs.copyFileSync(backupPath, dbPath);
      await db.open({ path: dbPath, enableWal: false });
      assert.equal((await db.query<{ value: string }>('SELECT value FROM captured;'))[0]?.value, 'at-backup');

      const managed = fs.readdirSync(dir).filter((file) =>
        new RegExp(`^${path.basename(dbPath)}\\.bak\\.\\d{13}$`).test(file),
      );
      assert.equal(managed.length, MAX_RETAINED_BACKUPS);
      assert.ok(fs.existsSync(`${dbPath}.bak.pre-fix-a`), 'legacy sidecars are unmanaged');
    } finally {
      await db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
}
