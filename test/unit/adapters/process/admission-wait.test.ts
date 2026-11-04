// Shared admission waiting owner contract (TASK-2830): one place owns polling,
// backoff, progress reporting, cancellation, wait limits and retry accounting for
// every contended Parallix resource. Doubles only; no timers, no filesystem.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  admissionDelayMs,
  waitForAdmission,
  waitForAdmissionSync,
  type AdmissionWaitPolicy,
} from '../../../../src/adapters/process/admission-wait.js';
import { gateAdmissionPolicy } from '../../../../src/adapters/process/gate-admission.js';
import { CUSTOM_CAPACITY_ADMISSION_POLICY } from '../../../../src/adapters/agents/custom-capacity.js';

const ROOT = path.join(import.meta.dirname, '..', '..', '..', '..');
const POLICY: AdmissionWaitPolicy = {
  resource: 'git-worktree-lock',
  initialDelayMs: 100,
  maxDelayMs: 800,
  maxWaitMs: 1000,
  progressEveryMs: 300,
};

test('shared admission waits with policy backoff and reports progress on its own budget (TASK-2830)', async () => {
  let clock = 0;
  const delays: number[] = [];
  const reports: Array<{ attempts: number; waitedMs: number; resource: string }> = [];
  let probes = 0;
  const result = await waitForAdmission(() => (++probes === 5 ? 'lease' : null), POLICY, {
    now: () => clock,
    pause: async ms => { delays.push(ms); clock += 200; },
    onWaiting: state => { reports.push({ attempts: state.attempts, waitedMs: state.waitedMs, resource: state.resource }); },
  });
  assert.equal(result.acquired, true);
  assert.equal(result.value, 'lease');
  assert.equal(result.attempts, 5, 'retry accounting survives the wait');
  assert.equal(result.waitedMs, 800);
  assert.deepEqual(delays, [100, 200, 400, 400], 'backoff grows to the policy ceiling and never past it');
  assert.deepEqual(reports.map(r => [r.attempts, r.waitedMs]), [[1, 0], [3, 400]], 'one line per progress budget');
  assert.deepEqual([...new Set(reports.map(r => r.resource))], ['git-worktree-lock'], 'the wait is attributed to the named resource');
});

test('shared admission stops at the justified wait limit and keeps the accounting it gathered (TASK-2830)', async () => {
  let clock = 0;
  let probes = 0;
  const result = await waitForAdmission(() => { probes += 1; return null; }, POLICY, {
    now: () => clock,
    pause: async () => { clock += 300; },
  });
  assert.equal(result.acquired, false);
  assert.equal(result.value, null, 'a wait that stops never hands back a half-held resource');
  assert.equal(probes, 5);
  assert.equal(result.attempts, 5);
  assert.equal(result.waitedMs, 1200, 'the caller sees the real elapsed wait, not a retry count');
});

test('shared admission stops on cancellation without polling again (TASK-2830)', async () => {
  const controller = new AbortController();
  let probes = 0;
  const signalled: Array<AbortSignal | undefined> = [];
  const result = await waitForAdmission(() => { probes += 1; if (probes === 2) { controller.abort(); } return null; }, POLICY, {
    signal: controller.signal,
    pause: async (_ms, signal) => { signalled.push(signal); },
  });
  assert.equal(result.acquired, false);
  assert.equal(probes, 2, 'no probe is taken after cancellation');
  assert.deepEqual(signalled, [controller.signal], 'the pause itself is cancellable, not a blind sleep');
});

test('the shared pause rejects on abort so a cancelled wait cannot linger in a timer (TASK-2830)', async () => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 20);
  const started = Date.now();
  await assert.rejects(
    waitForAdmission(() => null, { ...POLICY, maxWaitMs: null }, { signal: controller.signal }),
    (error: unknown) => (error as Error).name === 'AbortError',
  );
  assert.ok(Date.now() - started < 1000, 'cancellation is prompt, not the remaining poll interval');
});

test('admission delay stays finite and bounded for every attempt (TASK-2830)', () => {
  const delays = Array.from({ length: 20 }, (_, index) => admissionDelayMs(POLICY, index + 1));
  assert.deepEqual(delays.slice(0, 5), [100, 200, 400, 800, 800]);
  assert.equal(Math.max(...delays), POLICY.maxDelayMs);
  assert.ok(delays.every(delay => delay > 0 && delay <= POLICY.maxDelayMs));
});

test('verification-gate and custom-agent capacity waits are typed policies on this owner (TASK-2830)', () => {
  const gate = gateAdmissionPolicy('verification:git');
  assert.equal(gate.resource, 'verification:verification:git', 'waiters of the same resource share one reported line');
  for (const policy of [gate, CUSTOM_CAPACITY_ADMISSION_POLICY]) {
    assert.ok(policy.initialDelayMs > 0 && policy.maxDelayMs >= policy.initialDelayMs);
    assert.equal(policy.maxWaitMs, null, 'a lease-backed slot is bounded by its caller, not by an admission timer');
    assert.ok(policy.progressEveryMs === null || policy.progressEveryMs > 0);
  }
});

test('admission waiters delegate to the shared owner instead of owning a poll loop (TASK-2830)', () => {
  for (const file of ['src/adapters/process/gate-admission.ts', 'src/adapters/agents/custom-capacity.ts']) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.match(source, /waitForAdmission/, `${file} must wait through the shared owner`);
    assert.doesNotMatch(source, /while \(!lease\)|do \{\s*await pause/, `${file} must not keep a private admission loop`);
  }
});

test('cancelled admission never acquires a free resource (TASK-2830)', async () => {
  const controller = new AbortController(); controller.abort();
  let probes = 0;
  const result = await waitForAdmission(() => { probes++; return 'lease'; }, POLICY, { signal: controller.signal });
  assert.equal(probes, 0); assert.equal(result.acquired, false);
});

test('synchronous port driver uses the same wait accounting and cancellation policy (TASK-2830)', () => {
  let clock = 0; let probes = 0;
  const delays: number[] = [];
  const result = waitForAdmissionSync(() => ++probes === 4 ? 'released' : null, POLICY, {
    now: () => clock, pause: ms => { clock += ms; delays.push(ms); },
  });
  assert.equal(result.value, 'released'); assert.equal(result.attempts, 4);
  assert.deepEqual(delays, [100, 200, 400]); assert.equal(result.waitedMs, 700);
  const controller = new AbortController(); controller.abort();
  assert.equal(waitForAdmissionSync(() => assert.fail('no acquisition after cancellation'), POLICY, { signal: controller.signal }).attempts, 0);
});
