/**
 * Real tmux terminal-host contract (TASK-2643).
 *
 * Boundary: the tmux binary and the launch seam (`spawnAndTee` with the run
 * session from `openRunSession`). Each case owns a private terminal state root
 * and worktree and tears them down — and any tmux server on its sockets — in
 * `finally`, so no case depends on another. Unit doubles live in
 * test/unit/adapters/process/tmux-host-contract.test.ts.
 *
 * Classified integration-local: tmux is a declared workstation dependency
 * and is not on a clean GitHub-hosted runner (test/lib/test-categories.ts).
 */
import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { mkdtempAt } from '../../helpers/temp-dir.js';
import { openRunSession } from '../../../src/adapters/agents/run-session.js';
import { spawnAndTee } from '../../../src/adapters/process/spawn-tee.js';
import { listTmuxSessions, missionSocketPath, missionTerminalCapturePath, prepareTmuxLaunch, reconcileOrphanSessions, tmuxAttachArgs, shellQuote, closeMissionTerminal, retireMissionTerminal, superviseTmuxLaunch } from '../../../src/adapters/process/tmux-host.js';
import { agentRunIdentity } from '../../../src/domain/agent-run.js';
import { hostMissionCommand } from '../../../src/composition/mission-terminal.js';
import { missionRepositoryKey } from '../../../src/adapters/filesystem/mission-repository-key.js';
import { buildBubblewrapArgs, resolveSandboxProfile } from '../../../src/adapters/process/bubblewrap.js';
import { missionRunsDir, runHistoryFileSystem } from '../../../src/adapters/filesystem/run-history-store.js';
import { listRuns, searchRuns } from '../../../src/application/run-history.js';
import { attachRun } from '../../../src/adapters/cli/commands/run-history.js';

const sink = { write: () => true };
const REPO_ROOT = path.join(import.meta.dirname, '..', '..', '..');

interface Fixture {
  root: string;
  env: NodeJS.ProcessEnv;
  worktree(_slug: string): string;
  own(_child: childProcess.ChildProcess): void;
  cleanup(): void;
}

function fixture(): Fixture {
  // Coverage nests TMPDIR deeply; Unix sockets need a short absolute path.
  // mkdtempAt still registers this root for cleanup on forced worker exit.
  const root = mkdtempAt('/tmp', 'px-tmux-it-');
  const env = { ...process.env, PARALLIX_TERMINAL_STATE_DIR: path.join(root, 'state'), PARALLIX_BUBBLEWRAP: '0' };
  const children: childProcess.ChildProcess[] = [];
  let cleaned = false;
  const previous = { state: process.env.PARALLIX_TERMINAL_STATE_DIR, bwrap: process.env.PARALLIX_BUBBLEWRAP };
  // spawnAndTee and the Bubblewrap mask read the process environment.
  process.env.PARALLIX_TERMINAL_STATE_DIR = env.PARALLIX_TERMINAL_STATE_DIR;
  process.env.PARALLIX_BUBBLEWRAP = '0';
  return {
    root,
    env,
    worktree(slug) {
      const dir = path.join(root, `repo-${slug}`);
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    },
    own(child) { children.push(child); },
    cleanup() {
      if (cleaned) { return; }
      cleaned = true;
      for (const child of children) { if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); } }
      const state = env.PARALLIX_TERMINAL_STATE_DIR!;
      for (const dir of fs.existsSync(state) ? fs.readdirSync(state) : []) {
        for (const file of fs.readdirSync(path.join(state, dir)).filter(name => name.endsWith('.sock'))) {
          childProcess.spawnSync('tmux', ['-S', path.join(state, dir, file), 'kill-server'], { stdio: 'ignore' });
        }
      }
      for (const [key, value] of [['PARALLIX_TERMINAL_STATE_DIR', previous.state], ['PARALLIX_BUBBLEWRAP', previous.bwrap]] as const) {
        if (value === undefined) { delete process.env[key]; } else { process.env[key] = value; }
      }
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function session(fx: Fixture, worktree: string, slug: string, family = 'codex', role = 'execute') {
  return openRunSession(
    { worktree, slug, role, family, attempt: 1, log: () => {} },
    { interactive: true, config: () => ({ host: 'tmux', whenUnavailable: 'fail' }), repositoryKey: () => 'itrepo', env: fx.env },
  )!;
}

function scope(worktree: string, slug: string) {
  return { runsDir: missionRunsDir(worktree, slug), fs: runHistoryFileSystem, isAlive: (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } } };
}

function waitFor(predicate: () => boolean, timeoutMs = 3000): void {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) { throw new Error('condition not reached before deadline'); }
    childProcess.spawnSync('sleep', ['0.05']);
  }
}

test('hosted launch returns the agent exit status and keeps history beyond scrollback and the alternate screen', { timeout: 20000 }, async () => {
  const fx = fixture();
  try {
    const worktree = fx.worktree('task-a');
    const run = session(fx, worktree, 'task-a');
    const script = 'echo first-line; i=0; while [ $i -lt 30000 ]; do echo "row $i"; i=$((i+1)); done; printf "\\033[?1049hALT-SCREEN-FAILURE E401\\033[?1049l\\n"; exit 4';
    const result = await spawnAndTee('sh', ['-c', script], { cwd: worktree, stdoutSink: sink, stderrSink: sink, ...run.teeOptions });
    run.finish(result);
    assert.equal(result.status, 4);
    assert.equal(result.stdout.includes('first-line'), false, 'the in-memory tail has lost the start');
    const found = searchRuns(scope(worktree, 'task-a'), { pattern: 'first-line' });
    assert.equal(found.totalHits, 1, 'durable capture kept output tmux scrollback (history-limit 2000) drops');
    assert.equal(searchRuns(scope(worktree, 'task-a'), { pattern: 'ALT-SCREEN-FAILURE' }).totalHits, 1);
    assert.deepEqual(listTmuxSessions(missionSocketPath(run.identity, fx.env)).map(s => s.name), ['task-a'], 'the mission terminal persists after exit');
    assert.equal(fs.existsSync(missionSocketPath(run.identity, fx.env)), true);
  } finally { fx.cleanup(); }
});

