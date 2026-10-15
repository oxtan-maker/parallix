import type { ParallixConfiguration } from "../../application/ports/configuration.js";
import { DEFAULT_CONFIGURATION } from "../../application/ports/configuration.js";
import childProcess from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { NativeTerminalRun, NativeMissionTerminalIdentity } from './mission-terminal-identity.js';
import { isRunHistoryId } from '../../application/run-history-types.js';
import { agentRunId } from '../../domain/agent-run.js';
import { missionTerminalIdentity } from './mission-terminal-identity.js';
import { ensurePrivateDir, terminalSocketFallbackRoot, terminalStateRoot } from './terminal-state-root.js';

/** Mission-keyed persistent terminals; operation windows retain run attribution. */

export interface TmuxProbe {
  readonly available: boolean;
  readonly version: string | null;
  readonly reason: string | null;
}

export type SpawnSyncFn = (command: string, args: string[], options: childProcess.SpawnSyncOptions) => {
  status: number | null; stdout?: string | Buffer | null; stderr?: string | Buffer | null; error?: NodeJS.ErrnoException;
};

/** Probe whether tmux can host a launch on this platform. */
export function probeTmux(spawnSyncFn: SpawnSyncFn = childProcess.spawnSync, platform: NodeJS.Platform = process.platform): TmuxProbe {
  if (platform === 'win32') {
    return { available: false, version: null, reason: 'tmux terminal hosting is supported on Linux and macOS only' };
  }
  const probe = spawnSyncFn('tmux', ['-V'], { encoding: 'utf8', timeout: 5000 });
  if (probe.error || probe.status !== 0) {
    const cause = probe.error ? probe.error.code || probe.error.message : `exit ${probe.status}`;
    return { available: false, version: null, reason: `tmux is not runnable (${cause}); install tmux or set adapters.terminal.host to "pipe"` };
  }
  return { available: true, version: String(probe.stdout).trim() || null, reason: null };
}

/**
 * The native tmux name of a canonical Mission ID (TASK-2749). tmux rewrites
 * `.` and `:` in session names, so the adapter encodes `.` as `_` itself.
 * Canonical Mission IDs never contain `_` or `:`, so the encoding is injective
 * and equals the token earlier releases used: existing sessions keep resolving.
 */
export function tmuxMissionName(missionId: string): string {
  return missionTerminalIdentity({ repositoryKey: 'x', missionId }).missionId.replace(/\./g, '_');
}

/** The Mission's tmux socket: one server per repository and Mission. */
export function missionSocketPath(input: { readonly repositoryKey: string; readonly missionId: string }, configuration: ParallixConfiguration = DEFAULT_CONFIGURATION): string {
  // Native handles are derived only from a validated identity; invalid input throws.
  const identity = missionTerminalIdentity(input);
  const root = terminalStateRoot(configuration);
  const name = tmuxMissionName(identity.missionId);
  const socket = path.join(root, identity.repositoryKey, `${name}.sock`);
  if (Buffer.byteLength(socket) <= 100) { return socket; }
  // sockaddr_un pathnames have a small portable limit. Include the resolved
  // root in the digest so independent configured state roots cannot collide.
  const digest = createHash('sha256').update(`${root}\0${identity.repositoryKey}\0${name}`).digest('hex').slice(0, 32);
  return path.join(terminalSocketFallbackRoot(configuration), `${digest}.sock`);
}

/**
 * Private, unredacted operation transcript in the owner-only terminal state
 * root: the source of the console's display-only replay. It is never exposed
 * through history, attach or the web host; retained, redacted history is the
 * run-history store (TASK-2749).
 */
export function missionTerminalCapturePath(identity: { readonly repositoryKey: string; readonly missionId: string }, configuration: ParallixConfiguration = DEFAULT_CONFIGURATION): string {
  return `${missionSocketPath(identity, configuration)}.log`;
}

/** Single-quote one value for POSIX `sh`. */
export function shellQuote(value: string): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

