import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../src/adapters/sqlite/migration-runner.js';
import { SqliteBlocklistRepository } from '../src/adapters/sqlite/blocklist-repository.js';
import { materializeBlocklistSnapshot } from '../src/adapters/sqlite/blocklist-snapshot.js';

// The REAL production consumers — the same functions `px active` selection runs
// through. These must stay synchronous while honoring the SQLite-materialized
// blocklist overlay.
import { eligibleAgentsForStep } from '../src/platform/runtime/lib/agents/launcher-selection.js';
import { isAgentBlocked } from '../src/platform/runtime/lib/agents/agent-config.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTempDir(name: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `parallix-sqlite-test-${name}-`));
}

function cleanupTempDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Best effort cleanup
  }
}

async function createDbWithSchema(): Promise<{ db: SqliteDatabaseAdapter; dir: string; dbPath: string }> {
  const dir = createTempDir('cascade');
  const dbPath = path.join(dir, 'test.db');
  const db = new SqliteDatabaseAdapter();
  await db.open({ path: dbPath });
  await new SqliteMigrationRunner(db).applyPending(loadDefaultMigrations());
  return { db, dir, dbPath };
}

const activeStepConfig = (blocklist: unknown) => ({
  steps: { active: { eligible: ['codex', 'claude', 'vibe', 'custom'] } },
  blocklist,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SQLite operator blocklist — CP3: real consumer wiring with no async cascade', () => {
  // --- The async boundary is the composition-root materialization only ---

  it('materializes the operator blocklist from SQLite via a single async read', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      await new SqliteBlocklistRepository(db).save({ agent: 'codex', blocked: true, reason: 'maintenance' });
      await new SqliteBlocklistRepository(db).save({ agent: 'vibe', blocked: false });

      // The one and only await: read blocklist rows, then map to a plain overlay.
      const entries = await new SqliteBlocklistRepository(db).findAll();
      const overlay = materializeBlocklistSnapshot(entries);

      assert.deepEqual(overlay.codex, { blocked: true, reason: 'maintenance' });
      // blocked=false, no `until` → not a block → omitted from the overlay.
      assert.equal(overlay.vibe, undefined);
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  // --- The consumer reads the overlay synchronously (no await, no Promise) ---

  it('the real selector consumes the SQLite blocklist synchronously and excludes blocked agents', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      await new SqliteBlocklistRepository(db).save({ agent: 'codex', blocked: true, reason: 'blocked by operator' });
      const overlay = materializeBlocklistSnapshot(await new SqliteBlocklistRepository(db).findAll());

      const result = eligibleAgentsForStep('active', { config: activeStepConfig(overlay) });

      // Proof of no async cascade: the hot-path consumer returns a plain array,
      // never a Promise, even though the data originated in async SQLite.
      assert.ok(!(result instanceof Promise), 'eligibleAgentsForStep must be synchronous');
      assert.ok(Array.isArray(result));
      assert.ok(!result.includes('codex'), 'SQLite-blocked codex must be excluded');
      assert.ok(result.includes('claude'), 'unblocked claude must remain eligible');

      // isAgentBlocked itself is synchronous (boolean return) and honors the overlay.
      const blocked: boolean = isAgentBlocked('codex', activeStepConfig(overlay));
      assert.equal(blocked, true);
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  it('time-based SQLite blocks apply and expire through the existing sync isAgentBlocked logic', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      const repo = new SqliteBlocklistRepository(db);
      await repo.save({ agent: 'codex', blocked: true, until: '2099-12-31 23', reason: 'future' });
      await repo.save({ agent: 'claude', blocked: true, until: '2000-01-01 00', reason: 'expired' });
      const overlay = materializeBlocklistSnapshot(await repo.findAll());

      assert.equal(isAgentBlocked('codex', activeStepConfig(overlay)), true, 'future until → blocked');
      assert.equal(isAgentBlocked('claude', activeStepConfig(overlay)), false, 'past until → not blocked');
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  // --- Rollback: without the overlay, the untouched file blocklist is authority ---

  it('with no SQLite overlay the selector falls back to the file-based config.blocklist', () => {
    // Simulates the adapter-disabled/rollback path: overlay is absent, so the
    // consumer reads the file config's own blocklist field unchanged.
    const fileConfig = activeStepConfig({ vibe: true });
    const result = eligibleAgentsForStep('active', { config: fileConfig });

    assert.ok(!result.includes('vibe'), 'file-blocked vibe excluded via untouched readers');
    assert.ok(result.includes('codex') && result.includes('claude'));
  });

  // --- Static proof: the real consumer modules declare zero async ---

  it('agent-config.ts consumer functions are not async', () => {
    const content = fs.readFileSync(
      path.resolve('src/platform/runtime/lib/agents/agent-config.ts'),
      'utf8',
    );
    for (const fn of ['readAgentConfig', 'isAgentBlocked', 'parseBlockUntil', 'readAgentConfigOrExit', 'parseAgentConfigFile']) {
      assert.ok(content.includes(`function ${fn}(`), `${fn} should exist`);
      assert.ok(!content.includes(`async function ${fn}(`), `${fn} must NOT be async`);
    }
    assert.equal((content.match(/async\s+function\s+\w+/g) ?? []).length, 0, 'agent-config.ts has no async functions');
  });

  it('launcher-selection.ts selection functions are not async', () => {
    const content = fs.readFileSync(
      path.resolve('src/platform/runtime/lib/agents/launcher-selection.ts'),
      'utf8',
    );
    for (const fn of ['selectAgent', 'eligibleAgentsForStep']) {
      assert.ok(content.includes(`function ${fn}(`), `${fn} should exist`);
      assert.ok(!content.includes(`async function ${fn}(`), `${fn} must NOT be async`);
    }
  });

  it('the blocklist materializer is a pure synchronous mapper (no async, no I/O imports)', () => {
    const content = fs.readFileSync(
      path.resolve('src/adapters/sqlite/blocklist-snapshot.ts'),
      'utf8',
    );
    assert.ok(content.includes('export function materializeBlocklistSnapshot('));
    assert.ok(!content.includes('async function materializeBlocklistSnapshot('));
    // The mapper must not reach for effectful modules.
    assert.ok(!/from ['"]node:sqlite['"]/.test(content), 'must not import node:sqlite');
    assert.ok(!/from ['"]node:fs['"]/.test(content), 'must not import node:fs');
  });
});
