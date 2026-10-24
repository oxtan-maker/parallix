import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { mock } from 'node:test';

import { defaultIsAgentBlockedNow, updateAgentBlockChecked } from '../../../src/adapters/agents/agents.js';
import { clearOperatorStateCache } from '../../../src/adapters/sqlite/adapter-factory.js';
import { SqliteBlocklistRepository } from '../../../src/adapters/sqlite/blocklist-repository.js';
import { initOperatorState } from '../../../src/adapters/sqlite/adapter-factory.js';
import { ConcreteAgentReadAdapter } from '../../../src/adapters/backlog/concrete-agent-read-adapter.js';
import { agentFamily } from '../../../src/domain/agents.js';
import { resolveAgentBlockAuthority } from '../../../src/adapters/agents/agent-block-authority.js';
import { materializeBlocklistSnapshot } from '../../../src/adapters/sqlite/blocklist-snapshot.js';
import { createDefaultExecuteMissionRuntime, createExecuteMissionPorts } from '../../../src/adapters/mission/execute-mission-adapters.js';
import type { MissionTransitionStore } from '../../../src/application/domain-ports.js';
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

test('explicit local overrides take precedence in execute selection and the pre-launch recheck as a persisted ISO block expires (TASK-2789)', async (t) => {
  const previousHome = process.env.PARALLIX_HOME;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2789-'));
  t.after(async () => {
    mock.timers.reset();
    await clearOperatorStateCache();
    if (previousHome === undefined) { delete process.env.PARALLIX_HOME; } else { process.env.PARALLIX_HOME = previousHome; }
    fs.rmSync(home, { recursive: true, force: true });
  });
  process.env.PARALLIX_HOME = home;
  const configuration = { ...DEFAULT_CONFIGURATION, storage: { ...DEFAULT_CONFIGURATION.storage, parallixHome: home } };
  const start = Date.UTC(2030, 0, 1, 10, 0, 0, 0);
  const expiry = start + 90_500;
  mock.timers.enable({ apis: ['Date'], now: start });
  // codex: local unblock over an active runtime block; claude: local block with
  // no runtime row; custom: an expired local timed entry defers to the runtime.
  fs.writeFileSync(path.join(home, 'agents.local.json'), JSON.stringify({
    blocklist: { codex: { blocked: false }, claude: true, custom: { until: '2000-01-01 00' } },
  }));
  const until = new Date(expiry).toISOString().replace('Z', '+00:00');
  await updateAgentBlockChecked('codex', until, { reason: 'quota', configuration });
  await updateAgentBlockChecked('custom', until, { reason: 'quota', configuration });
  const { db } = await initOperatorState({ configuration });
  const selection = createExecuteMissionPorts('/repo', {
    configuration,
    missionTransitionStore: {} as MissionTransitionStore,
    operatorBlocklist: materializeBlocklistSnapshot(await new SqliteBlocklistRepository(db).findAll()),
  }, createDefaultExecuteMissionRuntime(configuration)).agentExecution;

  for (const [instant, expected] of [[expiry - 1, [true, false, false]], [expiry, [true, false, true]]] as const) {
    mock.timers.setTime(instant);
    const selected = await Promise.all(['codex', 'claude', 'custom'].map((family) => selection.eligible(family)));
    const recheck = await Promise.all(['codex', 'claude', 'custom'].map(async (family) => !(await defaultIsAgentBlockedNow(family, configuration))));
    assert.deepEqual(selected, expected, `execute selection at ${new Date(instant).toISOString()}`);
    assert.deepEqual(recheck, expected, `pre-launch recheck at ${new Date(instant).toISOString()}`);
  }
});
