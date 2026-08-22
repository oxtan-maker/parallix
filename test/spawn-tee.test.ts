// @ts-nocheck -- TASK-2328: partial test doubles from ESM seam migration; resolve in follow-up


import fs from 'fs';
import os from 'os';
import path from 'path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import childProcess from 'node:child_process';
import { Writable } from 'node:stream';
import { mockModule, installModuleMocks } from './lib/module-mock.js';
const spawnAndTeeModule = mockModule<typeof import('../src/adapters/process/spawn-tee.js')>('../src/adapters/process/spawn-tee.js', import.meta.url);
await installModuleMocks();
test.afterEach(() => mock.restoreAll());
const { spawnAndTee, DEFAULT_MAX_TAIL_BYTES } = spawnAndTeeModule;
'use strict';

const { mock } = test;

function noopSink() {
  return new Writable({ write(chunk, enc, cb) { cb(); } });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createMockChild(config = {}) {
  const child = new EventEmitter();
// @ts-expect-error -- Legacy fixture intentionally accesses runtime-only `pid` absent from its inferred mock shape.
  child.pid = config.pid || 1234;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();

  const emitChunks = (stream, chunks = [], delayMs = 0) => {
    chunks.forEach((chunk, index) => {
      const payload = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
// @ts-expect-error -- Legacy fixture intentionally accesses runtime-only `emit` absent from its inferred mock shape.
      setTimeout(() => stream.emit('data', payload), delayMs + index * (config.chunkGapMs || 0));
    });
  };

// @ts-expect-error -- Legacy fixture intentionally accesses runtime-only `error` absent from its inferred mock shape.
  if (config.error) {
// @ts-expect-error -- Legacy fixture intentionally accesses runtime-only `emit` absent from its inferred mock shape.
    setImmediate(() => child.emit('error', config.error));
  } else {
// @ts-expect-error -- Legacy fixture intentionally accesses runtime-only `stdout` absent from its inferred mock shape.
    emitChunks(child.stdout, config.stdoutChunks, config.stdoutDelayMs || 0);
// @ts-expect-error -- Legacy fixture intentionally accesses runtime-only `stderr` absent from its inferred mock shape.
    emitChunks(child.stderr, config.stderrChunks, config.stderrDelayMs || 0);
// @ts-expect-error -- Legacy fixture intentionally accesses runtime-only `closeDelayMs` absent from its inferred mock shape.
    const closeDelayMs = config.closeDelayMs ?? Math.max(config.stdoutDelayMs || 0, config.stderrDelayMs || 0) + 1;
// @ts-expect-error -- Legacy fixture intentionally accesses runtime-only `status` absent from its inferred mock shape.
    const status = config.status === undefined ? 0 : config.status;
// @ts-expect-error -- Legacy fixture intentionally accesses runtime-only `signal` absent from its inferred mock shape.
    const signal = config.signal === undefined ? null : config.signal;
    setTimeout(() => child.emit('close', status, signal), closeDelayMs);
  }

  return child;
}

async function withMockSpawn(config, fn) {
  const observed = [];
  const mocked = mock.method(childProcess, 'spawn', (command, args, options) => {
    observed.push({ command, args, options });
    return createMockChild(config);
  });
  try {
    return await fn(observed);
  } finally {
    mocked.mock.restore();
  }
}

test('spawnAndTee retains the full transcript when output stays under the cap', async () => {
  const result = await withMockSpawn({
    stdoutChunks: ['hello'],
    stderrChunks: ['world'],
    status: 0
  }, async () => spawnAndTee('mock-node', [], {
    stdoutSink: noopSink(),
    stderrSink: noopSink()
  }));
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'hello');
  assert.equal(result.stderr, 'world');
});

test('spawnAndTee bounds the in-memory transcript via maxTailBytes', async () => {
  // Regression for round-5 finding 2: previously every chunk was retained for
  // the lifetime of the spawn, so a chatty agent could push the harness into
  // O(total output) memory. Now we keep only a bounded tail.
  const cap = 1024;
  const totalChunks = 200;
  const chunkSize = 200; // 200 * 200 = 40 KiB total -> well above the 1 KiB cap
  const script = `
    const chunk = 'x'.repeat(${chunkSize});
    let i = 0;
    function tick() {
      if (i++ >= ${totalChunks}) { process.stdout.write('END'); return; }
      process.stdout.write(chunk);
      setImmediate(tick);
    }
    tick();
  `;
  const result = await withMockSpawn({
    stdoutChunks: Array.from({ length: totalChunks }, () => 'x'.repeat(chunkSize)).concat(['END']),
    status: 0
  }, async () => spawnAndTee('mock-node', [], {
    stdoutSink: noopSink(),
    stderrSink: noopSink(),
    maxTailBytes: cap
  }));
  assert.equal(result.status, 0);
  // The retained tail must not exceed the cap (small overshoot tolerance for
  // the final chunk push, but never close to the unbounded total of 40 KiB).
  assert.ok(
    result.stdout.length <= cap,
    `expected tail length <= ${cap}, got ${result.stdout.length}`
  );
  // The most recent bytes ("END") must still be present at the end so a real
  // limit-hit phrase emitted just before exit would still be detectable.
  assert.ok(result.stdout.endsWith('END'), `expected tail to end with "END", got: ...${result.stdout.slice(-16)}`);
});

