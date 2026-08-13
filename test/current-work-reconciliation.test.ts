import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileCurrentWork } from '../src/application/projections/current-work.js';
import { attentionReason } from '../src/application/projections/board.js';
import { makeCard } from './fixtures/board-projection.js';
import { agentFamily } from '../src/domain/agents.js';
import { missionId } from '../src/domain/mission.js';

const now = Date.parse('2026-08-13T12:00:00.000Z');
const event = (overrides: Record<string, unknown> = {}) => ({
  missionId: missionId('task-2370'), operationId: 'op', phase: 'execute' as const,
  state: 'running' as const, summary: 'working', agent: agentFamily('qwen'),
  processId: 42, blockedReason: null, occurredAt: new Date(now - 1_000).toISOString(), ...overrides,
});

test('current work keeps automatic family handoff working and makes exhaustion actionable', () => {
  const handoff = reconcileCurrentWork([event({ agent: agentFamily('claude') }), event({ agent: agentFamily('qwen'), occurredAt: new Date(now).toISOString() })], {
    nowMs: now, ttlMs: 1_000, isProcessAlive: () => true,
  }).get(missionId('task-2370'))!;
  assert.equal(handoff.currentWork?.agent, 'qwen');
  assert.equal(attentionReason(makeCard({ currentWork: handoff.currentWork, blockingReason: handoff.blockingReason })).kind, 'none');

  const exhausted = reconcileCurrentWork([event({ state: 'blocked', blockedReason: 'all eligible families are blocked' })], {
    nowMs: now, ttlMs: 1_000,
  }).get(missionId('task-2370'))!;
  assert.equal(attentionReason(makeCard({ currentWork: exhausted.currentWork, blockingReason: exhausted.blockingReason })).kind, 'blocking');
});

test('current work distinguishes unverified, stale, and known-stopped publishers', () => {
  const options = { ttlMs: 1_000, isProcessAlive: () => null as boolean | null };
  assert.equal(reconcileCurrentWork([event()], { ...options, nowMs: now }).get(missionId('task-2370'))?.currentWork?.freshness, 'unverified');
  assert.equal(reconcileCurrentWork([event()], { ...options, nowMs: now + 2_000 }).get(missionId('task-2370'))?.currentWork?.freshness, 'stale');
  assert.equal(reconcileCurrentWork([event()], { ...options, isProcessAlive: () => false, nowMs: now }).get(missionId('task-2370'))?.currentWork, null);
});