export type TmuxLaunchInput = {
  /** Distinguishes a second spawn inside one launch (for example a stale-resume retry). */
  readonly spawnIndex: number;
  /** Whole CLI command, or an already-confined agent command from its launch seam. */
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The harness process supervising this launch; defaults to this process. */
  readonly supervisorPid?: number;
  /**
   * Renders the command's output into the visible pane. The pane then shows
   * the rendered view while the supervisor still receives the raw bytes.
   */
  readonly presenter?: { readonly command: string; readonly args: readonly string[] };
  /** Bytes the command reads from stdin, followed by EOF, instead of the pane terminal. */
  readonly input?: Buffer;
} & ({ readonly identity: NativeMissionTerminalIdentity; readonly runId: string }
  | { readonly identity: NativeTerminalRun; readonly runId?: undefined });

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
export function tmuxSessionName(identity: { readonly missionId: string }, _spawnIndex = 0): string {
  return tmuxMissionName(identity.missionId);
}

function operationWindowName(runId: string, spawnIndex: number): string {
  return `${runId}-s${spawnIndex}-${randomUUID().slice(0, 8)}`;
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Record the supervised command PID before exec, without changing its terminal.
 * Supplied input becomes the command's stdin; its private file is unlinked once open.
 */
function commandScript(socketPath: string, scratch: string, command: string, args: readonly string[], hasInput: boolean): string {
  const input = shellQuote(path.join(scratch, 'stdin'));
  return [
    '#!/bin/sh',
    `printf '%s' "$$" > ${shellQuote(path.join(scratch, 'command.pid'))}`,
    `tmux -S ${shellQuote(socketPath)} set-option -w -t "$TMUX_PANE" @px_command_pid "$$"`,
    ...(hasInput ? [`exec 3< ${input} || exit 66`, `rm -f ${input}`] : []),
    `exec ${[command, ...args].map(shellQuote).join(' ')}${hasInput ? ' <&3 3<&-' : ''}`,
    '',
  ].join('\n');
}

function paneScript(socketPath: string, windowName: string, scratch: string, presenter?: TmuxLaunchInput['presenter']): string {
  const t = `tmux -S ${shellQuote(socketPath)}`;
  const agentOut = shellQuote(path.join(scratch, 'agent.out'));
  // Agent output goes to a private fifo: `tee` forwards the raw bytes to the
  // host's raw channel while the presenter draws the readable view on the pane.
  const run = presenter
    ? [`mkfifo ${agentOut}`,
      `tee ${shellQuote(path.join(scratch, 'raw'))} < ${agentOut} | ${[presenter.command, ...presenter.args].map(shellQuote).join(' ')} &`,
      'presenter=$!',
      `sh ${shellQuote(path.join(scratch, 'command.sh'))} > ${agentOut} 2>&1`,
      'status=$?',
      'wait "$presenter"']
    : [`sh ${shellQuote(path.join(scratch, 'command.sh'))}`, 'status=$?'];
  return [
    '#!/bin/sh',
    `${t} wait-for ${shellQuote(`${windowName}-go`)}`,
    `. ${shellQuote(path.join(scratch, 'pane.env'))}`,
    `rm -f ${shellQuote(path.join(scratch, 'pane.env'))}`,
    ...run,
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

function consolePxScript(command: string | undefined): string {
  if (!command) { return '#!/bin/sh\nexit 127\n'; }
  // A px child starts an interactive Bash that reads the operator's rc files
  // before exec. Those files may run px themselves (`eval "$(px shell-init)"`),
  // which would re-enter this wrapper without end: the marker makes the nested
  // call exec the CLI directly, and is dropped before the real command runs.
  const quoted = shellQuote(command);
  return ['#!/bin/sh',
    `if [ -n "$PARALLIX_CONSOLE_PX" ]; then exec ${quoted} "$@"; fi`,
    `PARALLIX_CONSOLE_PX=1 exec /bin/bash -ic 'unset PARALLIX_CONSOLE_PX; exec "$@"' bash ${quoted} "$@"`, ''].join('\n');
}

function hostScript(socketPath: string, sessionName: string, windowName: string, scratch: string, cwd: string, supervisorPid: number, consoleBin: string, capturePath: string, terminalStateDir: string, configuration: ParallixConfiguration, presented: boolean, runId: string): string {
  // The tmux server, and every window it later launches, must not inherit operation credentials.
  // The retained console is the operator's own interactive shell and reads their rc files like any terminal.
  const cleanEnv = Object.entries(configuration.terminal.hostEnvironment).filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${key}=${shellQuote(value!)}`).join(' ');
  const stateRoot = path.dirname(path.dirname(socketPath));
  const t = `env -i ${cleanEnv} PARALLIX_TERMINAL_STATE_DIR=${shellQuote(stateRoot)} tmux -S ${shellQuote(socketPath)}`;
  const fifo = shellQuote(path.join(scratch, 'out'));
  const raw = shellQuote(path.join(scratch, 'raw'));
  const status = shellQuote(path.join(scratch, 'status'));
  const capture = shellQuote(capturePath);
  const name = shellQuote(sessionName);
  const consoleTarget = shellQuote(`=${sessionName}:console`);
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
    '  [ -z "$rawrelay" ] || kill "$rawrelay" 2>/dev/null',
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
    // Presented launches relay the raw stream to the supervisor separately from the pane's readable view.
    ...(presented ? [`mkfifo ${raw} || exit 70`, `cat ${raw} &`, 'rawrelay=$!'] : []),
    // -A would attach when the session exists and require a caller TTY.
    // Concurrent creators may lose new-session; recheck the exact session.
    `${t} has-session -t ${shellQuote(`=${sessionName}`)} 2>/dev/null || ${t} -f /dev/null new-session -d -s ${name} -n console -x 200 -y 50 -c ${shellQuote(cwd)} ${shellQuote(`PARALLIX_TERMINAL_STATE_DIR=${shellQuote(terminalStateDir)} PATH=${consoleBin}:$PATH exec "\${SHELL:-/bin/sh}" -i`)} 2>/dev/null || ${t} has-session -t ${shellQuote(`=${sessionName}`)} || exit 70`,
    // The private transcript keeps the operator console too (TASK-2670); it is
    // never history: retained, redacted history is the run-history store.
    `${t} pipe-pane -t ${consoleTarget} -o ${shellQuote(`cat >> ${capture}`)} || exit 70`,
    `${t} new-window -d -t ${name} -n ${shellQuote(windowName)} -c ${shellQuote(cwd)} ${shellQuote(`sh ${shellQuote(path.join(scratch, 'pane.sh'))}`)} || exit 70`,
    `${t} set-option -w -t ${target} @px_run_id ${shellQuote(runId)} >/dev/null`,
    `${t} set-option -w -t ${target} @px_host_pid "$$" >/dev/null`,
    `${t} set-option -w -t ${target} @px_supervisor_pid ${supervisorPid} >/dev/null`,
    `${t} pipe-pane -t ${target} -o ${shellQuote(`cat > ${fifo}`)} || { cleanup; exit 70; }`,
    presented ? `cat ${fifo} >> ${capture} &` : `cat ${fifo} | tee -a ${capture} &`,
    'relay=$!',
    `${t} select-window -t ${target}`,
    `${t} wait-for -S ${shellQuote(`${windowName}-go`)}`,
    `while [ ! -s ${status} ] && ${t} display-message -p -t ${target} '#{pane_id}' >/dev/null 2>&1; do sleep 0.1; done &`,
    'completion=$!',
    'wait "$completion"',
    `${t} pipe-pane -t ${target}`,
    'wait "$relay"',
    ...(presented ? ['wait "$rawrelay"'] : []),
    `if [ -s ${status} ]; then`,
    `  result=$(cat ${status})`,
    `  printf '\n[mission terminal command exit code: %s]\n' "$result" >> ${capture}`,
    // Show the completed command in the surviving operator shell before the
    // operation window disappears. The replay reaches only the console and its
    // private transcript; retained history never receives it (TASK-2749).
    `  ${t} send-keys -t ${consoleTarget} -l ${shellQuote(`tail -n 50 ${capture}`)}`,
    `  ${t} send-keys -t ${consoleTarget} Enter`,
    `  ${t} select-window -t ${consoleTarget}`,
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
export function prepareTmuxLaunch(input: TmuxLaunchInput, options: { configuration?: ParallixConfiguration; spawnSyncFn?: SpawnSyncFn } = {}): TmuxLaunch {
  const configuration = options.configuration ?? DEFAULT_CONFIGURATION;
  const socketPath = missionSocketPath(input.identity, configuration);
  const sessionName = tmuxSessionName(input.identity, input.spawnIndex);
  const runId = input.runId ?? ('family' in input.identity ? agentRunId(input.identity) : null);
  if (!runId || !isRunHistoryId(runId)) { throw new Error('A terminal launch needs a valid retained capture id'); }
  const windowName = operationWindowName(runId, input.spawnIndex);
  const scratch = path.join(path.dirname(socketPath), sessionName, windowName);
  ensurePrivateDir(path.dirname(socketPath));
  ensurePrivateDir(scratch);
  const consoleBin = path.join(path.dirname(socketPath), sessionName, 'console-bin');
  ensurePrivateDir(consoleBin);
  const commandPath = configuration.agents.searchPath.split(path.delimiter).map(dir => path.join(dir, 'px')).find(candidate => {
    try { return fs.statSync(candidate).isFile(); } catch { return false; }
  });
  fs.writeFileSync(path.join(consoleBin, 'px'), consolePxScript(commandPath), { mode: 0o700 });
  writeEnvFile(path.join(scratch, 'pane.env'), { ...input.env, PWD: input.cwd, PARALLIX_MISSION_TERMINAL: input.identity.missionId, PARALLIX_MISSION_SOCKET: socketPath });
  if (input.input) { fs.writeFileSync(path.join(scratch, 'stdin'), input.input, { mode: 0o600 }); }
  fs.writeFileSync(path.join(scratch, 'command.sh'), commandScript(socketPath, scratch, input.command, input.args, Boolean(input.input)), { mode: 0o700 });
  fs.writeFileSync(path.join(scratch, 'pane.sh'), paneScript(socketPath, windowName, scratch, input.presenter), { mode: 0o700 });
  fs.writeFileSync(path.join(scratch, 'host.sh'), hostScript(socketPath, sessionName, windowName, scratch, input.cwd, input.supervisorPid ?? process.pid, consoleBin, missionTerminalCapturePath(input.identity, configuration), terminalStateRoot(configuration), configuration, Boolean(input.presenter), runId), { mode: 0o700 });
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

function isReconciledOperationWindow(name: string, host: string | undefined, supervisor: string | undefined, role: string, allRoles: boolean): boolean {
  return (allRoles || name.startsWith(`${role}-`)) && Boolean(host || supervisor);
}

/** Stop unsupervised operation windows; idle shells and other roles survive. */
export function reconcileOrphanSessions(
  identity: { readonly repositoryKey: string; readonly missionId: string; readonly role: string },
  options: { configuration?: ParallixConfiguration; spawnSyncFn?: SpawnSyncFn; isAlive?: (_pid: number) => boolean; allRoles?: boolean } = {},
): string[] {
  const socketPath = missionSocketPath(identity, options.configuration ?? DEFAULT_CONFIGURATION);
  const session = tmuxSessionName(identity);
  const spawnSyncFn = options.spawnSyncFn ?? childProcess.spawnSync;
  const isAlive = options.isAlive ?? pidAlive;
  if (!fs.existsSync(socketPath)) { return []; }
  const listed = spawnSyncFn('tmux', ['-S', socketPath, 'list-windows', '-t', `=${session}`, '-F', '#{window_name}\t#{@px_host_pid}\t#{@px_supervisor_pid}\t#{@px_command_pid}'], { encoding: 'utf8', timeout: 5000 });
  if (listed.status !== 0) { return []; }
  const killed: string[] = [];
  for (const line of String(listed.stdout).split('\n').filter(Boolean)) {
    const [name, host, supervisor, command] = line.split('\t');
    if (!isReconciledOperationWindow(name, host, supervisor, identity.role, Boolean(options.allRoles))) { continue; }
    const hostPid = positivePid(host);
    const supervisorPid = positivePid(supervisor);
    if (hostPid !== null && isAlive(hostPid) && supervisorPid !== null && isAlive(supervisorPid)) { continue; }
    const commandPid = positivePid(command);
    if (commandPid !== null) {
      spawnSyncFn('tmux', ['-S', socketPath, 'run-shell', '-t', `=${session}:${name}`, `kill -s TERM ${commandPid} 2>/dev/null; sleep 0.25`], { stdio: 'ignore', timeout: 5000 });
    }
    spawnSyncFn('tmux', ['-S', socketPath, 'kill-window', '-t', `=${session}:${name}`], { stdio: 'ignore', timeout: 5000 });
    killed.push(name);
  }
  return killed;
}

/** Argument vector that attaches the operator terminal to one run's session. */
export function tmuxAttachArgs(socketPath: string, sessionName: string, readOnly: boolean): string[] {
  return ['-S', socketPath, 'attach-session', ...(readOnly ? ['-r'] : []), '-t', `=${sessionName}`];
}

/**
 * Supervise a whole CLI command without applying agent confinement to the CLI.
 * `onOutput` receives every byte the operation pane relays (stderr merged by
 * the terminal), whether or not an operator is attached (TASK-2749).
 */
export function superviseTmuxLaunch(launch: TmuxLaunch, options: { onOutput?: (_stream: 'stdout' | 'stderr', _chunk: Buffer) => void } = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
    const child = childProcess.spawn(launch.command, launch.args, { stdio: ['inherit', 'pipe', 'pipe'], detached: true });
    let client: childProcess.ChildProcess | null = null;
    let finished = false;
    let commandClosed = false;
    let commandExitCode = 1;
    let attachedOnce = false;
    let attaching: ReturnType<typeof setTimeout> | null = null;
    let readiness: childProcess.ChildProcess | null = null;
    child.stdout?.on('data', chunk => { options.onOutput?.('stdout', chunk); if (!client) { process.stdout.write(chunk); } });
    if (options.onOutput) { child.stderr?.on('data', chunk => options.onOutput!('stderr', chunk)); }
    child.stderr?.pipe(process.stderr, { end: false });
    const scheduleAttach = () => {
      if (!finished && !commandClosed && !client && !attaching) { attaching = setTimeout(attach, 50); }
    };
    const attach = () => {
      attaching = null;
      if (finished) { return; }
      readiness = childProcess.execFile('tmux', commandClosed
        ? ['-S', launch.socketPath, 'has-session', '-t', `=${launch.sessionName}`]
        : ['-S', launch.socketPath, 'display-message', '-p', '-t', `=${launch.sessionName}:${launch.windowName}`, '#{pane_id}'], { timeout: 500 }, error => {
        readiness = null;
        if (finished) { return; }
        if (error) { if (commandClosed) { settle(commandExitCode); } else { scheduleAttach(); } return; }
        client = childProcess.spawn('tmux', ['-S', launch.socketPath, 'attach-session', '-t', `=${launch.sessionName}`], { stdio: 'inherit' });
        attachedOnce = true;
        const attached = client;
        attached.once('error', () => {
          if (client === attached) { client = null; }
          if (commandClosed) { settle(commandExitCode); } else { scheduleAttach(); }
        });
        attached.once('exit', code => {
          if (client !== attached) { return; }
          client = null;
          if (commandClosed) { settle(commandExitCode); }
          // A non-zero attach can race the just-created server/window. Retry
          // while the supervised command is still alive; a clean detach must
          // remain detached and therefore does not trigger a new attachment.
          else if (code !== 0) { scheduleAttach(); }
        });
      });
    };
    if (interactive) { scheduleAttach(); }
    const interrupt = () => { if (commandClosed) { client?.kill('SIGINT'); } else { child.kill('SIGINT'); } };
    const terminate = () => { if (commandClosed) { client?.kill('SIGTERM'); } else { child.kill('SIGTERM'); } };
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
    const settle = (code: number) => { if (finished) { return; } cleanup(); resolve(code); };
    child.once('error', err => { cleanup(); reject(err); });
    child.once('close', code => {
      commandClosed = true;
      commandExitCode = code ?? 1;
      if (attaching) { clearTimeout(attaching); attaching = null; }
      // An attached client is part of this interactive command's lifecycle.
      // Keep px alive while the operator reads the retained console, then
      // return only after an explicit tmux detach.  This avoids leaving an
      // inherited-stdio tmux child orphaned after the entry process exits.
      if (client) { return; }
      if (interactive && !attachedOnce) { if (!readiness) { attach(); } return; }
      settle(code ?? 1);
    });
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
  if (listTmuxSessions(socketPath, spawnSyncFn).some(session => session.name === sessionName && session.attached)) { return; }
  const windows = spawnSyncFn('tmux', ['-S', socketPath, 'list-windows', '-t', `=${sessionName}`, '-F', '#{@px_host_pid}'], { encoding: 'utf8', timeout: 5000 });
  if (windows.status === 0 && !String(windows.stdout).split('\n').some(pid => positivePid(pid) !== null)) {
    closeMissionTerminal(socketPath, sessionName, spawnSyncFn);
  }
}
