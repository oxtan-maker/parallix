import { resolveConfiguration } from '../../../../src/composition/config.js';
const environment: NodeJS.ProcessEnv = { ...process.env };


import fs from 'fs';
import os from 'os';
import path from 'path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import childProcess from 'node:child_process';
import { Writable } from 'node:stream';
import { mockModule, installModuleMocks } from '../../../lib/module-mock.js';
import { mkdtemp as registeredMkdtemp } from '../../../helpers/temp-dir.js';
const spawnAndTeeModule = mockModule<typeof import('../../../../src/adapters/process/spawn-tee.js')>('../../../../src/adapters/process/spawn-tee.js', import.meta.url);
await installModuleMocks();
test.afterEach(() => mock.restoreAll());
const { spawnAndTee, DEFAULT_MAX_TAIL_BYTES } = spawnAndTeeModule;
'use strict';

const { mock } = test;

function noopSink() {
  return new Writable({ write(chunk, enc, cb) { cb(); } });
}

function sleep(ms: number|undefined) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

interface MockChildConfig {
  pid?: number;
  chunkGapMs?: number;
  stdoutChunks?: readonly (string | Buffer)[];
  stderrChunks?: readonly (string | Buffer)[];
  stdoutDelayMs?: number;
  stderrDelayMs?: number;
  closeDelayMs?: number;
  status?: number | null;
  signal?: NodeJS.Signals | null;
  error?: Error;
}