test('spawnAndTee tail buffer preserves enough context for limit-hit detection', async () => {
  // The detector clips ~200 chars around the matched phrase; the bounded tail
  // must keep both the match and the surrounding reset-time context.
  const script = `
    process.stdout.write('x'.repeat(8 * 1024));
    process.stderr.write("Claude usage limit reached. Your limit will reset at 5pm (UTC).");
    process.exit(1);
  `;
  const result = await withMockSpawn({
    stdoutChunks: ['x'.repeat(8 * 1024)],
    stderrChunks: ['Claude usage limit reached. Your limit will reset at 5pm (UTC).'],
    status: 1
  }, async () => spawnAndTee('mock-node', [], {
    stdoutSink: noopSink(),
    stderrSink: noopSink(),
    maxTailBytes: 4 * 1024
  }));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Claude usage limit reached\. Your limit will reset at 5pm \(UTC\)\./);
});

test('spawnAndTee exposes a sane DEFAULT_MAX_TAIL_BYTES', () => {
  // The default must be large enough for typical limit-hit messages and small
  // enough to bound memory in a long autonomous-review session.
  assert.equal(typeof DEFAULT_MAX_TAIL_BYTES, 'number');
  assert.ok(DEFAULT_MAX_TAIL_BYTES >= 8 * 1024);
  assert.ok(DEFAULT_MAX_TAIL_BYTES <= 1024 * 1024);
});

test('spawnAndTee reports no-output intervals until the child writes output', async () => {
  const diagnostics = [];
  const result = await withMockSpawn({
    stdoutChunks: ['ready'],
    stdoutDelayMs: 75,
    status: 0,
    closeDelayMs: 90
  }, async () => spawnAndTee('mock-node', [], {
    stdoutSink: noopSink(),
    stderrSink: noopSink(),
    noOutputWatchdog: {
      initialDelayMs: 20,
      intervalMs: 20,
      onNoOutput: event => diagnostics.push(event)
    }
  }));

  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'ready');
  assert.ok(diagnostics.length >= 1, 'expected at least one no-output diagnostic before delayed stdout');
  assert.equal(typeof diagnostics[0].pid, 'number');
  assert.ok(diagnostics[0].elapsedMs >= 0);
});

test('spawnAndTee continues liveness reports after visible output until the child settles', async () => {
  const diagnostics = [];
  const result = await withMockSpawn({
    stdoutChunks: ['ready'],
    stdoutDelayMs: 5,
    status: 0,
    closeDelayMs: 75
  }, async () => spawnAndTee('mock-node', [], {
    stdoutSink: noopSink(),
    stderrSink: noopSink(),
    noOutputWatchdog: {
      initialDelayMs: 20,
      intervalMs: 20,
      onNoOutput: event => diagnostics.push(event)
    }
  }));

  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'ready');
  assert.ok(diagnostics.length >= 2, 'expected periodic liveness reports after visible output while the child remains open');
});

test('spawnAndTee liveness watchdog never kills, signals, or cancels the child', async () => {
  // task-2386 AC #3: the watchdog is purely observational. Even across many
  // liveness reports it must not touch the child's lifecycle — the result may
  // only come from the child's own close event.
  const diagnostics = [];
  const lifecycleCalls = [];
  const mocked = mock.method(childProcess, 'spawn', () => {
    const child = createMockChild({ status: 0, closeDelayMs: 90 });
    child.kill = (...args) => { lifecycleCalls.push(['kill', ...args]); return true; };
    child.disconnect = () => { lifecycleCalls.push(['disconnect']); };
    return child;
  });
  let result;
  try {
    result = await spawnAndTee('mock-node', [], {
      stdoutSink: noopSink(),
      stderrSink: noopSink(),
      noOutputWatchdog: {
        initialDelayMs: 15,
        intervalMs: 15,
        onNoOutput: event => diagnostics.push(event)
      }
    });
  } finally {
    mocked.mock.restore();
  }

  assert.ok(diagnostics.length >= 2, 'expected repeated liveness reports while the child ran');
  assert.deepEqual(lifecycleCalls, [], 'watchdog must never kill, signal, or disconnect the child');
  assert.equal(result.status, 0, 'result must come from the child closing on its own');
  assert.equal(result.signal, null);
});

test('spawnAndTee liveness reports carry sawOutput and the age of the last output', async () => {
  // task-2386 AC #4 payload contract: callers must be able to word the report
  // truthfully once the agent has already produced visible output.
  const diagnostics = [];
  const result = await withMockSpawn({
    stdoutChunks: ['ready'],
    stdoutDelayMs: 5,
    status: 0,
    closeDelayMs: 75
  }, async () => spawnAndTee('mock-node', [], {
    stdoutSink: noopSink(),
    stderrSink: noopSink(),
    noOutputWatchdog: {
      initialDelayMs: 20,
      intervalMs: 20,
      onNoOutput: event => diagnostics.push(event)
    }
  }));

  assert.equal(result.status, 0);
  const afterOutput = diagnostics.filter(event => event.sawOutput);
  assert.ok(afterOutput.length >= 1, 'expected at least one report flagged as post-output');
  assert.ok(afterOutput[0].msSinceLastOutput >= 0);
  assert.ok(afterOutput[0].msSinceLastOutput <= afterOutput[0].elapsedMs);
});

