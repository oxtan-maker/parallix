

import { resolveConfiguration } from '../../../src/composition/config.js';
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { childProcessDouble } from '../../fixtures/child-process-double.js';
import { spawn as realSpawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mockModule, installModuleMocks } from '../../lib/module-mock.js';
const captureOpencodeExportModule = mockModule<typeof import('../../../src/adapters/agents/opencode-export.js')>('../../../src/adapters/agents/opencode-export.js', import.meta.url);
await installModuleMocks();
test.afterEach(() => mock.restoreAll());
const { captureOpencodeExport } = captureOpencodeExportModule;
'use strict';

test('captureOpencodeExport returns the full stdout JSON on clean exit', async () => {
  const expected = JSON.stringify({ info: { tokens: { input: 1, output: 2 } } });
  const spawn: NonNullable<NonNullable<Parameters<typeof captureOpencodeExport>[1]>["spawn"]> = (cmd, args, opts) => {
    // Exercise a real child's stdout fd without starting a JS runtime merely
    // to emit a constant. Child CPU counts against this capture contract too.
    return realSpawn('printf', ['%s', expected], opts);
  };
  const result = await captureOpencodeExport('ses_x', { configuration: resolveConfiguration(process.env), spawn });
  assert.equal(result, expected);
});

test('captureOpencodeExport times out and kills a non-exiting export child', async () => {
  const child = childProcessDouble();
  const spawn: NonNullable<NonNullable<Parameters<typeof captureOpencodeExport>[1]>["spawn"]> = () => child;
  const result = await captureOpencodeExport('ses_hang', { configuration: resolveConfiguration(process.env), spawn, timeoutMs: 50 });
  assert.equal(result, null, 'must degrade to null, not hang');
  assert.equal(child.killed, true, 'hung export child must be killed');
});

test('captureOpencodeExport fails explicitly when output exceeds maxBytes', async () => {
  const spawn: NonNullable<NonNullable<Parameters<typeof captureOpencodeExport>[1]>["spawn"]> = (cmd, args, opts) => {
    return realSpawn('node', ['-e', 'process.stdout.write(Buffer.alloc(200, "{").toString())'], opts);
  };
  const result = await captureOpencodeExport('ses_big', { configuration: resolveConfiguration(process.env), spawn, maxBytes: 100, timeoutMs: 1000 });
  assert.equal(result, null, 'oversize export must fail explicitly, not truncate');
});

test('captureOpencodeExport resolves null when spawn throws', async () => {
  const spawn: NonNullable<NonNullable<Parameters<typeof captureOpencodeExport>[1]>["spawn"]> = () => { throw new Error('opencode not found'); };
  assert.equal(await captureOpencodeExport('ses_x', { configuration: resolveConfiguration(process.env), spawn }), null);
});

test('captureOpencodeExport removes its owned temporary directory after launch error and timeout', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-export-cleanup-'));
  try {
    assert.equal(await captureOpencodeExport('ses_launch', { configuration: resolveConfiguration(process.env), tmpDir, spawn: () => { throw new Error('ENOENT'); } }), null);
    assert.deepEqual(fs.readdirSync(tmpDir), []);
    const child = childProcessDouble();
    assert.equal(await captureOpencodeExport('ses_timeout', { configuration: resolveConfiguration(process.env), tmpDir, timeoutMs: 20, spawn: () => child }), null);
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
    const result = await captureOpencodeExport('ses_keep', { configuration: resolveConfiguration(process.env),
      tmpDir,
      retainTemp: true,
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
  const child = childProcessDouble();
  const spawn: NonNullable<NonNullable<Parameters<typeof captureOpencodeExport>[1]>["spawn"]> = () => child;
  const p = captureOpencodeExport('ses_x', { configuration: resolveConfiguration(process.env), spawn });
  child.emit('error', new Error('spawn ENOENT'));
  assert.equal(await p, null);
});

test('captureOpencodeExport returns null for missing session id', async () => {
  assert.equal(await captureOpencodeExport('', { configuration: resolveConfiguration(process.env), spawn: () => childProcessDouble() }), null);
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
  const spawn: NonNullable<NonNullable<Parameters<typeof captureOpencodeExport>[1]>["spawn"]> = (cmd, args, opts) => {
    return realSpawn('node', ['-e', spawnCode], opts);
  };

  const result = await captureOpencodeExport('ses_large', { configuration: resolveConfiguration(process.env), spawn, timeoutMs: 30000 });
  assert.equal(result, largePayload, 'full large payload must be captured without truncation');
  assert.equal(result.length, largePayload.length, 'byte count must match original');
  assert.doesNotThrow(() => JSON.parse(result), 'captured output must be valid JSON');
});

test('export preserves launch candidate precedence and deduplication (TASK-2787)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-parity-'));
  const candidates = [path.join(root, 'custom'), path.join(root, 'path', 'opencode'),
    path.join(root, '.opencode', 'bin', 'opencode'), path.join(root, '.local', 'bin', 'opencode')];
  try {
    for (const file of candidates) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, '');
      fs.chmodSync(file, 0o755);
    }
    const configuration = resolveConfiguration({ HOME: root, PATH: path.delimiter + path.dirname(candidates[1]) + path.delimiter, OPENCODE_BIN: candidates[0] });
    const capture = async (config: typeof configuration, expected: string) => {
      const result = await captureOpencodeExport('ses_parity', { configuration: config, tmpDir: root, env: { EXTRA: 'forwarded' },
        spawn: (command, args, options) => {
          assert.equal(command, expected);
          assert.deepEqual(args, ['export', 'ses_parity']);
          assert.equal(options.env?.EXTRA, 'forwarded');
          const stdio = options.stdio as readonly unknown[];
          fs.writeSync(stdio[1] as number, '{"parity":true}');
          const child = childProcessDouble();
          queueMicrotask(() => child.emit('close', 0));
          return child;
        }
      });
      assert.equal(result, '{"parity":true}');
    };
    for (const [index, expected] of [candidates[0], 'opencode', candidates[2], candidates[3], 'opencode'].entries()) {
      await capture(configuration, expected);
      if (index < candidates.length) { fs.chmodSync(candidates[index], 0o644); }
    }
    const duplicate = resolveConfiguration({ HOME: root, PATH: path.delimiter + path.dirname(candidates[1]) + path.delimiter, OPENCODE_BIN: candidates[2] });
    const access = mock.method(fs, 'accessSync', () => { throw new Error('missing'); });
    await capture(duplicate, 'opencode');
    assert.deepEqual(access.mock.calls.map(call => call.arguments[0]), [candidates[2], candidates[1], candidates[3]]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
