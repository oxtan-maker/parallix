import childProcess from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AgentRunIdentity } from '../../domain/agent-run.js';
import { agentRunId } from '../../domain/agent-run.js';
import { ensurePrivateDir, terminalSocketFallbackRoot, terminalStateRoot } from './terminal-state-root.js';

/** Mission-keyed persistent terminals; operation windows retain run attribution. */

export interface TmuxProbe {
  readonly available: boolean;
  readonly version: string | null;
  readonly reason: string | null;
}

type SpawnSyncFn = typeof childProcess.spawnSync;

/** Probe whether tmux can host a launch on this platform. */
export function probeTmux(spawnSyncFn: SpawnSyncFn = childProcess.spawnSync, platform: NodeJS.Platform = process.platform): TmuxProbe {
  if (platform === 'win32') {
    return { available: false, version: null, reason: 'tmux terminal hosting is supported on Linux and macOS only' };
  }
  const probe = spawnSyncFn('tmux', ['-V'], { encoding: 'utf8', timeout: 5000 });
  if (probe.error || probe.status !== 0) {
    const cause = probe.error ? (probe.error as NodeJS.ErrnoException).code || probe.error.message : `exit ${probe.status}`;
    return { available: false, version: null, reason: `tmux is not runnable (${cause}); install tmux or set adapters.terminal.host to "pipe"` };
  }
  return { available: true, version: String(probe.stdout).trim() || null, reason: null };
}

/** The Mission's tmux socket: one server per repository and Mission. */
export function missionSocketPath(identity: Pick<AgentRunIdentity, 'repositoryKey' | 'missionId'>, env: NodeJS.ProcessEnv = process.env): string {
  const root = terminalStateRoot(env);
  const socket = path.join(root, identity.repositoryKey, `${identity.missionId}.sock`);
  if (Buffer.byteLength(socket) <= 100) { return socket; }
  // sockaddr_un pathnames have a small portable limit. Include the resolved
  // root in the digest so independent configured state roots cannot collide.
  const name = createHash('sha256').update(`${root}\0${identity.repositoryKey}\0${identity.missionId}`).digest('hex').slice(0, 32);
  return path.join(terminalSocketFallbackRoot(env), `${name}.sock`);
}

/** Single-quote one value for POSIX `sh`. */
export function shellQuote(value: string): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

export interface TmuxLaunchInput {
  readonly identity: AgentRunIdentity;
  /** Distinguishes a second spawn inside one launch (for example a stale-resume retry). */
  readonly spawnIndex: number;
  /** Whole CLI command, or an already-confined agent command from its launch seam. */
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The harness process supervising this launch; defaults to this process. */
  readonly supervisorPid?: number;
}

export interface TmuxLaunch {
  readonly command: string;
  readonly args: string[];
  readonly socketPath: string;
  readonly sessionName: string;
  readonly windowName: string;
  started(): boolean;
  /** Stop unfinished work and remove launch transport; retain the mission terminal. */
  cleanup(): void;
}

/** Session identity follows the mission, not an agent or attempt. */
export function tmuxSessionName(identity: AgentRunIdentity, _spawnIndex: number): string {
  return identity.missionId;
}

