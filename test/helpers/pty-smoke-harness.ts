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
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => setTimeout(() => reject(new Error(`PTY smoke timeout after ${milliseconds}ms: ${description}`)), milliseconds)),
  ]);
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
  send(input: string): void;
  resize(columns: number, rows: number): Promise<void>;
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
  options: { readonly cwd: string; readonly timeoutMs: number },
): Promise<PtySmokeSession> {
  if (command.length === 0) { throw new Error('PTY smoke command is required'); }
  const temp = await mkdtemp(join(tmpdir(), 'parallix-pty-smoke-'));
  const ttyPath = join(temp, 'tty');
  const beforePath = join(temp, 'stty-before');
  const afterPath = join(temp, 'stty-after');
  const shell = [
    `tty > ${quote(ttyPath)}`,
    `${quote(STTY)} -g > ${quote(beforePath)}`,
    `${quote(STTY)} cols 120 rows 30`,
    command.map(quote).join(' '),
    'status=$?',
    `${quote(STTY)} -g > ${quote(afterPath)}`,
    `${quote(STTY)} "$(cat ${quote(beforePath)})"`,
    'exit "$status"',
  ].join('; ');
  const child = spawn(SCRIPT, ['-qefc', shell, '/dev/null'], {
    cwd: options.cwd,
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
  try {
    device = await timeout(waitForFile(ttyPath, options.timeoutMs), options.timeoutMs, 'starting local PTY');
  } catch (error) {
    throw new Error(`Could not start local PTY (temporary diagnostics: ${temp}): ${String(error)}; output: ${output.join('')}`);
  }
  return {
    output: () => output.join(''),
    isAlive: () => !hasExited,
    send: (input) => { child.stdin.write(input); },
    resize: async (columns, rows) => {
      await timeout(runStty(device, columns, rows), options.timeoutMs, 'resizing local PTY');
    },
    exitCleanly: async () => {
      child.stdin.write('q');
      const exitCode = await timeout(exited, options.timeoutMs, 'clean UI exit');
      const [before, after] = await Promise.all([readFile(beforePath, 'utf8'), readFile(afterPath, 'utf8')]);
      await rm(temp, { recursive: true, force: true });
      return { exitCode, terminalRestored: before === after };
    },
  };
}
