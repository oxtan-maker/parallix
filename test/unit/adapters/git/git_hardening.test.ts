import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'child_process';
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
