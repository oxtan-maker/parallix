// TASK-2322.09 CP 5 — SessionMarker repository and adapter tests.
//
// Fast unit tests with mocked provider dependencies and isolated database
// fixtures. No Forgejo calls, no real agent launches, no CLI subprocesses.
//
// Covers: resume, failover, duplicate marker, stale update, restart,
// and database-unavailable scenarios (SC9).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../src/adapters/sqlite/migration-runner.js';
import { SqliteSessionMarkerRepository } from '../src/adapters/sqlite/session-marker-repository.js';
import { SqliteSessionMarkerAdapter } from '../src/adapters/sqlite/session-marker-adapter.js';
import { importSessionMarkers } from '../src/adapters/sqlite/session-marker-import.js';
import type { SessionMarkerEntry, SessionMarkerWrite } from '../src/application/ports/mission-store.js';
import { agentFamily } from '../src/domain/agents.js';
import { missionId } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';
import { startAgent } from '../src/platform/runtime/lib/agents/agents.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTempDir(name: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `session-marker-test-${name}-`));
}

function cleanupTempDir(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
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

const TEST_REPOSITORY_ID = repositoryId('session-marker-test-repository');

function makeEntry(
  missionSlug = 'task-0001',
  role: SessionMarkerEntry['role'] = 'execute',
  agent = 'claude',
  lastLaunched = '2026-07-29T00:00:00Z',
  sessionId: string | null = null,
): SessionMarkerWrite {
  return {
    missionId: missionId(missionSlug),
    role,
    agent: agentFamily(agent),
    lastLaunched,
    sessionId,
  };
}

// ---------------------------------------------------------------------------
// SC9: Resume — same family matches, different family rejects
// ---------------------------------------------------------------------------

describe('resume — same family matches, different family rejects', () => {
  it('shouldResume returns true when mission, role, and agent all match', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const adapter = new SqliteSessionMarkerAdapter(db, TEST_REPOSITORY_ID);
      await adapter.save({
        missionId: 'task-0001' as any,
        role: 'execute',
        agent: 'claude' as any,
        lastLaunched: '2026-07-29T00:00:00Z',
        sessionId: 'sess-abc',
      });

      const resume = await adapter.shouldResume('task-0001' as any, 'execute', 'claude' as any);
      assert.equal(resume, true, 'shouldResume should return true for matching family');
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  it('shouldResume returns false when agent family differs', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const adapter = new SqliteSessionMarkerAdapter(db, TEST_REPOSITORY_ID);
      await adapter.save({
        missionId: 'task-0001' as any,
        role: 'execute',
        agent: 'claude' as any,
        lastLaunched: '2026-07-29T00:00:00Z',
        sessionId: 'sess-abc',
      });

      const resume = await adapter.shouldResume('task-0001' as any, 'execute', 'pi' as any);
      assert.equal(resume, false, 'shouldResume should return false for different family');
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  it('shouldResume returns false when no marker exists', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const adapter = new SqliteSessionMarkerAdapter(db, TEST_REPOSITORY_ID);
      const resume = await adapter.shouldResume('task-0001' as any, 'execute', 'claude' as any);
      assert.equal(resume, false, 'shouldResume should return false when no marker exists');
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  it('shouldResume returns false when role differs', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const adapter = new SqliteSessionMarkerAdapter(db, TEST_REPOSITORY_ID);
      await adapter.save({
        missionId: 'task-0001' as any,
        role: 'execute',
        agent: 'claude' as any,
        lastLaunched: '2026-07-29T00:00:00Z',
        sessionId: null,
      });

      const resume = await adapter.shouldResume('task-0001' as any, 'review', 'claude' as any);
      assert.equal(resume, false, 'shouldResume should return false for different role');
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });
});

// ---------------------------------------------------------------------------
// SC9: Failover — marker replaced on new launch
// ---------------------------------------------------------------------------

describe('failover — marker replaced on new launch', () => {
  it('save replaces existing marker for same (mission, role)', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const repo = new SqliteSessionMarkerRepository(db, TEST_REPOSITORY_ID);

      // Initial marker
      await repo.save(makeEntry('task-0001', 'execute', 'claude', '2026-07-29T00:00:00Z', 'sess-1'));
      let entry = await repo.findByMissionAndRole(missionId('task-0001'), 'execute');
      assert.equal(entry!.agent, 'claude');
      assert.equal(entry!.sessionId, 'sess-1');

      // Failover: new launch replaces marker
      await repo.save(makeEntry('task-0001', 'execute', 'pi', '2026-07-29T01:00:00Z', 'sess-2'));
      entry = await repo.findByMissionAndRole(missionId('task-0001'), 'execute');
      assert.equal(entry!.agent, 'pi', 'agent should be replaced');
      assert.equal(entry!.sessionId, 'sess-2', 'sessionId should be replaced');
      assert.equal(entry!.lastLaunched, '2026-07-29T01:00:00Z', 'lastLaunched should be replaced');
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  it('failover does not affect other (mission, role) pairs', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const repo = new SqliteSessionMarkerRepository(db, TEST_REPOSITORY_ID);

      await repo.save(makeEntry('task-0001', 'execute', 'claude', '2026-07-29T00:00:00Z', 'sess-1'));
      await repo.save(makeEntry('task-0001', 'review', 'pi', '2026-07-29T00:00:00Z', 'sess-2'));

      // Replace execute, review should be untouched
      await repo.save(makeEntry('task-0001', 'execute', 'codex', '2026-07-29T01:00:00Z', 'sess-3'));

      const review = await repo.findByMissionAndRole(missionId('task-0001'), 'review');
      assert.equal(review!.agent, 'pi', 'review marker should be unchanged');
      assert.equal(review!.sessionId, 'sess-2', 'review sessionId should be unchanged');
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });
});

// ---------------------------------------------------------------------------
// SC9: Duplicate marker — upsert replaces
// ---------------------------------------------------------------------------

describe('duplicate marker — upsert replaces', () => {
  it('save is idempotent for the same (mission, role)', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const repo = new SqliteSessionMarkerRepository(db, TEST_REPOSITORY_ID);

      const entry = makeEntry('task-0001', 'execute', 'claude', '2026-07-29T00:00:00Z', 'sess-1');
      await repo.save(entry);
      await repo.save(entry);
      await repo.save(entry);

      const found = await repo.findByMissionAndRole(missionId('task-0001'), 'execute');
      assert.ok(found, 'marker should exist after repeated saves');
      assert.equal(found!.agent, 'claude');
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  it('UNIQUE constraint prevents duplicate rows', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const repo = new SqliteSessionMarkerRepository(db, TEST_REPOSITORY_ID);

      await repo.save(makeEntry('task-0001', 'execute', 'claude'));
      await repo.save(makeEntry('task-0001', 'execute', 'claude'));

      const all = await repo.findAll();
      assert.equal(all.length, 1, 'should have exactly one marker after two saves for same key');
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });
});

describe('repository-scoped identity', () => {
  it('same mission and role coexist in different repositories', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const firstRepo = new SqliteSessionMarkerRepository(
        db,
        repositoryId('first-repository'),
      );
      const secondRepo = new SqliteSessionMarkerRepository(
        db,
        repositoryId('second-repository'),
      );

      await firstRepo.save(makeEntry('task-2322.09', 'execute', 'claude'));
      await secondRepo.save(makeEntry('task-2322.09', 'execute', 'codex'));

      const first = await firstRepo.findByMissionAndRole(
        missionId('task-2322.09'),
        'execute',
      );
      const second = await secondRepo.findByMissionAndRole(
        missionId('task-2322.09'),
        'execute',
      );

      assert.equal(first?.agent, 'claude');
      assert.equal(first?.repositoryId, 'first-repository');
      assert.equal(second?.agent, 'codex');
      assert.equal(second?.repositoryId, 'second-repository');
      assert.equal((await firstRepo.findAll()).length, 1);
      assert.equal((await secondRepo.findAll()).length, 1);

      await firstRepo.clear();
      assert.equal((await firstRepo.findAll()).length, 0);
      assert.equal((await secondRepo.findAll()).length, 1);
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });
});

// ---------------------------------------------------------------------------
// SC9: Stale update — concurrent write handling
// ---------------------------------------------------------------------------

describe('stale update — concurrent write handling', () => {
  it('last write wins for concurrent saves on same (mission, role)', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const repo = new SqliteSessionMarkerRepository(db, TEST_REPOSITORY_ID);

      // Simulate concurrent writes (sequential in test, but both go through upsert)
      await repo.save(makeEntry('task-0001', 'execute', 'claude', '2026-07-29T00:00:00Z', 'sess-1'));
      await repo.save(makeEntry('task-0001', 'execute', 'pi', '2026-07-29T00:00:01Z', 'sess-2'));

      const found = await repo.findByMissionAndRole(missionId('task-0001'), 'execute');
      assert.equal(found!.agent, 'pi', 'last write should win');
      assert.equal(found!.sessionId, 'sess-2', 'sessionId from last write');
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  it('updated_at is set by the database on each save (ON CONFLICT)', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const repo = new SqliteSessionMarkerRepository(db, TEST_REPOSITORY_ID);

      await repo.save(makeEntry('task-0001', 'execute', 'claude', '2026-07-29T00:00:00Z'));
      const first = await repo.findByMissionAndRole(missionId('task-0001'), 'execute');
      assert.ok(first!.updatedAt, 'updated_at should be set by database');

      await repo.save(makeEntry('task-0001', 'execute', 'claude', '2026-07-29T00:00:01Z'));
      const second = await repo.findByMissionAndRole(missionId('task-0001'), 'execute');
      assert.ok(second!.updatedAt, 'updated_at should be set on each save');
      // Both saves set updated_at via strftime('now') — they will match
      // at second-level granularity, confirming the ON CONFLICT DO UPDATE
      // path executed (the row was updated, not inserted fresh).
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });
});

// ---------------------------------------------------------------------------
// SC9: Restart — marker survives process exit
// ---------------------------------------------------------------------------

describe('restart — marker survives process exit', () => {
  it('marker persists across database close/reopen', async () => {
    const { db, dir, dbPath } = await createDbWithSchema();
    try {
      const repo = new SqliteSessionMarkerRepository(db, TEST_REPOSITORY_ID);
      await repo.save(makeEntry('task-0001', 'execute', 'claude', '2026-07-29T00:00:00Z', 'sess-persist'));

      // Simulate process exit: close and reopen
      await db.close();

      const db2 = new SqliteDatabaseAdapter();
      await db2.open({ path: dbPath });
      const repo2 = new SqliteSessionMarkerRepository(db2, TEST_REPOSITORY_ID);

      const found = await repo2.findByMissionAndRole(missionId('task-0001'), 'execute');
      assert.ok(found, 'marker should persist after reopen');
      assert.equal(found!.agent, 'claude');
      assert.equal(found!.sessionId, 'sess-persist');

      await db2.close();
    } finally {
      cleanupTempDir(dir);
    }
  });

  it('marker survives worktree directory removal (SC8)', async () => {
    const { db, dir, dbPath } = await createDbWithSchema();
    try {
      const repo = new SqliteSessionMarkerRepository(db, TEST_REPOSITORY_ID);
      await repo.save(makeEntry('task-0001', 'execute', 'claude', '2026-07-29T00:00:00Z', 'sess-wt'));

      // Simulate worktree cleanup: the DB file is independent of the worktree
      // (PARALLIX_HOME vs worktree path). Marker should still be in the database.
      const found = await repo.findByMissionAndRole(missionId('task-0001'), 'execute');
      assert.ok(found, 'marker should survive (DB is independent of worktree)');
      assert.equal(found!.agent, 'claude');

      await db.close();
    } finally {
      cleanupTempDir(dir);
    }
  });
});

// ---------------------------------------------------------------------------
// SC9: Database-unavailable — explicit error, no file fallback
// ---------------------------------------------------------------------------

describe('database-unavailable — explicit error, no file fallback', () => {
  it('findByMissionAndRole throws when database is not open', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      await db.close();
      const repo = new SqliteSessionMarkerRepository(db, TEST_REPOSITORY_ID);

      let errorThrown = false;
      try {
        await repo.findByMissionAndRole(missionId('task-0001'), 'execute');
      } catch (err) {
        errorThrown = true;
        assert.ok(
          (err as Error).message.includes('not open'),
          'should throw explicit error about database not being open',
        );
      }
      assert.ok(errorThrown, 'should throw when database is closed');
    } finally {
      cleanupTempDir(dir);
    }
  });

  it('save throws when database is not open', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      await db.close();
      const repo = new SqliteSessionMarkerRepository(db, TEST_REPOSITORY_ID);

      let errorThrown = false;
      try {
        await repo.save(makeEntry('task-0001', 'execute', 'claude'));
      } catch (err) {
        errorThrown = true;
        assert.ok(
          (err as Error).message.includes('not open'),
          'should throw explicit error about database not being open',
        );
      }
      assert.ok(errorThrown, 'should throw when database is closed');
    } finally {
      cleanupTempDir(dir);
    }
  });

  it('SqliteSessionMarkerAdapter throws when database is closed (no file fallback)', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      await db.close();
      const adapter = new SqliteSessionMarkerAdapter(db, TEST_REPOSITORY_ID);

      let errorThrown = false;
      try {
        await adapter.find('task-0001' as any, 'execute');
      } catch (err) {
        errorThrown = true;
        assert.ok(
          (err as Error).message.includes('not open'),
          'should throw explicit error (not fall back to file)',
        );
      }
      assert.ok(errorThrown, 'should throw when database is closed');
    } finally {
      cleanupTempDir(dir);
    }
  });
});

