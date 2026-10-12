import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { startPiWorker } from '../../../src/adapters/agents/pi-worker-client.js';
import { resolveConfiguration } from '../../../src/composition/config.js';
import { mkdtemp } from '../../helpers/temp-dir.js';

// Owns the real IPC/process boundary; SDK semantics stay in pi-runner's unit suite.
const worker = { command: process.execPath, args: ['--import', import.meta.resolve('tsx'), path.resolve('test/fixtures/pi-worker/runner.ts')] };

test('Pi workers isolate concurrent SDK/tool environments and preserve stream, resume and result metadata (TASK-2668.08)', { timeout: 15000 }, async t => {
  const worktree = mkdtemp('pi-worker-contract-');
  const children: ChildProcess[] = [];
  t.after(() => { for (const child of children) { if (child.exitCode === null) { child.kill('SIGKILL'); } } });
  const parentValue = process.env.PI_WORKER_TEST_VALUE;
  let cleared = 0;
  const launch = (value: string, sessionId: string) => {
    const environment = { ...process.env, PARALLIX_NO_BUBBLEWRAP: '1', PI_WORKER_TEST_VALUE: value, TYPESAFE_API_KEY: 'secret-sentinel' };
    const configuration = resolveConfiguration(environment);
    let output = '';
    const result = startPiWorker({ configuration, prompt: 'respond', worktree, resume: true, sessionId,
      teeOptions: { stdoutSink: { write(chunk) { output += chunk; } }, stderrSink: { write() {} }, onSpawn: child => children.push(child) },
    }, { command: 'pi', args: [], options: { env: environment } }, async () => { cleared++; }, worker);
    return result.then(result => ({ result, output }));
  };
  const [first, second] = await Promise.all([launch('first', 'existing'), launch('second', 'missing')]);
  assert.equal(process.env.PI_WORKER_TEST_VALUE, parentValue);
  assert.equal(first.result.status, 0, first.result.stderr);
  assert.equal(first.result.stdout, 'resumed:first:first:stripped');
  assert.equal(second.result.stdout, 'new:second:second:stripped');
  assert.equal(cleared, 1);
  assert.equal(first.result.sessionId, 'worker-session');
  assert.equal(first.result.telemetry?.totalTokens, 6);
  assert.equal(first.result.model, 'fixture-model');
  assert.match(first.output, /streamed-before-result/);
  assert.match(second.output, /stored Pi session is unavailable/);
});

test('Pi worker interruption settles and reaps the isolated process (TASK-2668.08)', { timeout: 15000 }, async t => {
  const worktree = mkdtemp('pi-worker-interrupt-');
  const environment = { ...process.env, PARALLIX_NO_BUBBLEWRAP: '1' };
  let child: ChildProcess | undefined;
  t.after(() => child?.kill('SIGKILL'));
  const result = await startPiWorker({ configuration: resolveConfiguration(environment), prompt: 'hang', worktree,
    teeOptions: { stdoutSink: { write() {} }, stderrSink: { write() {} }, onSpawn(spawned) { child = spawned; spawned.kill('SIGTERM'); } },
  }, { command: 'pi', args: [], options: { env: environment } }, async () => {}, worker);
  assert.equal(result.status, 1);
  // The client can settle from a failed IPC send before the kernel reports the exit.
  if (child && child.exitCode === null && child.signalCode === null) { await new Promise(resolve => child!.once('exit', resolve)); }
  assert.equal(child?.signalCode, 'SIGTERM');
  assert.equal(child?.connected, false);
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  test(`parent ${signal} during a Pi worker run re-raises instead of returning a retryable result (TASK-2729)`, { timeout: 15000 }, async t => {
    const worktree = mkdtemp('pi-worker-cancel-');
    const environment = { ...process.env, PARALLIX_NO_BUBBLEWRAP: '1' };
    const before = process.listeners(signal);
    const realKill = process.kill.bind(process);
    const selfSignals: Array<string | number | undefined> = [];
    let child: ChildProcess | undefined;
    process.kill = ((pid: number, sig?: string | number) => {
      if (pid === process.pid && sig !== 0) { selfSignals.push(sig); return true; }
      return realKill(pid, sig as NodeJS.Signals);
    }) as typeof process.kill;
    t.after(() => {
      process.kill = realKill;
      if (child && child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); }
    });
    await startPiWorker({ configuration: resolveConfiguration(environment), prompt: 'hang', worktree,
      teeOptions: { stdoutSink: { write() {} }, stderrSink: { write() {} }, onSpawn(spawned) {
        child = spawned;
        // Invoke only the client's own listener; the test runner owns the others.
        const own = process.listeners(signal).filter(listener => !before.includes(listener));
        setImmediate(() => own.forEach(listener => (listener as (_s: string) => void)(signal)));
      } },
    }, { command: 'pi', args: [], options: { env: environment } }, async () => {}, worker);
    assert.deepEqual(selfSignals, [signal]);
    if (child && child.exitCode === null && child.signalCode === null) { await new Promise(resolve => child!.once('exit', resolve)); }
    assert.equal(child?.connected, false);
  });
}