function operationWindowName(identity: AgentRunIdentity, spawnIndex: number): string {
  return `${agentRunId(identity)}-s${spawnIndex}-${randomUUID().slice(0, 8)}`;
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Record the supervised command PID before exec, without changing its terminal. */
function commandScript(socketPath: string, scratch: string, command: string, args: readonly string[]): string {
  return [
    '#!/bin/sh',
    `printf '%s' "$$" > ${shellQuote(path.join(scratch, 'command.pid'))}`,
    `tmux -S ${shellQuote(socketPath)} set-option -w -t "$TMUX_PANE" @px_command_pid "$$"`,
    `exec ${[command, ...args].map(shellQuote).join(' ')}`,
    '',
  ].join('\n');
}

function paneScript(socketPath: string, windowName: string, scratch: string): string {
  const t = `tmux -S ${shellQuote(socketPath)}`;
  return [
    '#!/bin/sh',
    `${t} wait-for ${shellQuote(`${windowName}-go`)}`,
    `. ${shellQuote(path.join(scratch, 'pane.env'))}`,
    `rm -f ${shellQuote(path.join(scratch, 'pane.env'))}`,
    `sh ${shellQuote(path.join(scratch, 'command.sh'))}`,
    'status=$?',
    `printf '%s' "$status" > ${shellQuote(path.join(scratch, 'status'))}`,
    `${t} set-option -w -t "$TMUX_PANE" @px_host_pid ''`,
    `${t} set-option -w -t "$TMUX_PANE" @px_supervisor_pid ''`,
    `${t} set-option -w -t "$TMUX_PANE" @px_command_pid ''`,
    // Keep the pane until its output relay drains; only the console stays idle.
    `${t} wait-for ${shellQuote(`${windowName}-done`)}`,
    'exit "$status"',
    '',
  ].join('\n');
}

function hostScript(socketPath: string, sessionName: string, windowName: string, scratch: string, cwd: string, supervisorPid: number): string {
  // The server and retained console must not inherit operation credentials.
  const cleanEnv = ['PATH', 'HOME', 'TERM', 'SHELL', 'LANG', 'USER', 'LOGNAME', 'PARALLIX_HOME', 'XDG_CONFIG_HOME', 'XDG_STATE_HOME', 'XDG_DATA_HOME'].filter(key => process.env[key])
    .map(key => `${key}=${shellQuote(process.env[key]!)}`).join(' ');
  const stateRoot = path.dirname(path.dirname(socketPath));
  const t = `env -i ${cleanEnv} PARALLIX_TERMINAL_STATE_DIR=${shellQuote(stateRoot)} tmux -S ${shellQuote(socketPath)}`;
  const fifo = shellQuote(path.join(scratch, 'out'));
  const status = shellQuote(path.join(scratch, 'status'));
  const name = shellQuote(sessionName);
  const target = shellQuote(`=${sessionName}:${windowName}`);
  return [
    '#!/bin/sh',
    'cleanup() {',
    // Signal the command, not its enclosing pane shell. Killing the pane
    // shell first would deliver HUP before the CLI can stop detached children.
    `  operation_pid=$(cat ${shellQuote(path.join(scratch, 'command.pid'))} 2>/dev/null)`,
    '  if [ -n "$operation_pid" ]; then kill -s "${1:-TERM}" "$operation_pid" 2>/dev/null; sleep 0.25; fi',
    `  ${t} kill-window -t ${target} 2>/dev/null`,
    '  [ -z "$completion" ] || kill "$completion" 2>/dev/null',
    '  [ -z "$relay" ] || kill "$relay" 2>/dev/null',
    '}',

    "trap 'cleanup INT; exit 130' INT",
    "trap 'cleanup TERM; exit 143' TERM",
    "trap 'cleanup HUP; exit 129' HUP",
    // On terminal teardown dash reports a HUP-killed background job ("Hangup")
    // on stderr, a pipe to the harness that is already gone. Catching PIPE
    // turns that write into EPIPE so the HUP cleanup above still stops the
    // command; a caught signal resets to default in the children it execs.
    "trap ':' PIPE",
    `rm -f ${fifo} ${status}`,
    `mkfifo ${fifo} || exit 70`,
    // -A would attach when the session exists and require a caller TTY.
    // Concurrent creators may lose new-session; recheck the exact session.
    `${t} has-session -t ${shellQuote(`=${sessionName}`)} 2>/dev/null || ${t} -f /dev/null new-session -d -s ${name} -n console -x 200 -y 50 -c ${shellQuote(cwd)} '/bin/sh -i' 2>/dev/null || ${t} has-session -t ${shellQuote(`=${sessionName}`)} || exit 70`,
    `${t} new-window -d -t ${name} -n ${shellQuote(windowName)} -c ${shellQuote(cwd)} ${shellQuote(`sh ${shellQuote(path.join(scratch, 'pane.sh'))}`)} || exit 70`,
    `${t} set-option -w -t ${target} @px_host_pid "$$" >/dev/null`,
    `${t} set-option -w -t ${target} @px_supervisor_pid ${supervisorPid} >/dev/null`,
    `${t} pipe-pane -t ${target} -o ${shellQuote(`cat > ${fifo}`)} || { cleanup; exit 70; }`,
    `cat ${fifo} &`,
    'relay=$!',
    `${t} select-window -t ${target}`,
    `${t} wait-for -S ${shellQuote(`${windowName}-go`)}`,
    `while [ ! -s ${status} ] && ${t} display-message -p -t ${target} '#{pane_id}' >/dev/null 2>&1; do sleep 0.1; done &`,
    'completion=$!',
    'wait "$completion"',
    `${t} pipe-pane -t ${target}`,
    'wait "$relay"',
    `if [ -s ${status} ]; then`,
    `  result=$(cat ${status})`,
    `  ${t} wait-for -S ${shellQuote(`${windowName}-done`)}`,
    `  ${t} kill-window -t ${target} 2>/dev/null`,
    '  exit "$result"',
    'fi',
    'cleanup',
    'exit 137',
    '',
  ].join('\n');
}

function writeEnvFile(file: string, env: Readonly<Record<string, string | undefined>>): void {
  const lines = Object.entries(env)
    .filter(([key, value]) => ENV_NAME.test(key) && !['TMUX', 'TMUX_PANE'].includes(key) && value !== undefined)
    .map(([key, value]) => `export ${key}=${shellQuote(String(value))}`);
  fs.writeFileSync(file, `${lines.join('\n')}\n`, { mode: 0o600 });
}

/**
 * Prepare an operation window in the persistent mission terminal.
 * Whole CLI commands and already-confined direct launches use the same host.
 */
export function prepareTmuxLaunch(input: TmuxLaunchInput, options: { env?: NodeJS.ProcessEnv; spawnSyncFn?: SpawnSyncFn } = {}): TmuxLaunch {
  const env = options.env ?? process.env;
  const socketPath = missionSocketPath(input.identity, env);
  const sessionName = tmuxSessionName(input.identity, input.spawnIndex);
  const windowName = operationWindowName(input.identity, input.spawnIndex);
  const scratch = path.join(path.dirname(socketPath), input.identity.missionId, windowName);
  ensurePrivateDir(path.dirname(socketPath));
  ensurePrivateDir(scratch);
  writeEnvFile(path.join(scratch, 'pane.env'), { ...input.env, PWD: input.cwd, PARALLIX_MISSION_TERMINAL: input.identity.missionId, PARALLIX_MISSION_SOCKET: socketPath });
  fs.writeFileSync(path.join(scratch, 'command.sh'), commandScript(socketPath, scratch, input.command, input.args), { mode: 0o700 });
  fs.writeFileSync(path.join(scratch, 'pane.sh'), paneScript(socketPath, windowName, scratch), { mode: 0o700 });
  fs.writeFileSync(path.join(scratch, 'host.sh'), hostScript(socketPath, sessionName, windowName, scratch, input.cwd, input.supervisorPid ?? process.pid), { mode: 0o700 });
  const spawnSyncFn = options.spawnSyncFn ?? childProcess.spawnSync;
  let started = false;
  return {
    command: 'sh',
    args: [path.join(scratch, 'host.sh')],
    socketPath,
    sessionName,
    windowName,
    started: () => started || fs.existsSync(path.join(scratch, 'command.pid')),
    cleanup: () => {
      started ||= fs.existsSync(path.join(scratch, 'command.pid'));
      try {
        spawnSyncFn('tmux', ['-S', socketPath, 'kill-window', '-t', `=${sessionName}:${windowName}`], { stdio: 'ignore', timeout: 5000 });
        finishRetiredTerminal(socketPath, sessionName, spawnSyncFn);
      } catch (error) { console.error(`Mission terminal cleanup warning: ${(error as Error).message}`); }
      try { fs.rmSync(scratch, { recursive: true, force: true }); }
      catch (error) { console.error(`Mission terminal transport cleanup warning: ${(error as Error).message}`); }
      try { fs.rmdirSync(path.dirname(scratch)); } catch { /* other operations remain */ }
    },
  };
}

export interface TmuxSessionEntry {
  readonly name: string;
  readonly hostPid: number | null;
  readonly supervisorPid: number | null;
  readonly attached: boolean;
}

function positivePid(value: string | undefined): number | null {
  const pid = Number.parseInt(value ?? '', 10);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

/** List the sessions on one Mission socket; empty when no server answers. */
export function listTmuxSessions(socketPath: string, spawnSyncFn: SpawnSyncFn = childProcess.spawnSync): TmuxSessionEntry[] {
  if (!fs.existsSync(socketPath)) { return []; }
  const listed = spawnSyncFn('tmux', ['-S', socketPath, 'list-sessions', '-F', '#{session_name}\t#{@px_host_pid}\t#{@px_supervisor_pid}\t#{session_attached}'], { encoding: 'utf8', timeout: 5000 });
  if (listed.status !== 0) { return []; }
  return String(listed.stdout).split('\n').filter(Boolean).map(line => {
    const [name, host, supervisor, attached] = line.split('\t');
    return { name, hostPid: positivePid(host), supervisorPid: positivePid(supervisor), attached: Number(attached) > 0 };
  });
}

/** Stop the Mission's server and drop its socket once no session remains. */
export function stopEmptyServer(socketPath: string, spawnSyncFn: SpawnSyncFn = childProcess.spawnSync): void {
  if (listTmuxSessions(socketPath, spawnSyncFn).length > 0) { return; }
  spawnSyncFn('tmux', ['-S', socketPath, 'kill-server'], { stdio: 'ignore', timeout: 5000 });
  fs.rmSync(socketPath, { force: true });
}

function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (err) { return (err as NodeJS.ErrnoException).code === 'EPERM'; }
}

/** Stop unsupervised operation windows; idle shells and other roles survive. */
export function reconcileOrphanSessions(
  identity: Pick<AgentRunIdentity, 'repositoryKey' | 'missionId' | 'role'>,
  options: { env?: NodeJS.ProcessEnv; spawnSyncFn?: SpawnSyncFn; isAlive?: (_pid: number) => boolean; allRoles?: boolean } = {},
): string[] {
  const socketPath = missionSocketPath(identity, options.env ?? process.env);
  const spawnSyncFn = options.spawnSyncFn ?? childProcess.spawnSync;
  const isAlive = options.isAlive ?? pidAlive;
  if (!fs.existsSync(socketPath)) { return []; }
  const listed = spawnSyncFn('tmux', ['-S', socketPath, 'list-windows', '-t', `=${identity.missionId}`, '-F', '#{window_name}\t#{@px_host_pid}\t#{@px_supervisor_pid}\t#{@px_command_pid}'], { encoding: 'utf8', timeout: 5000 });
  if (listed.status !== 0) { return []; }
  const killed: string[] = [];
  for (const line of String(listed.stdout).split('\n').filter(Boolean)) {
    const [name, host, supervisor, command] = line.split('\t');
    if ((!options.allRoles && !name.startsWith(`${identity.role}-`)) || (!host && !supervisor)) { continue; }
    const hostPid = positivePid(host);
    const supervisorPid = positivePid(supervisor);
    if (hostPid !== null && isAlive(hostPid) && supervisorPid !== null && isAlive(supervisorPid)) { continue; }
    const commandPid = positivePid(command);
    if (commandPid !== null) {
      spawnSyncFn('tmux', ['-S', socketPath, 'run-shell', '-t', `=${identity.missionId}:${name}`, `kill -s TERM ${commandPid} 2>/dev/null; sleep 0.25`], { stdio: 'ignore', timeout: 5000 });
    }
    spawnSyncFn('tmux', ['-S', socketPath, 'kill-window', '-t', `=${identity.missionId}:${name}`], { stdio: 'ignore', timeout: 5000 });
    killed.push(name);
  }
  return killed;
}

/** Argument vector that attaches the operator terminal to one run's session. */
export function tmuxAttachArgs(socketPath: string, sessionName: string, readOnly: boolean): string[] {
  return ['-S', socketPath, 'attach-session', ...(readOnly ? ['-r'] : []), '-t', `=${sessionName}`];
}

/** Supervise a whole CLI command without applying agent confinement to the CLI. */
export function superviseTmuxLaunch(launch: TmuxLaunch): Promise<number> {
  return new Promise((resolve, reject) => {
    const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
    const child = childProcess.spawn(launch.command, launch.args, { stdio: ['inherit', 'pipe', 'pipe'], detached: true });
    let client: childProcess.ChildProcess | null = null;
    let finished = false;
    let attaching: ReturnType<typeof setTimeout> | null = null;
    let readiness: childProcess.ChildProcess | null = null;
    child.stdout?.on('data', chunk => { if (!client) { process.stdout.write(chunk); } });
    child.stderr?.pipe(process.stderr, { end: false });
    const attach = () => {
      if (finished) { return; }
      readiness = childProcess.execFile('tmux', ['-S', launch.socketPath, 'display-message', '-p', '-t', `=${launch.sessionName}:${launch.windowName}`, '#{pane_id}'], { timeout: 500 }, error => {
        readiness = null;
        if (finished) { return; }
        if (error) { attaching = setTimeout(attach, 50); return; }
        client = childProcess.spawn('tmux', ['-S', launch.socketPath, 'attach-session', '-t', `=${launch.sessionName}:${launch.windowName}`], { stdio: 'inherit' });
        const attached = client;
        attached.once('error', () => { if (client === attached) { client = null; } });
        attached.once('exit', () => { if (client === attached) { client = null; } });
      });
    };
    if (interactive) { attaching = setTimeout(attach, 50); }
    const interrupt = () => { child.kill('SIGINT'); };
    const terminate = () => { child.kill('SIGTERM'); };
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', terminate);
    const cleanup = () => {
      finished = true;
      if (attaching) { clearTimeout(attaching); }
      readiness?.kill('SIGTERM');
      client?.kill('SIGTERM');
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', terminate);
      launch.cleanup();
    };
    child.once('error', err => { cleanup(); reject(err); });
    child.once('close', code => { cleanup(); resolve(code ?? 1); });
  });
}

/** Explicit idle-terminal cleanup; never cancel an operation as a side effect. */
export function closeMissionTerminal(socketPath: string, sessionName: string, spawnSyncFn: SpawnSyncFn = childProcess.spawnSync): void {
  const windows = spawnSyncFn('tmux', ['-S', socketPath, 'list-windows', '-t', `=${sessionName}`, '-F', '#{@px_host_pid}'], { encoding: 'utf8', timeout: 5000 });
  if (windows.status !== 0) { throw new Error('Cannot inspect mission terminal before closing it.'); }
  if (String(windows.stdout).split('\n').some(pid => positivePid(pid) !== null)) {
    throw new Error('Mission terminal has an owned operation; stop it before closing the terminal.');
  }
  const closed = spawnSyncFn('tmux', ['-S', socketPath, 'kill-session', '-t', `=${sessionName}`], { stdio: 'ignore', timeout: 5000 });
  if (closed.status !== 0) { throw new Error('Could not close mission terminal.'); }
  stopEmptyServer(socketPath, spawnSyncFn);
}

/** Worktree cleanup retires idle consoles now, or after active operations drain. */
export function retireMissionTerminal(socketPath: string, sessionName: string, spawnSyncFn: SpawnSyncFn = childProcess.spawnSync): void {
  if (!fs.existsSync(socketPath)) { return; }
  if (listTmuxSessions(socketPath, spawnSyncFn).length === 0) { stopEmptyServer(socketPath, spawnSyncFn); return; }
  const retired = spawnSyncFn('tmux', ['-S', socketPath, 'set-option', '-t', sessionName, '@px_retired', '1'], { stdio: 'ignore', timeout: 5000 });
  if (retired.status !== 0) { throw new Error('Cannot retire mission terminal during worktree cleanup.'); }
  finishRetiredTerminal(socketPath, sessionName, spawnSyncFn);
}

function finishRetiredTerminal(socketPath: string, sessionName: string, spawnSyncFn: SpawnSyncFn): void {
  const retired = spawnSyncFn('tmux', ['-S', socketPath, 'show-option', '-v', '-t', sessionName, '@px_retired'], { encoding: 'utf8', timeout: 5000 });
  if (retired.status !== 0 || String(retired.stdout).trim() !== '1') { return; }
  const windows = spawnSyncFn('tmux', ['-S', socketPath, 'list-windows', '-t', `=${sessionName}`, '-F', '#{@px_host_pid}'], { encoding: 'utf8', timeout: 5000 });
  if (windows.status === 0 && !String(windows.stdout).split('\n').some(pid => positivePid(pid) !== null)) {
    closeMissionTerminal(socketPath, sessionName, spawnSyncFn);
  }
}
