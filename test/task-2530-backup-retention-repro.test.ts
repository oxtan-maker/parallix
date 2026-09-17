import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner } from '../src/adapters/sqlite/migration-runner.js';
import type { Migration } from '../src/adapters/sqlite/database-adapter.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTempDir(name: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `parallix-task-2530-${name}-`));
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

describe('task-2530 — bounded SQLite backup retention (repro)', () => {
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
