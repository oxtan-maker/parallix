import assert from 'node:assert/strict';
import test from 'node:test';

import { AgentBlockService } from '../src/application/services/agent-block-service.js';

class MemoryBlockRepository {
  private readonly entries = new Map<string, { agent: string; blocked: boolean; until?: string; reason?: string }>();
  fail = false;

  async findAll() { if (this.fail) throw new Error('database unavailable'); return [...this.entries.values()]; }
  async findByAgent(agent: string) { if (this.fail) throw new Error('database unavailable'); return this.entries.get(agent); }
  async save(entry: { agent: string; blocked: boolean; until?: string; reason?: string }) {
    if (this.fail) throw new Error('database unavailable');
    this.entries.set(entry.agent, { ...entry });
  }
  async deleteByAgent(agent: string) { if (this.fail) throw new Error('database unavailable'); this.entries.delete(agent); }
  async clear() { this.entries.clear(); }
}

test('AgentBlock service expires a timed block and returns eligibility from the checked row', async () => {
  const repo = new MemoryBlockRepository();
  await repo.save({ agent: 'codex', blocked: true, until: '2030-01-01 00', reason: 'quota' });
  const state = await new AgentBlockService(repo as never).query('codex', Date.parse('2030-01-02T00:00:00'));
  assert.deepEqual(state, { agent: 'codex', eligible: true, blocked: false, until: null, reason: null, limit: null });
});

test('AgentBlock service unblocks an agent without touching configuration', async () => {
  const repo = new MemoryBlockRepository();
  const service = new AgentBlockService(repo as never);
  await service.block('codex', '2030-01-01 00', 'quota');
  const state = await service.unblock('codex');
  assert.equal(state.eligible, true);
  assert.equal(await repo.findByAgent('codex'), undefined);
});

test('AgentBlock service accepts concurrent checked-repository updates for distinct families', async () => {
  const repo = new MemoryBlockRepository();
  const service = new AgentBlockService(repo as never);
  await Promise.all([
    service.block('codex', '2030-01-01 00', 'quota'),
    service.block('claude', '2030-01-01 00', 'maintenance'),
  ]);
  assert.deepEqual((await service.queryAll(['claude', 'codex'], Date.parse('2029-01-01T00:00:00'))).map(({ agent, reason }) => [agent, reason]), [
    ['claude', 'maintenance'], ['codex', 'quota'],
  ]);
});

test('AgentBlock service reads the same checked block after restart', async () => {
  const repo = new MemoryBlockRepository();
  await new AgentBlockService(repo as never).block('codex', '2030-01-01 00', 'quota');
  const afterRestart = await new AgentBlockService(repo as never).query('codex', Date.parse('2029-01-01T00:00:00'));
  assert.equal(afterRestart.reason, 'quota');
  assert.equal(afterRestart.eligible, false);
});

test('AgentBlock service exposes repository failures without file fallback', async () => {
  const repo = new MemoryBlockRepository();
  repo.fail = true;
  await assert.rejects(new AgentBlockService(repo as never).query('codex'), /database unavailable/);
});
