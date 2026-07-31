import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../src/adapters/sqlite/migration-runner.js';
import { SqliteKnownRepositoriesRepository } from '../src/adapters/sqlite/repository-repository.js';
import { SqliteUIPreferencesRepository } from '../src/adapters/sqlite/ui-preferences-repository.js';
import { SqliteOperationalHistoryRepository } from '../src/adapters/sqlite/operational-history-repository.js';
import { SqliteBlocklistRepository } from '../src/adapters/sqlite/blocklist-repository.js';
import { KnownRepositoryService } from '../src/application/services/known-repository-service.js';
import { UIPreferencesService } from '../src/application/services/ui-preferences-service.js';
import { OperationalHistoryService } from '../src/application/services/operational-history-service.js';
import { AgentBlockService } from '../src/application/services/agent-block-service.js';
import { repositoryId } from '../src/domain/repository.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTempDir(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `parallix-opstate-${name}-`));
  return dir;
}

function cleanupTempDir(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
}

async function createDbWithSchema(): Promise<{ db: SqliteDatabaseAdapter; dir: string; dbPath: string }> {
  const dir = createTempDir('db');
  const dbPath = path.join(dir, 'test.db');
  const db = new SqliteDatabaseAdapter();
  await db.open({ path: dbPath });
  const runner = new SqliteMigrationRunner(db);
  await runner.applyPending(loadDefaultMigrations());
  return { db, dir, dbPath };
}

// ---------------------------------------------------------------------------
// Mock repository interfaces for failure tests
// ---------------------------------------------------------------------------

interface MockKnownRepositoriesRepository {
  findAll: () => Promise<readonly unknown[]>;
  findById: (id: string) => Promise<unknown | undefined>;
  save: (entry: unknown) => Promise<void>;
  deleteById: (id: string) => Promise<void>;
  clear: () => Promise<void>;
}

interface MockUIPreferencesRepository {
  findAll: () => Promise<readonly unknown[]>;
  findByKey: (key: string) => Promise<unknown | undefined>;
  save: (entry: unknown) => Promise<void>;
  deleteByKey: (key: string) => Promise<void>;
  clear: () => Promise<void>;
}

interface MockOperationalHistoryRepository {
  findAll: () => Promise<readonly unknown[]>;
  findByType: (type: string) => Promise<readonly unknown[]>;
  append: (entry: unknown) => Promise<void>;
  clear: () => Promise<void>;
}

