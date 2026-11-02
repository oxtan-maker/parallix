// Git subprocess capture contract (TASK-2828.3): a child that produces more than the
// declared capture limit yields an incomplete stream, so the adapter must reject it as a
// typed, actionable failure instead of handing a truncated result back as a clean one.
// Unit tier: node:child_process is a recorded double; no real Git process is spawned.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import * as childProcess from 'node:child_process';
import { moduleMockOptions } from '../../../lib/module-mock.js';

test.afterEach(() => mock.restoreAll());

function mockSpawnSync(fake: (...args: unknown[]) => Record<string, unknown>): void {
  mock.restoreAll();
  mock.module('node:child_process', { ...moduleMockOptions({ ...childProcess, spawnSync: fake }) });
}

function limitError(code: string): Error & { code: string } {
  const error = new Error(`spawnSync git ${code}`) as Error & { code: string };
  error.code = code;
  return error;
}

function thrownBy(run: () => unknown): Error & { code?: string } {
  try { run(); } catch (error) { return error as Error & { code?: string }; }
  throw new Error('expected the call to throw');
}

async function adapter() {
  return (await import(`../../../../src/adapters/git/git.js?mock=${Date.now()}`)) as {
    git: (args: string[], options?: Record<string, unknown>) => unknown;
    run: (command: string, args: string[], options?: Record<string, unknown>) => unknown;
  };
}

test('git rejects truncated output from an exceeded capture limit instead of reporting success (TASK-2828.3)', async () => {
  // spawnSync reports the overflow as ENOBUFS while still returning exit status 0.
  mockSpawnSync(() => ({ status: 0, stdout: 'partial', stderr: '', error: limitError('ENOBUFS') }));
  const { git: gitFn } = await adapter();
  const error = thrownBy(() => gitFn(['-C', '/tmp/repo', 'status', '--porcelain']));
  assert.equal(error.name, 'CommandOutputLimitError');
  assert.equal(error.code, 'ENOBUFS');
  assert.match(error.message, /git status produced more output than its 1048576 byte capture limit allows/);
});

test('run rejects a maxbuffer overflow naming the failing operation (TASK-2828.3)', async () => {
  mockSpawnSync(() => ({ status: null, signal: 'SIGTERM', stdout: 'partial', stderr: '', error: limitError('ERR_CHILD_PROCESS_STDIO_MAXBUFFER') }));
  const { run } = await adapter();
  const error = thrownBy(() => run('git', ['-C', '/tmp/repo', 'diff', 'main..HEAD']));
  assert.equal(error.name, 'CommandOutputLimitError');
  assert.match(error.message, /git diff produced more output than its 1048576 byte capture limit allows/);
});

test('an output-limit failure names only the subcommand, never the arguments it was given (TASK-2828.3)', async () => {
  mockSpawnSync(() => ({ status: 0, stdout: '', stderr: '', error: limitError('ENOBUFS') }));
  const { git: gitFn } = await adapter();
  const error = thrownBy(() => gitFn(['-c', 'http.extraheader=Authorization: Bearer secret-token',
    'fetch', 'https://user:secret-token@forgejo.example/repo.git']));
  assert.equal(error.name, 'CommandOutputLimitError');
  assert.match(error.message, /git fetch produced more output/);
  assert.ok(!error.message.includes('secret-token'), 'the diagnostic must not carry the credential');
  assert.ok(!error.message.includes('forgejo.example'), 'the diagnostic must not carry the remote');
});
