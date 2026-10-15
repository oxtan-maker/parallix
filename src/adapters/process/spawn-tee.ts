import type { ParallixConfiguration } from "../../application/ports/configuration.js";
import { DEFAULT_CONFIGURATION } from "../../application/ports/configuration.js";
import childProcess from 'node:child_process';
import type { SpawnOptions, ChildProcess } from 'node:child_process';
import path from 'node:path';
import { createOutputWatchdog, type NoOutputWatchdog } from './output-watchdog.js';
import { wrapWithBubblewrap } from './bubblewrap.js';
import { DECISION_CREDENTIAL_ENV } from '../../domain/decision-credentials.js';

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

export interface SpawnTeeOptions {
  configuration?: ParallixConfiguration;
  stdoutSink?: TeeSink;
  stderrSink?: TeeSink;
  maxTailBytes?: number;
  noOutputWatchdog?: NoOutputWatchdog | null;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /**
   * Unref the child and its piped stdio so a long-running child cannot keep
   * the host process alive. Used by board fire-and-forget dispatch, where the
   * board must exit on q/Ctrl+C while the action runs on (CP-4 ownership rule).
   */
  unrefChild?: boolean;
  onSpawn?: (_child: ChildProcess) => void;
  /**
   * Optional terminal host (TASK-2643). Receives the already-confined launch and
   * returns the command that hosts it, for example a tmux session host script.
   * The hosted command is the one supervised child, so signals, the watchdog
   * and exit status keep this function's semantics. `cleanup` runs once.
   */
  terminalHost?: TerminalHost;
  /** Optional durable sink that receives every output chunk, before any tail bound. */
  capture?: OutputCapture;
  /**
   * Ask the terminal host to render the launch's stdout readably in its visible
   * terminal. The sinks, tail and capture still receive the raw bytes.
   */
  hostPresentation?: HostPresentation;
  /**
   * Bytes the child reads from stdin, followed by EOF. A launcher passes a
   * prompt here when the provider accepts it on stdin, so prompt size is not
   * bounded by the per-argument exec limit. Absent: stdin is inherited.
   */
  input?: string | Buffer;
  [key: string]: unknown;
}

/** Readable presentation a host should give the launch's stdout inside its visible terminal. */
export type HostPresentation = 'claude-stream';

export interface TerminalHost {
  /** A host must deliver `input`, when present, as the hosted command's stdin followed by EOF. */
  host(_launch: { command: string; args: string[]; input?: Buffer }, _context: { cwd: string; env: NodeJS.ProcessEnv; presentation?: HostPresentation }): { command: string; args: string[]; cleanup(): void };
}

export interface OutputCapture {
  write(_stream: 'stdout' | 'stderr', _chunk: Buffer): void;
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

function outputDeadlineEnabled(watchdog: NoOutputWatchdog | null) { return Number.isFinite(watchdog?.maxNoOutputMs) && (watchdog?.maxNoOutputMs ?? 0) > 0; }

function superviseOutput(child: ChildProcess, noOutputWatchdog: NoOutputWatchdog | null, hasNoOutputDeadline: boolean, command: string, args: string[], startTime: number) {
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
    }, noOutputWatchdog!.maxNoOutputMs!);
    noOutputTimer.unref?.();
  }

  return {
    get timedOut() { return noOutputTimedOut; },
    noteOutput() { if (!noOutputTimedOut) { clearDeadlineTimer(); } watchdog.noteOutput(); },
    clear() {
      watchdog.clear();
      clearDeadlineTimer();
      clearEscalationTimer();
      if (hasNoOutputDeadline) {
        process.removeListener('SIGINT', forwardSigint);
        process.removeListener('SIGTERM', forwardSigterm);
      }
    },
  };
}

function forwardOutput(chunk: Buffer, stream: 'stdout' | 'stderr', tail: TailBuffer, sink: TeeSink, supervisor: ReturnType<typeof superviseOutput>, capture?: OutputCapture) {
  supervisor.noteOutput();
  capture?.write(stream, chunk);
  tail.push(chunk);
  if (sink && typeof sink.write === 'function') { sink.write(chunk); }
}

