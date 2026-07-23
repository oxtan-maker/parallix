import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../src/adapters/sqlite/migration-runner.js';
import { SqliteBlocklistRepository } from '../src/adapters/sqlite/blocklist-repository.js';
import { SqliteUsageRepository } from '../src/adapters/sqlite/usage-repository.js';
import { SqliteKnownRepositoriesRepository } from '../src/adapters/sqlite/repository-repository.js';
import { SqliteUIPreferencesRepository } from '../src/adapters/sqlite/ui-preferences-repository.js';
import { SqliteOperationalHistoryRepository } from '../src/adapters/sqlite/operational-history-repository.js';
import { SqliteMigrationLedgerRepository } from '../src/adapters/sqlite/migration-ledger-repository.js';
import { SQLITE_ENTITY_AUTHORITY } from '../src/adapters/sqlite/authority-map.js';

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

describe('SQLite repository ports — CP2: domain mappings and authority', () => {
  // --- Agent blocklist repository ---

  it('blocklist: findAll returns empty array on fresh database', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const repo = new SqliteBlocklistRepository(db);
      const entries = await repo.findAll();
      assert.equal(entries.length, 0);
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  it('blocklist: save and findByAgent round-trip', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const repo = new SqliteBlocklistRepository(db);
      await repo.save({ agent: 'claude', blocked: true, reason: 'maintenance' });
      await repo.save({ agent: 'codex', blocked: false, until: '2026-08-01 12' });

      const claude = await repo.findByAgent('claude');
      assert.ok(claude);
      assert.equal(claude.agent, 'claude');
      assert.equal(claude.blocked, true);
      assert.equal(claude.reason, 'maintenance');

      const codex = await repo.findByAgent('codex');
      assert.ok(codex);
      assert.equal(codex.blocked, false);
      assert.equal(codex.until, '2026-08-01 12');
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  it('blocklist: save upserts existing entry', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const repo = new SqliteBlocklistRepository(db);
      await repo.save({ agent: 'claude', blocked: true, reason: 'initial' });
      await repo.save({ agent: 'claude', blocked: false, reason: 'updated' });

      const entry = await repo.findByAgent('claude');
      assert.ok(entry);
      assert.equal(entry.blocked, false);
      assert.equal(entry.reason, 'updated');

      const all = await repo.findAll();
      assert.equal(all.length, 1, 'Upsert should not create duplicate');
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  it('blocklist: deleteByAgent removes entry', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const repo = new SqliteBlocklistRepository(db);
      await repo.save({ agent: 'claude', blocked: true });
      await repo.deleteByAgent('claude');

      const entry = await repo.findByAgent('claude');
      assert.equal(entry, undefined);
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  it('blocklist: clear removes all entries', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const repo = new SqliteBlocklistRepository(db);
      await repo.save({ agent: 'claude', blocked: true });
      await repo.save({ agent: 'codex', blocked: false });
      await repo.clear();

      const all = await repo.findAll();
      assert.equal(all.length, 0);
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  // --- Usage statistics repository ---

  it('usage: save and findAll round-trip', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const repo = new SqliteUsageRepository(db);
      await repo.save({
        date: '2026-07-20',
        repo: 'parallix',
        mission: 'task-2294',
        stage: 'execute',
        implementer_agent: 'claude',
        input_tokens: 1000,
        output_tokens: 500,
      });

      const all = await repo.findAll();
      assert.equal(all.length, 1);
      assert.equal(all[0].repo, 'parallix');
      assert.equal(all[0].stage, 'execute');
      // Numeric columns round-trip as numbers, conforming to the domain model.
      assert.strictEqual(all[0].input_tokens, 1000);
      assert.strictEqual(all[0].output_tokens, 500);
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  it('usage: numeric columns conform to the domain model (INTEGER/REAL, NULL = unavailable)', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const repo = new SqliteUsageRepository(db);
      // A fully-measured record: integer counts and a fractional cost.
      await repo.save({
        date: '2026-07-20', repo: 'parallix', stage: 'execute',
        input_tokens: 1000, tool_calls: 12, cost_usd: 0.42, pr_fix_rounds: 3,
      });
      // A record with an unmeasured cost: it must stay unavailable, not become 0.
      await repo.save({
        date: '2026-07-21', repo: 'parallix', stage: 'draft', input_tokens: 0,
      });

      const [measured, partial] = await repo.findAll();

      // INTEGER round-trips as a number, not a string.
      assert.strictEqual(measured.input_tokens, 1000);
      assert.strictEqual(measured.tool_calls, 12);
      assert.strictEqual(measured.pr_fix_rounds, 3);
      // REAL preserves the fractional value.
      assert.strictEqual(measured.cost_usd, 0.42);
      assert.equal(typeof measured.input_tokens, 'number');

      // Measured zero is preserved (distinct from unavailable).
      assert.strictEqual(partial.input_tokens, 0);
      // An unset numeric column is `undefined` (SQL NULL / unavailable), not 0.
      assert.strictEqual(partial.cost_usd, undefined);
      assert.strictEqual(partial.tool_calls, undefined);

      // Column affinity is genuinely numeric at the SQL layer.
      const affinities = await db.query<{ name: string; type: string }>(
        "SELECT name, type FROM pragma_table_info('usage_statistics') WHERE name IN ('input_tokens','cost_usd','tool_calls','pr_fix_rounds');",
      );
      const typeByName = Object.fromEntries(affinities.map((c) => [c.name, c.type]));
      assert.equal(typeByName.input_tokens, 'INTEGER');
      assert.equal(typeByName.tool_calls, 'INTEGER');
      assert.equal(typeByName.pr_fix_rounds, 'INTEGER');
      assert.equal(typeByName.cost_usd, 'REAL');
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  it('usage: saveAll persists multiple records in transaction', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const repo = new SqliteUsageRepository(db);
      await repo.saveAll([
        { date: '2026-07-20', repo: 'parallix', stage: 'draft' },
        { date: '2026-07-21', repo: 'parallix', stage: 'execute' },
        { date: '2026-07-22', repo: 'parallix', stage: 'review' },
      ]);

      const all = await repo.findAll();
      assert.equal(all.length, 3);
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  it('usage: findWhere filters records', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const repo = new SqliteUsageRepository(db);
      await repo.saveAll([
        { date: '2026-07-20', repo: 'parallix', stage: 'draft' },
        { date: '2026-07-21', repo: 'other', stage: 'execute' },
        { date: '2026-07-22', repo: 'parallix', stage: 'review' },
      ]);

      const filtered = await repo.findWhere((r) => r.repo === 'parallix');
      assert.equal(filtered.length, 2);
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  it('usage: clear removes all records', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const repo = new SqliteUsageRepository(db);
      await repo.save({ date: '2026-07-20', repo: 'parallix' });
      await repo.clear();

      const all = await repo.findAll();
      assert.equal(all.length, 0);
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  // --- Known repositories repository ---

  it('known-repos: save and findById round-trip', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const repo = new SqliteKnownRepositoriesRepository(db);
      await repo.save({
        id: 'parallix-repo',
        path: '/home/user/code/parallix',
        lastAccessed: '2026-07-23T10:00:00Z',
      });

      const entry = await repo.findById('parallix-repo');
      assert.ok(entry);
      assert.equal(entry.id, 'parallix-repo');
      assert.equal(entry.path, '/home/user/code/parallix');
      assert.equal(entry.lastAccessed, '2026-07-23T10:00:00Z');
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  it('known-repos: findAll returns entries ordered by last_accessed', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const repo = new SqliteKnownRepositoriesRepository(db);
      await repo.save({ id: 'repo-a', path: '/a', lastAccessed: '2026-07-20T10:00:00Z' });
      await repo.save({ id: 'repo-b', path: '/b', lastAccessed: '2026-07-23T10:00:00Z' });

      const all = await repo.findAll();
      assert.equal(all.length, 2);
      assert.equal(all[0].id, 'repo-b', 'Most recently accessed should be first');
      assert.equal(all[1].id, 'repo-a');
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  // --- UI preferences repository ---

  it('ui-preferences: save and findByKey round-trip', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const repo = new SqliteUIPreferencesRepository(db);
      await repo.save({
        key: 'board-lane-order',
        value: JSON.stringify(['backlog', 'active', 'review', 'done']),
        updatedAt: '2026-07-23T10:00:00Z',
      });

      const entry = await repo.findByKey('board-lane-order');
      assert.ok(entry);
      assert.equal(entry.key, 'board-lane-order');
      const parsed = JSON.parse(entry.value);
      assert.equal(parsed.length, 4);
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  it('ui-preferences: save upserts existing key', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const repo = new SqliteUIPreferencesRepository(db);
      await repo.save({ key: 'theme', value: 'light', updatedAt: '2026-07-20T10:00:00Z' });
      await repo.save({ key: 'theme', value: 'dark', updatedAt: '2026-07-23T10:00:00Z' });

      const entry = await repo.findByKey('theme');
      assert.ok(entry);
      assert.equal(entry.value, 'dark');
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  // --- Operational history repository ---

  it('operational-history: append and findByType', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const repo = new SqliteOperationalHistoryRepository(db);
      await repo.append({
        eventType: 'migration-applied',
        eventData: JSON.stringify({ migration: '0001-initial-schema' }),
        createdAt: '2026-07-23T10:00:00Z',
      });
      await repo.append({
        eventType: 'import-completed',
        eventData: JSON.stringify({ source: 'stats.csv' }),
        createdAt: '2026-07-23T10:01:00Z',
      });

      const migrationEvents = await repo.findByType('migration-applied');
      assert.equal(migrationEvents.length, 1);
      assert.equal(migrationEvents[0].eventType, 'migration-applied');

      const all = await repo.findAll();
      assert.equal(all.length, 2);
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  // --- Migration ledger repository ---

  it('migration-ledger: findAll returns applied migrations', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const repo = new SqliteMigrationLedgerRepository(db);
      const entries = await repo.findAll();
      assert.ok(entries.length >= 2, 'Should have at least 2 applied migrations');
      assert.equal(entries[0].id, '0001-initial-schema');
      assert.ok(entries[0].checksum, 'Should have checksum');
      assert.ok(entries[0].appliedAt, 'Should have appliedAt');
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  it('migration-ledger: findById returns specific migration', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const repo = new SqliteMigrationLedgerRepository(db);
      const entry = await repo.findById('0002-import-history');
      assert.ok(entry);
      assert.equal(entry.id, '0002-import-history');
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  it('migration-ledger: findById returns undefined for missing ID', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const repo = new SqliteMigrationLedgerRepository(db);
      const entry = await repo.findById('9999-nonexistent');
      assert.equal(entry, undefined);
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  // --- Authority map completeness ---

  it('authority map covers all six operator-local domains', () => {
    const domains = Object.keys(SQLITE_ENTITY_AUTHORITY);
    assert.ok(domains.includes('agent_blocklist'), 'agent_blocklist authority');
    assert.ok(domains.includes('usage_statistics'), 'usage_statistics authority');
    assert.ok(domains.includes('known_repositories'), 'known_repositories authority');
    assert.ok(domains.includes('ui_preferences'), 'ui_preferences authority');
    assert.ok(domains.includes('operational_history'), 'operational_history authority');
    assert.ok(domains.includes('schema_migrations'), 'migration metadata authority');
    assert.ok(domains.includes('import_history'), 'import history authority');
  });

  it('authority map: every field maps to exactly one authority owner', () => {
    for (const [table, fields] of Object.entries(SQLITE_ENTITY_AUTHORITY)) {
      for (const [field, authority] of Object.entries(fields)) {
        assert.ok(
          authority.owner === 'operator-local' || authority.owner === 'operator-local-cache',
          `Field ${table}.${field} must map to a valid authority owner`,
        );
      }
    }
  });

  it('authority map: no field is shared across tables', () => {
    const allFields = new Map<string, string>();
    for (const [table, fields] of Object.entries(SQLITE_ENTITY_AUTHORITY)) {
      for (const field of Object.keys(fields)) {
        const key = `${table}.${field}`;
        assert.ok(
          !allFields.has(key),
          `Field ${key} is duplicated in authority map`,
        );
        allFields.set(key, table);
      }
    }
  });

  // --- Ports are asynchronous ---

  it('all repository ports return Promise values', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const blocklist = new SqliteBlocklistRepository(db);
      const usage = new SqliteUsageRepository(db);
      const repos = new SqliteKnownRepositoriesRepository(db);
      const prefs = new SqliteUIPreferencesRepository(db);
      const history = new SqliteOperationalHistoryRepository(db);
      const ledger = new SqliteMigrationLedgerRepository(db);

      // Verify all methods return promises
      assert.ok(blocklist.findAll() instanceof Promise);
      assert.ok(blocklist.findByAgent('x') instanceof Promise);
      assert.ok(blocklist.save({ agent: 'x', blocked: false }) instanceof Promise);
      assert.ok(blocklist.deleteByAgent('x') instanceof Promise);
      assert.ok(blocklist.clear() instanceof Promise);

      assert.ok(usage.findAll() instanceof Promise);
      assert.ok(usage.findWhere(() => true) instanceof Promise);
      assert.ok(usage.save({}) instanceof Promise);
      assert.ok(usage.saveAll([]) instanceof Promise);
      assert.ok(usage.clear() instanceof Promise);

      assert.ok(repos.findAll() instanceof Promise);
      assert.ok(repos.findById('x') instanceof Promise);
      assert.ok(repos.save({ id: 'x', path: '/x', lastAccessed: 'now' }) instanceof Promise);
      assert.ok(repos.deleteById('x') instanceof Promise);
      assert.ok(repos.clear() instanceof Promise);

      assert.ok(prefs.findAll() instanceof Promise);
      assert.ok(prefs.findByKey('x') instanceof Promise);
      assert.ok(prefs.save({ key: 'x', value: 'v', updatedAt: 'now' }) instanceof Promise);
      assert.ok(prefs.deleteByKey('x') instanceof Promise);
      assert.ok(prefs.clear() instanceof Promise);

      assert.ok(history.findAll() instanceof Promise);
      assert.ok(history.findByType('x') instanceof Promise);
      assert.ok(history.append({ eventType: 'x', eventData: '{}', createdAt: 'now' }) instanceof Promise);
      assert.ok(history.clear() instanceof Promise);

      assert.ok(ledger.findAll() instanceof Promise);
      assert.ok(ledger.findById('x') instanceof Promise);
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  // --- Domain entity mapping ---

  it('blocklist maps to AgentBlock domain entity fields', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const repo = new SqliteBlocklistRepository(db);

      // AgentBlock domain has: kind (none/indefinite/until), reason
      // SQL stores: blocked (bool), until (string), reason (string)
      // Mapping: blocked=false -> kind='none'; blocked=true, no until -> kind='indefinite';
      //          blocked=true, with until -> kind='until'
      await repo.save({
        agent: 'claude',
        blocked: true,
        until: '2026-08-01 12',
        reason: 'scheduled maintenance',
      });

      const entry = await repo.findByAgent('claude');
      assert.ok(entry);
      assert.equal(entry.agent, 'claude');
      assert.equal(entry.blocked, true);
      assert.equal(entry.until, '2026-08-01 12');
      assert.equal(entry.reason, 'scheduled maintenance');
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });
});