test('concurrent Missions get separate servers and separate searchable history', { timeout: 20000 }, async () => {
  const fx = fixture();
  try {
    const [a, b] = [fx.worktree('task-a'), fx.worktree('task-b')];
    const runA = session(fx, a, 'task-a');
    const runB = session(fx, b, 'task-b');
    const launchA = spawnAndTee('sh', ['-c', 'echo MARK-A; sleep 0.4'], { cwd: a, stdoutSink: sink, stderrSink: sink, ...runA.teeOptions });
    const launchB = spawnAndTee('sh', ['-c', 'echo MARK-B; sleep 0.4'], { cwd: b, stdoutSink: sink, stderrSink: sink, ...runB.teeOptions });
    const socketA = missionSocketPath(runA.identity, fx.env);
    const socketB = missionSocketPath(runB.identity, fx.env);
    waitFor(() => listTmuxSessions(socketA).length === 1 && listTmuxSessions(socketB).length === 1);
    assert.notEqual(socketA, socketB);
    assert.deepEqual(listTmuxSessions(socketA).map(s => s.name), ['task-a']);
    const [resultA, resultB] = await Promise.all([launchA, launchB]);
    runA.finish(resultA);
    runB.finish(resultB);
    assert.equal(searchRuns(scope(a, 'task-a'), { pattern: 'MARK-B' }).totalHits, 0, 'Mission A cannot find Mission B output');
    assert.equal(searchRuns(scope(b, 'task-b'), { pattern: 'MARK-B' }).totalHits, 1);
  } finally { fx.cleanup(); }
});

test('cancellation by signal kills the owned agent and preserves the mission terminal', { timeout: 20000 }, async () => {
  const fx = fixture();
  try {
    const worktree = fx.worktree('task-c');
    const run = session(fx, worktree, 'task-c');
    const pidFile = path.join(fx.root, 'agent.pid');
    let hostPid = 0;
    const launch = spawnAndTee('sh', ['-c', `echo $$ > ${pidFile}; exec sleep 30`], {
      cwd: worktree, stdoutSink: sink, stderrSink: sink, ...run.teeOptions,
      onSpawn: (child: { pid?: number }) => { hostPid = child.pid ?? 0; },
    });
    waitFor(() => fs.existsSync(pidFile) && fs.readFileSync(pidFile, 'utf8').trim() !== '');
    const agentPid = Number(fs.readFileSync(pidFile, 'utf8'));
    process.kill(hostPid, 'SIGTERM');
    const result = await launch;
    run.finish(result);
    assert.equal(result.status, 143);
    waitFor(() => { try { process.kill(agentPid, 0); return false; } catch { return true; } });
    assert.deepEqual(listTmuxSessions(missionSocketPath(run.identity, fx.env)).map(s => s.name), [run.identity.missionId]);
  } finally { fx.cleanup(); }
});

test('a launch the pane cannot start reports the failure and cleans up', { timeout: 20000 }, async () => {
  const fx = fixture();
  try {
    const worktree = fx.worktree('task-f');
    const run = session(fx, worktree, 'task-f');
    const result = await spawnAndTee('/nonexistent/agent-cli', ['--x'], { cwd: worktree, stdoutSink: sink, stderrSink: sink, ...run.teeOptions });
    run.finish(result);
    assert.equal(result.status, 127, 'command-not-found propagates as the launch status');
    assert.deepEqual(listTmuxSessions(missionSocketPath(run.identity, fx.env)).map(s => s.name), [run.identity.missionId]);
    assert.equal(listRuns(scope(worktree, 'task-f'))[0].record.exitCode, 127);
  } finally { fx.cleanup(); }
});

test('after a harness crash the orphaned session is adopted, stopped, and its history reads interrupted', { timeout: 20000 }, async () => {
  const fx = fixture();
  try {
    const worktree = fx.worktree('task-r');
    // A child "harness" opens the run session and launches, then is SIGKILLed.
    const harness = `
      import { openRunSession } from ${JSON.stringify(path.join(REPO_ROOT, 'src/adapters/agents/run-session.ts'))};
      import { spawnAndTee } from ${JSON.stringify(path.join(REPO_ROOT, 'src/adapters/process/spawn-tee.ts'))};
      const run = openRunSession({ worktree: ${JSON.stringify(worktree)}, slug: 'task-r', role: 'execute', family: 'codex', attempt: 1, log: () => {} },
        { interactive: true, config: () => ({ host: 'tmux', whenUnavailable: 'fail' }), repositoryKey: () => 'itrepo' });
      spawnAndTee('sh', ['-c', 'echo crash-marker; sleep 30'], { cwd: ${JSON.stringify(worktree)}, stdoutSink: { write: () => true }, stderrSink: { write: () => true }, ...run.teeOptions });
      setInterval(() => {}, 1000);
    `;
    const child = childProcess.spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', harness], { env: fx.env, stdio: 'ignore', cwd: REPO_ROOT });
    fx.own(child);
    const socket = missionSocketPath({ repositoryKey: 'itrepo', missionId: 'task-r' }, fx.env);
    waitFor(() => listTmuxSessions(socket).length === 1, 10000);
    waitFor(() => searchRuns(scope(worktree, 'task-r'), { pattern: 'crash-marker' }).totalHits === 1, 5000);
    // Only the harness dies; its host script and the pane keep running.
    const exited = new Promise(resolve => child.on('exit', resolve));
    process.kill(child.pid!, 'SIGKILL');
    await exited;
    const orphan = listTmuxSessions(socket);
    assert.equal(orphan.length, 1, 'the session outlived its supervisor');
    const killed = reconcileOrphanSessions({ repositoryKey: 'itrepo', missionId: 'task-r', role: 'execute' }, { env: fx.env });
    assert.equal(killed.length, 1);
    assert.match(killed[0], /^execute-codex-/);
    assert.deepEqual(listTmuxSessions(socket).map(s => s.name), ['task-r']);
    const [record] = listRuns(scope(worktree, 'task-r'));
    assert.equal(record.state, 'interrupted');
    assert.ok(record.coverage.some(line => /interrupted/.test(line)));
  } finally { fx.cleanup(); }
});

