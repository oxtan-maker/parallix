import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'child_process';
import { mockModule, installModuleMocks } from './lib/module-mock.js';
const git = mockModule<typeof import('../src/adapters/git/git.js')>('../src/adapters/git/git.js', import.meta.url);
await installModuleMocks();
const { mock } = test;

test('git function defaults stdio to ignore stdin', async () => {
  let capturedOptions: Record<string, unknown> | null = null;

  mock.module('node:child_process', {
// @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
    fallback: true,
    exports: {
      ...childProcess,
      spawnSync: (_cmd: string, _args: string[], options: Record<string, unknown>) => {
        capturedOptions = options;
        return { status: 0, stdout: '', stderr: '' };
      },
    },
  });

  const { git: gitFn } = await import('../src/adapters/git/git.js?mock=' + Date.now());
  gitFn(['status']);
  assert.deepEqual(capturedOptions!.stdio, ['ignore', 'pipe', 'pipe']);
});

test('git function allows overriding stdio', async () => {
  mock.restoreAll();
  let capturedOptions: Record<string, unknown> | null = null;

  mock.module('node:child_process', {
// @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
    fallback: true,
    exports: {
      ...childProcess,
      spawnSync: (_cmd: string, _args: string[], options: Record<string, unknown>) => {
        capturedOptions = options;
        return { status: 0, stdout: '', stderr: '' };
      },
    },
  });

  const { git: gitFn } = await import('../src/adapters/git/git.js?mock=' + Date.now());
  gitFn(['status'], { stdio: 'inherit' });
  assert.equal(capturedOptions!.stdio, 'inherit');
});

test('run function defaults stdio to ignore stdin', async () => {
  mock.restoreAll();
  let capturedOptions: Record<string, unknown> | null = null;

  mock.module('node:child_process', {
// @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
    fallback: true,
    exports: {
      ...childProcess,
      spawnSync: (_cmd: string, _args: string[], options: Record<string, unknown>) => {
        capturedOptions = options;
        return { status: 0, stdout: '', stderr: '' };
      },
    },
  });

  const { run } = await import('../src/adapters/git/git.js?mock=' + Date.now());
  run('echo', ['hello']);
  assert.deepEqual(capturedOptions!.stdio, ['ignore', 'pipe', 'pipe']);
});
