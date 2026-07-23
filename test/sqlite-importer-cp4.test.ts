import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../src/adapters/sqlite/migration-runner.js';
import { SqliteImporter } from '../src/adapters/sqlite/importer.js';
import { SqliteBlocklistRepository } from '../src/adapters/sqlite/blocklist-repository.js';
import { SqliteUsageRepository } from '../src/adapters/sqlite/usage-repository.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTempDir(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `parallix-sqlite-test-${name}-`));
  return dir;
}

function cleanupTempDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Best effort cleanup
  }
}

async function createDbWithSchema(): Promise<{
  db: SqliteDatabaseAdapter;
  dir: string;
  dbPath: string;
}> {
  const dir = createTempDir('db');
  const dbPath = path.join(dir, 'test.db');
  const db = new SqliteDatabaseAdapter();
  await db.open({ path: dbPath });
  const runner = new SqliteMigrationRunner(db);
  await runner.applyPending(loadDefaultMigrations());
  return { db, dir, dbPath };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SQLite importer — CP4: transactional idempotent importers', () => {
  // --- Blocklist import ---

  it('importBlocklist: transactional import from JSON', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const sourcePath = path.join(dir, 'agents.local.json');
      fs.writeFileSync(sourcePath, JSON.stringify({
        blocklist: {
          claude: { blocked: true, reason: 'maintenance' },
          codex: false,
        },
      }));

      const importer = new SqliteImporter(db);
      const record = await importer.importBlocklist(sourcePath);

      assert.equal(record.importedCount, 2);
      assert.ok(record.digest, 'Should have digest');
      assert.ok(record.backupPath, 'Should have backup path');
      assert.ok(record.importedAt, 'Should have importedAt');

      // Verify data in database
      const repo = new SqliteBlocklistRepository(db);
      const entries = await repo.findAll();
      assert.equal(entries.length, 2);

      const claude = await repo.findByAgent('claude');
      assert.ok(claude);
      assert.equal(claude.blocked, true);
      assert.equal(claude.reason, 'maintenance');

      const codex = await repo.findByAgent('codex');
      assert.ok(codex);
      assert.equal(codex.blocked, false);
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  it('importBlocklist: idempotent (re-running produces identical state)', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const sourcePath = path.join(dir, 'agents.local.json');
      fs.writeFileSync(sourcePath, JSON.stringify({
        blocklist: {
          claude: { blocked: true, reason: 'maintenance' },
        },
      }));

      const importer = new SqliteImporter(db);

      // First import
      const record1 = await importer.importBlocklist(sourcePath);
      assert.equal(record1.importedCount, 1);

      // Second import (idempotent — same data)
      const record2 = await importer.importBlocklist(sourcePath);
      assert.equal(record2.importedCount, 1);

      // Verify database has exactly 1 entry (not 2)
      const repo = new SqliteBlocklistRepository(db);
      const entries = await repo.findAll();
      assert.equal(entries.length, 1, 'Idempotent import should not duplicate entries');

      // Verify import history has 2 records
      const history = await importer.getImportHistory(sourcePath);
      assert.equal(history.length, 2, 'Import history should record both imports');
      assert.equal(history[0].digest, history[1].digest, 'Digests should match for same file');
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  it('importBlocklist: leaves original source file untouched', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const sourcePath = path.join(dir, 'agents.local.json');
      const originalContent = JSON.stringify({
        blocklist: { claude: { blocked: true } },
      });
      fs.writeFileSync(sourcePath, originalContent);
      const originalStat = fs.statSync(sourcePath);

      const importer = new SqliteImporter(db);
      await importer.importBlocklist(sourcePath);

      // Verify source file is unchanged
      const afterContent = fs.readFileSync(sourcePath, 'utf8');
      assert.equal(afterContent, originalContent, 'Source file should be untouched');

      const afterStat = fs.statSync(sourcePath);
      assert.equal(afterStat.size, originalStat.size, 'Source file size should be unchanged');
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  it('importBlocklist: records source path and SHA-256 digest', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const sourcePath = path.join(dir, 'agents.local.json');
      fs.writeFileSync(sourcePath, JSON.stringify({ blocklist: { claude: true } }));

      const importer = new SqliteImporter(db);
      const record = await importer.importBlocklist(sourcePath);

      assert.equal(record.sourcePath, sourcePath);
      assert.equal(record.digest.length, 64, 'Digest should be SHA-256 hex (64 chars)');

      // Verify digest matches manual computation
      const expectedDigest = SqliteImporter.computeDigest(sourcePath);
      assert.equal(record.digest, expectedDigest);
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  it('importBlocklist: throws on malformed JSON', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const sourcePath = path.join(dir, 'agents.local.json');
      fs.writeFileSync(sourcePath, '{ invalid json }');

      const importer = new SqliteImporter(db);
      let errorThrown = false;
      try {
        await importer.importBlocklist(sourcePath);
      } catch (err) {
        errorThrown = true;
        assert.ok(String(err).includes('Malformed blocklist JSON'));
      }
      assert.ok(errorThrown, 'Should throw on malformed JSON');

      // Verify no data was imported (transactional rollback)
      const repo = new SqliteBlocklistRepository(db);
      const entries = await repo.findAll();
      assert.equal(entries.length, 0, 'No data should be imported after rollback');
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  it('importBlocklist: malformed entries are skipped, valid entries are imported', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const sourcePath = path.join(dir, 'agents.local.json');
      fs.writeFileSync(sourcePath, JSON.stringify({
        blocklist: {
          claude: true,
          codex: null, // null is malformed
          pi: false,
        },
      }));

      const importer = new SqliteImporter(db);
      const record = await importer.importBlocklist(sourcePath);

      // Valid entries imported, malformed skipped
      assert.equal(record.importedCount, 2, 'Should import 2 valid entries');
      assert.equal(record.skippedCount, 1, 'Should skip 1 malformed entry');

      // Verify database has only valid entries
      const repo = new SqliteBlocklistRepository(db);
      const entries = await repo.findAll();
      assert.equal(entries.length, 2, 'Database should have 2 entries');
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  // --- Stats import ---

  it('importStats: transactional import from CSV', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const sourcePath = path.join(dir, 'stats.csv');
      fs.writeFileSync(sourcePath, [
        'date,repo,mission,implementer,stage,input_tokens,output_tokens',
        '2026-07-20,parallix,task-2294,claude,execute,1000,500',
        '2026-07-21,parallix,task-2295,codex,draft,800,400',
      ].join('\n'));

      const importer = new SqliteImporter(db);
      const record = await importer.importStats(sourcePath);

      assert.equal(record.importedCount, 2);
      assert.ok(record.digest);
      assert.ok(record.backupPath);

      // Verify data in database
      const repo = new SqliteUsageRepository(db);
      const all = await repo.findAll();
      assert.equal(all.length, 2);
      assert.equal(all[0].repo, 'parallix');
      // Imported numeric cells are parsed to numbers (domain-conformant types).
      assert.strictEqual(all[0].input_tokens, 1000);
      assert.strictEqual(all[0].output_tokens, 500);
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  it('importStats: idempotent (DELETE + INSERT mirrors CSV)', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const sourcePath = path.join(dir, 'stats.csv');
      const csvContent = [
        'date,repo,mission,implementer,stage,input_tokens,output_tokens',
        '2026-07-20,parallix,task-2294,claude,execute,1000,500',
      ].join('\n');
      fs.writeFileSync(sourcePath, csvContent);

      const importer = new SqliteImporter(db);

      // First import
      await importer.importStats(sourcePath);

      // Second import (idempotent — DELETE + INSERT)
      await importer.importStats(sourcePath);

      // Verify database has exactly 1 row (not 2)
      const repo = new SqliteUsageRepository(db);
      const all = await repo.findAll();
      assert.equal(all.length, 1, 'Idempotent import should not duplicate rows');
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  it('importStats: leaves original source file untouched', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const sourcePath = path.join(dir, 'stats.csv');
      const csvContent = 'date,repo\n2026-07-20,parallix\n';
      fs.writeFileSync(sourcePath, csvContent);
      const originalStat = fs.statSync(sourcePath);

      const importer = new SqliteImporter(db);
      await importer.importStats(sourcePath);

      const afterContent = fs.readFileSync(sourcePath, 'utf8');
      assert.equal(afterContent, csvContent, 'Source file should be untouched');
      assert.equal(fs.statSync(sourcePath).size, originalStat.size);
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  it('importStats: malformed rows are skipped, valid rows are imported', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const sourcePath = path.join(dir, 'stats.csv');
      fs.writeFileSync(sourcePath, [
        'date,repo,mission',
        '2026-07-20,parallix,task-2294',
        '2026-07-21', // Missing columns
        '2026-07-22,parallix,task-2295',
      ].join('\n'));

      const importer = new SqliteImporter(db);
      const record = await importer.importStats(sourcePath);

      assert.equal(record.importedCount, 2, 'Should import 2 valid rows');
      assert.equal(record.skippedCount, 1, 'Should skip 1 malformed row');

      const repo = new SqliteUsageRepository(db);
      const all = await repo.findAll();
      assert.equal(all.length, 2, 'Database should have 2 entries');
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  it('importStats: unmatched quotes are skipped, valid rows imported', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const sourcePath = path.join(dir, 'stats.csv');
      fs.writeFileSync(sourcePath, [
        'date,repo,mission',
        '2026-07-20,parallix,task-2294',
        '2026-07-21,"parallix,test', // Unmatched quote
      ].join('\n'));

      const importer = new SqliteImporter(db);
      const record = await importer.importStats(sourcePath);

      assert.equal(record.importedCount, 1, 'Should import 1 valid row');
      assert.equal(record.skippedCount, 1, 'Should skip 1 row with unmatched quotes');
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  it('importStats: handles empty CSV file', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const sourcePath = path.join(dir, 'stats.csv');
      fs.writeFileSync(sourcePath, '');

      const importer = new SqliteImporter(db);
      const record = await importer.importStats(sourcePath);

      assert.equal(record.importedCount, 0);
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  // --- Import history ---

  it('getImportHistory returns records in reverse chronological order', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const sourcePath = path.join(dir, 'agents.local.json');
      fs.writeFileSync(sourcePath, JSON.stringify({ blocklist: { claude: true } }));

      const importer = new SqliteImporter(db);
      await importer.importBlocklist(sourcePath);
      await new Promise((r) => setTimeout(r, 10));
      await importer.importBlocklist(sourcePath);

      const history = await importer.getImportHistory(sourcePath);
      assert.equal(history.length, 2);
      assert.ok(
        history[0].importedAt >= history[1].importedAt,
        'Most recent import should be first',
      );
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  it('backup file is created before import', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const sourcePath = path.join(dir, 'agents.local.json');
      fs.writeFileSync(sourcePath, JSON.stringify({ blocklist: { claude: true } }));

      const importer = new SqliteImporter(db);
      const record = await importer.importBlocklist(sourcePath);

      assert.ok(record.backupPath);
      assert.ok(fs.existsSync(record.backupPath), 'Backup file should exist');

      // Verify backup content matches original
      const backupContent = fs.readFileSync(record.backupPath, 'utf8');
      const originalContent = fs.readFileSync(sourcePath, 'utf8');
      assert.equal(backupContent, originalContent, 'Backup should match original');
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  it('importBlocklist: handles boolean true/false entries', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const sourcePath = path.join(dir, 'agents.local.json');
      fs.writeFileSync(sourcePath, JSON.stringify({
        blocklist: {
          claude: true,
          codex: false,
        },
      }));

      const importer = new SqliteImporter(db);
      await importer.importBlocklist(sourcePath);

      const repo = new SqliteBlocklistRepository(db);
      const claude = await repo.findByAgent('claude');
      assert.ok(claude);
      assert.equal(claude.blocked, true);

      const codex = await repo.findByAgent('codex');
      assert.ok(codex);
      assert.equal(codex.blocked, false);
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });
});
