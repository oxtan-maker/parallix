import { resolveConfiguration } from '../../../../src/composition/config.js';
const environment: NodeJS.ProcessEnv = { ...process.env };
import fs from 'node:fs';
import path from 'node:path';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
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
  superviseTmuxLaunch,
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
  const a = missionSocketPath(identity('task-1'), resolveConfiguration(env));
  const b = missionSocketPath(identity('task-2'), resolveConfiguration(env));
  const otherRepo = missionSocketPath({ ...identity('task-1'), repositoryKey: 'def456' }, resolveConfiguration(env));
  assert.equal(new Set([a, b, otherRepo]).size, 3);
  assert.ok(a.startsWith(terminalStateRoot(resolveConfiguration(env))) || Buffer.byteLength(path.join(terminalStateRoot(resolveConfiguration(env)), 'abc123', 'task-1.sock')) > 100);
  ensurePrivateDir(path.dirname(a));
  assert.equal(fs.statSync(path.dirname(a)).mode & 0o777, 0o700);
});

test('an overlong configured state root uses a stable private compact socket name (TASK-2643)', () => {
  const root = path.join(mkdtemp('px-tmux-long-root-'), 'x'.repeat(120));
  const env = { PARALLIX_TERMINAL_STATE_DIR: root };
  const first = missionSocketPath(identity(), resolveConfiguration(env));
  const same = missionSocketPath(identity(), resolveConfiguration(env));
  const otherMission = missionSocketPath(identity('task-2'), resolveConfiguration(env));
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
  }, { configuration: resolveConfiguration({ ...environment, ...env }), spawnSyncFn: fn });
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
  assert.ok(host.includes('exec "${SHELL:-/bin/sh}" -i'), 'the retained console is the operator\'s interactive shell so their rc environment returns (TASK-2675)');
  assert.equal(host.includes('exec /bin/sh -i'), false);
  assert.match(host, /env -i /, 'the tmux server itself stays credential-free');
  assert.equal(host.includes('hunter2') || launch.args.join(' ').includes('hunter2'), false, 'credentials never reach argv or the host script');
  assert.match(paneEnv, /export SECRET_TOKEN='hunter2'/);
  assert.doesNotMatch(paneEnv, /bad-name/);
  assert.equal(fs.statSync(path.join(scratch, 'pane.env')).mode & 0o777, 0o600);
  launch.cleanup();
  assert.equal(fs.existsSync(scratch), false);
  assert.ok(calls.some(call => call.includes('kill-window') && call.includes(`=${launch.sessionName}:${launch.windowName}`)));
});