test('an operator can attach, detach without stopping the run, and reconnect', { timeout: 20000 }, async () => {
  const fx = fixture();
  try {
    const worktree = fx.worktree('task-t');
    const run = session(fx, worktree, 'task-t');
    const release = path.join(fx.root, 'release');
    const launch = spawnAndTee('sh', ['-c', `echo attach-me; while [ ! -e ${release} ]; do sleep 0.05; done; echo released`], { cwd: worktree, stdoutSink: sink, stderrSink: sink, ...run.teeOptions });
    const socket = missionSocketPath(run.identity, fx.env);
    waitFor(() => listTmuxSessions(socket).length === 1);
    const name = listTmuxSessions(socket)[0].name;
    for (const round of [1, 2]) {
      // `script` gives the attaching client the terminal tmux requires.
      const client = childProcess.spawn('script', ['-qfc', ['tmux', ...tmuxAttachArgs(socket, name, true)].join(' '), '/dev/null'], { env: { ...fx.env, TERM: 'xterm' }, stdio: 'ignore' });
      fx.own(client);
      waitFor(() => listTmuxSessions(socket).some(s => s.attached));
      childProcess.spawnSync('tmux', ['-S', socket, 'detach-client', '-s', name]);
      await new Promise(resolve => client.on('exit', resolve));
      assert.equal(listTmuxSessions(socket).length, 1, `round ${round}: detaching leaves the run alive`);
    }
    fs.writeFileSync(release, '');
    const result = await launch;
    run.finish(result);
    assert.equal(result.status, 0);
    assert.equal(searchRuns(scope(worktree, 'task-t'), { pattern: 'released' }).totalHits, 1);
  } finally { fx.cleanup(); }
});

test('a Bubblewrap-confined agent cannot reach the Mission tmux socket', { timeout: 20000 }, async () => {
  const fx = fixture();
  try {
    const worktree = fx.worktree('task-s');
    const run = session(fx, worktree, 'task-s');
    const launch = spawnAndTee('sh', ['-c', 'sleep 1'], { cwd: worktree, stdoutSink: sink, stderrSink: sink, ...run.teeOptions });
    const socket = missionSocketPath(run.identity, fx.env);
    waitFor(() => listTmuxSessions(socket).length === 1);
    const args = buildBubblewrapArgs(resolveSandboxProfile('active', worktree), worktree);
    const probe = childProcess.spawnSync('bwrap', [...args, 'tmux', '-S', socket, 'list-sessions'], { encoding: 'utf8' });
    assert.notEqual(probe.status, 0, 'the confined process must not list sessions');
    assert.match(probe.stderr, /No such file|error connecting/);
    run.finish(await launch);
  } finally { fx.cleanup(); }
});


test('automatic command hosting includes harness and agent output in one persistent mission terminal (TASK-2643)', { timeout: 20000 }, async () => {
  const fx = fixture();
  const previousWrapper = process.env.PARALLIX_CLI_COMMAND;
  delete process.env.PARALLIX_CLI_COMMAND;
  try {
    const worktree = fx.worktree('whole');
    childProcess.spawnSync('git', ['init', '-q', worktree]);
    const output = path.join(fx.root, 'identity.json');
    const script = path.join(fx.root, 'command.mjs');
    fs.writeFileSync(script, `
      import fs from 'node:fs';
      import { openRunSession } from ${JSON.stringify(path.join(REPO_ROOT, 'src/adapters/agents/run-session.ts'))};
      import { spawnAndTee } from ${JSON.stringify(path.join(REPO_ROOT, 'src/adapters/process/spawn-tee.ts'))};
      console.log('HARNESS-PREFLIGHT');
      const run = openRunSession({ worktree: process.cwd(), slug: 'task-whole', role: 'execute', family: 'codex', attempt: 1, log: console.log });
      fs.writeFileSync(${JSON.stringify(output)}, JSON.stringify({ identity: run.identity, nested: Boolean(run.teeOptions.terminalHost), terminal: process.env.PARALLIX_MISSION_TERMINAL }));
      const result = await spawnAndTee('sh', ['-c', 'echo AGENT-COMMAND; test -t 0 || exit 91; echo GATE-OUTPUT; exit 4'], { cwd: process.cwd(), ...run.teeOptions });
      run.finish(result);
      console.log('HARNESS-FINISHED');
      process.exit(result.status);
    `);
    const wrapper = path.join(fx.root, 'px');
    fs.writeFileSync(wrapper, `#!/bin/sh\nexec ${shellQuote(process.execPath)} --import ${shellQuote(path.join(REPO_ROOT, 'node_modules/tsx/dist/loader.mjs'))} ${shellQuote(script)} "$@"\n`, { mode: 0o700 });
    assert.equal(fs.existsSync(path.join(worktree, 'workflow.config.json')), false, 'no user configuration');
    const status = await hostMissionCommand('active', ['task-whole'], worktree, () => {}, { command: wrapper, args: [] }, { interactive: true });
    assert.equal(status, 4, 'whole-command status reaches the caller');
    const observed = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(observed.nested, false, 'the agent inherits the command terminal');
    assert.equal(observed.terminal, 'task-whole');
    const socket = missionSocketPath(observed.identity, fx.env);
    assert.deepEqual(listTmuxSessions(socket).map(s => s.name), ['task-whole']);
    const windows = childProcess.spawnSync('tmux', ['-S', socket, 'list-windows', '-F', '#{window_name}'], { encoding: 'utf8' });
    assert.deepEqual(windows.stdout.trim().split('\n'), ['console'], 'completed operations leave one console');
    assert.equal(searchRuns(scope(worktree, 'task-whole'), { pattern: 'AGENT-COMMAND' }).totalHits, 1, 'per-run capture is still attributable');
    assert.equal(searchRuns(scope(worktree, 'task-whole'), { pattern: 'HARNESS-PREFLIGHT' }).totalHits, 0, 'console output does not become agent evidence');
    closeMissionTerminal(socket, 'task-whole');
    assert.equal(fs.existsSync(socket), false);
  } finally {
    if (previousWrapper === undefined) { delete process.env.PARALLIX_CLI_COMMAND; } else { process.env.PARALLIX_CLI_COMMAND = previousWrapper; }
    fx.cleanup();
  }
});

test('roles and fallback attempts share a mission session and keep independent operation windows (TASK-2643)', { timeout: 20000 }, async () => {
  const fx = fixture();
  try {
    const worktree = fx.worktree('roles');
    const execute = session(fx, worktree, 'adhoc-roles');
    const review = session(fx, worktree, 'adhoc-roles', 'claude', 'review');
    const release = path.join(fx.root, 'release');
    const launches = [execute, review].map(run => spawnAndTee('sh', ['-c', `echo ${run.identity.role}; while [ ! -e ${shellQuote(release)} ]; do sleep 0.05; done`], { cwd: worktree, stdoutSink: sink, stderrSink: sink, ...run.teeOptions }));
    const socket = missionSocketPath(execute.identity, fx.env);
    waitFor(() => childProcess.spawnSync('tmux', ['-S', socket, 'list-windows', '-F', '#{window_name}'], { encoding: 'utf8' }).stdout.trim().split('\n').length === 3);
    assert.deepEqual(listTmuxSessions(socket).map(s => s.name), ['adhoc-roles']);
    assert.throws(() => closeMissionTerminal(socket, 'adhoc-roles'), /owned operation/);
    fs.writeFileSync(release, '');
    const results = await Promise.all(launches);
    results.forEach((result, index) => { [execute, review][index].finish(result); assert.equal(result.status, 0); });
    const fallback = session(fx, worktree, 'adhoc-roles', 'qwen');
    const result = await spawnAndTee('sh', ['-c', 'echo FALLBACK'], { cwd: worktree, stdoutSink: sink, stderrSink: sink, ...fallback.teeOptions });
    fallback.finish(result);
    assert.equal(result.status, 0);
    assert.deepEqual(listTmuxSessions(socket).map(s => s.name), ['adhoc-roles']);
    assert.deepEqual(reconcileOrphanSessions(execute.identity, { env: fx.env }), [], 'idle windows survive reconciliation');
    closeMissionTerminal(socket, 'adhoc-roles');
  } finally { fx.cleanup(); }
});

