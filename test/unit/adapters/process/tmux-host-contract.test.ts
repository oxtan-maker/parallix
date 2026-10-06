import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from '../../../helpers/temp-dir.js';
import { agentRunIdentity } from '../../../../src/domain/agent-run.js';
import {
  missionSocketPath,
  closeMissionTerminal,
  prepareTmuxLaunch,
  probeTmux,
  reconcileOrphanSessions,
  shellQuote,
  tmuxAttachArgs,
} from '../../../../src/adapters/process/tmux-host.js';
import { ensurePrivateDir, terminalStateRoot } from '../../../../src/adapters/process/terminal-state-root.js';

// Doubles only: real tmux runs in test/integration/process/tmux-terminal-host.test.ts.

function identity(missionId = 'task-1', role = 'execute') {
  return agentRunIdentity({ repositoryKey: 'abc123', missionId, role, family: 'claude', attempt: 1, startedAtMs: 1_790_000_000_000 });
}

function fakeSpawnSync(listing: string) {
  const calls: string[][] = [];
  const fn = ((command: string, args: string[]) => {
    calls.push([command, ...args]);
    if (args.includes('list-sessions') || args.includes('list-windows')) { return { status: 0, stdout: listing, stderr: '' }; }
    return { status: 0, stdout: '', stderr: '' };
  }) as never;
  return { fn, calls };
}

test('tmux probe reports an actionable unavailable result (TASK-2643)', () => {
  const missing = probeTmux((() => ({ status: null, error: Object.assign(new Error('spawn tmux ENOENT'), { code: 'ENOENT' }) })) as never, 'linux');
  assert.equal(missing.available, false);
  assert.match(missing.reason!, /ENOENT.*adapters\.terminal\.host/);
  assert.equal(probeTmux((() => ({ status: 0, stdout: 'tmux 3.7c\n' })) as never, 'linux').version, 'tmux 3.7c');
  assert.match(probeTmux(undefined, 'win32').reason!, /Linux and macOS only/);
});

test('each repository and Mission gets its own socket under the owner-only state root (TASK-2643)', () => {
  const env = { PARALLIX_TERMINAL_STATE_DIR: path.join(mkdtemp('px-tmux-root-'), 'state') };
  const a = missionSocketPath(identity('task-1'), env);
  const b = missionSocketPath(identity('task-2'), env);
  const otherRepo = missionSocketPath({ ...identity('task-1'), repositoryKey: 'def456' }, env);
  assert.equal(new Set([a, b, otherRepo]).size, 3);
  assert.ok(a.startsWith(terminalStateRoot(env)) || Buffer.byteLength(path.join(terminalStateRoot(env), 'abc123', 'task-1.sock')) > 100);
  ensurePrivateDir(path.dirname(a));
  assert.equal(fs.statSync(path.dirname(a)).mode & 0o777, 0o700);
});

test('an overlong configured state root uses a stable private compact socket name (TASK-2643)', () => {
  const root = path.join(mkdtemp('px-tmux-long-root-'), 'x'.repeat(120));
  const env = { PARALLIX_TERMINAL_STATE_DIR: root };
  const first = missionSocketPath(identity(), env);
  const same = missionSocketPath(identity(), env);
  const otherMission = missionSocketPath(identity('task-2'), env);
  assert.equal(first, same);
  assert.notEqual(first, otherMission);
  assert.ok(Buffer.byteLength(first) <= 100);
  assert.match(path.basename(first), /^[a-f0-9]{32}\.sock$/);
});

test('a symlinked state directory is refused (TASK-2643)', () => {
  const root = mkdtemp('px-tmux-link-');
  fs.mkdirSync(path.join(root, 'elsewhere'));
  fs.symlinkSync(path.join(root, 'elsewhere'), path.join(root, 'planted'));
  assert.throws(() => ensurePrivateDir(path.join(root, 'planted')), /not a directory/);
});

test('prepared host runs the confined command in the pane and keeps credentials out of argv (TASK-2643)', () => {
  const env = { PARALLIX_TERMINAL_STATE_DIR: path.join(mkdtemp('px-tmux-prep-'), 'state') };
  const { fn, calls } = fakeSpawnSync('');
  const launch = prepareTmuxLaunch({
    identity: identity(), spawnIndex: 1, command: 'bwrap', args: ['--ro-bind', '/', '/', '--', 'claude', "it's"],
    cwd: '/work tree', env: { SECRET_TOKEN: 'hunter2', 'bad-name': 'x' },
  }, { env, spawnSyncFn: fn });
  assert.equal(launch.command, 'sh');
  assert.equal(launch.sessionName, 'task-1');
  assert.match(launch.windowName, /^execute-claude-a1-[a-z0-9]+-s1-/);
  const scratch = path.dirname(launch.args[0]);
  const host = fs.readFileSync(launch.args[0], 'utf8');
  const pane = fs.readFileSync(path.join(scratch, 'command.sh'), 'utf8');
  const paneEnv = fs.readFileSync(path.join(scratch, 'pane.env'), 'utf8');
  assert.ok(pane.includes(`${shellQuote('bwrap')} ${shellQuote('--ro-bind')}`), 'the pane runs the already-confined command');
  assert.ok(pane.includes(shellQuote("it's")));
  assert.match(host, /trap 'cleanup TERM; exit 143' TERM/);
  assert.match(host, /pipe-pane/);
  assert.equal(host.includes('hunter2') || launch.args.join(' ').includes('hunter2'), false, 'credentials never reach argv or the host script');
  assert.match(paneEnv, /export SECRET_TOKEN='hunter2'/);
  assert.doesNotMatch(paneEnv, /bad-name/);
  assert.equal(fs.statSync(path.join(scratch, 'pane.env')).mode & 0o777, 0o600);
  launch.cleanup();
  assert.equal(fs.existsSync(scratch), false);
  assert.ok(calls.some(call => call.includes('kill-window') && call.includes(`=${launch.sessionName}:${launch.windowName}`)));
});