test('the console px wrapper cannot re-enter itself from an operator rc file (TASK-2675)', () => {
  const env = { PARALLIX_TERMINAL_STATE_DIR: path.join(mkdtemp('px-tmux-wrap-'), 'state') };
  const bin = mkdtemp('px-tmux-bin-');
  fs.writeFileSync(path.join(bin, 'px'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const previousPath = environment.PATH;
  environment.PATH = `${bin}${path.delimiter}${previousPath}`;
  try {
    const { fn } = fakeSpawnSync('');
    const launch = prepareTmuxLaunch({ identity: identity(), spawnIndex: 1, command: 'sh', args: [], cwd: '/work', env: {} }, { configuration: resolveConfiguration({ ...environment, ...env }), spawnSyncFn: fn });
    const wrapper = fs.readFileSync(path.join(path.dirname(missionSocketPath(identity(), resolveConfiguration(env))), 'task-1', 'console-bin', 'px'), 'utf8');
    // `eval "$(px shell-init bash)"` in an rc file runs this wrapper again from inside its own Bash child.
    assert.match(wrapper, /if \[ -n "\$PARALLIX_CONSOLE_PX" \]; then exec '[^']*px' "\$@"; fi/);
    assert.match(wrapper, /PARALLIX_CONSOLE_PX=1 exec \/bin\/bash -ic 'unset PARALLIX_CONSOLE_PX; exec "\$@"'/);
    launch.cleanup();
  } finally { environment.PATH = previousPath; }
});

test('restart adoption kills sessions whose host or harness died, only for the same role (TASK-2643)', () => {
  const env = { PARALLIX_TERMINAL_STATE_DIR: path.join(mkdtemp('px-tmux-adopt-'), 'state') };
  const socket = missionSocketPath(identity(), resolveConfiguration(env));
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
  const killed = reconcileOrphanSessions(identity(), { configuration: resolveConfiguration({ ...environment, ...env }), spawnSyncFn: fn, isAlive: (pid) => pid === 222 || pid === 900 });
  assert.deepEqual(killed, ['execute-claude-a1-old', 'execute-codex-a3-harness_gone']);
  assert.equal(calls.some(call => call.includes('review-codex-a1-other')), false, 'another role is never touched');
});

test('attach targets one exact session and supports read-only watching (TASK-2643)', () => {
  assert.deepEqual(tmuxAttachArgs('/s.sock', 'execute-claude-a1-x', false), ['-S', '/s.sock', 'attach-session', '-t', '=execute-claude-a1-x']);
  assert.deepEqual(tmuxAttachArgs('/s.sock', 'execute-claude-a1-x', true), ['-S', '/s.sock', 'attach-session', '-r', '-t', '=execute-claude-a1-x']);
});

test('interactive supervision retries an attach that loses the server/window race (TASK-2643)', async context => {
  const originalStdinTty = process.stdin.isTTY;
  const originalStdoutTty = process.stdout.isTTY;
  Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
  Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
  context.after(() => {
    Object.defineProperty(process.stdin, 'isTTY', { value: originalStdinTty, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: originalStdoutTty, configurable: true });
  });
  const child = Object.assign(new PassThrough(), { stderr: new PassThrough(), kill: () => true }) as unknown as childProcess.ChildProcess;
  const firstAttach = Object.assign(new PassThrough(), { kill: () => true }) as unknown as childProcess.ChildProcess;
  const secondAttach = Object.assign(new PassThrough(), { kill: () => true }) as unknown as childProcess.ChildProcess;
  const spawned: string[] = [];
  context.mock.method(childProcess, 'spawn', ((command: string) => {
    spawned.push(command);
    return spawned.length === 1 ? child : spawned.length === 2 ? firstAttach : secondAttach;
  }) as never);
  context.mock.method(childProcess, 'execFile', ((_command: string, _args: string[], _options: object, callback: (error: Error | null) => void) => {
    callback(null);
    return Object.assign(new PassThrough(), { kill: () => true });
  }) as never);
  const result = superviseTmuxLaunch({ command: 'px', args: [], socketPath: '/tmp/task.sock', sessionName: 'task-1', windowName: 'active', started: () => true, cleanup: () => {} });
  await new Promise(resolve => setTimeout(resolve, 60));
  firstAttach.emit('exit', 1);
  await new Promise(resolve => setTimeout(resolve, 60));
  secondAttach.emit('exit', 0);
  child.emit('close', 6);
  assert.equal(await result, 6);
  assert.deepEqual(spawned, ['px', 'tmux', 'tmux']);
});

for (const clientEvent of ['exit', 'error', 'early-exit', 'early-detach']) {
  test(`supervisor settles after retained interactive client ${clientEvent} (TASK-2670)`, async context => {
    const host = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true });
    const clientKills: string[] = [];
    const client = Object.assign(new EventEmitter(), { kill: (signal?: string) => { clientKills.push(signal || ''); return true; } });
    const readiness = Object.assign(new EventEmitter(), { kill: () => true });
    let spawnedClient = false;
    const spawn = context.mock.method(childProcess, 'spawn', (command: string) => {
      if (command === 'tmux') { spawnedClient = true; return client as never; }
      return host as never;
    });
    const execFile = context.mock.method(childProcess, 'execFile', (_command: string, _args: readonly string[], _options: object, callback: (error: Error | null) => void) => {
      setImmediate(() => callback(null));
      return readiness as never;
    });
    const stdinTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    const stdoutTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });
    let cleaned = 0;
    try {
      const result = superviseTmuxLaunch({ command: 'px', args: [], socketPath: '/tmp/task.sock', sessionName: 'task', windowName: 'console', started: () => true, cleanup: () => { cleaned += 1; } });
      if (clientEvent === 'early-exit') { host.emit('close', 0); }
      await new Promise<void>(resolve => {
        const wait = () => { if (spawnedClient) { resolve(); } else { setImmediate(wait); } };
        wait();
      });
      if (clientEvent === 'early-detach') { client.emit('exit', 0); }
      if (clientEvent !== 'early-exit') { host.emit('close', 0); }
      if (clientEvent !== 'early-detach') { client.emit(clientEvent === 'early-exit' ? 'exit' : clientEvent, clientEvent === 'error' ? new Error('attach failed') : 0); }
      assert.equal(spawn.mock.callCount(), 2, 'an explicit detach must not attach again at command completion');
      assert.equal(await result, 0);
      assert.equal(cleaned, 1);
      assert.deepEqual(clientKills, []);
    } finally {
      spawn.mock.restore();
      execFile.mock.restore();
      if (stdinTTY) { Object.defineProperty(process.stdin, 'isTTY', stdinTTY); } else { delete (process.stdin as { isTTY?: boolean }).isTTY; }
      if (stdoutTTY) { Object.defineProperty(process.stdout, 'isTTY', stdoutTTY); } else { delete (process.stdout as { isTTY?: boolean }).isTTY; }
    }
  });
}

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
  const launch = prepareTmuxLaunch({ identity: identity(), spawnIndex: 0, command: 'sh', args: [], cwd: '/tmp', env: {} }, { configuration: resolveConfiguration(env), spawnSyncFn });
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
  const socket = missionSocketPath(identity(), resolveConfiguration(env));
  ensurePrivateDir(path.dirname(socket));
  fs.writeFileSync(socket, '');
  const { fn, calls } = fakeSpawnSync('active-parallix-a1-dead\t111\t900\nreview-codex-a1-live\t222\t900\nconsole\t\t');
  assert.deepEqual(reconcileOrphanSessions(identity(), { configuration: resolveConfiguration({ ...environment, ...env }), spawnSyncFn: fn, allRoles: true, isAlive: pid => pid === 222 || pid === 900 }), ['active-parallix-a1-dead']);
  assert.equal(calls.some(call => call.includes('=task-1:review-codex-a1-live')), false);
});

