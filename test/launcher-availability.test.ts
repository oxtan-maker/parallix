import test from 'node:test';
import assert from 'node:assert/strict';
import { agentFamily } from '../src/domain/agents.js';
import { createLauncherProbe } from '../src/adapters/agents/launcher-availability.js';
import { ConcreteAgentReadAdapter } from '../src/adapters/backlog/concrete-agent-read-adapter.js';
import type { AgentBlockEntry, AgentBlocklistRepository } from '../src/application/ports/agent-blocklist.js';

// ---------------------------------------------------------------------------
// The board's launcher probe. `workflowLauncherStatus` spawns per call, so the
// probe caches; a board that never probes reports every configured family as
// available even when its CLI is absent.
// ---------------------------------------------------------------------------

class EmptyBlocklistRepo implements AgentBlocklistRepository {
  async findAll(): Promise<readonly AgentBlockEntry[]> { return []; }
  async findByAgent(): Promise<AgentBlockEntry | undefined> { return undefined; }
  async save(): Promise<void> { /* no writes in these tests */ }
  async deleteByAgent(): Promise<void> { /* no writes in these tests */ }
  async clear(): Promise<void> { /* no writes in these tests */ }
}

test('createLauncherProbe reports a supported launcher as available with no detail', () => {
  const probe = createLauncherProbe({ probe: () => ({ supported: true }) });

  assert.deepEqual(probe(agentFamily('codex')), { available: true, detail: null });
});

test('createLauncherProbe reports a missing launcher with a short reason', () => {
  const probe = createLauncherProbe({ probe: () => ({ supported: false, health: 'missing' }) });

  assert.deepEqual(probe(agentFamily('vibe')), { available: false, detail: 'launcher missing' });
});

test('createLauncherProbe includes the probe failure reason', () => {
  const probe = createLauncherProbe({
    probe: () => ({ supported: false, health: 'probe-failed', reason: 'exit 1' }),
  });

  assert.deepEqual(probe(agentFamily('claude')), {
    available: false,
    detail: 'launcher probe-failed: exit 1',
  });
});

test('createLauncherProbe reports a throwing probe as unavailable instead of propagating', () => {
  const probe = createLauncherProbe({
    probe: () => { throw new Error('Unknown agent: "ghost"'); },
  });

  const result = probe(agentFamily('ghost'));
  assert.equal(result.available, false);
  assert.match(String(result.detail), /launcher probe failed: Unknown agent/);
});

test('createLauncherProbe caches per family until the ttl expires', () => {
  let calls = 0;
  let clock = 1_000;
  const probe = createLauncherProbe({
    ttlMs: 500,
    now: () => clock,
    probe: () => { calls += 1; return { supported: true }; },
  });

  probe(agentFamily('codex'));
  probe(agentFamily('codex'));
  assert.equal(calls, 1, 'a cached family must not re-spawn the probe');

  probe(agentFamily('claude'));
  assert.equal(calls, 2, 'the cache is keyed by family');

  clock += 501;
  probe(agentFamily('codex'));
  assert.equal(calls, 3, 'an expired entry must be re-probed');
});

test('ConcreteAgentReadAdapter reports a family whose launcher is missing as unavailable', async () => {
  const adapter = new ConcreteAgentReadAdapter({
    rootDir: '/tmp',
    blocklistRepo: new EmptyBlocklistRepo(),
    knownAgentFamilies: [agentFamily('codex'), agentFamily('vibe')],
    launcherAvailable: (family) => family === 'vibe'
      ? { available: false, detail: 'launcher missing' }
      : { available: true, detail: null },
    resolveTaskFile: () => ({ ok: false, matches: [] }),
  });

  const availability = await adapter.loadAgentAvailability();

  const vibe = availability.find((agent) => agent.family === 'vibe');
  assert.equal(vibe?.launcherAvailable, false, 'the probe result must reach the read model');
  assert.equal(vibe?.launcherDetail, 'launcher missing', 'the probe detail must reach the read model');
  assert.equal(vibe?.block.kind, 'none', 'a missing launcher is not a block');

  const codex = availability.find((agent) => agent.family === 'codex');
  assert.equal(codex?.launcherAvailable, true);
  assert.equal(codex?.launcherDetail, null);
});