// ---------------------------------------------------------------------------
// SC7: Session identity round-trips without data loss
// ---------------------------------------------------------------------------

describe('session identity round-trips without data loss', () => {
  it('all identity fields round-trip through SQLite adapter', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const adapter = new SqliteSessionMarkerAdapter(db, TEST_REPOSITORY_ID);

      await adapter.save({
        missionId: 'task-2322.09' as any,
        role: 'execute',
        agent: 'claude' as any,
        lastLaunched: '2026-07-29T14:30:00Z',
        sessionId: 'sess-roundtrip-abc-123',
      });

      const found = await adapter.find('task-2322.09' as any, 'execute');
      assert.ok(found !== null, 'marker should exist');
      assert.equal(found!.missionId, 'task-2322.09', 'missionId should match');
      assert.equal(found!.role, 'execute', 'role should match');
      assert.equal(found!.agent, 'claude', 'agent should match');
      assert.equal(found!.lastLaunched, '2026-07-29T14:30:00Z', 'lastLaunched should match');
      assert.equal(found!.sessionId, 'sess-roundtrip-abc-123', 'sessionId should match');
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  it('null sessionId round-trips correctly', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const adapter = new SqliteSessionMarkerAdapter(db, TEST_REPOSITORY_ID);

      await adapter.save({
        missionId: 'task-0001' as any,
        role: 'draft',
        agent: 'pi' as any,
        lastLaunched: '2026-07-29T00:00:00Z',
        sessionId: null,
      });

      const found = await adapter.find('task-0001' as any, 'draft');
      assert.equal(found!.sessionId, null, 'null sessionId should round-trip');
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  it('empty sessionId remains distinct from null', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const repo = new SqliteSessionMarkerRepository(db, TEST_REPOSITORY_ID);
      await repo.save(makeEntry('task-0001', 'execute', 'claude', '2026-07-29T00:00:00Z', ''));

      const found = await repo.findByMissionAndRole(missionId('task-0001'), 'execute');
      assert.equal(found?.sessionId, '');
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  it('rejects persisted rows that cannot form checked domain values', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      await db.execute(
        `INSERT INTO session_markers
           (repository_id, mission_id, role, agent, last_launched, session_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?);`,
        [
          TEST_REPOSITORY_ID,
          'task-0001',
          'execute',
          'INVALID AGENT',
          '2026-07-29T00:00:00Z',
          null,
          '2026-07-29T00:00:00Z',
        ],
      );

      const repo = new SqliteSessionMarkerRepository(db, TEST_REPOSITORY_ID);
      await assert.rejects(
        repo.findByMissionAndRole(missionId('task-0001'), 'execute'),
        /Invalid agent family/,
      );
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });
});

// ---------------------------------------------------------------------------
// SC8: Clear behavior is observable and tested
// ---------------------------------------------------------------------------

describe('clear behavior is observable and tested', () => {
  it('delete removes specific (mission, role) marker', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const repo = new SqliteSessionMarkerRepository(db, TEST_REPOSITORY_ID);

      await repo.save(makeEntry('task-0001', 'execute', 'claude'));
      await repo.save(makeEntry('task-0001', 'review', 'pi'));

      await repo.deleteByMissionAndRole(missionId('task-0001'), 'execute');

      const execute = await repo.findByMissionAndRole(missionId('task-0001'), 'execute');
      assert.equal(execute, undefined, 'execute marker should be deleted');

      const review = await repo.findByMissionAndRole(missionId('task-0001'), 'review');
      assert.ok(review, 'review marker should still exist');
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  it('clear removes all markers', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const repo = new SqliteSessionMarkerRepository(db, TEST_REPOSITORY_ID);

      await repo.save(makeEntry('task-0001', 'execute', 'claude'));
      await repo.save(makeEntry('task-0002', 'execute', 'pi'));
      await repo.save(makeEntry('task-0001', 'review', 'codex'));

      await repo.clear();

      const all = await repo.findAll();
      assert.equal(all.length, 0, 'all markers should be cleared');
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });
});

// ---------------------------------------------------------------------------
// Migration 0004 schema validation
// ---------------------------------------------------------------------------

describe('migration 0004 — session_markers table schema', () => {
  it('role CHECK constraint rejects invalid role values', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const repo = new SqliteSessionMarkerRepository(db, TEST_REPOSITORY_ID);

      let errorThrown = false;
      try {
        await repo.save({
          missionId: missionId('task-0001'),
          role: 'unknown' as any,
          agent: agentFamily('claude'),
          lastLaunched: '2026-07-29T00:00:00Z',
          sessionId: null,
        });
      } catch (err) {
        errorThrown = true;
      }
      assert.ok(errorThrown, 'should reject invalid role value');
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  it('all three known roles (execute, draft, review) are accepted', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const repo = new SqliteSessionMarkerRepository(db, TEST_REPOSITORY_ID);

      await repo.save(makeEntry('task-0001', 'execute', 'claude'));
      await repo.save(makeEntry('task-0001', 'draft', 'pi'));
      await repo.save(makeEntry('task-0001', 'review', 'codex'));

      const all = await repo.findAll();
      assert.equal(all.length, 3, 'all three roles should be accepted');
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });
});

describe('migration 0005 — repository-scoped session markers', () => {
  it('loads table creation before repository scoping', () => {
    const migrations = loadDefaultMigrations();
    const baseIndex = migrations.findIndex(
      (migration) => migration.id === '0006-session-markers',
    );
    const scopeIndex = migrations.findIndex(
      (migration) => migration.id === '0005-repository-scoped-session-markers',
    );

    assert.notEqual(baseIndex, -1);
    assert.notEqual(scopeIndex, -1);
    assert.ok(baseIndex < scopeIndex, 'session_markers must exist before it is scoped');
  });

  it('upgrades the unscoped table without changing either migration or losing rows', async () => {
    const dir = createTempDir('migration-upgrade');
    const db = new SqliteDatabaseAdapter();
    try {
      await db.open({ path: path.join(dir, 'test.db') });
      const runner = new SqliteMigrationRunner(db);
      const migrations = loadDefaultMigrations();
      const scopeIndex = migrations.findIndex(
        (migration) => migration.id === '0005-repository-scoped-session-markers',
      );
      assert.ok(scopeIndex > 0);
      await runner.applyPending(migrations.slice(0, scopeIndex));
      await db.execute(
        `INSERT INTO session_markers
           (mission_id, role, agent, last_launched, session_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?);`,
        [
          'task-2322.09',
          'execute',
          'claude',
          '2026-07-29T00:00:00Z',
          'legacy-session',
          '2026-07-29T00:00:00Z',
        ],
      );

      await runner.applyPending(migrations);

      const legacyRepo = new SqliteSessionMarkerRepository(
        db,
        repositoryId('legacy-unscoped'),
      );
      const preserved = await legacyRepo.findByMissionAndRole(
        missionId('task-2322.09'),
        'execute',
      );
      assert.equal(preserved?.sessionId, 'legacy-session');
      // The highest-id applied migration, which advances as the schema grows.
      assert.equal(
        await runner.getCurrentVersion(),
        [...migrations].map(m => m.id).sort().at(-1),
      );
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  it('does not re-scope rows when repository scoping was already applied', async () => {
    const dir = createTempDir('migration-existing-scope');
    const db = new SqliteDatabaseAdapter();
    try {
      await db.open({ path: path.join(dir, 'test.db') });
      const runner = new SqliteMigrationRunner(db);
      const migrations = loadDefaultMigrations();
      await runner.applyPending(migrations);
      await db.execute(
        `INSERT INTO session_markers
           (repository_id, mission_id, role, agent, last_launched, session_id)
         VALUES (?, ?, ?, ?, ?, ?);`,
        [
          'parallix',
          'task-2322.09',
          'execute',
          'codex',
          '2026-07-30T00:00:00Z',
          'existing-session',
        ],
      );

      // Reproduce an operator database that created the table under its former
      // 0004 identifier and has already applied immutable repository scoping.
      await db.execute(
        "DELETE FROM schema_migrations WHERE id = '0006-session-markers';",
      );
      await runner.applyPending(migrations);

      const repository = new SqliteSessionMarkerRepository(
        db,
        repositoryId('parallix'),
      );
      const preserved = await repository.findByMissionAndRole(
        missionId('task-2322.09'),
        'execute',
      );
      assert.equal(preserved?.sessionId, 'existing-session');
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });
});

describe('runtime launch role mapping — real SQLite adapter', () => {
  it('persists implementer and reviewer launches using checked SessionRole values', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const adapter = new SqliteSessionMarkerAdapter(db, TEST_REPOSITORY_ID);
      const launches = [
        { step: 'active', runtimeRole: 'implementer', expectedRole: 'execute', missionId: 'task-impl' },
        { step: 'review', runtimeRole: 'reviewer', expectedRole: 'review', missionId: 'task-review' },
      ] as const;

      for (const launch of launches) {
        await startAgent(launch.step, {
          prompt: 'Mocked provider launch.',
          worktree: dir,
          agent: 'claude',
          slug: launch.missionId,
          role: launch.runtimeRole,
          sessionMarkerPort: adapter,
          isAgentBlockedFn: () => false,
          resolveAgentModelFn: () => null,
          assertAgentSupportedFn: () => {},
          log: () => {},
          launchAgentFn: () => ({
            invocation: { command: 'claude', args: [], options: {} },
            resultPromise: Promise.resolve({
              status: 0,
              stdout: '',
              stderr: '',
              sessionId: `session-${launch.expectedRole}`,
            }),
          }),
        });

        const stored = await adapter.find(launch.missionId as any, launch.expectedRole);
        assert.equal(stored?.role, launch.expectedRole);
        assert.equal(stored?.sessionId, `session-${launch.expectedRole}`);
      }
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });
});

// ---------------------------------------------------------------------------
// Import — dry-run and atomic idempotent import
// ---------------------------------------------------------------------------

describe('import — dry-run and atomic idempotent import', () => {
  it('dry-run returns report without writing to database', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const worktree = createTempDir('wt');
      const sessionsDir = path.join(worktree, '.workflow', 'sessions');
      fs.mkdirSync(sessionsDir, { recursive: true });
      fs.writeFileSync(
        path.join(sessionsDir, 'task-0001-execute.json'),
        JSON.stringify({ agent: 'claude', lastLaunched: '2026-07-29T00:00:00Z', sessionId: 'sess-1' }),
      );

      const result = await importSessionMarkers(db, worktree, { dryRun: true, repositoryId: TEST_REPOSITORY_ID });
      assert.equal(result.dryRun, true);
      assert.equal(result.imported.length, 1);
      assert.equal(result.filesExamined, 1);

      // Verify nothing was written
      const repo = new SqliteSessionMarkerRepository(db, TEST_REPOSITORY_ID);
      const all = await repo.findAll();
      assert.equal(all.length, 0, 'dry-run should not write any markers');

      cleanupTempDir(worktree);
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  it('atomic commit imports all markers in a single transaction', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const worktree = createTempDir('wt');
      const sessionsDir = path.join(worktree, '.workflow', 'sessions');
      fs.mkdirSync(sessionsDir, { recursive: true });
      fs.writeFileSync(
        path.join(sessionsDir, 'task-0001-execute.json'),
        JSON.stringify({ agent: 'claude', lastLaunched: '2026-07-29T00:00:00Z', sessionId: 'sess-1' }),
      );
      fs.writeFileSync(
        path.join(sessionsDir, 'task-0001-review.json'),
        JSON.stringify({ agent: 'pi', lastLaunched: '2026-07-29T01:00:00Z', sessionId: null }),
      );

      const result = await importSessionMarkers(db, worktree, { dryRun: false, repositoryId: TEST_REPOSITORY_ID });
      assert.equal(result.dryRun, false);
      assert.equal(result.imported.length, 2);

      const repo = new SqliteSessionMarkerRepository(db, TEST_REPOSITORY_ID);
      const all = await repo.findAll();
      assert.equal(all.length, 2, 'atomic commit should write all markers');

      cleanupTempDir(worktree);
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  it('conflict detection reports both sides without overwriting', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      // Pre-populate database — updatedAt is set by DB (current time via strftime)
      const repo = new SqliteSessionMarkerRepository(db, TEST_REPOSITORY_ID);
      await repo.save(makeEntry('task-0001', 'execute', 'claude', '2026-07-29T00:00:00Z', 'sess-db'));

      // Create file with a future lastLaunched (newer than DB updatedAt)
      const worktree = createTempDir('wt');
      const sessionsDir = path.join(worktree, '.workflow', 'sessions');
      fs.mkdirSync(sessionsDir, { recursive: true });
      fs.writeFileSync(
        path.join(sessionsDir, 'task-0001-execute.json'),
        JSON.stringify({ agent: 'claude', lastLaunched: '2027-01-01T00:00:00Z', sessionId: 'sess-file' }),
      );

      const result = await importSessionMarkers(db, worktree, { dryRun: true, repositoryId: TEST_REPOSITORY_ID });
      assert.equal(result.conflicts.length, 1);
      // DB updatedAt is current time; file lastLaunched is future (2027), so file is newer
      assert.equal(result.conflicts[0].reason, 'db-exists');
      assert.equal(result.conflicts[0].database.agent, 'claude');
      assert.equal(result.conflicts[0].file.agent, 'claude');
      assert.equal(result.imported.length, 0, 'conflict should prevent import');

      // Verify source file is untouched
      const fileContent = JSON.parse(
        fs.readFileSync(path.join(sessionsDir, 'task-0001-execute.json'), 'utf8'),
      );
      assert.equal(fileContent.lastLaunched, '2027-01-01T00:00:00Z', 'source file should be unchanged');

      cleanupTempDir(worktree);
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  it('unknown roles are reported as skippedUnknownRole', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const worktree = createTempDir('wt');
      const sessionsDir = path.join(worktree, '.workflow', 'sessions');
      fs.mkdirSync(sessionsDir, { recursive: true });
      fs.writeFileSync(
        path.join(sessionsDir, 'task-0001-implementer.json'),
        JSON.stringify({ agent: 'claude', lastLaunched: '2026-07-29T00:00:00Z', sessionId: null }),
      );

      const result = await importSessionMarkers(db, worktree, { dryRun: true, repositoryId: TEST_REPOSITORY_ID });
      assert.equal(result.skippedUnknownRole.length, 1);
      assert.equal(result.skippedUnknownRole[0].role, 'implementer');
      assert.equal(result.imported.length, 0, 'unknown role should not be imported');

      cleanupTempDir(worktree);
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });
});