test('automatic command hosting returns the pipe path when tmux is missing (TASK-2643)', { timeout: 20000 }, async () => {
  const fx = fixture();
  const previousPath = process.env.PATH;
  try {
    const worktree = fx.worktree('missing');
    childProcess.spawnSync('git', ['init', '-q', worktree]);
    assert.equal(await hostMissionCommand('goal', ['set', '--slug', 'task-missing'], worktree, () => {}, { command: '/unused/px', args: [] }, { interactive: true }), null, 'structured Mission writes keep their caller-side JSON contract');
    assert.equal(fs.existsSync(fx.env.PARALLIX_TERMINAL_STATE_DIR!), false);
    process.env.PATH = '/nonexistent';
    const logs: string[] = [];
    assert.equal(await hostMissionCommand('active', ['task-missing'], worktree, line => logs.push(line), { command: '/unused/px', args: [] }, { interactive: true }), null);
    assert.deepEqual(logs, [], 'an absent optional tool needs no user action');
  } finally {
    if (previousPath === undefined) { delete process.env.PATH; } else { process.env.PATH = previousPath; }
    fx.cleanup();
  }
});


// Yield while the caller pipe drains; polling must not block Node's I/O loop.
async function waitForInput(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) { throw new Error('condition not reached before deadline'); }
    await delay(10);
  }
}

test('an interactive caller types directly into the whole-command mission terminal (TASK-2643)', { timeout: 20000 }, async context => {
  const fx = fixture();
  context.after(() => fx.cleanup());
  try {
    const worktree = fx.worktree('input');
    const answerFile = path.join(fx.root, 'answer');
    const readyFile = path.join(fx.root, 'input-ready');
    const harness = path.join(fx.root, 'interactive.mjs');
    fs.writeFileSync(harness, `
      import { agentRunIdentity } from ${JSON.stringify(path.join(REPO_ROOT, 'src/domain/agent-run.ts'))};
      import { prepareTmuxLaunch, superviseTmuxLaunch } from ${JSON.stringify(path.join(REPO_ROOT, 'src/adapters/process/tmux-host.ts'))};
      const identity = agentRunIdentity({ repositoryKey: 'itrepo', missionId: 'task-input', role: 'active', family: 'parallix', attempt: 1, startedAtMs: Date.now() });
      const launch = prepareTmuxLaunch({ identity, spawnIndex: 0, command: 'sh', args: ['-c', ${JSON.stringify(`touch ${shellQuote(readyFile)}; read answer; printf '%s' "$answer" > ${shellQuote(answerFile)}; exit 6`)}], cwd: ${JSON.stringify(worktree)}, env: process.env });
      const status = await superviseTmuxLaunch(launch);
      process.exit(status);
    `);
    const ttyFile = path.join(fx.root, 'caller-tty');
    const command = `tty > ${shellQuote(ttyFile)}; ` + [process.execPath, '--import', path.join(REPO_ROOT, 'node_modules/tsx/dist/loader.mjs'), harness].map(shellQuote).join(' ');
    const client = childProcess.spawn('script', ['-qefc', command, '/dev/null'], { env: { ...fx.env, TERM: 'xterm' }, stdio: ['pipe', 'ignore', 'ignore'] });
    fx.own(client);
    const exited = new Promise<number | null>(resolve => client.once('exit', resolve));
    const socket = missionSocketPath({ repositoryKey: 'itrepo', missionId: 'task-input' }, fx.env);
    await waitForInput(() => listTmuxSessions(socket).some(session => session.attached), 10000);
    // The operation pane exists before the host selects it and releases the
    // command. Raw caller mode alone could send input to the console window.
    await waitForInput(() => fs.existsSync(readyFile), 10000);
    // Attachment is published before tmux finishes putting the caller PTY
    // into raw mode. Inspect the device before sending terminal key bytes.
    await waitForInput(() => {
      if (!fs.existsSync(ttyFile)) { return false; }
      const fd = fs.openSync(fs.readFileSync(ttyFile, 'utf8').trim(), 'r');
      try {
        const settings = childProcess.spawnSync('stty', ['-a'], { stdio: [fd, 'pipe', 'ignore'], encoding: 'utf8' });
        return /(^|\s)-icanon(\s|$)/.test(settings.stdout ?? '');
      } finally { fs.closeSync(fd); }
    });
    client.stdin!.write('operator-input\r');
    await waitForInput(() => fs.existsSync(answerFile));
    childProcess.spawnSync('tmux', ['-S', socket, 'detach-client', '-s', 'task-input']);
    assert.equal(await exited, 6);
    assert.equal(fs.readFileSync(answerFile, 'utf8'), 'operator-input');
    assert.deepEqual(listTmuxSessions(socket).map(session => session.name), ['task-input']);
  } finally { fx.cleanup(); }
});