test('restart adoption kills sessions whose host or harness died, only for the same role (TASK-2643)', () => {
  const env = { PARALLIX_TERMINAL_STATE_DIR: path.join(mkdtemp('px-tmux-adopt-'), 'state') };
  const socket = missionSocketPath(identity(), env);
  ensurePrivateDir(path.dirname(socket));
  fs.writeFileSync(socket, '');
  const { fn, calls } = fakeSpawnSync([
    'execute-claude-a1-old\t111\t900\t0',
    'execute-codex-a2-live\t222\t900\t1',
    'execute-codex-a3-harness_gone\t222\t901\t0',
    'review-codex-a1-other\t333\t901\t0',
    'execute-claude-a1-idle\t\t',
    'console\t\t',
  ].join('\n'));
  const killed = reconcileOrphanSessions(identity(), { env, spawnSyncFn: fn, isAlive: (pid) => pid === 222 || pid === 900 });
  assert.deepEqual(killed, ['execute-claude-a1-old', 'execute-codex-a3-harness_gone']);
  assert.equal(calls.some(call => call.includes('review-codex-a1-other')), false, 'another role is never touched');
});

test('attach targets one exact session and supports read-only watching (TASK-2643)', () => {
  assert.deepEqual(tmuxAttachArgs('/s.sock', 'execute-claude-a1-x', false), ['-S', '/s.sock', 'attach-session', '-t', '=execute-claude-a1-x']);
  assert.deepEqual(tmuxAttachArgs('/s.sock', 'execute-claude-a1-x', true), ['-S', '/s.sock', 'attach-session', '-r', '-t', '=execute-claude-a1-x']);
});

test('retired-session cleanup tolerates a concurrent closer and removes transport (TASK-2643)', context => {
  const warnings: string[] = [];
  context.mock.method(console, 'error', (warning: string) => { warnings.push(warning); });
  let inspections = 0;
  const spawnSyncFn = ((_command: string, args: string[]) => {
    if (args.includes('show-option')) { return { status: 0, stdout: '1\n' }; }
    if (args.includes('list-windows')) { return { status: inspections++ === 0 ? 0 : 1, stdout: '' }; }
    return { status: 0, stdout: '' };
  }) as never;
  const env = { PARALLIX_TERMINAL_STATE_DIR: path.join(mkdtemp('px-tmux-race-'), 'state') };
  const launch = prepareTmuxLaunch({ identity: identity(), spawnIndex: 0, command: 'sh', args: [], cwd: '/tmp', env: {} }, { env, spawnSyncFn });
  const scratch = path.dirname(launch.args[0]);
  assert.doesNotThrow(() => launch.cleanup());
  assert.equal(fs.existsSync(scratch), false);
  assert.match(warnings.join('\n'), /cleanup warning.*Cannot inspect/);
});


test('explicit cleanup refuses an owned operation and closes only an idle mission (TASK-2643)', () => {
  const running = fakeSpawnSync('123\n');
  assert.throws(() => closeMissionTerminal('/s.sock', 'task-1', running.fn), /owned operation/);
  assert.equal(running.calls.some(call => call.includes('kill-session')), false);
  const idle = fakeSpawnSync('');
  closeMissionTerminal('/s.sock', 'task-1', idle.fn);
  assert.ok(idle.calls.some(call => call.includes('kill-session') && call.includes('=task-1')));
});


test('mission restart sweeps dead operations across roles and preserves live work and idle shells (TASK-2643)', () => {
  const env = { PARALLIX_TERMINAL_STATE_DIR: path.join(mkdtemp('px-mission-sweep-'), 'state') };
  const socket = missionSocketPath(identity(), env);
  ensurePrivateDir(path.dirname(socket));
  fs.writeFileSync(socket, '');
  const { fn, calls } = fakeSpawnSync('active-parallix-a1-dead\t111\t900\nreview-codex-a1-live\t222\t900\nconsole\t\t');
  assert.deepEqual(reconcileOrphanSessions(identity(), { env, spawnSyncFn: fn, allRoles: true, isAlive: pid => pid === 222 || pid === 900 }), ['active-parallix-a1-dead']);
  assert.equal(calls.some(call => call.includes('=task-1:review-codex-a1-live')), false);
});
