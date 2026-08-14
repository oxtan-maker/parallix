/**
 * TASK-2373 CP-5 — current-work liveness beyond a bare PID (SC13–SC14).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileCurrentWork } from '../src/application/projections/current-work.js';
import type { CurrentWorkEvent } from '../src/application/recording/current-work-recorder.js';
import { probeProcessLiveness, processStartIdentity } from '../src/adapters/process/process-liveness.js';
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
    processId: 4242,
    processIdentity: '900900',
    blockedReason: null,
    occurredAt: new Date(NOW - 1_000).toISOString(),
    ...overrides,
  } as CurrentWorkEvent;
}

test('SC13: a reused pid whose process-start identity differs is treated as dead', () => {
  const facts = reconcileCurrentWork([event()], {
    nowMs: NOW,
    ttlMs: 60_000,
    // The pid answers, but it belongs to a process that started later.
    isProcessAlive: (pid, identity) => pid === 4242 && identity === '111111',
  }).get(MISSION);
  assert.equal(facts?.currentWork, null, 'pid reuse must not keep a mission WORKING');
});

test('SC13: the matching process-start identity keeps the work live', () => {
  const facts = reconcileCurrentWork([event()], {
    nowMs: NOW,
    ttlMs: 60_000,
    isProcessAlive: (pid, identity) => pid === 4242 && identity === '900900',
  }).get(MISSION);
  assert.equal(facts?.currentWork?.freshness, 'live');
});

test('SC13: the probe uses a start identity where the platform exposes one', () => {
  const identity = processStartIdentity(process.pid);
  if (identity === null) {
    assert.equal(probeProcessLiveness(process.pid, identity), true);
    return;
  }
  assert.match(identity, /^\d+$/, 'a readable process-start identity is numeric');
  assert.equal(probeProcessLiveness(process.pid, identity), true);
  // The same live pid claimed by a publisher that started at another time is
  // exactly the pid-reuse case.
  assert.equal(probeProcessLiveness(process.pid, `${Number(identity) + 1}`), false);
});

test('SC13: an unreadable identity falls back to the bare pid check rather than guessing', () => {
  assert.equal(probeProcessLiveness(process.pid, null), true);
  assert.equal(probeProcessLiveness(-1, null), null);
});

test('SC14: an abnormally terminated publisher ages its work out instead of staying WORKING', () => {
  const options = { ttlMs: 1_000, isProcessAlive: () => null as boolean | null };
  // Killed without publishing a terminal event, and no longer observable.
  const fresh = reconcileCurrentWork([event()], { ...options, nowMs: NOW });
  const aged = reconcileCurrentWork([event()], { ...options, nowMs: NOW + 10_000 });
  assert.equal(fresh.get(MISSION)?.currentWork?.freshness, 'unverified');
  assert.equal(aged.get(MISSION)?.currentWork?.freshness, 'stale');
});

test('SC14: an abnormally terminated publisher observed dead clears the work immediately', () => {
  const facts = reconcileCurrentWork([event()], {
    nowMs: NOW,
    ttlMs: 60_000,
    isProcessAlive: () => false,
  }).get(MISSION);
  assert.equal(facts?.currentWork, null);
  assert.equal(facts?.blockingReason, null);
});