function spawnCapturedChild(launch: { command: string; args: string[] }, spawnOptions: SpawnOptions, env: NodeJS.ProcessEnv, hasNoOutputDeadline: boolean, onSpawn: SpawnTeeOptions['onSpawn'], unrefChild: boolean, inputBytes: Buffer | null): ChildProcess {
  const child = childProcess.spawn(launch.command, launch.args, {
    ...spawnOptions, env, ...(hasNoOutputDeadline ? { detached: true } : {}), stdio: [inputBytes ? 'pipe' : 'inherit', 'pipe', 'pipe'],
  });
  if (inputBytes) {
    // An early child exit can close stdin before the prompt is flushed.
    child.stdin?.on('error', () => { /* reported through the exit status */ });
    child.stdin?.end(inputBytes);
  }
  onSpawn?.(child);
  if (unrefChild) {
    child.unref();
    (child.stdout as { unref?: () => void } | null)?.unref?.();
    (child.stderr as { unref?: () => void } | null)?.unref?.();
  }
  return child;
}

export function spawnAndTee(command: string, args: string[], options: SpawnTeeOptions = {}): Promise<SpawnTeeResult> {
  const {
    configuration = DEFAULT_CONFIGURATION,
    stdoutSink = process.stdout,
    stderrSink = process.stderr,
    maxTailBytes = DEFAULT_MAX_TAIL_BYTES,
    noOutputWatchdog = null,
    unrefChild = false,
    onSpawn,
    terminalHost,
    capture,
    hostPresentation,
    input,
    ...spawnOptions
  } = options;

  return new Promise((resolve) => {
    const stdoutTail = new TailBuffer(maxTailBytes);
    const stderrTail = new TailBuffer(maxTailBytes);
    let settled = false;
    const startTime = Date.now();
    const resolvedCwd = path.resolve((spawnOptions.cwd as string) || process.cwd());
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...(spawnOptions.env || {}),
      PWD: resolvedCwd
    };
    // Decision-provider keys belong to Parallix alone; no launched child (agent or tool shell) inherits them.
    for (const name of DECISION_CREDENTIAL_ENV) { delete env[name]; }
    // Guard construction errors deliberately reject this launch. An available
    // but broken Bubblewrap guard must never retry the child unsandboxed.
    const confined = wrapWithBubblewrap(command, args, resolvedCwd, configuration);
    const inputBytes = input === undefined ? null : Buffer.from(input);
    let hosted: ReturnType<TerminalHost['host']> | null = null;
    try {
      hosted = terminalHost ? terminalHost.host({ ...confined, ...(inputBytes ? { input: inputBytes } : {}) }, { cwd: resolvedCwd, env, ...(hostPresentation ? { presentation: hostPresentation } : {}) }) : null;
    } catch (err) {
      const now = new Date().toISOString();
      resolve({ status: null, signal: null, stdout: '', stderr: '', error: err, startedAt: now, endedAt: now });
      return;
    }
    const launch = hosted ?? confined;

    const hasNoOutputDeadline = outputDeadlineEnabled(noOutputWatchdog);
    let child: ChildProcess;
    try {
      child = spawnCapturedChild(launch, spawnOptions as SpawnOptions, env, hasNoOutputDeadline, onSpawn, unrefChild, hosted ? null : inputBytes);
    } catch (err) {
      hosted?.cleanup();
      resolve({
        status: null, signal: null, stdout: '', stderr: '', error: err,
        startedAt: new Date(startTime).toISOString(), endedAt: new Date().toISOString()
      });
      return;
    }

    const supervisor = superviseOutput(child, noOutputWatchdog, hasNoOutputDeadline, command, args, startTime);

    const finish = (payload: FinishPayload): void => {
      if (settled) {return;}
      settled = true;
      try { hosted?.cleanup(); } catch { /* a failed host cleanup must not mask the launch result */ }
      supervisor.clear();
      payload.startedAt = new Date(startTime).toISOString();
      payload.endedAt = new Date().toISOString();
      resolve(payload as SpawnTeeResult);
    };

    child.stdout?.on('data', (chunk: Buffer) => forwardOutput(chunk, 'stdout', stdoutTail, stdoutSink, supervisor, capture));
    child.stderr?.on('data', (chunk: Buffer) => forwardOutput(chunk, 'stderr', stderrTail, stderrSink, supervisor, capture));

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
        status: supervisor.timedOut ? null : code,
        signal: supervisor.timedOut ? null : signal,
        stdout: stdoutTail.toString(),
        stderr: stderrTail.toString(),
        error: supervisor.timedOut ? Object.assign(new Error('No output before configured liveness deadline'), { code: 'NO_OUTPUT_TIMEOUT' }) : null,
      });
    });
  });
}
