import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { defaultIsAgentBlockedNow, updateAgentBlockChecked } from '../src/adapters/agents/agents.js';
import { clearOperatorStateCache } from '../src/adapters/sqlite/adapter-factory.js';
import { SqliteBlocklistRepository } from '../src/adapters/sqlite/blocklist-repository.js';
import { initOperatorState } from '../src/adapters/sqlite/adapter-factory.js';
import { ConcreteAgentReadAdapter } from '../src/adapters/backlog/concrete-agent-read-adapter.js';
import { agentFamily } from '../src/domain/agents.js';
import { resolveAgentBlockAuthority } from '../src/adapters/agents/agent-block-authority.js';

test('block persisted via updateAgentBlockChecked makes defaultIsAgentBlockedNow return true', async () => {
  const previousHome = process.env.PARALLIX_HOME;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2345-'));
  try {
    process.env.PARALLIX_HOME = home;
    await updateAgentBlockChecked('codex', '2099-01-01 00', { reason: 'quota' });

    assert.equal(await defaultIsAgentBlockedNow('codex'), true);
    const { db } = await initOperatorState();
    const board = new ConcreteAgentReadAdapter({
      rootDir: process.cwd(),
      blocklistRepo: new SqliteBlocklistRepository(db),
      knownAgentFamilies: [agentFamily('codex')],
      readAgentConfig: () => ({}),
      resolveTaskFile: () => ({ ok: false, matches: [] }),
    });
    assert.notEqual((await board.loadAgentAvailability())[0].block.kind, 'none');
  } finally {
    await clearOperatorStateCache();
    if (previousHome === undefined) {
      delete process.env.PARALLIX_HOME;
    } else {
      process.env.PARALLIX_HOME = previousHome;
    }
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('local-only and SQLite-only blocks both resolve as blocked', () => {
  const runtime = { agent: 'codex', eligible: false, blocked: true, until: null, reason: 'quota', limit: 'quota' };

  assert.equal(resolveAgentBlockAuthority('codex', { ...runtime, blocked: false, eligible: true, reason: null, limit: null }, { blocklist: { codex: true } }).blocked, true);
  assert.equal(resolveAgentBlockAuthority('codex', runtime, {}).blocked, true);
});

test('explicit local unblock overrides a SQLite block', () => {
  const runtime = { agent: 'codex', eligible: false, blocked: true, until: null, reason: 'quota', limit: 'quota' };

  assert.equal(resolveAgentBlockAuthority('codex', runtime, { blocklist: { codex: { blocked: false } } }).blocked, false);
});
