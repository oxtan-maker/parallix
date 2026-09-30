import childProcess from 'node:child_process';
import type { SpawnOptions, ChildProcess } from 'node:child_process';
import path from 'node:path';
import { createOutputWatchdog, type NoOutputWatchdog } from './output-watchdog.js';
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

    const hasNoOutputDeadline = Number.isFinite(noOutputWatchdog?.maxNoOutputMs) && (noOutputWatchdog?.maxNoOutputMs ?? 0) > 0;
    let child: ChildProcess;
    try {
      child = childProcess.spawn(launch.command, launch.args, {
        ...spawnOptions,
        env,
        ...(hasNoOutputDeadline ? { detached: true } : {}),
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

    const watchdog = createOutputWatchdog(noOutputWatchdog, { command, args, pid: child.pid }, startTime);
    let noOutputTimedOut = false;
    let noOutputTimer: ReturnType<typeof setTimeout> | null = null;
    let escalationTimer: ReturnType<typeof setTimeout> | null = null;
    const clearDeadlineTimer = () => {
      if (noOutputTimer) { clearTimeout(noOutputTimer); noOutputTimer = null; }
    };
    const clearEscalationTimer = () => {
      if (escalationTimer) { clearTimeout(escalationTimer); escalationTimer = null; }
    };
    const killGroup = (signal: NodeJS.Signals) => {
      try { process.kill(-child.pid!, signal); } catch { try { child.kill(signal); } catch { /* settled */ } }
    };
    const forward = (signal: NodeJS.Signals) => {
      killGroup(signal);
      // Detached children miss the terminal signal, but the parent must retain
      // Node's normal termination semantics after forwarding it.
      process.kill(process.pid, signal);
    };
    const forwardSigint = () => forward('SIGINT');
    const forwardSigterm = () => forward('SIGTERM');
    if (hasNoOutputDeadline) {
      process.once('SIGINT', forwardSigint);
      process.once('SIGTERM', forwardSigterm);
      noOutputTimer = setTimeout(() => {
        noOutputTimer = null;
        noOutputTimedOut = true;
        killGroup('SIGINT');
        escalationTimer = setTimeout(() => {
          killGroup('SIGTERM');
          escalationTimer = setTimeout(() => killGroup('SIGKILL'), 250);
          escalationTimer.unref?.();
        }, 250);
        escalationTimer.unref?.();
      }, noOutputWatchdog!.maxNoOutputMs);
      noOutputTimer.unref?.();
    }

    const finish = (payload: FinishPayload): void => {
      if (settled) {return;}
      settled = true;
      watchdog.clear();
      clearDeadlineTimer();
      clearEscalationTimer();
      if (hasNoOutputDeadline) {
        process.removeListener('SIGINT', forwardSigint);
        process.removeListener('SIGTERM', forwardSigterm);
      }
      payload.startedAt = new Date(startTime).toISOString();
      payload.endedAt = new Date().toISOString();
      resolve(payload as SpawnTeeResult);
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      if (!noOutputTimedOut) { clearDeadlineTimer(); }
      watchdog.noteOutput();
      stdoutTail.push(chunk);
      if (stdoutSink && typeof stdoutSink.write === 'function') {
        stdoutSink.write(chunk);
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (!noOutputTimedOut) { clearDeadlineTimer(); }
      watchdog.noteOutput();
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
        status: noOutputTimedOut ? null : code,
        signal: noOutputTimedOut ? null : signal,
        stdout: stdoutTail.toString(),
        stderr: stderrTail.toString(),
        error: noOutputTimedOut ? Object.assign(new Error('No output before configured liveness deadline'), { code: 'NO_OUTPUT_TIMEOUT' }) : null,
      });
    });
  });
}
