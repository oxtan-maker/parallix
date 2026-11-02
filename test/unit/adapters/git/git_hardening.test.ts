import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'child_process';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { mockModule, installModuleMocks, moduleMockOptions } from '../../../lib/module-mock.js';
const git = mockModule<typeof import('../../../../src/adapters/git/git.js')>('../../../../src/adapters/git/git.js', import.meta.url);
await installModuleMocks();
const { mock } = test;

test('git function defaults stdio to ignore stdin', async () => {
  let capturedOptions: { value: Record<string, unknown> | null } = { value: null };

  mock.module('node:child_process', {
    ...moduleMockOptions({
      ...childProcess,
      spawnSync: (_cmd: string, _args: string[], options: Record<string, unknown>) => {
        capturedOptions.value = options;
        return { status: 0, stdout: '', stderr: '' };
      },
    }),
  });

  const { git: gitFn } = await import('../../../../src/adapters/git/git.js?mock=' + Date.now());
  gitFn(['status']);
  assert.deepEqual(capturedOptions.value!.stdio, ['ignore', 'pipe', 'pipe']);
});

test('git function allows overriding stdio', async () => {
  mock.restoreAll();
  let capturedOptions: { value: Record<string, unknown> | null } = { value: null };

  mock.module('node:child_process', {
    ...moduleMockOptions({
      ...childProcess,
      spawnSync: (_cmd: string, _args: string[], options: Record<string, unknown>) => {
        capturedOptions.value = options;
        return { status: 0, stdout: '', stderr: '' };
      },
    }),
  });

  const { git: gitFn } = await import('../../../../src/adapters/git/git.js?mock=' + Date.now());
  gitFn(['status'], { stdio: 'inherit' });
  assert.equal(capturedOptions.value!.stdio, 'inherit');
});

test('run function defaults stdio to ignore stdin', async () => {
  mock.restoreAll();
  let capturedOptions: { value: Record<string, unknown> | null } = { value: null };

  mock.module('node:child_process', {
    ...moduleMockOptions({
      ...childProcess,
      spawnSync: (_cmd: string, _args: string[], options: Record<string, unknown>) => {
        capturedOptions.value = options;
        return { status: 0, stdout: '', stderr: '' };
      },
    }),
  });

  const { run } = await import('../../../../src/adapters/git/git.js?mock=' + Date.now());
  run('echo', ['hello']);
  assert.deepEqual(capturedOptions.value!.stdio, ['ignore', 'pipe', 'pipe']);
});

/** A spawned child double that writes to the file descriptors runToExit hands it. */
function fakeSpawn(behaviour: (_fds: { out: number; err: number }, _child: EventEmitter & { kill: (_signal: string) => boolean }) => void) {
  const seen: { args: string[]; stdin: unknown; kills: string[] } = { args: [], stdin: null, kills: [] };
  mock.module('node:child_process', {
    ...moduleMockOptions({
      ...childProcess,
      spawn: (_cmd: string, args: string[], options: { stdio: [string, number, number] }) => {
        const [stdin, out, err] = options.stdio;
        // Regular files, not pipes: a descendant holding them cannot delay the result.
        assert.ok(fs.fstatSync(out).isFile() && fs.fstatSync(err).isFile());
        const child = Object.assign(new EventEmitter(), { kill: (signal: string) => { seen.kills.push(signal); setImmediate(() => child.emit('exit', null, signal)); return true; } });
        Object.assign(seen, { args, stdin });
        setImmediate(() => behaviour({ out, err }, child));
        return child;
      },
    }),
  });
  return seen;
}

test('runToExit resolves on the command exit with file-captured output (TASK-2806)', async () => {
  mock.restoreAll();
  const seen = fakeSpawn(({ out, err }, child) => {
    fs.writeSync(out, 'early, final line');
    fs.writeSync(err, 'diagnostic');
    child.emit('exit', 3, null);
  });
  const { runToExit } = await import('../../../../src/adapters/git/git.js?mock=' + Date.now());
  const result = await runToExit('bash', ['-lc', 'check'], { cwd: '/checkout', maxBuffer: 17 });
  assert.deepEqual({ args: seen.args, stdin: seen.stdin, kills: seen.kills }, { args: ['-lc', 'check'], stdin: 'ignore', kills: [] });
  assert.deepEqual({ status: result.status, stdout: result.stdout, stderr: result.stderr }, { status: 3, stdout: 'early, final line', stderr: 'diagnostic' });
});

test('runToExit stops a command whose capture outgrows maxBuffer and fails explicitly (TASK-2806 F2)', async () => {
  mock.restoreAll();
  const seen = fakeSpawn(({ out }) => { fs.writeSync(out, 'x'.repeat(64)); });
  const { runToExit } = await import('../../../../src/adapters/git/git.js?mock=' + Date.now());
  await assert.rejects(runToExit('bash', ['-lc', 'runaway'], { maxBuffer: 32 }), (error: NodeJS.ErrnoException) =>
    error.code === 'ENOBUFS' && /32 byte capture limit/.test(error.message));
  assert.deepEqual(seen.kills, ['SIGTERM'], 'the runaway command is terminated, as spawnSync maxBuffer did');
});

test('runToExit fails a capped capture even when the command exits 0 before the next size check (TASK-2806 F2)', async () => {
  mock.restoreAll();
  const seen = fakeSpawn(({ out }, child) => { fs.writeSync(out, 'x'.repeat(64)); child.emit('exit', 0, null); });
  const { runToExit } = await import('../../../../src/adapters/git/git.js?mock=' + Date.now());
  await assert.rejects(runToExit('bash', ['-lc', 'noisy'], { maxBuffer: 32 }), { code: 'ENOBUFS' });
  assert.deepEqual(seen.kills, [], 'an exited command is not signalled');
});
