import childProcess from 'node:child_process';
import type { SpawnOptions, ChildProcess } from 'node:child_process';
import path from 'node:path';
import { wrapWithBubblewrap } from './bubblewrap.js';

export const DEFAULT_MAX_TAIL_BYTES = 64 * 1024;

type ChunkType = Buffer | string;

interface SpawnTeeResult {
  status: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  error: unknown | null;
  startedAt: string;
  endedAt: string;
}

interface NoOutputWatchdog {
  /**
   * Observational liveness report. It never kills, times out, or cancels the
   * child: it keeps firing on `intervalMs` until the child settles, including
   * after the first visible output (`sawOutput`).
   */
  onNoOutput?: (_event: { command: string; args: string[]; pid: number | undefined; elapsedMs: number; sawOutput: boolean; msSinceLastOutput: number | null }) => void;
  initialDelayMs?: number;
  intervalMs?: number;
}

/**
 * Minimal terminal sink contract. Widened from `NodeJS.WriteStream` so a
 * launcher can pass a renderer (see `claude-stream-view.ts`); the tail buffer
 * is unaffected, since it is pushed before the sink is written.
 */
export interface TeeSink {
  write(_chunk: Buffer | string): unknown;
}

interface SpawnTeeOptions {
  stdoutSink?: TeeSink;
  stderrSink?: TeeSink;
  maxTailBytes?: number;
  noOutputWatchdog?: NoOutputWatchdog | null;
  cwd?: string;
  env?: Record<string, string>;
  /**
   * Unref the child and its piped stdio so a long-running child cannot keep
   * the host process alive. Used by board fire-and-forget dispatch, where the
   * board must exit on q/Ctrl+C while the action runs on (CP-4 ownership rule).
   */
  unrefChild?: boolean;
  onSpawn?: (_child: ChildProcess) => void;
  [key: string]: unknown;
}

export class TailBuffer {
  maxBytes: number;
  chunks: ChunkType[];
  size: number;

  constructor(maxBytes: number) {
    this.maxBytes = maxBytes;
    this.chunks = [];
    this.size = 0;
  }

  push(chunk: ChunkType): void {
    this.chunks.push(chunk);
    this.size += chunk.length;
    while (this.size > this.maxBytes && this.chunks.length > 0) {
      const head = this.chunks[0];
      const overflow = this.size - this.maxBytes;
      if (head.length <= overflow) {
        this.chunks.shift();
        this.size -= head.length;
      } else {
        if (Buffer.isBuffer(head)) {
          this.chunks[0] = head.subarray(overflow);
        } else {
          this.chunks.shift();
          this.size -= head.length;
        }
        this.size -= overflow;
      }
    }
  }

  toString(): string {
    if (this.chunks.length === 0) {return '';}
    return Buffer.concat(this.chunks as Buffer[]).toString('utf8');
  }
}

interface FinishPayload {
  status: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  error: unknown | null;
  startedAt?: string;
  endedAt?: string;
}

export function spawnAndTee(command: string, args: string[], options: SpawnTeeOptions = {}): Promise<SpawnTeeResult> {
  const {
    stdoutSink = process.stdout,
    stderrSink = process.stderr,
    maxTailBytes = DEFAULT_MAX_TAIL_BYTES,
      noOutputWatchdog = null,
      unrefChild = false,
      onSpawn,
    ...spawnOptions
  } = options;

  return new Promise((resolve) => {
    const stdoutTail = new TailBuffer(maxTailBytes);
    const stderrTail = new TailBuffer(maxTailBytes);
    let settled = false;
    let sawOutput = false;
    let lastOutputAt: number | null = null;
    let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
    const startTime = Date.now();
    const resolvedCwd = path.resolve((spawnOptions.cwd as string) || process.cwd());
    const env: Record<string, string> = {
      ...process.env,
      ...(spawnOptions.env || {}),
      PWD: resolvedCwd
    };
    // Guard construction errors deliberately reject this launch. An available
    // but broken Bubblewrap guard must never retry the child unsandboxed.
    const launch = wrapWithBubblewrap(command, args, resolvedCwd);

    let child: ChildProcess;
    try {
      child = childProcess.spawn(launch.command, launch.args, {
        ...spawnOptions,
        env,
        stdio: ['inherit', 'pipe', 'pipe']
      } as SpawnOptions);
      onSpawn?.(child);
      if (unrefChild) {
        // child.unref() alone does not release the piped stdio handles — the
        // pipes would still anchor the event loop. Unref all three.
        child.unref();
        (child.stdout as { unref?: () => void } | null)?.unref?.();
        (child.stderr as { unref?: () => void } | null)?.unref?.();
      }
    } catch (err) {
      resolve({
        status: null, signal: null, stdout: '', stderr: '', error: err,
        startedAt: new Date(startTime).toISOString(), endedAt: new Date().toISOString()
      });
      return;
    }

    const clearWatchdog = (): void => {
      if (watchdogTimer) {
        clearTimeout(watchdogTimer);
        watchdogTimer = null;
      }
    };

    const finish = (payload: FinishPayload): void => {
      if (settled) {return;}
      settled = true;
      clearWatchdog();
      payload.startedAt = new Date(startTime).toISOString();
      payload.endedAt = new Date().toISOString();
      resolve(payload as SpawnTeeResult);
    };

    const scheduleWatchdog = (delayMs: number): void => {
      if (!noOutputWatchdog || typeof noOutputWatchdog.onNoOutput !== 'function') {return;}
      const delay = Number.isFinite(delayMs) && delayMs >= 0 ? delayMs : 0;
      watchdogTimer = setTimeout(() => {
        watchdogTimer = null;
        // Liveness reporting is observational for the child's full lifetime:
        // only settling stops it. Suppressing after the first output hid later
        // stalls, which is exactly the hang this watchdog exists to surface.
        if (settled) {return;}
        if (typeof noOutputWatchdog.onNoOutput === 'function') {
          noOutputWatchdog.onNoOutput({
            command,
            args,
            pid: child.pid,
            elapsedMs: Date.now() - startTime,
            sawOutput,
            msSinceLastOutput: lastOutputAt === null ? null : Date.now() - lastOutputAt
          });
        }
        scheduleWatchdog(noOutputWatchdog.intervalMs ?? 0);
      }, delay);
      if (typeof watchdogTimer.unref === 'function') {
        watchdogTimer.unref();
      }
    };

    const noteOutput = (): void => {
      sawOutput = true;
      lastOutputAt = Date.now();
    };

    if (noOutputWatchdog) {
      scheduleWatchdog(noOutputWatchdog.initialDelayMs ?? 0);
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      noteOutput();
      stdoutTail.push(chunk);
      if (stdoutSink && typeof stdoutSink.write === 'function') {
        stdoutSink.write(chunk);
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      noteOutput();
      stderrTail.push(chunk);
      if (stderrSink && typeof stderrSink.write === 'function') {
        stderrSink.write(chunk);
      }
    });

    child.on('error', (err: Error) => {
      finish({
        status: null,
        signal: null,
        stdout: stdoutTail.toString(),
        stderr: stderrTail.toString(),
        error: err,
      });
    });

    child.on('close', (code: number | null, signal: string | null) => {
      finish({
        status: code,
        signal,
        stdout: stdoutTail.toString(),
        stderr: stderrTail.toString(),
        error: null,
      });
    });
  });
}