test('successful review completion leaves the operator attached to the retained mission console (TASK-2670)', { timeout: 20000 }, async context => {
  const fx = fixture();
  context.after(() => fx.cleanup());
  try {
    const worktree = fx.worktree('review-retained');
    const identity = agentRunIdentity({ repositoryKey: 'itrepo', missionId: 'task-review-retained', role: 'review', family: 'parallix', attempt: 1, startedAtMs: Date.now() });
    const harness = path.join(fx.root, 'review-retained.mjs');
    const completed = path.join(fx.root, 'review-completed');
    fs.writeFileSync(harness, `
      import fs from 'node:fs';
      import { prepareTmuxLaunch, superviseTmuxLaunch } from ${JSON.stringify(path.join(REPO_ROOT, 'src/adapters/process/tmux-host.ts'))};
      const launch = prepareTmuxLaunch({ identity: ${JSON.stringify(identity)}, spawnIndex: 0, command: 'sh', args: ['-c', 'echo REVIEW-APPROVED; exit 0'], cwd: ${JSON.stringify(worktree)}, env: process.env });
      const status = await superviseTmuxLaunch(launch);
      fs.writeFileSync(${JSON.stringify(completed)}, String(status));
      setTimeout(() => process.exit(status), 1000);
    `);
    const child = childProcess.spawn('script', ['-qefc', [process.execPath, '--import', path.join(REPO_ROOT, 'node_modules/tsx/dist/loader.mjs'), harness].map(shellQuote).join(' '), '/dev/null'], { env: { ...fx.env, TERM: 'xterm' }, stdio: 'ignore' });
    fx.own(child);
    const exited = new Promise<number | null>(resolve => child.once('exit', resolve));
    const socket = missionSocketPath(identity, fx.env);
    waitFor(() => listTmuxSessions(socket)[0]?.attached === true, 10000);
    childProcess.spawnSync('sleep', ['0.2']);
    assert.equal(fs.existsSync(completed), false, 'the px-equivalent parent remains alive while it owns the attached client');
    assert.equal(listTmuxSessions(socket)[0]?.attached, true, 'review completion must not detach the operator from the retained console');
    const consoleOutput = () => String(childProcess.spawnSync('tmux', ['-S', socket, 'capture-pane', '-p', '-t', '=task-review-retained:console'], { encoding: 'utf8' }).stdout);
    waitFor(() => consoleOutput().includes('[mission terminal command exit code: 0]'));
    assert.match(consoleOutput(), /REVIEW-APPROVED/, 'completion keeps the review result visible in the console');
    const integrationStarted = path.join(fx.root, 'integration-started');
    childProcess.spawnSync('tmux', ['-S', socket, 'send-keys', '-t', '=task-review-retained:console', `echo integration-started > ${shellQuote(integrationStarted)}`, 'Enter']);
    waitFor(() => fs.existsSync(integrationStarted));
    assert.equal(fs.readFileSync(integrationStarted, 'utf8').trim(), 'integration-started', 'the retained console accepts the operator-triggered integration command');
    childProcess.spawnSync('tmux', ['-S', socket, 'send-keys', '-t', '=task-review-retained:console', 'echo INTEGRATION-FINAL-STATS', 'Enter']);
    const capturePath = missionTerminalCapturePath(identity, fx.env);
    waitFor(() => fs.readFileSync(capturePath, 'utf8').includes('INTEGRATION-FINAL-STATS'));
    retireMissionTerminal(socket, identity.missionId);
    assert.equal(listTmuxSessions(socket)[0]?.attached, true, 'landing retains the attached result view');
    childProcess.spawnSync('tmux', ['-S', socket, 'detach-client', '-s', identity.missionId]);
    waitFor(() => fs.existsSync(completed));
    assert.equal(fs.readFileSync(completed, 'utf8'), '0');
    assert.equal(await exited, 0, 'the parent exits cleanly only after the operator detaches');
  } finally { fx.cleanup(); }
});

test('a failed integration gate remains recoverable with its output and exit code after terminal cleanup (TASK-2670)', { timeout: 20000 }, async () => {
  const fx = fixture();
  try {
    const worktree = fx.worktree('integration-gate-retained');
    const identity = agentRunIdentity({ repositoryKey: 'itrepo', missionId: 'task-integration-gate-retained', role: 'integrate', family: 'parallix', attempt: 1, startedAtMs: Date.now() });
    const launch = prepareTmuxLaunch({ identity, spawnIndex: 0, command: 'sh', args: ['-c', 'echo "Integration gate static-analysis failed"; echo GATE-OUTPUT >&2; exit 42'], cwd: worktree, env: fx.env });
    try {
      assert.equal(await superviseTmuxLaunch(launch), 42);
    } finally { launch.cleanup(); }
    closeMissionTerminal(launch.socketPath, identity.missionId);
    const capture = fs.readFileSync(missionTerminalCapturePath(identity, fx.env), 'utf8');
    assert.match(capture, /Integration gate static-analysis failed/);
    assert.match(capture, /GATE-OUTPUT/);
    assert.match(capture, /exit code: 42/);
    const output: string[] = [];
    attachRun({ slug: identity.missionId, list: true, readOnly: false }, {
      inferSlugFn: () => null, resolveWorktreeFn: () => null, repositoryKeyFn: () => identity.repositoryKey,
      env: fx.env, log: line => output.push(line),
    });
    assert.match(output.join('\n'), /no live terminal; captured output=/, 'operator discovery survives mission-worktree cleanup');
  } finally { fx.cleanup(); }
});

test('a landed integration retains its final result and application statistics after terminal retirement (TASK-2670)', { timeout: 20000 }, async () => {
  const fx = fixture();
  try {
    const worktree = fx.worktree('integration-result-retained');
    const identity = agentRunIdentity({ repositoryKey: 'itrepo', missionId: 'task-integration-result-retained', role: 'integrate', family: 'parallix', attempt: 1, startedAtMs: Date.now() });
    const closeout = path.join(fx.root, 'closeout.mjs');
    fs.writeFileSync(closeout, `
      import { recordPostIntegrationStats } from ${JSON.stringify(path.join(REPO_ROOT, 'src/adapters/cli/commands/integrate-post.ts'))};
      await recordPostIntegrationStats('task-result', { rootDir: ${JSON.stringify(worktree)}, missionStore: null, recordIntegrationStatsFn: async () => ({
        row: { mission: 'task-result', implementer: 'codex', pr_fix_rounds: '2', classification: 'ai_sdlc', date: '2026-10-06' },
        report: 'weekly report: PR decisions unavailable'
      }) });
      console.log('Integration complete: local main updated');
    `);
    const launch = prepareTmuxLaunch({ identity, spawnIndex: 0, command: process.execPath, args: ['--import', path.join(REPO_ROOT, 'node_modules/tsx/dist/loader.mjs'), closeout], cwd: worktree, env: fx.env });
    try {
      assert.equal(await superviseTmuxLaunch(launch), 0);
      retireMissionTerminal(launch.socketPath, identity.missionId);
    } finally { launch.cleanup(); }
    const capture = fs.readFileSync(missionTerminalCapturePath(identity, fx.env), 'utf8');
    assert.match(capture, /Integration complete: local main updated/);
    assert.match(capture, /Workflow stats recorded: task-result: implementer=codex, pr_fix_rounds=2, classification=ai_sdlc/);
    assert.match(capture, /PR decisions unavailable/);
    assert.match(capture, /exit code: 0/);
  } finally { fx.cleanup(); }
});


