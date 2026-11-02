// Exit settlement: a command finishes when its own process exits, never when a
// descendant holding its output finally lets go, and is never signalled here.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import type { ChildProcess } from 'node:child_process';
import { settleOnExit } from '../../../../src/adapters/config/child-exit.js';

const DRAIN_MS = 30;
// Settlement runs in the check phase after its drain timer. A loaded runner can expire the
// drain timer and this wait in one timers phase, so observe only after that check phase too.
const wait = (ms: number) => new Promise(resolve => setTimeout(() => setImmediate(resolve), ms));

// Positive settlement waits poll to a generous deadline so a starved runner cannot flake them.
async function settledBy(settled: unknown[], ms: number) {
  const deadline = Date.now() + ms;
  while (settled.length === 0 && Date.now() < deadline) { await wait(DRAIN_MS / 3); }
}

function fakeChild() {
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kills: [] as unknown[] });
  Object.assign(child, { kill: (signal: unknown) => { child.kills.push(signal); return true; } });
  const settled: [number | null, NodeJS.Signals | null][] = [];
  const watch = (terminating?: () => boolean) => settleOnExit(child as unknown as ChildProcess,
    (code, signal) => { settled.push([code, signal]); }, { drainMs: DRAIN_MS, ...(terminating ? { terminating } : {}) });
  return { child, settled, watch };
}

test('an exited child settles after a quiet drain while a descendant keeps its pipes open (TASK-2806)', async () => {
  const { child, settled, watch } = fakeChild();
  watch();
  child.emit('exit', 0, null);
  await settledBy(settled, 2000);
  assert.deepEqual(settled, [[0, null]]);
  assert.equal(child.stdout.destroyed && child.stderr.destroyed, true, 'reading stops');
  assert.deepEqual(child.kills, [], 'nothing is signalled');
});

test('a failed exit settles with its own status and signal (TASK-2806)', async () => {
  const { child, settled, watch } = fakeChild();
  watch();
  child.emit('exit', 3, null);
  await settledBy(settled, 2000);
  assert.deepEqual(settled, [[3, null]]);
});

test('buffered output is read, but a writing descendant cannot extend settlement past the drain budget (TASK-2806)', async () => {
  const { child, settled, watch } = fakeChild();
  const received: string[] = [];
  child.stdout.on('data', chunk => { received.push(String(chunk)); });
  watch();
  child.stdout.write('buffered');
  child.emit('exit', 0, null);
  const chatter = setInterval(() => { if (!child.stdout.destroyed) { child.stdout.write('.'); } }, DRAIN_MS / 6);
  try {
    await wait(DRAIN_MS * 2);
    assert.deepEqual(settled, [[0, null]], 'continuous output does not hold settlement open');
    assert.equal(received[0], 'buffered');
    const ingested = received.length;
    await wait(DRAIN_MS);
    assert.equal(received.length, ingested, 'nothing is read after settlement');
    assert.deepEqual(child.kills, [], 'the writer is not signalled');
  } finally { clearInterval(chatter); }
});

test('a live child is never settled or signalled, however quiet (TASK-2806)', async () => {
  const { child, settled, watch } = fakeChild();
  watch();
  await wait(DRAIN_MS * 4);
  assert.deepEqual(settled, []);
  assert.equal(child.stdout.destroyed || child.stderr.destroyed, false);
  assert.deepEqual(child.kills, []);
});

test('a normal close leaves settlement to the caller (TASK-2806)', async () => {
  const { child, settled, watch } = fakeChild();
  watch();
  child.emit('exit', 0, null);
  child.emit('close', 0, null);
  await wait(DRAIN_MS * 3);
  assert.deepEqual(settled, []);
});

test('a cancelled child keeps its pipes for the termination path (TASK-2806)', async () => {
  const { child, settled, watch } = fakeChild();
  watch(() => true);
  child.emit('exit', null, 'SIGTERM');
  await wait(DRAIN_MS * 3);
  assert.deepEqual(settled, []);
  assert.equal(child.stdout.destroyed || child.stderr.destroyed, false);
});
