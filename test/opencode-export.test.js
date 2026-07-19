'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { spawn: realSpawn } = require('child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { captureOpencodeExport } = require('../dist/lib/agents/opencode-export');

function makeFakeChild() {
  const child = new EventEmitter();
  // @ts-expect-error TS2339 Property 'stdout' does not exist on type 'EventEmitter<any>'.
  child.stdout = new EventEmitter();
  // @ts-expect-error TS2339 Property 'killed' does not exist on type 'EventEmitter<any>'.
  child.killed = false;
  // @ts-expect-error TS2339 Property 'kill' does not exist on type 'EventEmitter<any>'.
  child.kill = () => { child.killed = true; };
  return child;
}

test('captureOpencodeExport returns the full stdout JSON on clean exit', async () => {
  const expected = JSON.stringify({ info: { tokens: { input: 1, output: 2 } } });
  const encoded = Buffer.from(expected).toString('base64');
  const spawn = (cmd, args, opts) => {
    return realSpawn('node', ['-e', 'process.stdout.write(Buffer.from(process.argv[1], "base64"))', encoded], opts);
  };
  // @ts-expect-error TS2322 Type '(cmd: any, args: any, opts: any) => ChildProcessWithoutNullStreams' is not
  const result = await captureOpencodeExport('ses_x', { spawn });
  assert.equal(result, expected);
});

test('captureOpencodeExport times out and kills a non-exiting export child', async () => {
  const child = makeFakeChild();
  const spawn = () => child;
  // @ts-expect-error TS2322 Type '() => EventEmitter<any>' is not assignable to type '{ (command: string, op
  const result = await captureOpencodeExport('ses_hang', { spawn, timeoutMs: 50 });
  assert.equal(result, null, 'must degrade to null, not hang');
  // @ts-expect-error TS2339 Property 'killed' does not exist on type 'EventEmitter<any>'.
  assert.equal(child.killed, true, 'hung export child must be killed');
});

test('captureOpencodeExport fails explicitly when output exceeds maxBytes', async () => {
  const spawn = (cmd, args, opts) => {
    return realSpawn('node', ['-e', 'process.stdout.write(Buffer.alloc(200, "{").toString())'], opts);
  };
  // @ts-expect-error TS2322 Type '(cmd: any, args: any, opts: any) => ChildProcessWithoutNullStreams' is not
  const result = await captureOpencodeExport('ses_big', { spawn, maxBytes: 100, timeoutMs: 1000 });
  assert.equal(result, null, 'oversize export must fail explicitly, not truncate');
});

test('captureOpencodeExport resolves null when spawn throws', async () => {
  const spawn = () => { throw new Error('opencode not found'); };
  assert.equal(await captureOpencodeExport('ses_x', { spawn }), null);
});

test('captureOpencodeExport removes its owned temporary directory after launch error and timeout', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-export-cleanup-'));
  try {
    assert.equal(await captureOpencodeExport('ses_launch', { tmpDir, spawn: () => { throw new Error('ENOENT'); } }), null);
    assert.deepEqual(fs.readdirSync(tmpDir), []);
    const child = makeFakeChild();
    // @ts-expect-error TS2322 fake child only implements the error/close surface.
    assert.equal(await captureOpencodeExport('ses_timeout', { tmpDir, timeoutMs: 20, spawn: () => child }), null);
    assert.deepEqual(fs.readdirSync(tmpDir), []);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('captureOpencodeExport retains only its owned temporary directory when opted in', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-export-retain-'));
  const operatorFile = path.join(tmpDir, 'operator.log');
  fs.writeFileSync(operatorFile, 'keep');
  try {
    const result = await captureOpencodeExport('ses_keep', {
      tmpDir,
      retainTemp: true,
      // @ts-expect-error TS2322 realSpawn's overload cannot infer the fd-only stderr stream.
      spawn: (cmd, args, opts) => realSpawn('node', ['-e', 'process.stdout.write("{}")'], opts)
    });
    assert.equal(result, '{}');
    const owned = fs.readdirSync(tmpDir).filter((entry) => entry.startsWith('opencode-export-'));
    assert.equal(owned.length, 1);
    assert.ok(fs.existsSync(path.join(tmpDir, owned[0], 'stdout.json')));
    assert.equal(fs.readFileSync(operatorFile, 'utf8'), 'keep');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('captureOpencodeExport resolves null on child error event', async () => {
  const child = makeFakeChild();
  const spawn = () => child;
  // @ts-expect-error TS2322 Type '() => EventEmitter<any>' is not assignable to type '{ (command: string, op
  const p = captureOpencodeExport('ses_x', { spawn });
  child.emit('error', new Error('spawn ENOENT'));
  assert.equal(await p, null);
});

test('captureOpencodeExport returns null for missing session id', async () => {
  // @ts-expect-error TS2322 Type 'EventEmitter<any>' is not assignable to type 'ChildProcess | ChildProcessW
  assert.equal(await captureOpencodeExport('', { spawn: () => makeFakeChild() }), null);
});

test('captureOpencodeExport captures full output with large payloads (regression for pipe-buffer truncation)', async () => {
  // Regression test for task-1345: pipe-buffer data loss caused ~7-8 KB truncation
  // of large (>100 KB) opencode export output. The temp-file fd approach fixes this.
  // Uses a real child process to exercise the actual fd→file capture path.
  const steps = Array.from({ length: 50 }, (_, i) => ({
    type: `step-${i}`,
    content: 'x'.repeat(3000),
    tokens: { input: 20000, output: 266 },
  }));
  const largePayload = JSON.stringify({
    info: { id: 'ses_large', tokens: { input: 522475, output: 6932, cached: 0 } },
    steps,
  });
  assert.ok(largePayload.length >= 140000, `payload must be ≥140 KB, got ${largePayload.length}`);

  // Generate identical payload in child process to avoid CLI argument size limits
  const spawnCode = 'var p={info:{id:"ses_large",tokens:{input:522475,output:6932,cached:0}},steps:[]};for(var i=0;i<50;i++){p.steps.push({type:"step-"+i,content:"x".repeat(3000),tokens:{input:20000,output:266}});}process.stdout.write(JSON.stringify(p));';
  const spawn = (cmd, args, opts) => {
    return realSpawn('node', ['-e', spawnCode], opts);
  };

  // @ts-expect-error TS2322 Type '(cmd: any, args: any, opts: any) => ChildProcessWithoutNullStreams' is not
  const result = await captureOpencodeExport('ses_large', { spawn, timeoutMs: 30000 });
  assert.equal(result, largePayload, 'full large payload must be captured without truncation');
  assert.equal(result.length, largePayload.length, 'byte count must match original');
  assert.doesNotThrow(() => JSON.parse(result), 'captured output must be valid JSON');
});
