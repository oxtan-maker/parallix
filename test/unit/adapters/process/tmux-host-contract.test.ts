import { resolveConfiguration } from '../../../../src/composition/config.js';
const environment: NodeJS.ProcessEnv = { ...process.env };
import fs from 'node:fs';
import path from 'node:path';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdtempAt } from '../../../helpers/temp-dir.js';
import { agentRunIdentity as logicalRunIdentity } from '../../../../src/domain/agent-run.js';
import {
  missionSocketPath,
  closeMissionTerminal,
  prepareTmuxLaunch,
  probeTmux,
  reconcileOrphanSessions,
  shellQuote,
  superviseTmuxLaunch,
  tmuxAttachArgs,
  tmuxMissionName,
  type TmuxLaunch,
} from '../../../../src/adapters/process/tmux-host.js';
import { ensurePrivateDir, terminalStateRoot } from '../../../../src/adapters/process/terminal-state-root.js';
import { createTmuxMissionTerminalHost } from '../../../../src/adapters/process/tmux-mission-terminal.js';
import { missionTerminalIdentity } from '../../../../src/adapters/process/mission-terminal-identity.js';

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
  });
  return { fn, calls };
}

test('tmux probe reports an actionable unavailable result (TASK-2643)', () => {
  const missing = probeTmux((() => ({ stdout: '', stderr: '', signal: null,  status: null, error: Object.assign(new Error('spawn tmux ENOENT'), { code: 'ENOENT' }) })), 'linux');
  assert.equal(missing.available, false);
  assert.match(missing.reason!, /ENOENT.*adapters\.terminal\.host/);
  assert.equal(probeTmux((() => ({ stderr: '', signal: null,  status: 0, stdout: 'tmux 3.7c\n' })), 'linux').version, 'tmux 3.7c');
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
  const env = { PARALLIX_TERMINAL_STATE_DIR: path.join(mkdtemp('px-tmux-prep-'), 'state') } satisfies Partial<NonNullable<Parameters<typeof resolveConfiguration>[0]>>;
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

test('a hosted prompt rides in an owner-only stdin file the pane opens, unlinks and redirects, never in argv (TASK-2760)', () => {
  const env = { PARALLIX_TERMINAL_STATE_DIR: path.join(mkdtemp('px-tmux-stdin-'), 'state') };
  const { fn } = fakeSpawnSync('');
  const prompt = Buffer.from('recover — 修复\n');
  const launch = prepareTmuxLaunch({ identity: identity(), spawnIndex: 0, command: 'codex', args: ['exec', '-'], cwd: '/w', env: {}, input: prompt }, { configuration: resolveConfiguration({ ...environment, ...env }), spawnSyncFn: fn });
  const scratch = path.dirname(launch.args[0]);
  const stdinFile = path.join(scratch, 'stdin');
  assert.ok(fs.readFileSync(stdinFile).equals(prompt));
  assert.equal(fs.statSync(stdinFile).mode & 0o777, 0o600);
  const pane = fs.readFileSync(path.join(scratch, 'command.sh'), 'utf8');
  assert.ok(pane.includes(`exec 3< ${shellQuote(stdinFile)} || exit 66\nrm -f ${shellQuote(stdinFile)}\n`));
  assert.ok(pane.includes(`exec ${shellQuote('codex')} ${shellQuote('exec')} ${shellQuote('-')} <&3 3<&-`));
  assert.equal(pane.includes('修复'), false, 'the prompt is not interpolated into the command script');
  launch.cleanup();
  assert.equal(fs.existsSync(scratch), false, 'cleanup removes an unread prompt file');
  const plain = prepareTmuxLaunch({ identity: identity(), spawnIndex: 1, command: 'codex', args: ['exec'], cwd: '/w', env: {} }, { configuration: resolveConfiguration({ ...environment, ...env }), spawnSyncFn: fn });
  assert.equal(fs.readFileSync(path.join(path.dirname(plain.args[0]), 'command.sh'), 'utf8').includes('<&3'), false, 'without input the pane terminal stays stdin');
  plain.cleanup();
});

// TASK-2704 launch-path measurement: a whole `px` command hosted in the mission terminal is the owning
// process and keeps the operator's decision keys; the tmux server and every argv stay credential-free.
test('a hosted px command keeps decision keys in its private pane environment only (TASK-2704)', () => {
  const env = { PARALLIX_TERMINAL_STATE_DIR: path.join(mkdtemp('px-tmux-keys-'), 'state') } satisfies Partial<NonNullable<Parameters<typeof resolveConfiguration>[0]>>;
  const keys = { TYPESAFE_API_KEY: 'sentinel-typesafe', OPENROUTER_API_KEY: 'sentinel-openrouter', AI_GATEWAY_API_KEY: 'sentinel-gateway' };
  const { fn } = fakeSpawnSync('');
  const launch = prepareTmuxLaunch({ identity: identity('task-1', 'review'), spawnIndex: 0, command: 'px', args: ['review', 'task-1'], cwd: '/work',
    env: { ...keys, PARALLIX_MISSION_TERMINAL: 'task-1' } }, { configuration: resolveConfiguration({ ...environment, ...env }), spawnSyncFn: fn });
  const scratch = path.dirname(launch.args[0]);
  const paneEnv = fs.readFileSync(path.join(scratch, 'pane.env'), 'utf8');
  for (const [name, value] of Object.entries(keys)) {
    assert.ok(paneEnv.includes(`export ${name}='${value}'`), `${name} reaches the owning px process`);
    for (const file of ['host.sh', 'pane.sh', 'command.sh']) {
      assert.equal(fs.readFileSync(path.join(scratch, file), 'utf8').includes(value), false, `${file} must not embed ${name}`);
    }
    assert.equal(launch.args.join(' ').includes(value), false);
  }
  launch.cleanup();
});

test('the console px wrapper cannot re-enter itself from an operator rc file (TASK-2675)', () => {
  const env = { PARALLIX_TERMINAL_STATE_DIR: path.join(mkdtemp('px-tmux-wrap-'), 'state') } satisfies Partial<NonNullable<Parameters<typeof resolveConfiguration>[0]>>;
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
  const env = { PARALLIX_TERMINAL_STATE_DIR: path.join(mkdtemp('px-tmux-adopt-'), 'state') } satisfies Partial<NonNullable<Parameters<typeof resolveConfiguration>[0]>>;
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
  const child = Object.assign(new childProcess.ChildProcess(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true });
  const firstAttach = Object.assign(new childProcess.ChildProcess(), { kill: () => true });
  const secondAttach = Object.assign(new childProcess.ChildProcess(), { kill: () => true });
  const spawned: string[] = [];
  context.mock.method(childProcess, 'spawn', ((command: string) => {
    spawned.push(command);
    return spawned.length === 1 ? child : spawned.length === 2 ? firstAttach : secondAttach;
  }));
  context.mock.method(childProcess, 'execFile', ((_command: string, _args: string[], _options: object, callback: (error: Error | null) => void) => {
    callback(null);
    return Object.assign(new PassThrough(), { kill: () => true });
  }));
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
      if (command === 'tmux') { spawnedClient = true; return client; }
      return host;
    });
    const execFile = context.mock.method(childProcess, 'execFile', (_command: string, _args: readonly string[], _options: object, callback: (error: Error | null) => void) => {
      setImmediate(() => callback(null));
      return readiness;
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
  });
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
  const env = { PARALLIX_TERMINAL_STATE_DIR: path.join(mkdtemp('px-mission-sweep-'), 'state') } satisfies Partial<NonNullable<Parameters<typeof resolveConfiguration>[0]>>;
  const socket = missionSocketPath(identity(), resolveConfiguration(env));
  ensurePrivateDir(path.dirname(socket));
  fs.writeFileSync(socket, '');
  const { fn, calls } = fakeSpawnSync('active-parallix-a1-dead\t111\t900\nreview-codex-a1-live\t222\t900\nconsole\t\t');
  assert.deepEqual(reconcileOrphanSessions(identity(), { configuration: resolveConfiguration({ ...environment, ...env }), spawnSyncFn: fn, allRoles: true, isAlive: pid => pid === 222 || pid === 900 }), ['active-parallix-a1-dead']);
  assert.equal(calls.some(call => call.includes('=task-1:review-codex-a1-live')), false);
});

