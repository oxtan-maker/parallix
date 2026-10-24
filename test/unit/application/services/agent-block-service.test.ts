// Regression provenance: TASK-2322.
import assert from 'node:assert/strict';
import test from 'node:test';

import { AgentBlockService, agentBlockOf } from '../../../../src/application/services/agent-block-service.js';

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
  const state = await new AgentBlockService(repo).query('codex', Date.parse('2030-01-02T00:00:00'));
  assert.deepEqual(state, { agent: 'codex', eligible: true, blocked: false, until: null, reason: null, limit: null });
});

test('AgentBlock service unblocks an agent without touching configuration', async () => {
  const repo = new MemoryBlockRepository();
  const service = new AgentBlockService(repo);
  await service.block('codex', '2030-01-01 00', 'quota');
  const state = await service.unblock('codex');
  assert.equal(state.eligible, true);
  assert.equal(await repo.findByAgent('codex'), undefined);
});

test('AgentBlock service accepts concurrent checked-repository updates for distinct families', async () => {
  const repo = new MemoryBlockRepository();
  const service = new AgentBlockService(repo);
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
  await new AgentBlockService(repo).block('codex', '2030-01-01 00', 'quota');
  const afterRestart = await new AgentBlockService(repo).query('codex', Date.parse('2029-01-01T00:00:00'));
  assert.equal(afterRestart.reason, 'quota');
  assert.equal(afterRestart.eligible, false);
});

test('AgentBlock service exposes repository failures without file fallback', async () => {
  const repo = new MemoryBlockRepository();
  repo.fail = true;
  await assert.rejects(new AgentBlockService(repo).query('codex'), /database unavailable/);
});

test('AgentBlock service keeps local-time hourly expiry before, at and after the hour (TASK-2789)', async () => {
  const repo = new MemoryBlockRepository();
  await repo.save({ agent: 'codex', blocked: true, until: '2030-01-01 05', reason: 'quota' });
  const expiry = new Date(2030, 0, 1, 5).getTime();
  const service = new AgentBlockService(repo);
  assert.equal((await service.query('codex', expiry - 1)).blocked, true);
  assert.equal((await service.query('codex', expiry)).blocked, false);
  assert.equal((await service.query('codex', expiry + 3_600_000)).blocked, false);
});

test('AgentBlock service keeps ISO offset and sub-hour precision (TASK-2789)', async () => {
  const repo = new MemoryBlockRepository();
  await repo.save({ agent: 'codex', blocked: true, until: '2030-01-01T05:30:15.250+02:00', reason: 'quota' });
  const expiry = Date.UTC(2030, 0, 1, 3, 30, 15, 250);
  const service = new AgentBlockService(repo);
  assert.deepEqual(await service.query('codex', expiry - 1), {
    agent: 'codex', eligible: false, blocked: true, until: '2030-01-01T05:30:15.250+02:00', reason: 'quota', limit: 'quota',
  });
  assert.deepEqual(agentBlockOf(await service.query('codex', expiry - 1)), { kind: 'until', untilMs: expiry, reason: 'quota' });
  assert.equal((await service.query('codex', expiry)).blocked, false);
  assert.equal((await service.query('codex', expiry + 1)).blocked, false);
});

test('AgentBlock service keeps unblocked rows unblocked and indefinite or malformed active rows blocked (TASK-2789)', async () => {
  const repo = new MemoryBlockRepository();
  await repo.save({ agent: 'codex', blocked: false, until: '2099-01-01 00' });
  await repo.save({ agent: 'claude', blocked: true, reason: 'operator' });
  await repo.save({ agent: 'vibe', blocked: true, until: 'not-a-time', reason: 'quota' });
  const states = await new AgentBlockService(repo).queryAll(['codex', 'claude', 'vibe', 'qwen'], Date.parse('2030-01-01T00:00:00Z'));
  assert.deepEqual(states.map(({ agent, blocked }) => [agent, blocked]), [
    ['codex', false], ['claude', true], ['vibe', true], ['qwen', false],
  ]);
  assert.deepEqual(states.map(agentBlockOf), [
    { kind: 'none' }, { kind: 'indefinite', reason: 'operator' }, { kind: 'indefinite', reason: 'quota' }, { kind: 'none' },
  ], 'an unparseable expiry stays blocked without inventing an instant');
});