function createMockChild(config: MockChildConfig = {}) {
  const child = Object.assign(new EventEmitter(), {
    pid: config.pid || 1234,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: (_signal?: NodeJS.Signals | number) => true,
    disconnect: () => {},
  });

  const emitChunks = (stream: { emit: (arg0: string,arg1: Buffer) => void; }, chunks: readonly (string | Buffer)[] = [], delayMs = 0) => {
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

type ObservedSpawn = { command: string; args: readonly string[]; options: childProcess.SpawnOptions };
async function withMockSpawn<T>(config: MockChildConfig, fn: (observed: ObservedSpawn[]) => Promise<T>): Promise<T> {
  const observed: ObservedSpawn[] = [];
  const mocked = mock.method(childProcess, 'spawn', (command: Parameters<(typeof childProcess)["spawn"]>[0], args: Parameters<(typeof childProcess)["spawn"]>[1], options: Parameters<(typeof childProcess)["spawn"]>[2]) => {
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

test('spawnAndTee reports no-output intervals until the child writes output', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const diagnostics: { command: string; args: string[]; pid: number | undefined; elapsedMs: number; sawOutput: boolean; msSinceLastOutput: number | null; }[] = [];
  const pending = withMockSpawn({
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
  // Advance in steps so recursively scheduled watchdog intervals run before close.
  for (let elapsed = 0; elapsed < 100; elapsed += 5) { t.mock.timers.tick(5); }
  const result = await pending;

  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'ready');
  assert.ok(diagnostics.length >= 1, 'expected at least one no-output diagnostic before delayed stdout');
  assert.equal(typeof diagnostics[0].pid, 'number');
  assert.ok(diagnostics[0].elapsedMs >= 0);
});

test('spawnAndTee continues liveness reports after visible output until the child settles', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const diagnostics: { command: string; args: string[]; pid: number | undefined; elapsedMs: number; sawOutput: boolean; msSinceLastOutput: number | null; }[] = [];
  const pending = withMockSpawn({
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
  // Advance in steps so recursively scheduled watchdog intervals run before close.
  for (let elapsed = 0; elapsed < 100; elapsed += 5) { t.mock.timers.tick(5); }
  const result = await pending;

  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'ready');
  assert.deepEqual(diagnostics.map(event => [event.elapsedMs, event.sawOutput]), [
    [20, true], [40, true], [60, true]
  ], 'reports continue after output and stop when the child closes');
});

test('spawnAndTee liveness watchdog never kills, signals, or cancels the child', async (t) => {
  // task-2386 AC #3: the watchdog is purely observational. Even across many
  // liveness reports it must not touch the child's lifecycle — the result may
  // only come from the child's own close event.
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const diagnostics: { command: string; args: string[]; pid: number | undefined; elapsedMs: number; sawOutput: boolean; msSinceLastOutput: number | null; }[] = [];
  const lifecycleCalls: string[][] = [];
  const mocked = mock.method(childProcess, 'spawn', () => {
    const child = createMockChild({ status: 0, closeDelayMs: 90 });
    child.kill = signal => { lifecycleCalls.push(['kill', ...(signal === undefined ? [] : [String(signal)])]); return true; };
    child.disconnect = () => { lifecycleCalls.push(['disconnect'] as const); };
    return child;
  });
  let result;
  try {
    const pending = spawnAndTee('mock-node', [], {
      stdoutSink: noopSink(),
      stderrSink: noopSink(),
      noOutputWatchdog: {
        initialDelayMs: 15,
        intervalMs: 15,
        onNoOutput: event => diagnostics.push(event)
      }
    });
    for (let elapsed = 0; elapsed < 100; elapsed += 5) { t.mock.timers.tick(5); }
    result = await pending;
  } finally {
    mocked.mock.restore();
  }

  assert.ok(diagnostics.length >= 2, 'expected repeated liveness reports while the child ran');
  assert.deepEqual(lifecycleCalls, [], 'watchdog must never kill, signal, or disconnect the child');
  assert.equal(result.status, 0, 'result must come from the child closing on its own');
  assert.equal(result.signal, null);
});

test('spawnAndTee liveness reports carry sawOutput and the age of the last output', async (t) => {
  // task-2386 AC #4 payload contract: callers must be able to word the report
  // truthfully once the agent has already produced visible output.
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const diagnostics: { command: string; args: string[]; pid: number | undefined; elapsedMs: number; sawOutput: boolean; msSinceLastOutput: number | null; }[] = [];
  const pending = withMockSpawn({
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
  // Advance in steps so recursively scheduled watchdog intervals run before close.
  for (let elapsed = 0; elapsed < 100; elapsed += 5) { t.mock.timers.tick(5); }
  const result = await pending;

  assert.equal(result.status, 0);
  const afterOutput = diagnostics.filter(event => event.sawOutput);
  assert.ok(afterOutput.length >= 1, 'expected at least one report flagged as post-output');
  assert.ok(afterOutput[0].msSinceLastOutput != null);
  assert.ok(afterOutput[0].msSinceLastOutput >= 0);
  assert.ok(afterOutput[0].msSinceLastOutput <= afterOutput[0].elapsedMs);
});

test('spawnAndTee treats stdout before the first interval as visible output', async () => {
  const diagnostics: { command: string; args: string[]; pid: number | undefined; elapsedMs: number; sawOutput: boolean; msSinceLastOutput: number | null; }[] = [];
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
  const diagnostics: { command: string; args: string[]; pid: number | undefined; elapsedMs: number; sawOutput: boolean; msSinceLastOutput: number | null; }[] = [];
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
  const diagnostics: { command: string; args: string[]; pid: number | undefined; elapsedMs: number; sawOutput: boolean; msSinceLastOutput: number | null; }[] = [];
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
  const diagnostics: { command: string; args: string[]; pid: number | undefined; elapsedMs: number; sawOutput: boolean; msSinceLastOutput: number | null; }[] = [];
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
  const diagnostics: { command: string; args: string[]; pid: number | undefined; elapsedMs: number; sawOutput: boolean; msSinceLastOutput: number | null; }[] = [];
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
  const tmpRoot = registeredMkdtemp('spawn-tee-pwd-');
  const parentPwd = environment.PWD;
  try {
    environment.PWD = '/tmp/not-the-child-worktree';

    const result = await withMockSpawn({
      stdoutChunks: [JSON.stringify({ cwd: tmpRoot, pwd: tmpRoot })],
      status: 0
    }, async (observed) => spawnAndTee('mock-node', [], {
      cwd: tmpRoot,
      stdoutSink: noopSink(),
      stderrSink: noopSink()
    }).then(res => {
      assert.equal(observed[0].options.cwd, tmpRoot);
      assert.ok(observed[0].options.env);
      assert.equal(observed[0].options.env.PWD, tmpRoot);
      return res;
    }));

    assert.equal(result.status, 0);
    assert.equal(result.signal, null);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.cwd, tmpRoot);
    assert.equal(parsed.pwd, tmpRoot);
  } finally {
    if (parentPwd === undefined) delete environment.PWD;
    else environment.PWD = parentPwd;
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

test('spawnAndTee marks a real no-output deadline as a bounded timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const signals: (string | number | undefined)[] = [];
  const kill = mock.method(process, 'kill', (_pid: Parameters<(typeof process)["kill"]>[0], signal: Parameters<(typeof process)["kill"]>[1]) => { signals.push(signal); return true; });
  const pending = withMockSpawn({ stdoutChunks: ['Interrupted'], stdoutDelayMs: 10, closeDelayMs: 600, status: 1 }, async () => spawnAndTee('mock-node', [], {
    stdoutSink: noopSink(), stderrSink: noopSink(), noOutputWatchdog: { maxNoOutputMs: 5 },
  }));
  t.mock.timers.tick(5);
  t.mock.timers.tick(250);
  t.mock.timers.tick(250);
  t.mock.timers.tick(95);
  const result = await pending;
  kill.mock.restore();
  assert.equal((result.error as { code?: string }).code, 'NO_OUTPUT_TIMEOUT');
  assert.equal(result.status, null);
  assert.equal(result.signal, null);
  assert.deepEqual(signals, ['SIGINT', 'SIGTERM', 'SIGKILL']);
});

test('spawnAndTee cancels the no-output deadline after visible output', async () => {
  const kill = mock.method(process, 'kill', () => true);
  const result = await withMockSpawn({ stdoutChunks: ['ready'], stdoutDelayMs: 2, closeDelayMs: 20, status: 0 }, async () => spawnAndTee('mock-node', [], {
    stdoutSink: noopSink(), stderrSink: noopSink(),
    noOutputWatchdog: { maxNoOutputMs: 5 },
  }));
  kill.mock.restore();
  assert.equal(result.error, null);
  assert.equal(result.status, 0);
});

test('spawnAndTee installs parent signal forwarding only for detached deadline launches', async () => {
  const before = process.listenerCount('SIGINT');
  await withMockSpawn({ status: 0, closeDelayMs: 1 }, async () => spawnAndTee('mock-node', [], { stdoutSink: noopSink(), stderrSink: noopSink() }));
  assert.equal(process.listenerCount('SIGINT'), before);
});

test('spawnAndTee hands every chunk to the durable capture before the tail bound (TASK-2643)', async () => {
  const captured: Record<'stdout' | 'stderr', Buffer[]> = { stdout: [], stderr: [] };
  const result = await withMockSpawn({
    stdoutChunks: ['first ', 'x'.repeat(2048), ' last'],
    stderrChunks: ['warn'],
    status: 0
  }, async () => spawnAndTee('mock-node', [], {
    stdoutSink: noopSink(),
    stderrSink: noopSink(),
    maxTailBytes: 64,
    capture: { write: (stream, chunk) => captured[stream].push(Buffer.from(chunk)) }
  }));
  assert.equal(result.stdout.includes('first'), false, 'the in-memory tail is still bounded');
  assert.equal(Buffer.concat(captured.stdout).toString(), `first ${'x'.repeat(2048)} last`);
  assert.equal(Buffer.concat(captured.stderr).toString(), 'warn');
});

test('spawnAndTee spawns the terminal host command and cleans it up once (TASK-2643)', async () => {
  const hosted: { launch: { command: string; args: string[]; }; cwd: string; }[] = [];
  let cleanups = 0;
  const terminalHost = {
    host: (launch, context) => {
      hosted.push({ launch, cwd: context.cwd });
      return { command: 'sh', args: ['/state/host.sh'], cleanup: () => { cleanups += 1; } };
    }
  } satisfies import("../../../../src/adapters/process/spawn-tee.js").TerminalHost;
  await withMockSpawn({ stdoutChunks: ['ok'], status: 3 }, async (observed) => {
    const result = await spawnAndTee('agent-cli', ['--flag'], { stdoutSink: noopSink(), stderrSink: noopSink(), terminalHost });
    assert.equal(result.status, 3, 'the hosted command exit status is the launch status');
    assert.equal(observed[0].command, 'sh');
    assert.deepEqual(observed[0].args, ['/state/host.sh']);
  });
  assert.equal(hosted.length, 1);
  assert.ok(hosted[0].launch.args.includes('--flag') || hosted[0].launch.command === 'agent-cli', 'the host receives the (possibly confined) agent command');
  assert.equal(cleanups, 1);
});

test('file stdin reaches terminal hosting as literal arguments without changing exit handling (TASK-2750)', async () => {
  const stdinPath = '/state/prompt $(literal).txt';
  let hosted: { command: string; args: string[] } | undefined;
  await withMockSpawn({ status: 7, stdoutChunks: ['diagnostic'] }, async () => {
    const result = await spawnAndTee('codex', ['exec', '-'], {
      stdinPath, stdoutSink: noopSink(), stderrSink: noopSink(),
      terminalHost: { host: launch => {
        hosted = launch;
        return { ...launch, cleanup() {} };
      } },
    });
    assert.equal(result.status, 7);
    assert.equal(result.stdout, 'diagnostic');
  });
  assert.ok(hosted);
  assert.equal(hosted.command, 'bash');
  assert.deepEqual(hosted.args.slice(0, 3), ['-c', 'exec "$@" < "$0"', stdinPath]);
  assert.deepEqual(hosted.args.slice(-2), ['exec', '-']);
});

test('a launched agent is hosted without decision-provider credentials (TASK-2704)', async () => {
  const names = ['TYPESAFE_API_KEY', 'OPENROUTER_API_KEY', 'AI_GATEWAY_API_KEY'];
  const hostedEnv: NodeJS.ProcessEnv[] = [];
  const terminalHost = { host: (_launch, context) => { hostedEnv.push(context.env); return { command: 'sh', args: ['/state/host.sh'], cleanup: () => {} }; } } satisfies import("../../../../src/adapters/process/spawn-tee.js").TerminalHost;
  const env = { KEEP_ME: '1', ...Object.fromEntries(names.map(name => [name, 'sentinel'])) };
  await withMockSpawn({ stdoutChunks: [], status: 0 }, async () => spawnAndTee('agent-cli', [], { env, stdoutSink: noopSink(), stderrSink: noopSink(), terminalHost }));
  assert.equal(hostedEnv.length, 1);
  for (const name of names) { assert.equal(name in hostedEnv[0], false, `${name} reaches the agent's terminal pane`); }
  assert.equal(hostedEnv[0].KEEP_ME, '1');
});

test('spawnAndTee reports a terminal host that cannot prepare as a launch error (TASK-2643)', async () => {
  const terminalHost = { host: () => { throw Object.assign(new Error('mkfifo failed'), { code: 'EACCES' }); } } satisfies import("../../../../src/adapters/process/spawn-tee.js").TerminalHost;
  await withMockSpawn({ stdoutChunks: ['never'], status: 0 }, async (observed) => {
    const result = await spawnAndTee('agent-cli', [], { stdoutSink: noopSink(), stderrSink: noopSink(), terminalHost });
    assert.equal(result.status, null);
    assert.ok(result.error instanceof Error);
    assert.equal(result.error.message, 'mkfifo failed');
    assert.equal(observed.length, 0, 'nothing is spawned when the host cannot prepare');
  });
});

test('spawnAndTee never passes decision-provider credentials to a launched child (TASK-2675)', async () => {
  const tmpRoot = registeredMkdtemp('spawn-tee-credentials-');
  const names = ['TYPESAFE_API_KEY', 'OPENROUTER_API_KEY', 'AI_GATEWAY_API_KEY'];
  const saved = names.map(name => environment[name]);
  try {
    for (const name of names) { environment[name] = 'sentinel'; }
    await withMockSpawn({ stdoutChunks: [], status: 0 }, async (observed) => spawnAndTee('mock-node', [], {
      cwd: tmpRoot, env: { OPENROUTER_API_KEY: 'sentinel', KEEP_ME: '1' }, stdoutSink: noopSink(), stderrSink: noopSink()
    }).then(res => {
      assert.ok(observed[0].options.env);
      for (const name of names) { assert.equal(name in observed[0].options.env, false, `${name} leaked to the child`); }
      assert.equal(observed[0].options.env.KEEP_ME, '1');
      return res;
    }));
  } finally {
    names.forEach((name, i) => { if (saved[i] === undefined) { delete environment[name]; } else { environment[name] = saved[i]; } });
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('spawnAndTee passes the requested host presentation to the terminal host and keeps raw output in the tail (TASK-2735)', async () => {
  const contexts: (string | undefined)[] = [];
  const terminalHost = { host: (_launch, context) => { contexts.push(context.presentation); return { command: 'sh', args: ['/state/host.sh'], cleanup: () => {} }; } } satisfies import("../../../../src/adapters/process/spawn-tee.js").TerminalHost;
  await withMockSpawn({ stdoutChunks: ['{"type":"result"}\n'], status: 0 }, async (observed) => {
    const result = await spawnAndTee('agent-cli', [], { stdoutSink: noopSink(), stderrSink: noopSink(), terminalHost, hostPresentation: 'claude-stream' });
    assert.equal(result.stdout, '{"type":"result"}\n');
    assert.equal('hostPresentation' in observed[0].options, false, 'the option is not forwarded to child_process.spawn');
  });
  assert.deepEqual(contexts, ['claude-stream']);
});

test('spawnAndTee writes supplied input to a piped stdin and ends it; a closed stdin pipe stays the exit status (TASK-2760)', async () => {
  const input = Buffer.from('prompt — réparation 🚀\n'.repeat(3));
  for (const failWrite of [false, true]) {
    const received: Buffer[] = [];
    let ended = false;
    let stdio: childProcess.StdioOptions | undefined;
    const mocked = mock.method(childProcess, 'spawn', (_command: string, _args: readonly string[], options: childProcess.SpawnOptions) => {
      stdio = options.stdio;
      const stdin = new Writable({
        write(chunk, _enc, cb) { received.push(chunk); cb(failWrite ? Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }) : null); },
        final(cb) { ended = true; cb(); },
      });
      return Object.assign(createMockChild({ status: failWrite ? 1 : 0, closeDelayMs: 5 }), { stdin });
    });
    try {
      const result = await spawnAndTee('agent-cli', ['-'], { stdoutSink: noopSink(), stderrSink: noopSink(), input: input.toString('utf8') });
      assert.equal(stdio?.[0], 'pipe');
      assert.ok(Buffer.concat(received).equals(input), 'exact prompt bytes reach stdin');
      assert.equal(result.status, failWrite ? 1 : 0, 'an unread prompt is reported through the exit status, not a launcher crash');
      if (!failWrite) { assert.equal(ended, true, 'stdin ends with EOF after the prompt'); }
    } finally {
      mocked.mock.restore();
    }
  }
});

test('spawnAndTee keeps stdin inherited without input and hands input to the terminal host instead of a pipe (TASK-2760)', async () => {
  const launches: Parameters<import('../../../../src/adapters/process/spawn-tee.js').TerminalHost['host']>[0][] = [];
  const terminalHost = { host: (launch) => { launches.push(launch); return { command: 'sh', args: ['/state/host.sh'], cleanup: () => {} }; } } satisfies import('../../../../src/adapters/process/spawn-tee.js').TerminalHost;
  await withMockSpawn({ status: 0 }, async (observed) => {
    await spawnAndTee('agent-cli', ['-'], { stdoutSink: noopSink(), stderrSink: noopSink() });
    await spawnAndTee('agent-cli', ['-'], { stdoutSink: noopSink(), stderrSink: noopSink(), terminalHost, input: 'hosted prompt' });
    assert.deepEqual(observed.map(call => call.options.stdio?.[0]), ['inherit', 'inherit']);
  });
  assert.equal(launches.length, 1);
  assert.ok(Buffer.isBuffer(launches[0].input) && launches[0].input.toString('utf8') === 'hosted prompt');
});
