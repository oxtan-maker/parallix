import { once } from 'node:events';
import { closeSync, openSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const SCRIPT = '/usr/bin/script';
const STTY = '/usr/bin/stty';
/** How long the outer shell holds the PTY open after the launched process exits. */
const HOLD_TICKS = 400;
const HOLD_TICK_SECONDS = '0.05';
/** Grace period for the outer shell to publish the launched process's `$?`. */
const EXIT_STATUS_GRACE_MS = 1_000;

function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function timeout<T>(promise: Promise<T>, milliseconds: number, description: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const deadline = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`PTY smoke timeout after ${milliseconds}ms: ${description}`)), milliseconds);
  });
  return Promise.race([promise, deadline]).finally(() => {
    if (timer !== null) { clearTimeout(timer); }
  });
}

async function waitForFile(path: string, milliseconds: number): Promise<string> {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    try {
      const content = await readFile(path, 'utf8');
      if (content.trim()) { return content.trim(); }
    } catch {
      // The shell writes metadata immediately after the local PTY is ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error(`PTY smoke timeout after ${milliseconds}ms: waiting for ${path}`);
}

function runStty(device: string, settings: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const fd = openSync(device, 'r');
    const child = spawn(STTY, [...settings], { stdio: [fd, 'ignore', 'ignore'] });
    child.once('error', (error: Error) => { closeSync(fd); reject(error); });
    child.once('exit', (code) => {
      closeSync(fd);
      if (code === 0) { resolve(); } else { reject(new Error(`stty ${settings.join(' ')} failed with ${code}`)); }
    });
  });
}

/**
 * Read terminal settings straight off the PTY device from *this* process.
 *
 * Every reader of the terminal's state must live outside the Ctrl+C blast
 * radius: 0x03 in cooked mode is delivered as a SIGINT to the PTY's whole
 * foreground process group, which includes the launched command and the outer
 * `script` shell. The test process is not in that group.
 */