test('read-only terminal capture selects command panes and fails closed (TASK-2661)', async () => {
  const { createTmuxTerminalReader } = await import('../../../../src/adapters/process/tmux-terminal-reader.js');
  const calls: string[][] = [];
  let listing = 'console\t\nexecute\t42\n';
  let status = 0;
  let captureStatus = 0;
  const reader = createTmuxTerminalReader({ configuration: resolveConfiguration({ PARALLIX_TERMINAL_STATE_DIR: '/tmp/px-reader-double' }),
    resolveMissionWorktree: id => id === 'task-1' ? '/isolated' : null,
    repositoryKey: () => 'abc123',
    spawnSyncFn: ((_cmd: string, args: string[]) => {
      calls.push(args);
      return args.includes('list-windows') ? { status, stdout: listing } : { status: captureStatus, stdout: 'progress marker\n' };
    }) as never,
  });
  assert.equal(reader.read('absent').kind, 'unavailable');
  assert.equal(calls.length, 0);
  assert.deepEqual(reader.read('task-1'), { kind: 'live', output: 'progress marker\n' });
  assert.equal(calls.at(-1)?.at(-1), '=task-1:execute');
  listing = 'console\t\nreview\t\n';
  assert.equal(reader.read('task-1').kind, 'live');
  assert.equal(calls.at(-1)?.at(-1), '=task-1:review');
  listing = 'console\t\n';
  assert.equal(reader.read('task-1').kind, 'live');
  assert.equal(calls.at(-1)?.at(-1), '=task-1:console');
  listing = '';
  assert.equal(reader.read('task-1').kind, 'unavailable');
  listing = 'execute\t42\n'; captureStatus = 1;
  assert.equal(reader.read('task-1').kind, 'unavailable');
  status = 1;
  assert.equal(reader.read('task-1').kind, 'unavailable');
  assert.ok(calls.every(args => args.includes('list-windows') || args.includes('capture-pane')));
});
