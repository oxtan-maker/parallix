import { resolveConfiguration } from '../../../../src/composition/config.js';
import path from 'node:path';
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from '../../../helpers/temp-dir.js';
import { parseAttachCliRequest, parseHistoryCliRequest, createHistoryCommand } from '../../../../src/interfaces/cli/run-history.js';
import { attachRun, createRunHistoryPort, resolveRunHistoryMission } from '../../../../src/adapters/cli/commands/run-history.js';
import { agentRunIdentity as logicalRunIdentity } from '../../../../src/domain/agent-run.js';
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
  const deps = { inferSlugFn: () => 'task-1' };
  assert.equal(resolveRunHistoryMission(undefined, deps), 'task-1');
  assert.throws(() => resolveRunHistoryMission('task-2', deps), /scoped to this worktree's Mission \(task-1\)/);
  const outside = { inferSlugFn: (explicit: string | undefined) => explicit ?? null };
  assert.equal(resolveRunHistoryMission('TASK-2', outside), 'task-2', 'an uppercase CLI alias normalizes at the input boundary');
  assert.throws(() => resolveRunHistoryMission(undefined, { ...outside, inferSlugFn: () => null }), /slug is required/);
});

test('history show rejects a malformed reference and attach explains why nothing is attachable (TASK-2643)', async () => {
  const checkout = mkdtemp('px-history-cli-');
  const deps = { inferSlugFn: () => 'task-1', checkout, resolveWorktreeFn: () => null, repositoryKeyFn: () => 'repo', configuration: resolveConfiguration({ PARALLIX_TERMINAL_STATE_DIR: path.join(checkout, 'state') }), spawnSyncFn: (() => ({ status: 0, stdout: '' })) as never };
  const lines: string[] = [];
  const history = createHistoryCommand(createRunHistoryPort(deps), line => lines.push(line));
  await assert.rejects(history(['show', '/etc/passwd']), /Not a run-history reference/);
  await history(['list']);
  assert.deepEqual(lines, ['No retained agent runs for this Mission.']);
  assert.throws(() => attachRun({ readOnly: false, list: false }, { ...deps, isTTY: true }), /Nothing to attach: no mission terminal is live for task-1\. Retained history: px history task-1 list/);
  assert.throws(() => attachRun({ slug: 'task-1_x', readOnly: false, list: false }, { ...deps, inferSlugFn: () => null, isTTY: true }), /not a Mission ID/);
});


test('attach resolves the launch socket and native session for dotted, aliased and DB-owned ids (TASK-2643, TASK-2749)', () => {
  const checkout = mkdtemp('px-idle-attach-');
  const env = { PARALLIX_TERMINAL_STATE_DIR: path.join(checkout, 'state') };
  for (const [input, canonical, native] of [['task-1', 'task-1', 'task-1'], ['TASK-2622.18', 'task-2622.18', 'task-2622_18'], ['px-0042', 'px-0042', 'px-0042']]) {
    // The socket launch created for this Mission (launch derives it from its run identity).
    const socket = missionSocketPath(agentRunIdentity({ repositoryKey: 'repo', missionId: canonical, role: 'execute', family: 'codex', attempt: 1, startedAtMs: 1 }), resolveConfiguration(env));
    fs.mkdirSync(path.dirname(socket), { recursive: true });
    fs.writeFileSync(socket, '');
    const calls: string[][] = [];
    const lines: string[] = [];
    const deps = {
      inferSlugFn: () => null, checkout, resolveWorktreeFn: () => null, repositoryKeyFn: () => 'repo',
      configuration: resolveConfiguration(env), isTTY: true, log: (line: string) => lines.push(line),
      spawnSyncFn: ((_command: string, args: string[]) => {
        calls.push(args);
        return { status: 0, stdout: args.includes('list-sessions') ? `${native}\nother-mission\n` : 'console\t\t\n' };
      }) as never,
    };
    attachRun({ slug: input, readOnly: true, list: true }, deps);
    assert.deepEqual(lines, [`${canonical}  terminal=idle console; retained operations=0`]);
    attachRun({ slug: input, readOnly: true, list: false }, deps);
    assert.deepEqual(calls.at(-1), ['-S', socket, 'attach-session', '-r', '-t', `=${native}`]);
  }
});

function agentRunIdentity(input: Omit<Parameters<typeof logicalRunIdentity>[0], 'repositoryId'> & { repositoryKey: string }) {
  return { ...logicalRunIdentity({ ...input, repositoryId: input.repositoryKey }), repositoryKey: input.repositoryKey };
}
