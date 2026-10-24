import type { AgentConfig } from '../../../src/adapters/agents/agent-config.js';
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { SqliteDatabaseAdapter } from '../../../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../../../src/adapters/sqlite/migration-runner.js';
import { SqliteBlocklistRepository } from '../../../src/adapters/sqlite/blocklist-repository.js';
import { materializeBlocklistSnapshot } from '../../../src/adapters/sqlite/blocklist-snapshot.js';

// The REAL production consumers — the same functions `px active` selection runs
// through. These must stay synchronous while honoring the SQLite-materialized
// blocklist overlay.
import { eligibleAgentsForStep } from '../../../src/adapters/agents/launcher-selection.js';
import { createExecuteMissionPorts, type ExecuteMissionRuntime } from '../../../src/adapters/mission/execute-mission-adapters.js';
import type { MissionTransitionStore } from '../../../src/application/domain-ports.js';
import { AgentBlockService } from '../../../src/application/services/agent-block-service.js';

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

const activeStepConfig = (blocklist: AgentConfig['blocklist']): AgentConfig => ({
  steps: { active: { eligible: ['codex', 'claude', 'vibe', 'custom'] } },
  blocklist,
});

const FAMILIES = ['codex', 'claude', 'vibe', 'qwen'];

/** The production execute selection consumer over a once-materialized SQLite snapshot. */
function executeSelection(overlay: ReturnType<typeof materializeBlocklistSnapshot>, config: AgentConfig = {}) {
  const runtime = { readAgentConfig: () => ({ steps: { active: { eligible: FAMILIES } }, ...config }) } as unknown as ExecuteMissionRuntime;
  return createExecuteMissionPorts('/repo', { missionTransitionStore: {} as MissionTransitionStore, operatorBlocklist: overlay }, runtime).agentExecution;
}

/** Service and execute-selection eligibility at the controlled current instant. */
async function decisionsNow(repo: SqliteBlocklistRepository, selection: ReturnType<typeof executeSelection>) {
  const service = await new AgentBlockService(repo).queryAll(FAMILIES, Date.now());
  const selected = await Promise.all(FAMILIES.map((family) => selection.eligible(family)));
  return { service: service.map(({ eligible }) => eligible), selected };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SQLite operator-state transaction contract (CP3)', () => {
  // --- The async boundary is the composition-root materialization only ---

  it('materializes the operator blocklist from SQLite via a single async read', async () => {
    const { db, dir } = await createDbWithSchema();
    try {
      await new SqliteBlocklistRepository(db).save({ agent: 'Codex', blocked: true, reason: 'maintenance' });
      await new SqliteBlocklistRepository(db).save({ agent: 'vibe', blocked: false, until: '2099-01-01 00' });

      // The one and only await: read blocklist rows, then key them by family.
      const entries = await new SqliteBlocklistRepository(db).findAll();
      const overlay = materializeBlocklistSnapshot(entries);

      // Rows are kept unchanged; interpretation happens at each selection.
      assert.deepEqual(overlay, {
        codex: { agent: 'Codex', blocked: true, until: undefined, reason: 'maintenance' },
        vibe: { agent: 'vibe', blocked: false, until: '2099-01-01 00', reason: undefined },
      });
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

      const result = eligibleAgentsForStep('active', { config: activeStepConfig({}), runtimeBlocklist: overlay });

      // Proof of no async cascade: the hot-path consumer returns a plain array,
      // never a Promise, even though the data originated in async SQLite.
      assert.ok(!(result instanceof Promise), 'eligibleAgentsForStep must be synchronous');
      assert.ok(Array.isArray(result));
      assert.ok(!result.includes('codex'), 'SQLite-blocked codex must be excluded');
      assert.ok(result.includes('claude'), 'unblocked claude must remain eligible');
    } finally {
      await db.close();
      cleanupTempDir(dir);
    }
  });

  it('service and execute selection agree on hourly and ISO expiry as the clock advances past a once-materialized snapshot (TASK-2789)', async (t) => {
    const { db, dir } = await createDbWithSchema();
    t.after(async () => { mock.timers.reset(); await db.close(); cleanupTempDir(dir); });
    const repo = new SqliteBlocklistRepository(db);
    await repo.save({ agent: 'codex', blocked: true, until: '2030-01-01T05:30:15.250+02:00', reason: 'quota' });
    await repo.save({ agent: 'claude', blocked: true, until: '2030-01-01 06', reason: 'quota' });
    const isoExpiry = Date.UTC(2030, 0, 1, 3, 30, 15, 250);
    const hourlyExpiry = new Date(2030, 0, 1, 6).getTime();
    mock.timers.enable({ apis: ['Date'], now: Math.min(isoExpiry, hourlyExpiry) - 60_000 });
    const selection = executeSelection(materializeBlocklistSnapshot(await repo.findAll()));

    for (const [instant, codex, claude] of [
      [isoExpiry - 1, false, hourlyExpiry <= isoExpiry - 1], [isoExpiry, true, hourlyExpiry <= isoExpiry], [isoExpiry + 1, true, hourlyExpiry <= isoExpiry + 1],
      [hourlyExpiry - 1, isoExpiry <= hourlyExpiry - 1, false], [hourlyExpiry, isoExpiry <= hourlyExpiry, true], [hourlyExpiry + 3_600_000, true, true],
    ] as const) {
      mock.timers.setTime(instant);
      const { service, selected } = await decisionsNow(repo, selection);
      assert.deepEqual(selected, service, `execute selection must match the service at ${new Date(instant).toISOString()}`);
      assert.deepEqual(selected, [codex, claude, true, true], `eligibility at ${new Date(instant).toISOString()}`);
    }
  });

  it('service and execute selection agree on unblocked, indefinite and malformed persisted rows (TASK-2789)', async (t) => {
    const { db, dir } = await createDbWithSchema();
    t.after(async () => { await db.close(); cleanupTempDir(dir); });
    const repo = new SqliteBlocklistRepository(db);
    await repo.save({ agent: 'codex', blocked: false, until: '2099-01-01 00' });
    await repo.save({ agent: 'claude', blocked: true, reason: 'operator' });
    await repo.save({ agent: 'vibe', blocked: true, until: 'garbage:00', reason: 'quota' });

    const { service, selected } = await decisionsNow(repo, executeSelection(materializeBlocklistSnapshot(await repo.findAll())));
    assert.deepEqual(selected, service);
    assert.deepEqual(selected, [true, false, false, true], 'false rows and absent rows stay eligible; indefinite and malformed active rows stay blocked');
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
      path.resolve('src/adapters/agents/agent-config.ts'),
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
      path.resolve('src/adapters/agents/launcher-selection.ts'),
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
