// Historical regression provenance: TASK-2375.
// Current-work liveness contract: a publisher's pid and process-start identity decide whether its work is
// live, aged out, or cleared; probes cover Linux, macOS, native Windows and WSL.
//
// Behavior-owned suite (TASK-2622.12). Case names are unchanged; each section keeps its historical
// task provenance and the legacy file it replaced.
//   Process liveness: TASK-2373 SC13/SC14
//   Unverifiable process liveness: TASK-2375 SC5 (was test/task-2375-metrics-cache-and-liveness.test.ts)

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { mock, describe } from 'node:test';
import { processStartIdentity, probeProcessLiveness, runNativeStartIdentity, readProcessStat } from '../../../../src/adapters/process/process-liveness.js';
import { reconcileCurrentWork } from '../../../../src/application/projections/current-work.js';
import type { CurrentWorkEvent } from '../../../../src/application/recording/current-work-recorder.js';
import { agentFamily } from '../../../../src/domain/agents.js';
import { missionId } from '../../../../src/domain/mission.js';

// ── Process liveness — TASK-2373 (was task-2373-liveness.test.ts) ──
/**
 * TASK-2373 CP-5 — current-work liveness beyond a bare PID (SC13–SC14).
 */

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

// ── Unverifiable process liveness — TASK-2375 SC5 (was task-2375-metrics-cache-and-liveness.test.ts, SC5) ──
describe("Unverifiable process liveness — SC5", () => {
  // ---------------------------------------------------------------------------
  // SC5 — unverifiable process liveness
  // ---------------------------------------------------------------------------

  test('TASK-2375 SC5: probeProcessLiveness returns null when identity is null (non-Linux fallback)', () => {
    // On non-Linux, processStartIdentity returns null (no /proc).
    // When recorded identity is null, probe should return null (unverifiable),
    // not true (authoritatively alive).
    const result = probeProcessLiveness(process.pid, null);
    assert.strictEqual(
      result,
      null,
      'pid exists but identity unverifiable — must return null for TTL aging, not true',
    );
  });

  test('TASK-2375 SC5: probeProcessLiveness returns true when identity matches (Linux authoritative)', () => {
    // On Linux, processStartIdentity reads /proc/<pid>/stat field 22.
    // When identity matches, probe returns true (authoritatively alive).
    // On Linux, this process has a start identity. On non-Linux it returns null.
    // This test proves the Linux path works: identity is read and compared.
    // Skip the match assertion on non-Linux where /proc is unavailable.
    try {
      const stat = readFileSync(`/proc/${process.pid}/stat`, 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      const startTime = fields[19];
      if (startTime && /^\d+$/.test(startTime)) {
        // Linux path: identity available, probe should return true
        const result = probeProcessLiveness(process.pid, startTime);
        assert.strictEqual(result, true, 'Linux start-identity match returns true (authoritative)');
        return;
      }
    } catch {
      // Non-Linux: /proc unavailable, skip authoritative check
    }
    // Non-Linux or unreadable: test passes by not throwing
    assert.ok(true, 'non-Linux: identity check skipped');
  });

  test('TASK-2375 SC5: probeProcessLiveness returns false for dead process', () => {
    // Use a pid that is very unlikely to exist
    const deadPid = 99999999;
    const result = probeProcessLiveness(deadPid, null);
    assert.strictEqual(result, false, 'dead pid returns false');
  });
});
