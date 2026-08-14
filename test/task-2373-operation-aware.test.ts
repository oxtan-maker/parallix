/**
 * TASK-2373 CP-3 — operation-aware replacement and termination (SC8, SC9).
 *
 * Reconciliation is the only place allowed to decide which published fact still
 * describes a mission. These tests pin the two rules that decision now follows:
 * a terminal event clears only its own operation, and same-operation events are
 * ordered by the operational store's durable row order rather than by timestamp
 * coincidence.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { reconcileCurrentWork } from '../src/application/projections/current-work.js';
import { parseCurrentWorkEntry, currentWorkEventToEntry, type CurrentWorkEvent } from '../src/application/recording/current-work-recorder.js';
import { agentFamily } from '../src/domain/agents.js';
import { missionId } from '../src/domain/mission.js';

const MISSION = missionId('task-2373');
const NOW = Date.parse('2026-08-13T12:00:00.000Z');

function event(overrides: Partial<CurrentWorkEvent> = {}): CurrentWorkEvent {
  return {
    missionId: MISSION,
    operationId: 'op-a',
    phase: 'execute',
    state: 'running',
    summary: 'working',
    agent: agentFamily('claude'),
    processId: null,
    blockedReason: null,
    occurredAt: new Date(NOW - 5_000).toISOString(),
    ...overrides,
  } as CurrentWorkEvent;
}

function reconcile(events: readonly CurrentWorkEvent[]) {
  return reconcileCurrentWork(events, { nowMs: NOW, ttlMs: 60_000 }).get(MISSION);
}

test('SC8: a terminal event clears the work of the operation it belongs to', () => {
  const facts = reconcile([
    event({ operationId: 'op-a', sequence: 1 }),
    event({ operationId: 'op-a', state: 'ended', sequence: 2 }),
  ]);
  assert.equal(facts?.currentWork, null);
  assert.equal(facts?.blockingReason, null);
});

test('SC8: a terminal event from a superseded operation leaves the newer work standing', () => {
  const facts = reconcile([
    event({ operationId: 'op-a', sequence: 1 }),
    event({ operationId: 'op-b', phase: 'review', agent: agentFamily('qwen'), sequence: 2 }),
    event({ operationId: 'op-a', state: 'ended', sequence: 3 }),
    event({ operationId: 'op-a', state: 'blocked', blockedReason: 'stale operation gave up', sequence: 4 }),
  ]);
  assert.equal(facts?.currentWork?.operationId, 'op-b');
  assert.equal(facts?.currentWork?.phase, 'review');
  assert.equal(facts?.blockingReason, null, 'a superseded operation cannot block the mission it no longer owns');
});

test('SC8: a blocked event for the standing operation still surfaces its reason', () => {
  const facts = reconcile([
    event({ operationId: 'op-a', sequence: 1 }),
    event({ operationId: 'op-a', state: 'blocked', blockedReason: 'every eligible family is blocked', sequence: 2 }),
  ]);
  assert.equal(facts?.currentWork, null);
  assert.equal(facts?.blockingReason, 'every eligible family is blocked');
});

test('SC9: durable store order decides between two events written in the same millisecond', () => {
  const at = new Date(NOW - 1_000).toISOString();
  const facts = reconcile([
    event({ phase: 'review-response', agent: agentFamily('qwen'), occurredAt: at, sequence: 9 }),
    event({ phase: 'review', agent: agentFamily('claude'), occurredAt: at, sequence: 8 }),
  ]);
  assert.equal(facts?.currentWork?.phase, 'review-response');
  assert.equal(facts?.currentWork?.agent, 'qwen');
});

test('SC9: the durable sequence comes from the stored row id, not from the publisher', () => {
  const stored = parseCurrentWorkEntry({
    id: 4242,
    ...currentWorkEventToEntry(event()),
  });
  assert.equal(stored?.sequence, 4242);
});

test('SC8: legacy rows published without an operation id keep clearing the mission', () => {
  const facts = reconcile([
    event({ operationId: '', sequence: 1 }),
    event({ operationId: '', state: 'ended', sequence: 2 }),
  ]);
  assert.equal(facts?.currentWork, null);
});