function createFailingRepository<T extends object>(real: T, method: string): T {
  return new Proxy(real, {
    get(target, prop) {
      if (prop === method) {
        return async () => { throw new Error(`database failure: ${method}`); };
      }
      return (target as Record<string, unknown>)[prop as string];
    },
  }) as T;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('KnownRepositoryService: path replacement by RepositoryId', () => {
  let db: SqliteDatabaseAdapter;
  let dir: string;
  let service: KnownRepositoryService;

  beforeEach(async () => {
    const result = await createDbWithSchema();
    db = result.db;
    dir = result.dir;
    service = new KnownRepositoryService(new SqliteKnownRepositoriesRepository(db));
  });

  afterEach(async () => {
    await db.close();
    cleanupTempDir(dir);
  });

  it('saves an observation and loads it by RepositoryId', async () => {
    const repoId = repositoryId('parallix-task-2322');
    await service.saveObservation(
      { id: repoId, displayName: 'parallix' },
      '/home/user/code/parallix',
      '2026-07-23T10:00:00Z',
    );

    const observation = await service.loadObservation(repoId);
    assert.ok(observation);
    assert.equal(observation.id, repoId);
    assert.equal(observation.path, '/home/user/code/parallix');
  });

  it('replaces path metadata on rediscovery without creating a duplicate', async () => {
    const repoId = repositoryId('parallix-task-2322');

    // First observation at original path
    await service.saveObservation(
      { id: repoId, displayName: 'parallix' },
      '/home/user/code/parallix',
      '2026-07-23T10:00:00Z',
    );

    // Repository rediscovered at a different path
    await service.saveObservation(
      { id: repoId, displayName: 'parallix' },
      '/opt/repos/parallix',
      '2026-07-24T10:00:00Z',
    );

    // Load — should have updated path, not a second entry
    const observation = await service.loadObservation(repoId);
    assert.ok(observation);
    assert.equal(observation.path, '/opt/repos/parallix', 'Path must be updated');
    assert.equal(observation.lastAccessed, '2026-07-24T10:00:00Z', 'Timestamp must be updated');

    // Only one entry exists
    const all = await service.listAll();
    assert.equal(all.length, 1, 'Path replacement must not create a duplicate identity');
  });

  it('returns null for unknown RepositoryId', async () => {
    const observation = await service.loadObservation(repositoryId('nonexistent-repo'));
    assert.equal(observation, null);
  });

  it('listAll returns entries ordered by last access', async () => {
    await service.saveObservation(
      { id: repositoryId('repo-a'), displayName: 'repo-a' },
      '/a',
      '2026-07-20T10:00:00Z',
    );
    await service.saveObservation(
      { id: repositoryId('repo-b'), displayName: 'repo-b' },
      '/b',
      '2026-07-23T10:00:00Z',
    );

    const all = await service.listAll();
    assert.equal(all.length, 2);
    assert.equal(all[0].id, 'repo-b', 'Most recently accessed first');
    assert.equal(all[1].id, 'repo-a');
  });
});

describe('UIPreferencesService: restart persistence', () => {
  let db: SqliteDatabaseAdapter;
  let dir: string;
  let dbPath: string;
  let service: UIPreferencesService;

  beforeEach(async () => {
    const result = await createDbWithSchema();
    db = result.db;
    dir = result.dir;
    dbPath = result.dbPath;
    service = new UIPreferencesService(new SqliteUIPreferencesRepository(db));
  });

  afterEach(async () => {
    await db.close();
    cleanupTempDir(dir);
  });

  it('saves and retrieves a preference value', async () => {
    await service.set('board-lane-order', JSON.stringify(['backlog', 'active', 'review', 'done']));
    const value = await service.get('board-lane-order');
    assert.ok(value);
    const lanes = JSON.parse(value);
    assert.equal(lanes.length, 4);
  });

  it('returns null for unknown preference key', async () => {
    const value = await service.get('nonexistent-key');
    assert.equal(value, null);
  });

  it('persists across simulated restart (close and reopen database)', async () => {
    // First "instance" saves a preference
    await service.set('theme', 'dark');
    await service.set('board-lane-order', JSON.stringify(['backlog', 'active']));
    await db.close();

    // Second "instance" opens the same database
    const db2 = new SqliteDatabaseAdapter();
    await db2.open({ path: dbPath });
    const service2 = new UIPreferencesService(new SqliteUIPreferencesRepository(db2));

    // Preferences must survive the restart
    const theme = await service2.get('theme');
    assert.equal(theme, 'dark', 'Preference must survive database reopen');

    const lanes = await service2.get('board-lane-order');
    assert.equal(lanes, JSON.stringify(['backlog', 'active']), 'Complex preference must survive');

    await db2.close();
  });

  it('getAll returns all stored preferences', async () => {
    await service.set('theme', 'dark');
    await service.set('font-size', '14');

    const all = await service.getAll();
    assert.equal(all.length, 2);
  });

  it('delete removes a preference', async () => {
    await service.set('theme', 'dark');
    await service.delete('theme');

    const value = await service.get('theme');
    assert.equal(value, null);
  });
});

describe('OperationalHistoryService: ordered events and failure handling', () => {
  let db: SqliteDatabaseAdapter;
  let dir: string;
  let service: OperationalHistoryService;

  beforeEach(async () => {
    const result = await createDbWithSchema();
    db = result.db;
    dir = result.dir;
    service = new OperationalHistoryService(new SqliteOperationalHistoryRepository(db));
  });

  afterEach(async () => {
    await db.close();
    cleanupTempDir(dir);
  });

  it('appends events and returns them in stored order', async () => {
    await service.append('migration-applied', JSON.stringify({ migration: '0001' }), '2026-07-23T10:00:00Z');
    await service.append('import-completed', JSON.stringify({ source: 'stats.csv' }), '2026-07-23T10:01:00Z');
    await service.append('adapter-initialized', JSON.stringify({ adapter: 'sqlite' }), '2026-07-23T10:02:00Z');

    const all = await service.loadAll();
    assert.equal(all.length, 3);
    assert.equal(all[0].eventType, 'migration-applied');
    assert.equal(all[1].eventType, 'import-completed');
    assert.equal(all[2].eventType, 'adapter-initialized');
  });

  it('loadByType filters by event type', async () => {
    await service.append('migration-applied', JSON.stringify({ migration: '0001' }), '2026-07-23T10:00:00Z');
    await service.append('import-completed', JSON.stringify({ source: 'stats.csv' }), '2026-07-23T10:01:00Z');
    await service.append('migration-applied', JSON.stringify({ migration: '0002' }), '2026-07-23T10:02:00Z');

    const migrations = await service.loadByType('migration-applied');
    assert.equal(migrations.length, 2);
    assert.equal(migrations[0].eventType, 'migration-applied');
    assert.equal(migrations[1].eventType, 'migration-applied');
  });

  it('returns empty array when no events exist', async () => {
    const all = await service.loadAll();
    assert.equal(all.length, 0);
  });

  it('propagates database failure as an error (not empty)', async () => {
    // Use a failing mock repository
    const failingRepo = createFailingRepository(
      new SqliteOperationalHistoryRepository(db),
      'findAll',
    );
    const failingService = new OperationalHistoryService(failingRepo);

    let errorCaught = false;
    try {
      await failingService.loadAll();
    } catch (err) {
      errorCaught = true;
      assert.ok((err as Error).message.includes('database failure'), 'Error must indicate database failure');
    }
    assert.ok(errorCaught, 'Database failure must propagate to caller');
  });

  it('append propagates database failure as an error', async () => {
    const failingRepo = createFailingRepository(
      new SqliteOperationalHistoryRepository(db),
      'append',
    );
    const failingService = new OperationalHistoryService(failingRepo);

    let errorCaught = false;
    try {
      await failingService.append('test-event', '{}');
    } catch (err) {
      errorCaught = true;
      assert.ok((err as Error).message.includes('database failure'), 'Error must indicate database failure');
    }
    assert.ok(errorCaught, 'Database failure on append must propagate to caller');
  });
});

describe('AgentBlockService: blocked agent projection', () => {
  let db: SqliteDatabaseAdapter;
  let dir: string;
  let service: AgentBlockService;

  beforeEach(async () => {
    const result = await createDbWithSchema();
    db = result.db;
    dir = result.dir;
    service = new AgentBlockService(new SqliteBlocklistRepository(db));
  });

  afterEach(async () => {
    await db.close();
    cleanupTempDir(dir);
  });

  it('reports agent as eligible when no block exists', async () => {
    const state = await service.query('codex');
    assert.equal(state.eligible, true);
    assert.equal(state.blocked, false);
  });

  it('reports agent as blocked when indefinite block exists', async () => {
    await service.block('claude', '', 'maintenance window');
    const state = await service.query('claude');
    assert.equal(state.blocked, true);
    assert.equal(state.eligible, false);
    assert.equal(state.reason, 'maintenance window');
  });

  it('reports agent as eligible when time-bound block has expired', async () => {
    // Block until a time in the past
    const pastTime = new Date(Date.now() - 3600_000).toISOString().replace('T', ' ').slice(0, 16);
    await service.block('codex', pastTime, 'temporary limit');
    const state = await service.query('codex');
    assert.equal(state.blocked, false, 'Expired block must not block the agent');
    assert.equal(state.eligible, true, 'Expired block must allow agent eligibility');
  });

  it('queryAll returns states for multiple agents', async () => {
    await service.block('claude', '', 'maintenance');
    const states = await service.queryAll(['claude', 'codex', 'opencode']);
    assert.equal(states.length, 3);
    assert.equal(states[0].agent, 'claude');
    assert.equal(states[0].blocked, true);
    assert.equal(states[1].agent, 'codex');
    assert.equal(states[1].blocked, false);
  });

  it('unblock removes the block entry', async () => {
    await service.block('claude', '', 'maintenance');
    await service.unblock('claude');
    const state = await service.query('claude');
    assert.equal(state.blocked, false);
    assert.equal(state.eligible, true);
  });
});

describe('Database failure: explicit unavailable result', () => {
  let db: SqliteDatabaseAdapter;
  let dir: string;

  beforeEach(async () => {
    const result = await createDbWithSchema();
    db = result.db;
    dir = result.dir;
  });

  afterEach(async () => {
    await db.close();
    cleanupTempDir(dir);
  });

  it('KnownRepositoryService propagates database error on loadObservation', async () => {
    const failingRepo = createFailingRepository(
      new SqliteKnownRepositoriesRepository(db),
      'findById',
    );
    const service = new KnownRepositoryService(failingRepo);

    let errorCaught = false;
    try {
      await service.loadObservation(repositoryId('test'));
    } catch (err) {
      errorCaught = true;
      assert.ok((err as Error).message.includes('database failure'));
    }
    assert.ok(errorCaught, 'Database failure must propagate for loadObservation');
  });

  it('UIPreferencesService propagates database error on get', async () => {
    const failingRepo = createFailingRepository(
      new SqliteUIPreferencesRepository(db),
      'findByKey',
    );
    const service = new UIPreferencesService(failingRepo);

    let errorCaught = false;
    try {
      await service.get('theme');
    } catch (err) {
      errorCaught = true;
      assert.ok((err as Error).message.includes('database failure'));
    }
    assert.ok(errorCaught, 'Database failure must propagate for preference get');
  });

  it('AgentBlockService propagates database error on query', async () => {
    const failingRepo = createFailingRepository(
      new SqliteBlocklistRepository(db),
      'findByAgent',
    );
    const service = new AgentBlockService(failingRepo);

    let errorCaught = false;
    try {
      await service.query('codex');
    } catch (err) {
      errorCaught = true;
      assert.ok((err as Error).message.includes('database failure'));
    }
    assert.ok(errorCaught, 'Database failure must propagate for agent query');
  });
});