test('the mission host port reads owned sessions, encodes dotted ids and types every probe failure (TASK-2661, TASK-2749)', t => {
  // Covered runs lengthen TMPDIR; this case owns the short-path legacy contract.
  // The overlong-root case above owns compact socket fallback behavior.
  const root = mkdtempAt('/tmp', 'px-tmux-port-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const env = { PARALLIX_TERMINAL_STATE_DIR: path.join(root, 'state') };
  const configuration = resolveConfiguration(env);
  const dotted = { ...identity('task-2622.18'), ...missionTerminalIdentity({ repositoryKey: 'abc123', missionId: 'task-2622.18' }) };
  const calls: string[][] = [];
  let reply: Record<string, unknown> = {};
  let windows = 'console\t\t\nexecute-codex-a1-x-s0-1\t11\t42\nreview-claude-a1-y-s0-2\t12\t\nexecute-codex-a1-z-s0-3\t\t\n';
  const host = createTmuxMissionTerminalHost({ configuration, repositoryKey: 'abc123', spawnSyncFn: ((_command: string, args: string[]) => {
    calls.push(args);
    if (Object.keys(reply).length > 0) { return { status: 1, stdout: '', stderr: '', ...reply }; }
    if (args.includes('list-sessions')) { return { status: 0, stdout: 'task-2622_18\nlegacy-run\n' }; }
    if (args.includes('list-windows')) { return { status: 0, stdout: windows }; }
    return { status: 0, stdout: 'pane marker\n' };
  }) as never });
  assert.deepEqual(host.sessions(dotted), { ok: true, sessions: null }, 'no socket file: definitively absent, without running tmux');
  assert.equal(calls.length, 0);
  const socket = missionSocketPath(dotted, configuration);
  assert.equal(path.basename(socket), 'task-2622_18.sock', 'dotted ids use the injective native name earlier releases created');
  fs.mkdirSync(path.dirname(socket), { recursive: true });
  fs.writeFileSync(socket, '');
  assert.deepEqual(host.sessions(dotted), { ok: true, sessions: { owned: 'task-2622_18', others: ['legacy-run'], operations: [
    { name: 'execute-codex-a1-x-s0-1', started: true, runId: null }, { name: 'review-claude-a1-y-s0-2', started: false, runId: null },
  ] } }, 'finished windows that cleared both PIDs are not operations');
  assert.deepEqual(calls.at(-1)?.slice(0, 5), ['-S', socket, 'list-windows', '-t', '=task-2622_18']);
  assert.deepEqual(host.capture(dotted, 'task-2622_18', 'execute-codex-a1-x-s0-1'), { ok: true, output: 'pane marker\n' });
  assert.equal(calls.at(-1)?.at(-1), '=task-2622_18:execute-codex-a1-x-s0-1');
  host.capture(dotted, 'task-2622_18', null);
  assert.equal(calls.at(-1)?.at(-1), '=task-2622_18:console');
  windows = '';
  reply = { error: Object.assign(new Error('spawnSync tmux ETIMEDOUT'), { code: 'ETIMEDOUT' }) };
  assert.deepEqual(host.sessions(dotted), { ok: false, reason: 'timeout', detail: 'tmux did not answer within 1000 ms' });
  assert.equal(host.capture(dotted, 'task-2622_18', null).ok, false);
  reply = { error: Object.assign(new Error('spawnSync tmux ENOENT'), { code: 'ENOENT' }), status: null };
  assert.equal((host.sessions(dotted) as { reason: string }).reason, 'host-missing', 'missing tmux is not reported as absence');
  reply = { stderr: 'no server running on /tmp/x' };
  assert.deepEqual(host.sessions(dotted), { ok: true, sessions: null }, 'a stale socket without a server is absence');
  reply = { stderr: 'unexpected' };
  assert.equal((host.sessions(dotted) as { reason: string }).reason, 'failed');
  assert.ok(calls.every(args => ['list-sessions', 'list-windows', 'capture-pane'].includes(args[2])), 'the reader never mutates the server');
});

test('native mission names are injective, lossless for canonical ids and refuse invalid ids (TASK-2749)', () => {
  const configuration = resolveConfiguration({ PARALLIX_TERMINAL_STATE_DIR: path.join(mkdtemp('px-tmux-names-'), 'state') });
  const ids = ['task-1.2', 'task-1-2', 'task-12', 'px-0012', 'adhoc-a.b-c'];
  assert.equal(new Set(ids.map(id => tmuxMissionName(id))).size, ids.length);
  assert.equal(new Set(ids.map(id => missionSocketPath({ repositoryKey: 'abc123', missionId: id }, configuration))).size, ids.length);
  assert.equal(tmuxMissionName('task-2622.18'), 'task-2622_18');
  for (const invalid of ['TASK-1', 'task-1_2', 'task-1:2', '../task-1', 'task-1.']) {
    assert.throws(() => missionSocketPath({ repositoryKey: 'abc123', missionId: invalid }, configuration), /Invalid mission slug/);
  }
  assert.throws(() => missionSocketPath({ repositoryKey: '../x', missionId: 'task-1' }, configuration), /Invalid repository key/);
  assert.throws(() => prepareTmuxLaunch({ identity: identity(), runId: '../../foreign', spawnIndex: 0, command: 'sh', args: [], cwd: '/tmp', env: {} }, { configuration }), /valid retained capture id/);
});

test('a presented launch draws the readable view on the pane and relays raw bytes to the host separately (TASK-2735)', () => {
  const env = { PARALLIX_TERMINAL_STATE_DIR: path.join(mkdtemp('px-tmux-pres-'), 'state') } satisfies Partial<NonNullable<Parameters<typeof resolveConfiguration>[0]>>;
  const { fn } = fakeSpawnSync('');
  const configuration = resolveConfiguration({ ...environment, ...env });
  const plain = prepareTmuxLaunch({ identity: identity(), spawnIndex: 0, command: 'claude', args: [], cwd: '/work', env: {} }, { configuration, spawnSyncFn: fn });
  const presented = prepareTmuxLaunch({ identity: identity(), spawnIndex: 1, command: 'claude', args: [], cwd: '/work', env: {}, presenter: { command: 'px', args: ['--claude-stream-presenter'] } }, { configuration, spawnSyncFn: fn });
  const files = (launch: TmuxLaunch) => { const scratch = path.dirname(launch.args[0]); return { host: fs.readFileSync(launch.args[0], 'utf8'), pane: fs.readFileSync(path.join(scratch, 'pane.sh'), 'utf8') }; };
  const [before, after] = [files(plain), files(presented)];
  assert.doesNotMatch(before.pane, /presenter/, 'unpresented launches keep the verbatim pane');
  assert.match(before.host, /tee -a/);
  assert.match(after.pane, /tee .*raw.* < .*agent\.out.* \| 'px' '--claude-stream-presenter' &/);
  assert.match(after.pane, /wait "\$presenter"/, 'the pane drains the presenter before reporting the exit status');
  assert.match(after.pane, /status=\$\?\nwait/, 'the command status is captured before waiting');
  assert.match(after.host, /cat '[^']*\/raw' &/, 'the host relays the raw stream to the supervisor');
  assert.doesNotMatch(after.host, /tee -a/, 'the transcript receives only the rendered pane');
  plain.cleanup();
  presented.cleanup();
});

function agentRunIdentity(input: Omit<Parameters<typeof logicalRunIdentity>[0], 'repositoryId'> & { repositoryKey: string }) {
  return { ...logicalRunIdentity({ ...input, repositoryId: input.repositoryKey }), repositoryKey: input.repositoryKey };
}


test('terminal observation exposes the retained run id and an explicit execution probe (TASK-2749)', () => {
  const root = mkdtemp('px-native-run-observation-');
  const configuration = resolveConfiguration({ PARALLIX_TERMINAL_STATE_DIR: root });
  const owned = identity();
  const socket = missionSocketPath(owned, configuration);
  fs.mkdirSync(path.dirname(socket), { recursive: true });
  fs.writeFileSync(socket, '');
  let alive: boolean | null = true;
  const host = createTmuxMissionTerminalHost({ configuration, repositoryKey: 'abc123', executionAlive: () => alive, spawnSyncFn: ((_command: string, args: string[]) => ({ status: 0,
    stdout: args.includes('list-sessions') ? 'task-1\n' : 'native-window\t11\t12\texecute-claude-a1-abc\n',
  })) as never });
  const observation = () => { const result = host.sessions(owned); assert.equal(result.ok, true); return result.ok ? result.sessions!.operations[0] : null; };
  assert.equal(observation()!.runId, 'execute-claude-a1-abc');
  assert.equal(observation()!.execution, true);
  alive = false;
  assert.equal(observation()!.execution, false);
  alive = null;
  assert.equal(observation()!.execution, null, 'unknown liveness remains unknown');
});
