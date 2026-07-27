import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A real-PTY session used by the TASK-2286 native single-executable smoke.
 *
 * It differs from `test/helpers/pty-smoke-harness.ts` in one respect that the
 * SEA proof needs: the launched process keeps the shell's own PID (the shell
 * `exec`s into it), so the test can address the executable directly for signal
 * delivery and for `/proc/<pid>` idle-memory sampling. The harness itself has
 * no agent, Forgejo, Git, network, or repository-write capability.
 */

const SCRIPT = '/usr/bin/script';
const STTY = '/usr/bin/stty';

function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function waitForFile(path: string, milliseconds: number, description: string): Promise<string> {
  const deadline = Date.now() + milliseconds;
  for (;;) {
    try {
      const content = await readFile(path, 'utf8');
      if (content.trim()) { return content.trim(); }
    } catch {
      // The shell writes both metadata files immediately after the PTY opens.
    }
    if (Date.now() > deadline) {
      throw new Error(`SEA PTY timeout after ${milliseconds}ms: ${description}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

export interface SeaPtySession {
  /** PID of the launched executable itself (not of a wrapper shell). */
  readonly pid: number;
  /** PTY device the executable was given as stdin/stdout, e.g. /dev/pts/7. */
  readonly ttyPath: string;
  readonly output: () => string;
  readonly isAlive: () => boolean;
  send(input: string): void;
  /** Resident set size of the live process in MB, sampled from /proc. */
  residentMemoryMb(): number;
  waitForOutput(pattern: RegExp, milliseconds: number): Promise<void>;
  signal(signal: NodeJS.Signals): void;
  /** Resolve with the exit code and the observed shutdown duration in ms. */
  waitExit(milliseconds: number): Promise<{ readonly exitCode: number; readonly shutdownMs: number }>;
  close(): Promise<void>;
}

/**
 * Launch `command` on a real local PTY.
 *
 * @param command argv of the executable under test
 * @param options cwd, extra environment, and the per-wait timeout budget
 */
export async function launchSeaPty(
  command: readonly string[],
  options: { readonly cwd: string; readonly env?: NodeJS.ProcessEnv; readonly timeoutMs: number },
): Promise<SeaPtySession> {
  if (command.length === 0) { throw new Error('SEA PTY command is required'); }
  const temp = await mkdtemp(join(tmpdir(), 'parallix-sea-pty-'));
  const ttyFile = join(temp, 'tty');
  const pidFile = join(temp, 'pid');
  // `exec` keeps the shell's PID, so $$ is the PID of the executable itself.
  // The PTY is sized first: `script` opens it at the inherited (often 1x1)
  // size, which would wrap a TUI into unreadable single-column output.
  const shell = [
    `tty > ${quote(ttyFile)}`,
    `${quote(STTY)} cols 120 rows 30`,
    `echo $$ > ${quote(pidFile)}`,
    `exec ${command.map(quote).join(' ')}`,
  ].join('; ');

  const child = spawn(SCRIPT, ['-qefc', shell, '/dev/null'], {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const chunks: string[] = [];
  child.stdout.on('data', (data: Buffer) => chunks.push(data.toString()));
  child.stderr.on('data', (data: Buffer) => chunks.push(data.toString()));
  let hasExited = false;
  const exited = once(child, 'exit').then(([code, signal]) => {
    hasExited = true;
    // `script` reports the wrapped command's status; a signalled exit has none.
    return typeof code === 'number' ? code : (signal ? 0 : 1);
  });

  const output = () => chunks.join('');
  let ttyPath: string;
  let pid: number;
  try {
    ttyPath = await waitForFile(ttyFile, options.timeoutMs, 'opening the local PTY');
    pid = Number(await waitForFile(pidFile, options.timeoutMs, 'reading the launched PID'));
  } catch (error) {
    child.kill('SIGKILL');
    await rm(temp, { recursive: true, force: true });
    throw new Error(`Could not start the SEA PTY session: ${String(error)}; output: ${output()}`);
  }

  return {
    pid,
    ttyPath,
    output,
    isAlive: () => !hasExited,
    send: (input) => { child.stdin.write(input); },
    residentMemoryMb: () => {
      const status = readFileSync(`/proc/${pid}/status`, 'utf8');
      const match = /^VmRSS:\s+(\d+) kB$/m.exec(status);
      if (!match) { throw new Error(`VmRSS not reported for PID ${pid}`); }
      return Number(match[1]) / 1024;
    },
    waitForOutput: async (pattern, milliseconds) => {
      const deadline = Date.now() + milliseconds;
      while (!pattern.test(output())) {
        if (Date.now() > deadline) {
          throw new Error(`SEA PTY timeout after ${milliseconds}ms waiting for ${String(pattern)}; output: ${output()}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    },
    signal: (signal) => { process.kill(pid, signal); },
    waitExit: async (milliseconds) => {
      const started = Date.now();
      const exitCode = await Promise.race([
        exited,
        new Promise<number>((_resolve, reject) => setTimeout(
          () => reject(new Error(`SEA PTY timeout after ${milliseconds}ms waiting for exit; output: ${output()}`)),
          milliseconds,
        )),
      ]);
      return { exitCode, shutdownMs: Date.now() - started };
    },
    close: async () => {
      if (!hasExited) { child.kill('SIGKILL'); }
      await rm(temp, { recursive: true, force: true });
    },
  };
}
