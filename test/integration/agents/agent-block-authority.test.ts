import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { defaultIsAgentBlockedNow, updateAgentBlockChecked } from '../../../src/adapters/agents/agents.js';
import { clearOperatorStateCache } from '../../../src/adapters/sqlite/adapter-factory.js';
import { SqliteBlocklistRepository } from '../../../src/adapters/sqlite/blocklist-repository.js';
import { initOperatorState } from '../../../src/adapters/sqlite/adapter-factory.js';
import { ConcreteAgentReadAdapter } from '../../../src/adapters/backlog/concrete-agent-read-adapter.js';
import { agentFamily } from '../../../src/domain/agents.js';
import { resolveAgentBlockAuthority } from '../../../src/adapters/agents/agent-block-authority.js';
import { DEFAULT_CONFIGURATION } from '../../../src/application/ports/configuration.js';

test('block persisted via updateAgentBlockChecked makes defaultIsAgentBlockedNow return true', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-block-authority-'));
  const configuration = { ...DEFAULT_CONFIGURATION, storage: { ...DEFAULT_CONFIGURATION.storage, parallixHome: home } };
  fs.writeFileSync(path.join(home, 'agents.local.json'), '{"blocklist":{}}\n');
  try {
    await updateAgentBlockChecked('codex', '2099-01-01 00', { reason: 'quota', configuration });

    assert.equal(await defaultIsAgentBlockedNow('codex', configuration), true);
    const { db } = await initOperatorState({ configuration });
    const board = new ConcreteAgentReadAdapter({
      rootDir: process.cwd(),
      blocklistRepo: new SqliteBlocklistRepository(db),
      knownAgentFamilies: [agentFamily('codex')],
      readAgentConfig: () => ({}),
      resolveTaskFile: () => ({ ok: false as const, matches: [] }),
    });
    assert.notEqual((await board.loadAgentAvailability())[0].block.kind, 'none');
  } finally {
    await clearOperatorStateCache();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('local-only and SQLite-only blocks both resolve as blocked', () => {
  const runtime = { agent: 'codex', eligible: false, blocked: true, until: null, reason: 'quota', limit: 'quota' } satisfies Partial<NonNullable<Parameters<typeof resolveAgentBlockAuthority>[1]>>;

  assert.equal(resolveAgentBlockAuthority('codex', { ...runtime, blocked: false, eligible: true, reason: null, limit: null }, { blocklist: { codex: true } }).blocked, true);
  assert.equal(resolveAgentBlockAuthority('codex', runtime, {}).blocked, true);
});

test('explicit local unblock overrides a SQLite block', () => {
  const runtime = { agent: 'codex', eligible: false, blocked: true, until: null, reason: 'quota', limit: 'quota' };

  assert.equal(resolveAgentBlockAuthority('codex', runtime, { blocklist: { codex: { blocked: false } } }).blocked, false);
});
