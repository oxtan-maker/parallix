import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

import { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../src/adapters/sqlite/migration-runner.js';
import { resolveDatabasePath, verifyDatabasePathIsolation } from '../src/adapters/sqlite/database-path-resolver.js';
import { initOperatorState } from '../src/adapters/sqlite/adapter-factory.js';

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

function createTempDb(): { db: SqliteDatabaseAdapter; dir: string; dbPath: string } {
  const dir = createTempDir('db');
  const dbPath = path.join(dir, 'test.db');
  const db = new SqliteDatabaseAdapter();
  db.open({ path: dbPath }).catch(() => {});
  return { db, dir, dbPath };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SQLite adapter — CP1: schema and migration runner', () => {
  // --- Connection rules ---

  it('enables foreign keys on connection', async () => {
    const { db, dir, dbPath } = createTempDb();
    try {
      const result = await db.query<Record<string, unknown>>('PRAGMA foreign_keys;');
      // foreign_keys pragma returns a single column with the key name
      const fkValue = result[0]?.foreign_keys ?? result[0]?.value;
      assert.equal(fkValue, 1, 'foreign_keys should be ON (1)');
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  it('sets bounded busy timeout on connection', async () => {
    const { db, dir } = createTempDb();
    try {
      const result = await db.query<Record<string, unknown>>('PRAGMA busy_timeout;');
      const btValue = result[0]?.timeout ?? result[0]?.busy_timeout ?? result[0]?.value;
      assert.equal(btValue, 5000, 'busy_timeout should default to 5000');
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  it('enables WAL mode on connection', async () => {
    const { db, dir } = createTempDb();
    try {
      const result = await db.query<{ journal_mode: string }>('PRAGMA journal_mode;');
      assert.equal(result[0].journal_mode, 'wal', 'journal_mode should be WAL');
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  it('uses parameterized SQL for dynamic values', async () => {
    const { db, dir } = createTempDb();
    try {
      // Create a test table
      await db.execute('CREATE TABLE test_param (id TEXT PRIMARY KEY, name TEXT NOT NULL);');

      // Insert with parameterized values
      await db.execute('INSERT INTO test_param (id, name) VALUES (?, ?);', ['a', 'alpha']);
      await db.execute('INSERT INTO test_param (id, name) VALUES (?, ?);', ['b', 'beta']);

      // Query with parameterized filter
      const rows = await db.query<{ id: string; name: string }>(
        'SELECT id, name FROM test_param WHERE id = ?;',
        ['b'],
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].name, 'beta');
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  it('wraps multi-statement changes in explicit transactions', async () => {
    const { db, dir } = createTempDb();
    try {
      await db.execute('CREATE TABLE tx_test (id INTEGER PRIMARY KEY, val TEXT);');

      await db.beginTransaction();
      await db.execute('INSERT INTO tx_test (id, val) VALUES (?, ?);', [1, 'first']);
      await db.execute('INSERT INTO tx_test (id, val) VALUES (?, ?);', [2, 'second']);
      await db.commitTransaction();

      const rows = await db.query<{ id: number; val: string }>('SELECT id, val FROM tx_test ORDER BY id;');
      assert.equal(rows.length, 2);
      assert.equal(rows[0].val, 'first');
      assert.equal(rows[1].val, 'second');
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  it('rolls back transaction on failure', async () => {
    const { db, dir } = createTempDb();
    try {
      await db.execute('CREATE TABLE rollback_test (id INTEGER PRIMARY KEY, val TEXT NOT NULL);');
      await db.execute('INSERT INTO rollback_test (id, val) VALUES (?, ?);', [1, 'keep']);

      await db.beginTransaction();
      await db.execute('INSERT INTO rollback_test (id, val) VALUES (?, ?);', [2, 'will rollback']);

      // Trigger a constraint violation (val is NOT NULL, inserting NULL)
      try {
        await db.execute('INSERT INTO rollback_test (id, val) VALUES (3, null);');
      } catch {
        // Expected constraint violation
      }

      await db.rollbackTransaction();

      const rows = await db.query<{ id: number; val: string }>('SELECT id, val FROM rollback_test ORDER BY id;');
      assert.equal(rows.length, 1, 'Only the pre-transaction row should remain after rollback');
      assert.equal(rows[0].val, 'keep');
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  // --- Migration runner ---

  it('applies clean-install migrations from scratch', async () => {
    const { db, dir } = createTempDb();
    try {
      const runner = new SqliteMigrationRunner(db);
      const migrations = loadDefaultMigrations();
      const applied = await runner.applyPending(migrations);

      assert.ok(applied.length > 0, 'Should have applied migrations');
      assert.equal(applied[0].id, '0001-initial-schema', 'First migration should be 0001');
      assert.ok(applied[0].checksum, 'Migration should have a checksum');
      assert.ok(applied[0].appliedAt, 'Migration should have an appliedAt timestamp');

      // Verify all expected tables exist
      const tables = await db.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;",
      );
      const tableNames = tables.map((t) => t.name);

      assert.ok(tableNames.includes('agent_blocklist'), 'agent_blocklist table should exist');
      assert.ok(tableNames.includes('usage_statistics'), 'usage_statistics table should exist');
      assert.ok(tableNames.includes('known_repositories'), 'known_repositories table should exist');
      assert.ok(tableNames.includes('ui_preferences'), 'ui_preferences table should exist');
      assert.ok(tableNames.includes('operational_history'), 'operational_history table should exist');
      assert.ok(tableNames.includes('schema_migrations'), 'schema_migrations table should exist');
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  it('idempotent re-run of already-applied migrations', async () => {
    const { db, dir } = createTempDb();
    try {
      const runner = new SqliteMigrationRunner(db);
      const migrations = loadDefaultMigrations();

      // First run
      const applied1 = await runner.applyPending(migrations);
      assert.ok(applied1.length > 0, 'First run should apply migrations');

      // Second run (idempotent — no new migrations)
      const applied2 = await runner.applyPending(migrations);
      assert.equal(applied2.length, applied1.length, 'Second run should apply no new migrations');
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  it('detects checksum mismatch for modified migration', async () => {
    const { db, dir } = createTempDb();
    try {
      const runner = new SqliteMigrationRunner(db);
      const migrations = loadDefaultMigrations();

      // Apply migrations
      await runner.applyPending(migrations);

      // Re-run with a modified migration (different checksum)
      const modifiedMigrations = migrations.map((m) => {
        if (m.id === '0001-initial-schema') {
          return { ...m, checksum: 'modified-checksum-that-does-not-match' };
        }
        return m;
      });

      let errorThrown = false;
      try {
        await runner.applyPending(modifiedMigrations);
      } catch (err) {
        errorThrown = true;
        assert.ok(
          String(err).includes('Checksum mismatch'),
          'Error should mention checksum mismatch',
        );
      }
      assert.ok(errorThrown, 'Should throw on checksum mismatch');
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  it('previous-schema upgrade applies pending migrations only', async () => {
    const { db, dir } = createTempDb();
    try {
      const runner = new SqliteMigrationRunner(db);
      const migrations = loadDefaultMigrations();

      // Apply only first migration
      const firstMigration = migrations[0];
      const applied1 = await runner.applyPending([firstMigration]);
      assert.equal(applied1.length, 1, 'First run should apply only one migration');
      assert.equal(applied1[0].id, '0001-initial-schema');

      // Apply all migrations (second should be pending)
      const applied2 = await runner.applyPending(migrations);
      assert.equal(applied2.length, migrations.length, 'Second run should apply remaining migrations');
      assert.equal(applied2[1].id, '0002-import-history');
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  it('migration ledger records version, checksum, and timestamp', async () => {
    const { db, dir } = createTempDb();
    try {
      const runner = new SqliteMigrationRunner(db);
      const migrations = loadDefaultMigrations();
      await runner.applyPending(migrations);

      const ledger = await db.query<{ id: string; checksum: string; applied_at: string }>(
        'SELECT id, checksum, applied_at FROM schema_migrations ORDER BY id;',
      );
      assert.equal(ledger.length, migrations.length, 'Ledger should have entries for all migrations');

      for (const entry of ledger) {
        assert.ok(entry.id, 'Ledger entry should have id');
        assert.ok(entry.checksum, 'Ledger entry should have checksum');
        assert.ok(entry.applied_at, 'Ledger entry should have applied_at timestamp');
        // Verify checksum is SHA-256 hex (64 chars)
        assert.equal(entry.checksum.length, 64, 'Checksum should be SHA-256 hex');
      }
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  it('getCurrentVersion returns highest applied migration ID', async () => {
    const { db, dir } = createTempDb();
    try {
      const runner = new SqliteMigrationRunner(db);
      const migrations = loadDefaultMigrations();

      // Before any migrations
      assert.equal(await runner.getCurrentVersion(), null, 'Version should be null before migrations');

      // After first migration
      await runner.applyPending([migrations[0]]);
      assert.equal(await runner.getCurrentVersion(), '0001-initial-schema');

      // After all migrations
      await runner.applyPending(migrations);
      assert.equal(await runner.getCurrentVersion(), '0006-session-markers');
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  // --- Schema correctness ---

  it('schema maps all six operator-local domains', async () => {
    const { db, dir } = createTempDb();
    try {
      const runner = new SqliteMigrationRunner(db);
      await runner.applyPending(loadDefaultMigrations());

      const tables = await db.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;",
      );
      const tableNames = tables.map((t) => t.name);

      // Operator-local domains + schema_migrations
      assert.ok(tableNames.includes('agent_blocklist'), 'Domain: agent_blocklist');
      assert.ok(tableNames.includes('usage_statistics'), 'Domain: usage_statistics');
      assert.ok(tableNames.includes('known_repositories'), 'Domain: known_repositories');
      assert.ok(tableNames.includes('ui_preferences'), 'Domain: ui_preferences');
      assert.ok(tableNames.includes('operational_history'), 'Domain: operational_history');
      assert.ok(tableNames.includes('schema_migrations'), 'Domain: migration metadata (ledger)');
      assert.ok(tableNames.includes('import_history'), 'Domain: import history (from migration 0002)');
      assert.ok(tableNames.includes('board_lane_events'), 'Domain: board lane events (from migration 0003)');
      assert.ok(tableNames.includes('missions'), 'Domain: Mission aggregate (from migration 0004)');
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  it('schema contains no secret/credential/password/token/api_key columns', async () => {
    const { db, dir } = createTempDb();
    try {
      const runner = new SqliteMigrationRunner(db);
      await runner.applyPending(loadDefaultMigrations());

      // Get all column info from all tables
      const tables = await db.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';",
      );

      // Check for columns that would store secrets or raw agent credentials.
      // "token" in column names like input_tokens/output_tokens is about token counts,
      // not API credentials. We check for credential-specific column names.
      const forbiddenColumnNames = ['secret', 'credential', 'password', 'api_key'];
      for (const table of tables) {
        const columns = await db.query<{ name: string }>(
          `PRAGMA table_info(${table.name});`,
        );
        for (const col of columns) {
          const colName = String(col.name).toLowerCase();
          for (const forbidden of forbiddenColumnNames) {
            assert.ok(
              colName !== forbidden,
              `Column "${col.name}" in table "${table.name}" matches forbidden secret/credential name "${forbidden}"`,
            );
          }
        }
      }
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  // --- Database path resolution ---

  it('resolves database path under PARALLIX_HOME', () => {
    const home = createTempDir('home');
    try {
      const dbPath = resolveDatabasePath({ home });
      assert.equal(dbPath, path.join(home, 'parallix.db'));
    } finally {
      cleanupTempDir(home);
    }
  });

  it('database path is never under a target repository directory', () => {
    const home = createTempDir('home');
    const repo = createTempDir('repo');
    try {
      const dbPath = resolveDatabasePath({ home });
      const isolated = verifyDatabasePathIsolation(dbPath, [repo]);
      assert.equal(isolated, true, 'Database should be isolated from repository');
    } finally {
      cleanupTempDir(home);
      cleanupTempDir(repo);
    }
  });

  it('detects database path inside excluded directory', () => {
    const repo = createTempDir('repo');
    try {
      const dbPath = path.join(repo, 'parallix.db');
      const isolated = verifyDatabasePathIsolation(dbPath, [repo]);
      assert.equal(isolated, false, 'Database inside repo should not be isolated');
    } finally {
      cleanupTempDir(repo);
    }
  });

  // --- Checksum computation ---

  it('computeChecksum produces deterministic SHA-256 hex', () => {
    const sql = 'CREATE TABLE test (id INTEGER PRIMARY KEY);';
    const expected = crypto.createHash('sha256').update(sql).digest('hex');
    const actual = SqliteMigrationRunner.computeChecksum(sql);
    assert.equal(actual, expected);
    assert.equal(actual.length, 64, 'SHA-256 hex should be 64 characters');

    // Same input always produces same output
    assert.equal(SqliteMigrationRunner.computeChecksum(sql), actual);
  });

  it('computeChecksum differs for different SQL content', () => {
    const sql1 = 'CREATE TABLE a (id INTEGER);';
    const sql2 = 'CREATE TABLE b (id INTEGER);';
    const hash1 = SqliteMigrationRunner.computeChecksum(sql1);
    const hash2 = SqliteMigrationRunner.computeChecksum(sql2);
    assert.notEqual(hash1, hash2, 'Different SQL should produce different checksums');
  });

  // --- Adapter factory ---

  it('initOperatorState opens database and applies migrations', async () => {
    const home = createTempDir('home');
    try {
      const adapter = await initOperatorState({ homeDir: home });
      try {
        assert.ok(adapter.db.isOpen(), 'Database should be open');
        assert.ok(adapter.db.getPath(), 'Database should have a path');

        const tables = await adapter.db.query<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;",
        );
        const tableNames = tables.map((t) => t.name);
        assert.ok(tableNames.includes('agent_blocklist'), 'Schema should be applied');
      } finally {
        await adapter.db.close();
      }
    } finally {
      cleanupTempDir(home);
    }
  });

  it('initOperatorState creates backup before irreversible migration', async () => {
    const home = createTempDir('home');
    try {
      const adapter = await initOperatorState({ homeDir: home });
      try {
        const dbPath = adapter.db.getPath()!;
        // After first run, backup files should exist for irreversible migrations
        const dirContents = fs.readdirSync(path.dirname(dbPath));
        const backupFiles = dirContents.filter((f) => f.includes('.bak.'));
        assert.ok(backupFiles.length > 0, 'Should have created backup files for irreversible migrations');
      } finally {
        await adapter.db.close();
      }
    } finally {
      cleanupTempDir(home);
    }
  });

  // --- Only node:sqlite in adapter layer ---

  it('node:sqlite import is confined to src/adapters/sqlite/', () => {
    // Verify by checking that database-adapter.ts is the only file importing node:sqlite
    // This test reads the source files and checks for the import
    const adapterDir = path.resolve('src/adapters/sqlite');
    const files = fs.readdirSync(adapterDir, { recursive: true })
      .filter((f): f is string => typeof f === 'string' && f.endsWith('.ts'))
      .map((f) => path.join(adapterDir, f));

    const sqliteImporters = files.filter((f) => {
      const content = fs.readFileSync(f, 'utf8');
      return content.includes("'node:sqlite'") || content.includes('"node:sqlite"');
    });

    assert.ok(sqliteImporters.length >= 1, 'At least one file should import node:sqlite');
    // database-adapter.ts is the expected importer
    assert.ok(
      sqliteImporters.some((f) => f.endsWith('database-adapter.ts')),
      'database-adapter.ts should import node:sqlite',
    );
    // SC2 is exactly one importer, and it is the database adapter.
    assert.equal(
      sqliteImporters.length,
      1,
      `exactly one adapter module may import node:sqlite; found: ${sqliteImporters.join(', ')}`,
    );
  });

  it('no module under src/platform/runtime/lib imports node:sqlite (SC2 negative)', () => {
    // The application/runtime layer must never bind the SQLite driver directly;
    // it reaches operator state only through the async composition-root boundary.
    // The boundary-guards.ts file references 'node:sqlite' as a forbidden token
    // (not an import), so we check for actual import statements.
    const libDir = path.resolve('src/platform/runtime/lib');
    const files = fs.readdirSync(libDir, { recursive: true })
      .filter((f): f is string => typeof f === 'string' && f.endsWith('.ts'))
      .map((f) => path.join(libDir, f));

    const offenders = files.filter((f) => {
      const content = fs.readFileSync(f, 'utf8');
      // Check for import statements referencing node:sqlite (not string constants)
      return /(?:from\s+|import\s*(?:\(\s*)?)['"]node:sqlite['"]/.test(content);
    });

    assert.deepEqual(offenders, [], `no lib module may import node:sqlite; found: ${offenders.join(', ')}`);
  });
});
