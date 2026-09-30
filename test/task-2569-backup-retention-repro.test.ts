import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { MAX_RETAINED_BACKUPS, SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
import { mkdtemp as registeredMkdtemp } from './helpers/temp-dir.js';

describe('task-2569 — backup retention ignores legacy sidecars', () => {
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
