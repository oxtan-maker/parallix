'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const childProcess = require('node:child_process');
const { mock } = test;
const { Writable } = require('node:stream');

const { spawnAndTee, DEFAULT_MAX_TAIL_BYTES } = require('../lib/core/spawn-tee');

function noopSink() {
  return new Writable({ write(chunk, enc, cb) { cb(); } });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createMockChild(config = {}) {
  const child = new EventEmitter();
  child.pid = config.pid || 1234;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();

  const emitChunks = (stream, chunks = [], delayMs = 0) => {
    chunks.forEach((chunk, index) => {
      const payload = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      setTimeout(() => stream.emit('data', payload), delayMs + index * (config.chunkGapMs || 0));
    });
  };

  if (config.error) {
    setImmediate(() => child.emit('error', config.error));
  } else {
    emitChunks(child.stdout, config.stdoutChunks, config.stdoutDelayMs || 0);
    emitChunks(child.stderr, config.stderrChunks, config.stderrDelayMs || 0);
    const closeDelayMs = config.closeDelayMs ?? Math.max(config.stdoutDelayMs || 0, config.stderrDelayMs || 0) + 1;
    const status = config.status === undefined ? 0 : config.status;
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
      initialDelayMs: 1000,
      intervalMs: 20,
      onNoOutput: event => diagnostics.push(event)
    }
  }));
  await sleep(1020);

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
      initialDelayMs: 1000,
      intervalMs: 30,
      onNoOutput: event => diagnostics.push(event)
    }
  }));
  await sleep(1020);

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