test('whole-command cancellation reaches the existing supervisor and its detached agent child (TASK-2643)', { timeout: 20000 }, async () => {
  const fx = fixture();
  let launch: ReturnType<typeof prepareTmuxLaunch> | undefined;
  const pidFile = path.join(fx.root, 'detached.pid');
  let childReaped = false;
  try {
    const worktree = fx.worktree('supervised');
    const harness = path.join(fx.root, 'supervisor.mjs');
    fs.writeFileSync(harness, `
      import fs from 'node:fs';
      import { spawnAndTee } from ${JSON.stringify(path.join(REPO_ROOT, 'src/adapters/process/spawn-tee.ts'))};
      await spawnAndTee('sleep', ['30'], {
        cwd: ${JSON.stringify(worktree)}, noOutputWatchdog: { maxNoOutputMs: 10000 },
        onSpawn: child => setImmediate(() => fs.writeFileSync(${JSON.stringify(pidFile)}, String(child.pid))),
      });
    `);
    const identity = agentRunIdentity({ repositoryKey: 'itrepo', missionId: 'task-supervised', role: 'active', family: 'parallix', attempt: 1, startedAtMs: Date.now() });
    launch = prepareTmuxLaunch({ identity, spawnIndex: 0, command: process.execPath,
      args: ['--import', path.join(REPO_ROOT, 'node_modules/tsx/dist/loader.mjs'), harness], cwd: worktree, env: fx.env });
    const host = childProcess.spawn(launch.command, launch.args, { env: fx.env, stdio: 'ignore' });
    fx.own(host);
    const exited = new Promise<number | null>(resolve => host.once('exit', resolve));
    waitFor(() => fs.existsSync(pidFile) && fs.readFileSync(pidFile, 'utf8').trim() !== '', 10000);
    const agentPid = Number(fs.readFileSync(pidFile, 'utf8'));
    host.kill('SIGTERM');
    assert.equal(await exited, 143);
    try { waitFor(() => { try { process.kill(agentPid, 0); return false; } catch { return true; } }); } catch (err) {
      const after = childProcess.spawnSync('ps', ['-p', String(agentPid), '-o', 'pid,ppid,pgid,sid,stat,comm'], { encoding: 'utf8' }).stdout;
      throw new Error(`${err}\nAgent after cancellation: ${after}`);
    }
    childReaped = true;
    assert.deepEqual(listTmuxSessions(launch.socketPath).map(session => session.name), ['task-supervised']);
  } finally {
    if (!childReaped && fs.existsSync(pidFile)) {
      const pid = Number(fs.readFileSync(pidFile, 'utf8'));
      if (Number.isInteger(pid) && pid > 0) { try { process.kill(-pid, 'SIGKILL'); } catch { /* already exited */ } }
    }
    launch?.cleanup(); fx.cleanup();
  }
});