function readStty(device: string, flag: '-a' | '-g'): Promise<string> {
  return new Promise((resolve, reject) => {
    const fd = openSync(device, 'r');
    const child = spawn(STTY, [flag], { stdio: [fd, 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    const errors: Buffer[] = [];
    child.stdout.on('data', (data: Buffer) => chunks.push(data));
    child.stderr.on('data', (data: Buffer) => errors.push(data));
    child.once('error', (error: Error) => { closeSync(fd); reject(error); });
    child.once('exit', (code) => {
      closeSync(fd);
      if (code === 0) { resolve(Buffer.concat(chunks).toString()); }
      else { reject(new Error(`stty ${flag} failed with ${code}: ${Buffer.concat(errors).toString().trim()}`)); }
    });
  });
}

async function waitForRawState(device: string, milliseconds: number): Promise<void> {
  const deadline = Date.now() + milliseconds;
  for (;;) {
    try {
      // ICANON off is the marker for raw input mode.
      if (/(^|\s)-icanon(\s|$)/.test(await readStty(device, '-a'))) { return; }
    } catch {
      // Transient read failure; the deadline bounds the wait.
    }
    if (Date.now() >= deadline) {
      throw new Error(`PTY smoke timeout after ${milliseconds}ms: terminal never entered raw mode`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

export interface PtySmokeSession {
  readonly output: () => string;
  readonly isAlive: () => boolean;
  /**
   * The operating-system process id of the launched command itself (not the
   * `script` wrapper), so a shutdown test can prove *that* process is gone
   * rather than that a callback ran.
   */
  readonly pid: number;
  send(input: string): void;
  resize(columns: number, rows: number): Promise<void>;
  /** Send an OS signal to the launched process. */
  signal(signal: NodeJS.Signals): void;
  /**
   * Resolve with the launched process's own exit status once it is gone, or
   * reject on timeout. A status of `128 + n` means the process died by signal
   * `n` rather than returning a code of its own.
   */
  waitForExit(milliseconds: number): Promise<number>;
  /** Whether the launched pid no longer exists. */
  processGone(): boolean;
  /** Whether the PTY's terminal settings match the pre-launch capture. */
  terminalRestored(): Promise<boolean>;
  /**
   * Resolve once the launched process has put the PTY into raw mode. Keystrokes
   * sent before raw mode is active can be translated by the line discipline —
   * Ctrl+C (0x03) becomes a SIGINT to the foreground process group instead of
   * an input byte — so tests must await this before sending raw keys.
   */
  waitForRaw(milliseconds: number): Promise<void>;
  /**
   * Whether the PTY is in raw input mode right now, read from the device by
   * the test process. Lets a test prove *which* side of Ink's raw-mode window
   * it is exercising instead of assuming it.
   */
  isRaw(): Promise<boolean>;
  /**
   * Put the line discipline back into canonical, signal-generating mode from
   * the test process, so a test can exercise signal delivery while the PTY is
   * *not* in raw mode without racing the launched process's startup. Only
   * `icanon`/`isig` are touched, so the result still differs from the
   * pre-launch capture and `terminalRestored()` keeps its teeth.
   */
  leaveRawMode(): Promise<void>;
  /** Remove the session's temporary metadata directory. */
  cleanup(): Promise<void>;
  exitCleanly(): Promise<{ readonly exitCode: number; readonly terminalRestored: boolean }>;
}

/**
 * Launch a real local PTY through util-linux `script`. It can only launch the
 * supplied local executable; it does not contain agent, Forgejo, Git, or repo
 * mutation capabilities. Temporary lifecycle metadata lives under the OS temp
 * directory and is removed when the session closes.
 */
export async function launchPtySmoke(
  command: readonly string[],
  options: { readonly cwd: string; readonly timeoutMs: number; readonly env?: NodeJS.ProcessEnv },
): Promise<PtySmokeSession> {
  if (command.length === 0) { throw new Error('PTY smoke command is required'); }
  const temp = await mkdtemp(join(tmpdir(), 'parallix-pty-smoke-'));
  const ttyPath = join(temp, 'tty');
  const pidPath = join(temp, 'pid');
  const beforePath = join(temp, 'stty-before');
  const statusPath = join(temp, 'status');
  // `sh -c 'echo $$ …; exec …'` publishes the launched process's own pid while
  // keeping it in the foreground, so the PTY stays wired to its stdin.
  const launch = `sh -c ${quote(`echo $$ > ${quote(pidPath)}; exec ${command.map(quote).join(' ')}`)}`;
  const shell = [
    `tty > ${quote(ttyPath)}`,
    `${quote(STTY)} -g > ${quote(beforePath)}`,
    `${quote(STTY)} cols 120 rows 30`,
    // Ctrl+C in cooked mode raises SIGINT on this shell's whole foreground
    // process group. Trapping it keeps the shell — and therefore the PTY
    // device — alive after the launched process is gone, so the test process
    // can still read the terminal's final state. A trap bound to a command is
    // reset to the default disposition in the forked child, so the launched
    // process still receives the signal unmodified.
    "trap 'true' INT",
    launch,
    `echo $? > ${quote(statusPath)}`,
    // Hold the PTY open so the test process can still read the terminal's
    // final state; the test process releases the session by terminating this
    // wrapper as soon as it has captured that state. The shell writes no
    // terminal postcondition of its own — everything a signal could skip has
    // moved into the test process.
    `i=0; while [ "$i" -lt ${HOLD_TICKS} ]; do sleep ${HOLD_TICK_SECONDS}; i=$((i+1)); done`,
    `exit "$(cat ${quote(statusPath)})"`,
  ].join('; ');
  const child = spawn(SCRIPT, ['-qefc', shell, '/dev/null'], {
    cwd: options.cwd,
    env: options.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const output: string[] = [];
  child.stdout.on('data', (data: Buffer) => output.push(data.toString()));
  child.stderr.on('data', (data: Buffer) => output.push(data.toString()));
  let hasExited = false;
  const exited = once(child, 'exit').then(([code]) => {
    hasExited = true;
    return Number(code ?? 1);
  });
  let device: string;
  let pid: number;
  try {
    device = await timeout(waitForFile(ttyPath, options.timeoutMs), options.timeoutMs, 'starting local PTY');
    pid = Number(await timeout(waitForFile(pidPath, options.timeoutMs), options.timeoutMs, 'reading launched pid'));
  } catch (error) {
    throw new Error(`Could not start local PTY (temporary diagnostics: ${temp}): ${String(error)}; output: ${output.join('')}`);
  }

  const pidGone = () => {
    try {
      process.kill(pid, 0);
      return false;
    } catch {
      return true;
    }
  };

  /**
   * The after-state capture. Taken by the test process from the PTY device
   * once the launched process is gone; never read back from a file some other
   * process was supposed to write.
   */
  let afterState: string | null = null;
  let afterStateFailure: string | null = null;
  const captureAfterState = async () => {
    if (afterState !== null || afterStateFailure !== null) { return; }
    try {
      afterState = (await readStty(device, '-g')).trim();
    } catch (error) {
      afterStateFailure = String(error);
    }
  };
  /** End the wrapper's PTY hold once the after-state has been captured. */
  const release = () => {
    if (!hasExited) { child.kill('SIGKILL'); }
  };

  const readExitStatus = async (): Promise<number> => {
    try {
      const published = await waitForFile(statusPath, EXIT_STATUS_GRACE_MS);
      const status = Number(published);
      if (Number.isInteger(status)) { return status; }
    } catch {
      // The outer shell was killed outright; fall back to the wrapper's code.
    }
    return hasExited ? await exited : -1;
  };

  let launchedExit: Promise<number> | null = null;
  const waitForLaunchedExit = (milliseconds: number): Promise<number> => {
    if (launchedExit !== null) { return launchedExit; }
    launchedExit = (async () => {
      const deadline = Date.now() + milliseconds;
      while (!pidGone()) {
        if (Date.now() >= deadline) {
          throw new Error(`PTY smoke timeout after ${milliseconds}ms: waiting for pid ${pid} to exit`);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await captureAfterState();
      const status = await readExitStatus();
      release();
      return status;
    })();
    launchedExit.catch(() => { launchedExit = null; });
    return launchedExit;
  };

  const terminalRestored = async () => {
    await captureAfterState();
    if (afterState === null) {
      throw new Error(`Could not read the PTY's terminal settings after exit: ${afterStateFailure}`);
    }
    const before = (await readFile(beforePath, 'utf8')).trim();
    return before === afterState;
  };

  return {
    output: () => output.join(''),
    isAlive: () => !hasExited && !pidGone(),
    pid,
    signal: (signal) => { process.kill(pid, signal); },
    waitForExit: waitForLaunchedExit,
    processGone: pidGone,
    terminalRestored,
    waitForRaw: (milliseconds) => waitForRawState(device, milliseconds),
    isRaw: async () => /(^|\s)-icanon(\s|$)/.test(await readStty(device, '-a')),
    leaveRawMode: async () => {
      await timeout(runStty(device, ['icanon', 'isig']), options.timeoutMs, 'leaving raw mode');
    },
    cleanup: async () => {
      release();
      await exited;
      await rm(temp, { recursive: true, force: true });
    },
    send: (input) => { child.stdin.write(input); },
    resize: async (columns, rows) => {
      await timeout(runStty(device, ['cols', String(columns), 'rows', String(rows)]), options.timeoutMs, 'resizing local PTY');
    },
    exitCleanly: async () => {
      child.stdin.write('q');
      const exitCode = await waitForLaunchedExit(options.timeoutMs);
      const restored = await terminalRestored();
      release();
      await rm(temp, { recursive: true, force: true });
      return { exitCode, terminalRestored: restored };
    },
  };
}
