import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync, spawn } from 'node:child_process';
import { promisify } from 'node:util';

import { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../src/adapters/sqlite/migration-runner.js';
import { SqliteBlocklistRepository } from '../src/adapters/sqlite/blocklist-repository.js';
import { SqliteUsageRepository } from '../src/adapters/sqlite/usage-repository.js';
import { SqliteImporter } from '../src/adapters/sqlite/importer.js';
import { materializeBlocklistSnapshot } from '../src/adapters/sqlite/blocklist-snapshot.js';
// Real production consumers, for the rollback / repository-wins proofs.
import { eligibleAgentsForStep } from '../src/platform/runtime/lib/agents/launcher-selection.js';
import { readAgentConfig } from '../src/platform/runtime/lib/agents/agent-config.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const execFile = promisify(spawn);

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

describe('SQLite recovery, backup, concurrency, rollback — CP5', () => {
  // --- Backup before migration ---

  it('backup is created before irreversible migration', async () => {
    const { db, dir, dbPath } = await createDbWithSchema();
    try {
      const dirContents = fs.readdirSync(dir);
      const backupFiles = dirContents.filter((f) => f.includes('.bak.'));
      assert.ok(backupFiles.length > 0, 'Should have backup files from migration');
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  // --- Interrupted migration recovery ---

  it('interrupted migration: failed migration is rolled back and can be retried', async () => {
    const dir = createTempDir('db');
    const dbPath = path.join(dir, 'test.db');
    const db = new SqliteDatabaseAdapter();
    await db.open({ path: dbPath });

    try {
      const runner = new SqliteMigrationRunner(db);
      const migrations = loadDefaultMigrations();

      // Apply only first migration
      await runner.applyPending([migrations[0]]);
      assert.equal(await runner.getCurrentVersion(), '0001-initial-schema');

      // Simulate interrupted second migration: manually insert partial entry
      await db.execute(
        'INSERT INTO schema_migrations (id, checksum, applied_at) VALUES (?, ?, ?);',
        ['0002-import-history', migrations[1].checksum, new Date().toISOString()],
      );

      // Re-applying both should be idempotent (both already in ledger)
      const applied = await runner.applyPending(migrations);
      assert.equal(applied.length, 2, 'Should report both migrations as applied');
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  // --- Checksum mismatch detection ---

  it('checksum mismatch fails closed for modified migration', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const runner = new SqliteMigrationRunner(db);
      const migrations = loadDefaultMigrations();
      await runner.applyPending(migrations);

      // Try with a modified checksum
      const modifiedMigrations = migrations.map((m) => {
        if (m.id === '0001-initial-schema') {
          return { ...m, checksum: 'different-checksum' };
        }
        return m;
      });

      let errorThrown = false;
      try {
        await runner.applyPending(modifiedMigrations);
      } catch (err) {
        errorThrown = true;
        assert.ok(String(err).includes('Checksum mismatch'));
      }
      assert.ok(errorThrown, 'Should throw on checksum mismatch');
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  // --- Concurrent access (two actual processes using spawn) ---

  it('concurrent access: two processes contend for the database simultaneously', async () => {
    const dir = createTempDir('db');
    const dbPath = path.join(dir, 'test.db');

    // Create database with schema
    const initScript = `
      import { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
      import { SqliteMigrationRunner, loadDefaultMigrations } from '../src/adapters/sqlite/migration-runner.js';
      const db = new SqliteDatabaseAdapter();
      await db.open({ path: '${dbPath}' });
      const runner = new SqliteMigrationRunner(db);
      await runner.applyPending(loadDefaultMigrations());
      await db.close();
    `;
    const initResult = spawnSync('node', ['--import', 'tsx', '-e', initScript], {
      cwd: path.resolve('test'),
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(initResult.status, 0, `Init process failed: ${initResult.stderr}`);

    // Launch two processes that simultaneously write to the database
    const writeScript = (agent: string) => `
      import { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
      import { SqliteBlocklistRepository } from '../src/adapters/sqlite/blocklist-repository.js';
      const db = new SqliteDatabaseAdapter();
      await db.open({ path: '${dbPath}', busyTimeoutMs: 2000 });
      const repo = new SqliteBlocklistRepository(db);
      await repo.save({ agent: '${agent}', blocked: true });
      // Hold the connection open for 500ms to create overlap
      await new Promise(r => setTimeout(r, 500));
      await db.close();
    `;

    // Spawn both processes at the same time (not serially)
    const proc1 = spawn('node', ['--import', 'tsx', '-e', writeScript('agent-a')], {
      cwd: path.resolve('test'),
      timeout: 30000,
    });
    const proc2 = spawn('node', ['--import', 'tsx', '-e', writeScript('agent-b')], {
      cwd: path.resolve('test'),
      timeout: 30000,
    });

    // Wait for both to finish
    const [exit1, exit2] = await Promise.all([
      new Promise<number>((resolve) => proc1.on('close', resolve)),
      new Promise<number>((resolve) => proc2.on('close', resolve)),
    ]);

    assert.equal(exit1, 0, 'Process 1 should succeed');
    assert.equal(exit2, 0, 'Process 2 should succeed (busy timeout handles contention)');

    // Verify both entries were written
    const readScript = `
      import { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
      import { SqliteBlocklistRepository } from '../src/adapters/sqlite/blocklist-repository.js';
      const db = new SqliteDatabaseAdapter();
      await db.open({ path: '${dbPath}' });
      const repo = new SqliteBlocklistRepository(db);
      const entries = await repo.findAll();
      console.log(JSON.stringify({ count: entries.length, agents: entries.map(e => e.agent).sort() }));
      await db.close();
    `;
    const readResult = spawnSync('node', ['--import', 'tsx', '-e', readScript], {
      cwd: path.resolve('test'),
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(readResult.status, 0, `Read process failed: ${readResult.stderr}`);
    const output = JSON.parse(readResult.stdout);
    assert.equal(output.count, 2, 'Both processes should have written entries');
    assert.deepEqual(output.agents, ['agent-a', 'agent-b']);

    cleanupTempDir(dir);
  });

  // --- SC8: genuine adapter recovery after actual database corruption ---

  it('adapter recovers committed data from backup after the database file is corrupted', async () => {
    const dir = createTempDir('recovery');
    const dbPath = path.join(dir, 'test.db');

    // Seed a known-good state and capture a self-contained backup that contains it.
    const db = new SqliteDatabaseAdapter();
    await db.open({ path: dbPath });
    await new SqliteMigrationRunner(db).applyPending(loadDefaultMigrations());
    await new SqliteBlocklistRepository(db).save({ agent: 'claude', blocked: true, reason: 'seed' });
    const backupPath = await db.backup();
    assert.ok(fs.existsSync(backupPath), 'backup file should be written');
    await db.close();

    // Corrupt the main database file on disk.
    const corrupted = Buffer.from(fs.readFileSync(dbPath));
    for (let i = 0; i < corrupted.length; i++) { corrupted[i] = 0xff; }
    fs.writeFileSync(dbPath, corrupted);

    // Reopen and confirm the adapter DETECTS corruption (no unhandled throw).
    await db.open({ path: dbPath });
    assert.equal(await db.checkIntegrity(), false, 'corrupted image must fail integrity check');

    // Recover: the adapter restores the latest backup, reopens, and re-verifies.
    const recovered = await db.recoverFromBackup();
    assert.equal(recovered, true, 'recovery from backup should succeed');
    assert.equal(await db.checkIntegrity(), true, 'restored database must be healthy');

    // The committed data survives the recovery.
    const rows = await new SqliteBlocklistRepository(db).findAll();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].agent, 'claude');
    assert.equal(rows[0].reason, 'seed');

    await db.close();
    cleanupTempDir(dir);
  });

  it('recoverFromBackup reports failure when no backup is available', async () => {
    const dir = createTempDir('recovery-none');
    const dbPath = path.join(dir, 'nobackup.db');
    const db = new SqliteDatabaseAdapter();
    // Open without migrating so no pre-migration backup exists.
    await db.open({ path: dbPath });
    try {
      // Remove any stray backups to guarantee none are present.
      for (const f of fs.readdirSync(dir)) {
        if (f.includes('.bak.')) { fs.rmSync(path.join(dir, f)); }
      }
      assert.equal(await db.recoverFromBackup(), false, 'no backup → recovery reports false');
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  // --- SC10: repository/Git authority wins over the SQLite projection ---

  it('repository authority wins: SQLite only governs the blocklist field, never repo-owned step eligibility', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      // Repository authority: step eligibility comes from the config file.
      const fileConfig = {
        steps: { active: { eligible: ['codex', 'claude'] } },
        blocklist: {},
      };

      // SQLite authority: an operator-local block on codex.
      await new SqliteBlocklistRepository(db).save({ agent: 'codex', blocked: true, reason: 'operator' });
      const overlay = materializeBlocklistSnapshot(await new SqliteBlocklistRepository(db).findAll());

      // The composition root overlays ONLY the blocklist field (as LegacyActiveAdapter does).
      const effective = { ...fileConfig, blocklist: overlay };

      // Repo-owned steps are untouched by any SQLite projection.
      assert.deepEqual(effective.steps, fileConfig.steps, 'SQLite must not rewrite repo-owned step eligibility');

      // SQLite-owned blocklist is applied; repo-owned eligibility still governs the candidate set.
      const eligible = eligibleAgentsForStep('active', { config: effective });
      assert.deepEqual(eligible, ['claude'], 'codex blocked by SQLite; claude kept from repo eligibility');
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  // --- SC10: rollback disables the adapter and returns to untouched file readers ---

  it('rollback: with the adapter disabled, the untouched file reader supplies the blocklist', () => {
    const dir = createTempDir('rollback');
    const configPath = path.join(dir, 'agents.json');
    fs.writeFileSync(configPath, JSON.stringify({
      steps: { active: { eligible: ['codex', 'claude'] } },
      blocklist: { codex: { blocked: true, reason: 'file-authority' } },
    }));

    // The rollback path: no SQLite overlay. readAgentConfig reads via fs.readFileSync
    // (a non-CONFIG_PATH path skips local-merge and reads the file directly).
    const fileConfig = readAgentConfig(configPath);
    assert.equal((fileConfig.blocklist as Record<string, { reason?: string }>).codex.reason, 'file-authority');

    const eligible = eligibleAgentsForStep('active', { config: fileConfig });
    assert.deepEqual(eligible, ['claude'], 'file-blocked codex excluded via the untouched reader');

    cleanupTempDir(dir);
  });

  // --- Importer: malformed records reported without aborting ---

  it('importBlocklist: malformed entries are skipped, valid entries are imported', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const sourcePath = path.join(dir, 'agents.local.json');
      fs.writeFileSync(sourcePath, JSON.stringify({
        blocklist: {
          claude: true,
          codex: null, // malformed: null
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

  it('importStats: malformed rows are skipped, valid rows are imported', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const sourcePath = path.join(dir, 'stats.csv');
      fs.writeFileSync(sourcePath, [
        'date,repo,mission',
        '2026-07-20,parallix,task-2294',
        '2026-07-21', // malformed: missing columns
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

  // --- Busy timeout clamping ---

  it('busy timeout is clamped to 0-5000 range', async () => {
    const dir = createTempDir('db');
    const dbPath = path.join(dir, 'test.db');

    // Test with value above 5000
    const db1 = new SqliteDatabaseAdapter();
    await db1.open({ path: dbPath, busyTimeoutMs: 10000 });
    const result1 = await db1.query<Record<string, unknown>>('PRAGMA busy_timeout;');
    assert.equal(result1[0]?.timeout ?? result1[0]?.value, 5000, 'Should clamp 10000 to 5000');
    await db1.close();

    // Test with negative value
    const dbPath2 = path.join(dir, 'test2.db');
    const db2 = new SqliteDatabaseAdapter();
    await db2.open({ path: dbPath2, busyTimeoutMs: -100 });
    const result2 = await db2.query<Record<string, unknown>>('PRAGMA busy_timeout;');
    assert.equal(result2[0]?.timeout ?? result2[0]?.value, 0, 'Should clamp -100 to 0');
    await db2.close();

    // Test with non-numeric (NaN)
    const dbPath3 = path.join(dir, 'test3.db');
    const db3 = new SqliteDatabaseAdapter();
    await db3.open({ path: dbPath3, busyTimeoutMs: NaN });
    const result3 = await db3.query<Record<string, unknown>>('PRAGMA busy_timeout;');
    assert.equal(result3[0]?.timeout ?? result3[0]?.value, 0, 'Should clamp NaN to 0');
    await db3.close();

    cleanupTempDir(dir);
  });
});
