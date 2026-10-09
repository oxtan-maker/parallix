import { resolveConfiguration } from '../../../../src/composition/config.js';
import path from 'node:path';
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from '../../../helpers/temp-dir.js';
import { parseAttachCliRequest, parseHistoryCliRequest, createHistoryCommand } from '../../../../src/interfaces/cli/run-history.js';
import { attachRun, createRunHistoryPort, resolveRunHistoryScope } from '../../../../src/adapters/cli/commands/run-history.js';
import { missionSocketPath } from '../../../../src/adapters/process/tmux-host.js';

test('history arguments parse with an optional slug before the verb (TASK-2643)', () => {
  assert.deepEqual(parseHistoryCliRequest(['list']), { verb: 'list', slug: undefined, json: false });
  assert.deepEqual(parseHistoryCliRequest(['task-1', 'search', 'E401', '--run', 'execute-codex-a1-x', '--stream', 'stderr', '--max', '5', '--json']),
    { verb: 'search', slug: 'task-1', json: true, pattern: 'E401', regex: false, runId: 'execute-codex-a1-x', stream: 'stderr', maxHits: 5 });
  assert.deepEqual(parseHistoryCliRequest(['show', 'run:execute-codex-a1-x:stdout@10+4', '--context', '40']),
    { verb: 'show', slug: undefined, json: false, ref: 'run:execute-codex-a1-x:stdout@10+4', context: 40 });
  assert.throws(() => parseHistoryCliRequest(['search']), /Usage: px history/);
  assert.throws(() => parseHistoryCliRequest(['search', 'x', '--stream', 'tty']), /stdout or stderr/);
  assert.throws(() => parseHistoryCliRequest(['list', '--role', 'execute']), /unknown flag --role/);
  assert.deepEqual(parseAttachCliRequest(['task-1', '--close']), { slug: 'task-1', readOnly: false, list: false, close: true });
  assert.throws(() => parseAttachCliRequest(['--close', '--read-only']), /cannot be combined/);
  assert.deepEqual(parseAttachCliRequest(['--read-only']), { readOnly: true, list: false });
  assert.throws(() => parseAttachCliRequest(['--role', 'execute']), /unknown flag/);
  assert.throws(() => parseAttachCliRequest(['--run', 'run-1']), /unknown flag/);
});

test('history from inside a Mission worktree refuses another Mission (TASK-2643)', () => {
  const deps = { inferSlugFn: () => 'task-1', resolveWorktreeFn: (slug: string) => `/repo-${slug}` };
  assert.equal(resolveRunHistoryScope(undefined, deps).slug, 'task-1');
  assert.throws(() => resolveRunHistoryScope('task-2', deps), /scoped to this worktree's Mission \(task-1\)/);
  const outside = { inferSlugFn: (explicit: string | undefined) => explicit ?? null, resolveWorktreeFn: (slug: string) => `/repo-${slug}` };
  assert.equal(resolveRunHistoryScope('task-2', outside).scope.runsDir, path.join('/repo-task-2', '.workflow', 'run-history', 'task-2'));
  assert.throws(() => resolveRunHistoryScope(undefined, { ...outside, inferSlugFn: () => null }), /slug is required/);
});

test('history show rejects a malformed reference and attach explains why nothing is attachable (TASK-2643)', async () => {
  const worktree = mkdtemp('px-history-cli-');
  const deps = { inferSlugFn: () => 'task-1', resolveWorktreeFn: () => worktree, repositoryKeyFn: () => 'repo', spawnSyncFn: (() => ({ status: 0, stdout: '' })) as never };
  const lines: string[] = [];
  const history = createHistoryCommand(createRunHistoryPort(deps), line => lines.push(line));
  await assert.rejects(history(['show', '/etc/passwd']), /Not a run-history reference/);
  await history(['list']);
  assert.deepEqual(lines, ['No retained agent runs for this Mission.']);
  assert.throws(() => attachRun({ readOnly: false, list: false }, deps), /Nothing to attach: no mission terminal/);
});


test('attach finds a stopped mission terminal without any agent history (TASK-2643)', () => {
  const worktree = mkdtemp('px-idle-attach-');
  const state = path.join(worktree, 'state');
  const env = { PARALLIX_TERMINAL_STATE_DIR: state };
  const socket = missionSocketPath({ repositoryKey: 'repo', missionId: 'task-1' }, resolveConfiguration(env));
  fs.mkdirSync(path.dirname(socket), { recursive: true });
  fs.writeFileSync(socket, '');
  const calls: string[][] = [];
  const lines: string[] = [];
  const deps = {
    inferSlugFn: () => 'task-1', resolveWorktreeFn: () => worktree, repositoryKeyFn: () => 'repo',
    configuration: resolveConfiguration(env), isTTY: true, log: (line: string) => lines.push(line),
    spawnSyncFn: ((_command: string, args: string[]) => {
      calls.push(args);
      return { status: 0, stdout: 'task-1\t\t\t0\n' };
    }) as never,
  };
  attachRun({ readOnly: true, list: true }, deps);
  assert.deepEqual(lines, ['task-1  session=task-1']);
  attachRun({ readOnly: true, list: false }, deps);
  assert.deepEqual(calls.at(-1), ['-S', socket, 'attach-session', '-r', '-t', '=task-1']);
});
