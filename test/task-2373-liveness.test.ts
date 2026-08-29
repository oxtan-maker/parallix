/**
 * TASK-2373 CP-5 — current-work liveness beyond a bare PID (SC13–SC14).
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileCurrentWork } from '../src/application/projections/current-work.js';
import type { CurrentWorkEvent } from '../src/application/recording/current-work-recorder.js';
import { agentFamily } from '../src/domain/agents.js';
import { missionId } from '../src/domain/mission.js';
import { processStartIdentity, probeProcessLiveness, runNativeStartIdentity, readProcessStat } from '../src/adapters/process/process-liveness.js';

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
  // TASK-2375 SC5: when identity is null (non-Linux or legacy), bare pid
  // existence is not authoritative — return null so TTL aging can age it out.
  // This is a deliberate change from the old behaviour (null → true) that
  // kept unverifiable missions WORKING forever.
  assert.equal(probeProcessLiveness(process.pid, null), null);
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

// macOS and native Windows expose a per-PID start identity through a single
// targeted native lookup, not a process-table scan. The host runs Linux, so
// these tests pin `process.platform` and stub the one native call through the
// exported seam; no real process tooling is ever invoked.
//
// `mock.property` does not restore `process.platform` between tests on the CI
// runtime, so this helper saves the current value and restores it in a finally
// block rather than trusting auto-restore.
function withPlatform(platform: NodeJS.Platform, fn: () => void): void {
  const original = process.platform;
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  try { fn(); }
  finally { Object.defineProperty(process, 'platform', { value: original, configurable: true }); }
}

test('macOS: one ps lookup yields a start identity that rejects a recycled pid', () => {
  withPlatform('darwin', () => {
    mock.method(runNativeStartIdentity, 'execFileSync', () => 'Fri Aug 14 04:00:01 2026');
    const identity = processStartIdentity(4242);
    assert.match(identity!, /^\d{4}-\d{2}-\d{2}T/, 'ps output parses to an ISO-8601 identity');
    assert.equal(probeProcessLiveness(process.pid, identity!), true, 'matching identity stays live');
    assert.equal(probeProcessLiveness(process.pid, '2000-01-01T00:00:00.000Z'), false, 'recycled pid is dead');
  });
});

test('macOS: an unreadable start identity falls back to the bare pid check', () => {
  withPlatform('darwin', () => {
    mock.method(runNativeStartIdentity, 'execFileSync', () => { throw new Error('ESRCH'); });
    assert.equal(processStartIdentity(4242), null, 'ps failure is no identity');
    assert.equal(probeProcessLiveness(process.pid, '2000-01-01T00:00:00.000Z'), true, 'alive until proven reused');
  });
});

test('native Windows: one Get-Process lookup yields a start identity that rejects a recycled pid', () => {
  withPlatform('win32', () => {
    mock.method(runNativeStartIdentity, 'execFileSync', () => '2026-08-14T04:00:01.123456700Z');
    const identity = processStartIdentity(4242);
    assert.equal(identity, new Date('2026-08-14T04:00:01.123456700Z').toISOString());
    assert.equal(probeProcessLiveness(process.pid, identity), true, 'matching identity stays live');
    assert.equal(probeProcessLiveness(process.pid, '2000-01-01T00:00:00.000Z'), false, 'recycled pid is dead');
  });
});

test('native Windows: an unreadable start identity falls back to the bare pid check', () => {
  withPlatform('win32', () => {
    mock.method(runNativeStartIdentity, 'execFileSync', () => { throw new Error('PowerShell not found'); });
    assert.equal(processStartIdentity(4242), null, 'powershell failure is no identity');
    assert.equal(probeProcessLiveness(process.pid, '2000-01-01T00:00:00.000Z'), true);
  });
});

test('Linux: /proc/<pid>/stat field 22 is the one-pid start identity source', () => {
  // After the last ')' the 20th space-separated field (index 19) is field 22.
  const stat = '1234 (test) S 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 777';
  mock.method(readProcessStat, 'sync', () => stat);
  assert.equal(processStartIdentity(1234), '777');
});

test('WSL keeps the /proc path rather than the native Windows path', () => {
  // WSL reports process.platform === 'linux'; it must use /proc, not PowerShell.
  withPlatform('linux', () => {
    mock.method(readProcessStat, 'sync', () => '1234 (test) S 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 555');
    let nativeCalls = 0;
    mock.method(runNativeStartIdentity, 'execFileSync', () => { nativeCalls++; return 'nope'; });
    assert.equal(processStartIdentity(1234), '555');
    assert.equal(nativeCalls, 0, 'WSL never calls the native Windows lookup');
  });
});