test('a headless operator CLI invocation preserves pipes without an inherited wrapper (TASK-2643)', { timeout: 20000 }, () => {
  const fx = fixture();
  try {
    const worktree = fx.worktree('cli-entry');
    assert.equal(childProcess.spawnSync('git', ['init', '-q', worktree]).status, 0);
    const env = { ...fx.env, PARALLIX_HOME: path.join(fx.root, 'home') };
    for (const key of ['PARALLIX_CLI_COMMAND', 'PARALLIX_CLI_ENTRYPOINT', 'PARALLIX_MISSION_TERMINAL', 'PARALLIX_MISSION_SOCKET', 'TMUX', 'TMUX_PANE']) {
      delete env[key];
    }
    // A rejected verb exercises the real entry/dispatch/exit path without
    // launching an agent, changing a Mission or relying on operator services.
    const result = childProcess.spawnSync(process.execPath, [
      '--import', path.join(REPO_ROOT, 'node_modules/tsx/dist/loader.mjs'),
      path.join(REPO_ROOT, 'src/entry/px.ts'),
      'unknown-terminal-command', 'task-cli-entry',
    ], { cwd: worktree, env, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1, result.stderr);
    assert.doesNotMatch(result.stdout, /Mission terminal:/);
    const state = fx.env.PARALLIX_TERMINAL_STATE_DIR!;
    assert.equal(fs.existsSync(state), false);
  } finally { fx.cleanup(); }
});

test('headless mission calls preserve piped input and separate byte-exact output with durable history (TASK-2643)', { timeout: 20000 }, () => {
  const fx = fixture();
  try {
    const worktree = fx.worktree('headless');
    const script = path.join(fx.root, 'headless.mjs');
    fs.writeFileSync(script, `
      import { hostMissionCommand } from ${JSON.stringify(path.join(REPO_ROOT, 'src/composition/mission-terminal.ts'))};
      import { openRunSession } from ${JSON.stringify(path.join(REPO_ROOT, 'src/adapters/agents/run-session.ts'))};
      import { spawnAndTee } from ${JSON.stringify(path.join(REPO_ROOT, 'src/adapters/process/spawn-tee.ts'))};
      const hosted = await hostMissionCommand('active', ['task-headless'], process.cwd(), console.log, { command: '/must-not-run', args: [] });
      if (hosted !== null) throw new Error('headless call entered tmux');
      const run = openRunSession({ worktree: process.cwd(), slug: 'task-headless', role: 'execute', family: 'custom', attempt: 1, log: console.log }, { repositoryKey: () => 'itrepo' });
      const result = await spawnAndTee('sh', ['-c', 'read answer; printf "out:%s\\n" "$answer"; printf "err\\n" >&2; exit 7'], { cwd: process.cwd(), ...run.teeOptions });
      run.finish(result);
      process.exit(result.status);
    `);
    const result = childProcess.spawnSync(process.execPath, ['--import', path.join(REPO_ROOT, 'node_modules/tsx/dist/loader.mjs'), script], {
      cwd: worktree, env: fx.env, input: 'input\n', encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 7, result.stderr);
    assert.equal(result.stdout, 'out:input\n');
    assert.match(result.stderr, /(?:^|\n)err\n$/);
    assert.doesNotMatch(result.stdout + result.stderr, /\r/);
    assert.equal(listRuns(scope(worktree, 'task-headless'))[0].record.terminalHost, 'pipe');
    assert.equal(searchRuns(scope(worktree, 'task-headless'), { pattern: 'out:input' }).totalHits, 1);
    assert.equal(fs.existsSync(fx.env.PARALLIX_TERMINAL_STATE_DIR!), false);
  } finally { fx.cleanup(); }
});

test('completed operations keep one credential-free console and retired missions drain safely (TASK-2643)', { timeout: 20000 }, async () => {
  const fx = fixture();
  const previousCredential = process.env.TEST_PROVIDER_CREDENTIAL;
  process.env.TEST_PROVIDER_CREDENTIAL = 'private';
  try {
    const worktree = fx.worktree('bounded');
    const identity = agentRunIdentity({ repositoryKey: 'itrepo', missionId: 'task-bounded', role: 'active', family: 'parallix', attempt: 1, startedAtMs: Date.now() });
    const socket = missionSocketPath(identity, fx.env);
    for (let index = 0; index < 3; index += 1) {
      const launch = prepareTmuxLaunch({ identity, spawnIndex: index, command: 'sh', args: ['-c', 'test "$TEST_PROVIDER_CREDENTIAL" = private; exit 0'], cwd: worktree, env: { ...fx.env, TEST_PROVIDER_CREDENTIAL: 'private' } });
      try { assert.equal(childProcess.spawnSync(launch.command, launch.args, { timeout: 5000 }).status, 0); } finally { launch.cleanup(); }
      assert.equal(childProcess.spawnSync('tmux', ['-S', socket, 'list-windows', '-F', '#{window_name}'], { encoding: 'utf8' }).stdout, 'console\n');
      assert.notEqual(childProcess.spawnSync('tmux', ['-S', socket, 'show-environment', '-g', 'TEST_PROVIDER_CREDENTIAL']).status, 0);
    }
    const started = path.join(fx.root, 'started');
    const launch = prepareTmuxLaunch({ identity, spawnIndex: 3, command: 'sh', args: ['-c', `touch ${shellQuote(started)}; sleep 0.5; exit 9`], cwd: worktree, env: fx.env });
    const child = childProcess.spawn(launch.command, launch.args, { stdio: 'ignore' });
    fx.own(child);
    const exited = new Promise<number | null>(resolve => child.once('exit', resolve));
    try {
      waitFor(() => fs.existsSync(started));
      retireMissionTerminal(socket, identity.missionId);
      assert.equal(listTmuxSessions(socket).length, 1, 'retirement preserves the finishing command');
      assert.equal(await exited, 9);
    } finally { launch.cleanup(); }
    assert.equal(listTmuxSessions(socket).length, 0);
    assert.equal(fs.existsSync(socket), false);
    const idle = prepareTmuxLaunch({ identity, spawnIndex: 4, command: 'sh', args: ['-c', 'exit 0'], cwd: worktree, env: fx.env });
    try { assert.equal(childProcess.spawnSync(idle.command, idle.args, { timeout: 5000 }).status, 0); } finally { idle.cleanup(); }
    retireMissionTerminal(socket, identity.missionId);
    assert.equal(fs.existsSync(socket), false, 'an idle terminal retires immediately');
  } finally {
    if (previousCredential === undefined) { delete process.env.TEST_PROVIDER_CREDENTIAL; } else { process.env.TEST_PROVIDER_CREDENTIAL = previousCredential; }
    fx.cleanup();
  }
});

test('automatic hosting falls back only before launch and never replays a command exit 70 (TASK-2643)', { timeout: 20000 }, async () => {
  const fx = fixture();
  const previousPath = process.env.PATH;
  try {
    const worktree = fx.worktree('fallback');
    childProcess.spawnSync('git', ['init', '-q', worktree]);
    const command = { command: 'sh', args: ['-c', 'exit 70', 'px'] };
    // Long state paths are supported through a short socket fallback. A file
    // blocking the state directory forces a real preparation failure instead.
    const blockedState = path.join(fx.root, 'blocked-state');
    fs.writeFileSync(blockedState, 'not a directory');
    process.env.PARALLIX_TERMINAL_STATE_DIR = blockedState;
    assert.equal(await hostMissionCommand('active', ['task-fallback'], worktree, () => {}, command, { interactive: true }), null);
    process.env.PARALLIX_TERMINAL_STATE_DIR = fx.env.PARALLIX_TERMINAL_STATE_DIR;
    const bin = path.join(fx.root, 'bin'); fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'tmux'), '#!/bin/sh\nif [ "$1" = -V ]; then echo "tmux test"; exit 0; fi\nexit 1\n', { mode: 0o700 });
    process.env.PATH = `${bin}:${previousPath}`;
    assert.equal(await hostMissionCommand('active', ['task-fallback'], worktree, () => {}, command, { interactive: true }), null);
    process.env.PATH = previousPath;
    assert.equal(await hostMissionCommand('active', ['task-fallback'], worktree, () => {}, command, { interactive: true }), 70, 'a real command exit must not trigger fallback');
  } finally {
    if (previousPath === undefined) { delete process.env.PATH; } else { process.env.PATH = previousPath; }
    fx.cleanup();
  }
});

test('px active and attach from the retained console reuse the original mission socket (TASK-2643)', { timeout: 20000 }, () => {
  const fx = fixture();
  const previousHome = process.env.PARALLIX_HOME;
  let alternateSocket: string | undefined;
  try {
    process.env.PARALLIX_HOME = path.join(fx.root, 'home');
    const slug = `task-console-${process.pid}`;
    const worktree = fx.worktree('console');
    assert.equal(childProcess.spawnSync('git', ['init', '-q', '-b', `mission/${slug}`, worktree]).status, 0);
    fs.writeFileSync(path.join(worktree, 'workflow.config.json'), '{}\n');
    const identity = agentRunIdentity({ repositoryKey: missionRepositoryKey(worktree), missionId: slug, role: 'active', family: 'parallix', attempt: 1, startedAtMs: Date.now() });
    const launch = prepareTmuxLaunch({ identity, spawnIndex: 0, command: 'sh', args: ['-c', 'exit 0'], cwd: worktree, env: fx.env });
    try { assert.equal(childProcess.spawnSync(launch.command, launch.args, { timeout: 5000 }).status, 0); } finally { launch.cleanup(); }
    const px = [process.execPath, '--import', path.join(REPO_ROOT, 'node_modules/tsx/dist/loader.mjs'), path.join(REPO_ROOT, 'src/entry/px.ts')].map(shellQuote).join(' ');
    const activeOutput = path.join(fx.root, 'active.out');
    const attachOutput = path.join(fx.root, 'attach.out');
    const done = path.join(fx.root, 'done');
    // An invalid implementer exercises real startup and hosting without a model.
    const command = `${px} active ${slug} --implementer terminal-test-invalid > ${shellQuote(activeOutput)} 2>&1; ${px} attach ${slug} --list > ${shellQuote(attachOutput)} 2>&1; echo done > ${shellQuote(done)}`;
    alternateSocket = path.join('/tmp', `parallix-terminal-${process.getuid!()}`, identity.repositoryKey, `${slug}.sock`);
    childProcess.spawnSync('tmux', ['-S', launch.socketPath, 'send-keys', '-t', `=${slug}:console`, '-l', command]);
    childProcess.spawnSync('tmux', ['-S', launch.socketPath, 'send-keys', '-t', `=${slug}:console`, 'Enter']);
    waitFor(() => fs.existsSync(done), 10000);
    assert.doesNotMatch(fs.readFileSync(activeOutput, 'utf8'), /Mission terminal:|sessions should be nested/);
    assert.match(fs.readFileSync(attachOutput, 'utf8'), new RegExp(`session=${slug}`));
    assert.deepEqual(listTmuxSessions(launch.socketPath).map(session => session.name), [slug]);
    assert.equal(fs.existsSync(alternateSocket), false, 'no fallback-root server is created');
  } finally {
    if (alternateSocket && fs.existsSync(alternateSocket)) {
      childProcess.spawnSync('tmux', ['-S', alternateSocket, 'kill-server'], { stdio: 'ignore' });
    }
    if (previousHome === undefined) { delete process.env.PARALLIX_HOME; } else { process.env.PARALLIX_HOME = previousHome; }
    fx.cleanup();
  }
});

