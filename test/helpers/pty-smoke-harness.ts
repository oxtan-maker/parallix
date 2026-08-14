import { once } from 'node:events';
import { openSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const SCRIPT = '/usr/bin/script';
const STTY = '/usr/bin/stty';

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

function runStty(device: string, columns: number, rows: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const fd = openSync(device, 'r');
    const child = spawn(STTY, ['cols', String(columns), 'rows', String(rows)], { stdio: [fd, 'ignore', 'ignore'] });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`stty resize failed with ${code}`)));
  });
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
  /** Resolve with the exit code once the session ends, or reject on timeout. */
  waitForExit(milliseconds: number): Promise<number>;
  /** Whether the launched pid no longer exists. */
  processGone(): boolean;
  /** Whether the PTY's terminal settings match the pre-launch capture. */
  terminalRestored(): Promise<boolean>;
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
  const afterPath = join(temp, 'stty-after');
  // `sh -c 'echo $$ …; exec …'` publishes the launched process's own pid while
  // keeping it in the foreground, so the PTY stays wired to its stdin.
  const launch = `sh -c ${quote(`echo $$ > ${quote(pidPath)}; exec ${command.map(quote).join(' ')}`)}`;
  const shell = [
    `tty > ${quote(ttyPath)}`,
    `${quote(STTY)} -g > ${quote(beforePath)}`,
    `${quote(STTY)} cols 120 rows 30`,
    launch,
    'status=$?',
    `${quote(STTY)} -g > ${quote(afterPath)}`,
    `${quote(STTY)} "$(cat ${quote(beforePath)})"`,
    'exit "$status"',
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
  const terminalRestored = async () => {
    const [before, after] = await Promise.all([readFile(beforePath, 'utf8'), readFile(afterPath, 'utf8')]);
    return before === after;
  };
  return {
    output: () => output.join(''),
    isAlive: () => !hasExited,
    pid,
    signal: (signal) => { process.kill(pid, signal); },
    waitForExit: (milliseconds) => timeout(exited, milliseconds, `waiting for pid ${pid} to exit`),
    processGone: () => {
      try {
        process.kill(pid, 0);
        return false;
      } catch {
        return true;
      }
    },
    terminalRestored,
    cleanup: async () => { await rm(temp, { recursive: true, force: true }); },
    send: (input) => { child.stdin.write(input); },
    resize: async (columns, rows) => {
      await timeout(runStty(device, columns, rows), options.timeoutMs, 'resizing local PTY');
    },
    exitCleanly: async () => {
      child.stdin.write('q');
      const exitCode = await timeout(exited, options.timeoutMs, 'clean UI exit');
      const restored = await terminalRestored();
      await rm(temp, { recursive: true, force: true });
      return { exitCode, terminalRestored: restored };
    },
  };
}
