'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { Writable } = require('node:stream');

const { spawnAndTee, DEFAULT_MAX_TAIL_BYTES } = require('../lib/core/spawn-tee');

function noopSink() {
  return new Writable({ write(chunk, enc, cb) { cb(); } });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

test('spawnAndTee retains the full transcript when output stays under the cap', async () => {
  const result = await spawnAndTee(process.execPath, ['-e', 'process.stdout.write("hello"); process.stderr.write("world");'], {
    stdoutSink: noopSink(),
    stderrSink: noopSink()
  });
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
  const result = await spawnAndTee(process.execPath, ['-e', script], {
    stdoutSink: noopSink(),
    stderrSink: noopSink(),
    maxTailBytes: cap
  });
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
  const result = await spawnAndTee(process.execPath, ['-e', script], {
    stdoutSink: noopSink(),
    stderrSink: noopSink(),
    maxTailBytes: 4 * 1024
  });
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
  const script = `
    setTimeout(() => process.stdout.write('ready'), 75);
  `;
  const result = await spawnAndTee(process.execPath, ['-e', script], {
    stdoutSink: noopSink(),
    stderrSink: noopSink(),
    noOutputWatchdog: {
      initialDelayMs: 20,
      intervalMs: 20,
      onNoOutput: event => diagnostics.push(event)
    }
  });

  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'ready');
  assert.ok(diagnostics.length >= 1, 'expected at least one no-output diagnostic before delayed stdout');
  assert.equal(typeof diagnostics[0].pid, 'number');
  assert.ok(diagnostics[0].elapsedMs >= 0);
});

test('spawnAndTee treats stdout before the first interval as visible output', async () => {
  const diagnostics = [];
  const result = await spawnAndTee(process.execPath, ['-e', 'process.stdout.write("hello"); setTimeout(() => {}, 50);'], {
    stdoutSink: noopSink(),
    stderrSink: noopSink(),
    noOutputWatchdog: {
      initialDelayMs: 1000,
      intervalMs: 20,
      onNoOutput: event => diagnostics.push(event)
    }
  });

  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'hello');
  assert.deepEqual(diagnostics, []);
});

test('spawnAndTee treats stderr before the first interval as visible output', async () => {
  const diagnostics = [];
  const result = await spawnAndTee(process.execPath, ['-e', 'process.stderr.write("warn"); setTimeout(() => {}, 50);'], {
    stdoutSink: noopSink(),
    stderrSink: noopSink(),
    noOutputWatchdog: {
      initialDelayMs: 1000,
      intervalMs: 20,
      onNoOutput: event => diagnostics.push(event)
    }
  });

  assert.equal(result.status, 0);
  assert.equal(result.stderr, 'warn');
  assert.deepEqual(diagnostics, []);
});

test('spawnAndTee clears no-output watchdog on clean exit before first interval', async () => {
  const diagnostics = [];
  const result = await spawnAndTee(process.execPath, ['-e', 'process.exit(0);'], {
    stdoutSink: noopSink(),
    stderrSink: noopSink(),
    noOutputWatchdog: {
      initialDelayMs: 1000,
      intervalMs: 20,
      onNoOutput: event => diagnostics.push(event)
    }
  });
  await sleep(1020);

  assert.equal(result.status, 0);
  assert.deepEqual(diagnostics, []);
});

test('spawnAndTee clears no-output watchdog on spawn error', async () => {
  const diagnostics = [];
  const result = await spawnAndTee('/definitely/missing/workflow-agent', [], {
    stdoutSink: noopSink(),
    stderrSink: noopSink(),
    noOutputWatchdog: {
      initialDelayMs: 20,
      intervalMs: 20,
      onNoOutput: event => diagnostics.push(event)
    }
  });
  await sleep(40);

  assert.equal(result.status, null);
  assert.ok(result.error);
  assert.deepEqual(diagnostics, []);
});

test('spawnAndTee clears no-output watchdog on signal exit', async () => {
  const diagnostics = [];
  const result = await spawnAndTee(process.execPath, ['-e', "setTimeout(() => process.kill(process.pid, 'SIGTERM'), 10);"], {
    stdoutSink: noopSink(),
    stderrSink: noopSink(),
    noOutputWatchdog: {
      initialDelayMs: 1000,
      intervalMs: 30,
      onNoOutput: event => diagnostics.push(event)
    }
  });
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

    const result = await spawnAndTee(process.execPath, ['-e', 'process.stdout.write(JSON.stringify({ cwd: process.cwd(), pwd: process.env.PWD })); process.exit(0);'], {
      cwd: tmpRoot,
      stdoutSink: noopSink(),
      stderrSink: noopSink()
    });

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
  const result = await spawnAndTee(process.execPath, ['-e', 'setTimeout(() => process.exit(0), 60);'], {
    stdoutSink: noopSink(),
    stderrSink: noopSink(),
    noOutputWatchdog: {
      initialDelayMs: 10_000,
      intervalMs: 10_000,
      onNoOutput: () => {}
    }
  });

  assert.equal(result.status, 0);
});