test('spawnAndTee treats stdout before the first interval as visible output', async () => {
  const diagnostics = [];
  const result = await withMockSpawn({
    stdoutChunks: ['hello'],
    status: 0
  }, async () => spawnAndTee('mock-node', [], {
    stdoutSink: noopSink(),
    stderrSink: noopSink(),
    noOutputWatchdog: {
      initialDelayMs: 1000,
      intervalMs: 20,
      onNoOutput: event => diagnostics.push(event)
    }
  }));

  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'hello');
  assert.deepEqual(diagnostics, []);
});

test('spawnAndTee treats stderr before the first interval as visible output', async () => {
  const diagnostics = [];
  const result = await withMockSpawn({
    stderrChunks: ['warn'],
    status: 0
  }, async () => spawnAndTee('mock-node', [], {
    stdoutSink: noopSink(),
    stderrSink: noopSink(),
    noOutputWatchdog: {
      initialDelayMs: 1000,
      intervalMs: 20,
      onNoOutput: event => diagnostics.push(event)
    }
  }));

  assert.equal(result.status, 0);
  assert.equal(result.stderr, 'warn');
  assert.deepEqual(diagnostics, []);
});

test('spawnAndTee clears no-output watchdog on clean exit before first interval', async () => {
  const diagnostics = [];
  const result = await withMockSpawn({
    status: 0,
    closeDelayMs: 1
  }, async () => spawnAndTee('mock-node', [], {
    stdoutSink: noopSink(),
    stderrSink: noopSink(),
    noOutputWatchdog: {
      initialDelayMs: 25,
      intervalMs: 20,
      onNoOutput: event => diagnostics.push(event)
    }
  }));
  await sleep(50);

  assert.equal(result.status, 0);
  assert.deepEqual(diagnostics, []);
});

test('spawnAndTee clears no-output watchdog on spawn error', async () => {
  const diagnostics = [];
  const result = await withMockSpawn({
    error: new Error('ENOENT')
  }, async () => spawnAndTee('missing-node', [], {
    stdoutSink: noopSink(),
    stderrSink: noopSink(),
    noOutputWatchdog: {
      initialDelayMs: 20,
      intervalMs: 20,
      onNoOutput: event => diagnostics.push(event)
    }
  }));
  await sleep(40);

  assert.equal(result.status, null);
  assert.ok(result.error);
  assert.deepEqual(diagnostics, []);
});

test('spawnAndTee clears no-output watchdog on signal exit', async () => {
  const diagnostics = [];
  const result = await withMockSpawn({
    signal: 'SIGTERM',
    status: null,
    closeDelayMs: 1
  }, async () => spawnAndTee('mock-node', [], {
    stdoutSink: noopSink(),
    stderrSink: noopSink(),
    noOutputWatchdog: {
      initialDelayMs: 25,
      intervalMs: 30,
      onNoOutput: event => diagnostics.push(event)
    }
  }));
  await sleep(50);

  assert.equal(result.status, null);
  assert.equal(result.signal, 'SIGTERM');
  assert.deepEqual(diagnostics, []);
});

// ---------- Working-directory propagation ----------

test('spawnAndTee rewrites PWD to the spawned cwd so child CLIs see the mission worktree', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'spawn-tee-pwd-'));
  const parentPwd = process.env.PWD;
  try {
    process.env.PWD = '/tmp/not-the-child-worktree';

    const result = await withMockSpawn({
      stdoutChunks: [JSON.stringify({ cwd: tmpRoot, pwd: tmpRoot })],
      status: 0
    }, async (observed) => spawnAndTee('mock-node', [], {
      cwd: tmpRoot,
      stdoutSink: noopSink(),
      stderrSink: noopSink()
    }).then(res => {
      assert.equal(observed[0].options.cwd, tmpRoot);
      assert.equal(observed[0].options.env.PWD, tmpRoot);
      return res;
    }));

    assert.equal(result.status, 0);
    assert.equal(result.signal, null);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.cwd, tmpRoot);
    assert.equal(parsed.pwd, tmpRoot);
  } finally {
    if (parentPwd === undefined) delete process.env.PWD;
    else process.env.PWD = parentPwd;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('spawnAndTee leaves no-output watchdog intact when no stall cutoff is configured', async () => {
  const result = await withMockSpawn({
    status: 0,
    closeDelayMs: 60
  }, async () => spawnAndTee('mock-node', [], {
    stdoutSink: noopSink(),
    stderrSink: noopSink(),
    noOutputWatchdog: {
      initialDelayMs: 10_000,
      intervalMs: 10_000,
      onNoOutput: () => {}
    }
  }));

  assert.equal(result.status, 0);
});