test('a retained-console px command resolves an operator Jev credential without placing it in tmux (TASK-2674)', { timeout: 20000 }, () => {
  const fx = fixture();
  const previousHome = process.env.HOME;
  const previousPath = process.env.PATH;
  try {
    const home = path.join(fx.root, 'operator-home');
    const bin = path.join(fx.root, 'bin');
    const resolved = path.join(fx.root, 'resolved');
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(home, '.bashrc'), 'export OPENROUTER_API_KEY=operator-authorized-secret\n');
    fs.writeFileSync(path.join(bin, 'px'), `#!/bin/sh\nprintf '%s' "${'$'}{OPENROUTER_API_KEY:-}" > ${shellQuote(resolved)}\n`, { mode: 0o700 });
    process.env.HOME = home;
    process.env.PATH = `${bin}:${previousPath ?? ''}`;
    const worktree = fx.worktree('task-jev-console');
    const identity = agentRunIdentity({ repositoryKey: 'itrepo', missionId: 'task-jev-console', role: 'execute', family: 'codex', attempt: 1, startedAtMs: Date.now() });
    const launch = prepareTmuxLaunch({ identity, spawnIndex: 0, command: 'sh', args: ['-c', 'exit 0'], cwd: worktree, env: { ...fx.env, HOME: home, PATH: process.env.PATH } });
    try { assert.equal(childProcess.spawnSync(launch.command, launch.args, { timeout: 5000 }).status, 0); } finally { launch.cleanup(); }
    childProcess.spawnSync('tmux', ['-S', launch.socketPath, 'send-keys', '-t', '=task-jev-console:console', '-l', 'px']);
    childProcess.spawnSync('tmux', ['-S', launch.socketPath, 'send-keys', '-t', '=task-jev-console:console', 'Enter']);
    waitFor(() => fs.existsSync(resolved), 5000);
    assert.equal(fs.readFileSync(resolved, 'utf8'), 'operator-authorized-secret');
    assert.notEqual(childProcess.spawnSync('tmux', ['-S', launch.socketPath, 'show-environment', '-g', 'OPENROUTER_API_KEY']).status, 0);
    assert.doesNotMatch(childProcess.spawnSync('tmux', ['-S', launch.socketPath, 'capture-pane', '-p', '-t', '=task-jev-console:console'], { encoding: 'utf8' }).stdout, /operator-authorized-secret/);
  } finally {
    if (previousHome === undefined) { delete process.env.HOME; } else { process.env.HOME = previousHome; }
    if (previousPath === undefined) { delete process.env.PATH; } else { process.env.PATH = previousPath; }
    fx.cleanup();
  }
});

test('a host whose harness pipe is gone still stops its command when the terminal hangs up', { timeout: 20000 }, async () => {
  // Terminal teardown HUPs the host's background jobs as well as the host.
  // dash reports a HUP-killed job ("Hangup") on stderr, which by then is a
  // pipe to a dead harness; that write must not kill the host before its HUP
  // cleanup stops the command (TASK-2655 integration repair).
  const fx = fixture();
  try {
    const worktree = fx.worktree('task-h');
    const pidFile = path.join(fx.root, 'agent.pid');
    const identity = agentRunIdentity({ repositoryKey: 'itrepo', missionId: 'task-h', role: 'execute', family: 'codex', attempt: 1, startedAtMs: Date.now() });
    const launch = prepareTmuxLaunch({ identity, spawnIndex: 0, command: 'sh', args: ['-c', `echo $$ > ${pidFile}; exec sleep 30`], cwd: worktree, env: {} }, { env: fx.env });
    const host = childProcess.spawn(launch.command, launch.args, { cwd: worktree, env: fx.env, stdio: ['ignore', 'ignore', 'pipe'], detached: true });
    fx.own(host);
    const exited = new Promise<NodeJS.Signals | null>((resolve) => { host.once('exit', (_code, signal) => resolve(signal)); });
    waitFor(() => fs.existsSync(pidFile) && fs.readFileSync(pidFile, 'utf8').trim() !== '');
    const agentPid = Number(fs.readFileSync(pidFile, 'utf8'));
    host.stderr!.destroy();
    const jobs = String(childProcess.spawnSync('pgrep', ['-P', String(host.pid)], { encoding: 'utf8' }).stdout).split('\n').filter(Boolean).map(Number);
    const completion = jobs.find(pid => String(childProcess.spawnSync('ps', ['-o', 'args=', '-p', String(pid)], { encoding: 'utf8' }).stdout).includes('host.sh'));
    assert.ok(completion, `the host runs its completion loop as a background job (children: ${jobs.join(', ')})`);
    process.kill(completion, 'SIGHUP');
    waitFor(() => { try { process.kill(completion, 0); return false; } catch { return true; } });
    childProcess.spawnSync('sleep', ['0.2']);
    try { process.kill(host.pid!, 'SIGHUP'); } catch { /* the host already exited */ }
    assert.notEqual(await exited, 'SIGPIPE', 'the host survives reporting the hung-up job to its closed stderr');
    waitFor(() => { try { process.kill(agentPid, 0); return false; } catch { return true; } });
    launch.cleanup();
  } finally { fx.cleanup(); }
});
