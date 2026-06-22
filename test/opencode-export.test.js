'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { captureOpencodeExport } = require('../lib/agents/opencode-export');

// Build a fake child process whose stdout we can drive, and record whether it
// was killed. `autoClose` controls whether the child ever exits on its own.
function makeFakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.killed = false;
  child.kill = () => { child.killed = true; };
  return child;
}

test('captureOpencodeExport returns the full stdout JSON on clean exit', async () => {
  const payload = JSON.stringify({ info: { tokens: { input: 1, output: 2 } } });
  const child = makeFakeChild();
  const spawn = () => child;
  const p = captureOpencodeExport('ses_x', { spawn });
  // Emit the payload in two chunks, then close.
  child.stdout.emit('data', Buffer.from(payload.slice(0, 10)));
  child.stdout.emit('data', Buffer.from(payload.slice(10)));
  child.emit('close', 0, null);
  assert.equal(await p, payload);
});

test('captureOpencodeExport times out and kills a non-exiting export child', async () => {
  const child = makeFakeChild();
  const spawn = () => child;
  // Child never emits close — only the timeout can unblock us.
  const result = await captureOpencodeExport('ses_hang', { spawn, timeoutMs: 50 });
  assert.equal(result, null, 'must degrade to null, not hang');
  assert.equal(child.killed, true, 'hung export child must be killed');
});

test('captureOpencodeExport fails explicitly when output exceeds maxBytes', async () => {
  const child = makeFakeChild();
  const spawn = () => child;
  const p = captureOpencodeExport('ses_big', { spawn, maxBytes: 100, timeoutMs: 1000 });
  // Emit more than the cap; the document prefix would otherwise be retained
  // and parse to garbage. We require an explicit null instead.
  child.stdout.emit('data', Buffer.alloc(50, 0x7b));
  child.stdout.emit('data', Buffer.alloc(60, 0x7d));
  const result = await p;
  assert.equal(result, null, 'oversize export must fail explicitly, not truncate');
  assert.equal(child.killed, true, 'oversize export child must be killed');
});

test('captureOpencodeExport resolves null when spawn throws', async () => {
  const spawn = () => { throw new Error('opencode not found'); };
  assert.equal(await captureOpencodeExport('ses_x', { spawn }), null);
});

test('captureOpencodeExport resolves null on child error event', async () => {
  const child = makeFakeChild();
  const spawn = () => child;
  const p = captureOpencodeExport('ses_x', { spawn });
  child.emit('error', new Error('spawn ENOENT'));
  assert.equal(await p, null);
});

test('captureOpencodeExport returns null for missing session id', async () => {
  assert.equal(await captureOpencodeExport('', { spawn: () => makeFakeChild() }), null);
});
