import { failureReasonFromCause } from '../../domain/failure-reason.js';
import type { ParallixConfiguration } from "../../application/ports/configuration.js";
import { DEFAULT_CONFIGURATION } from "../../application/ports/configuration.js";
import { wrapWithBubblewrap } from "../process/bubblewrap.js";
import { spawn, type SpawnOptions } from 'node:child_process';
import { setImmediate } from 'node:timers';
import { cliInvocation, type CliInvocation } from '../process/cli-invocation.js';
import { createOutputWatchdog, type NoOutputWatchdog } from '../process/output-watchdog.js';
import type { SupervisedChild } from '../process/spawn-tee.js';
import type { RenderSink } from './agent-stream-view.js';
import type { PiWorkerMessage, PiWorkerObservation, PiWorkerResult as Result } from './pi-worker-protocol.js';
import { DECISION_CREDENTIAL_ENV } from '../../domain/decision-credentials.js';

/**
 * The process surface the client drives. Production spawns the real confined
 * worker; a unit double may speak the worker protocol in-process so the
 * transport contract stays testable without a child process (ADR 0057).
 */
export interface PiWorkerChild {
  readonly pid?: number;
  readonly stdout: Pick<NodeJS.ReadableStream, 'on'> | null;
  readonly stderr: Pick<NodeJS.ReadableStream, 'on'> | null;
  readonly connected: boolean;
  send(_message: PiWorkerMessage, _callback?: (_error?: Error | null) => void): boolean;
  on(_event: 'message', listener: (_message: PiWorkerMessage) => void): unknown;
  once(_event: 'error', listener: (_error: Error) => void): unknown;
  once(_event: 'close', listener: (_code: number | null, _signal: NodeJS.Signals | null) => void): unknown;
  /** Present on the confined launcher's child; a double may omit it. */
  terminateTree?(_signal: NodeJS.Signals): void;
}

export interface PiWorkerClientDeps {
  readonly spawn?: PiWorkerSpawn;
}

/** How the client starts its worker: the real launcher, or an in-process double. */
export type PiWorkerSpawn = (_command: string, _args: string[], _options: SpawnOptions) => PiWorkerChild;

export interface PiWorkerRequest {
  configuration?: ParallixConfiguration;
  prompt: string;
  worktree: string;
  resume?: boolean;
  sessionId?: string | null;
  model?: string | null;
  maxTransientRetries?: number;
  teeOptions?: {
    stdoutSink?: RenderSink;
    stderrSink?: RenderSink;
    noOutputWatchdog?: NoOutputWatchdog | null;
    onSpawn?: (_child: SupervisedChild) => void;
  };
}



/**
 * A worker that exited without sending its final result still reported what the
 * provider resolved. Keep those facts; only the process outcome is unknown.
 */
function interruptedWorkerResult(observed: PiWorkerObservation | null, failure: Error | null, signal: NodeJS.Signals | null, startedAt: string): Result {
  return {
    failureReason: failureReasonFromCause(failure, 'provider'), status: 1, stdout: '',
    stderr: failure?.message ?? 'Pi worker exited before returning a result', error: failure, signal,
    sessionId: observed?.sessionId ?? null, telemetry: observed?.telemetry ?? null,
    model: observed?.model ?? undefined, provider: observed?.provider ?? 'pi', transientRetries: 0,
    startedAt, endedAt: new Date().toISOString(),
  };
}

/** Later snapshots enrich earlier provider facts; absent fields never erase evidence. */
function mergeTelemetry(observed: Result['telemetry'] | null | undefined, latest: Result['telemetry'] | null | undefined): Result['telemetry'] {
  if (!observed) { return latest ?? null; }
  if (!latest) { return observed; }
  const reported = Object.fromEntries(Object.entries(latest).filter(([, value]) => value !== null && value !== undefined));
  return { ...observed, ...reported };
}

function mergeObservation(observed: PiWorkerObservation | null, latest: PiWorkerObservation): PiWorkerObservation {
  return {
    provider: latest.provider ?? observed?.provider ?? 'pi',
    model: latest.model ?? observed?.model,
    sessionId: latest.sessionId ?? observed?.sessionId,
    telemetry: mergeTelemetry(observed?.telemetry, latest.telemetry),
  };
}

/** A final process result owns outcome fields but cannot discard provider facts already observed. */
function mergeResultObservation(result: Result, observed: PiWorkerObservation | null): Result {
  return {
    ...result,
    sessionId: result.sessionId ?? observed?.sessionId ?? null,
    telemetry: mergeTelemetry(observed?.telemetry, result.telemetry),
    model: result.model ?? observed?.model,
    provider: result.provider ?? observed?.provider ?? 'pi',
  };
}

/** The worker inherits the launch environment without changing the parent's. */
export function startPiWorker(request: PiWorkerRequest, invocation: { command: string; args: string[]; options: { env: NodeJS.ProcessEnv } }, clearStaleMarker: () => Promise<void>, worker: CliInvocation = cliInvocation(process.argv[1]), deps: PiWorkerClientDeps = {}): Promise<Result> {
  const startedAt = new Date().toISOString();
  const cli = worker;
  const environment = { ...invocation.options.env };
  for (const key of DECISION_CREDENTIAL_ENV) { delete environment[key]; }
  return new Promise((resolve) => {
    let result: Result | null = null;
    let observed: PiWorkerObservation | null = null;
    let settled = false;
    let timedOut = false;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let escalation: ReturnType<typeof setTimeout> | undefined;
    const confined = wrapWithBubblewrap(cli.command, [...cli.args, '--pi-session-worker'], request.worktree, request.configuration ?? DEFAULT_CONFIGURATION);
    const spawnChild: PiWorkerSpawn = deps.spawn ?? ((command, args, options) => spawn(command, args, options));
    const child = spawnChild(confined.command, confined.args, {
      cwd: request.worktree, env: environment, detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'], serialization: 'advanced',
    });
    const watchdog = createOutputWatchdog(request.teeOptions?.noOutputWatchdog, { ...invocation, pid: child.pid });
    const signalTree = (signal: NodeJS.Signals) => {
      try { process.kill(process.platform === 'win32' ? child.pid! : -child.pid!, signal); } catch { /* Already exited. */ }
    };
    const stop = () => signalTree('SIGTERM');
    // A confined worker dies with its wrapper before a tree signal can drain it,
    // so a workflow stop asks the worker over IPC to settle with what it
    // observed. The worker reaps itself within its own flush bound, and the
    // caller's existing signal escalation stays the bound behind it.
    const requestStop = (signal: NodeJS.Signals) => {
      if ((signal === 'SIGTERM' || signal === 'SIGINT') && child.connected) {
        try { child.send({ kind: 'stop' }); return; } catch { /* Fall back to the signal. */ }
      }
      signalTree(signal);
    };
    child.terminateTree = requestStop;
    const parentExit = () => signalTree('SIGKILL');
    // Operator cancellation / shutdown: stop the worker, then let the parent
    // die by the same signal once it has closed, so no fallback agent launches
    // (TASK-2729). Re-raised only after our listeners are removed.
    let cancelSignal: NodeJS.Signals | null = null;
    const parentSignal = (signal: NodeJS.Signals) => { cancelSignal = signal; stop(); };
    process.once('exit', parentExit);
    process.on('SIGTERM', parentSignal);
    process.on('SIGINT', parentSignal);
    const finish = (error: Error | null, signal: NodeJS.Signals | null = null) => {
      if (settled) { return; }
      settled = true;
      watchdog.clear();
      clearTimeout(deadline); clearTimeout(escalation);
      process.removeListener('exit', parentExit);
      process.removeListener('SIGTERM', parentSignal); process.removeListener('SIGINT', parentSignal);
      const failure = timedOut ? Object.assign(new Error('No output before configured liveness deadline'), { code: 'NO_OUTPUT_TIMEOUT' }) : error;
      resolve(result ? mergeResultObservation(result, observed) : interruptedWorkerResult(observed, failure ?? null, signal, startedAt));
      // Give the launch continuation one event-loop turn to finalize durable run
      // history before the default signal action terminates this parent.
      const reraisedSignal = cancelSignal;
      if (reraisedSignal) { setImmediate(() => process.kill(process.pid, reraisedSignal)); }
    };
    const noteOutput = () => { watchdog.noteOutput(); clearTimeout(deadline); };
    child.stdout!.on('data', (chunk: Buffer) => { noteOutput(); (request.teeOptions?.stdoutSink ?? process.stdout).write(chunk.toString()); });
    child.stderr!.on('data', (chunk: Buffer) => { noteOutput(); (request.teeOptions?.stderrSink ?? process.stderr).write(chunk.toString()); });
    child.on('message', (message: PiWorkerMessage) => {
      if (message?.kind === 'result') { result = message.result; }
      if (message?.kind === 'observed') { observed = mergeObservation(observed, message.observation); }
      if (message?.kind === 'clear-stale-marker') {
        void clearStaleMarker().then(
          () => { if (child.connected) { child.send({ kind: 'marker-cleared' }); } },
          (error: unknown) => { if (child.connected) { child.send({ kind: 'marker-cleared', error: String(error) }); } },
        );
      }
    });
    child.once('error', error => finish(error));
    child.once('close', (_code, signal) => finish(null, signal));
    const maxNoOutput = request.teeOptions?.noOutputWatchdog?.maxNoOutputMs;
    if (maxNoOutput && Number.isFinite(maxNoOutput) && maxNoOutput > 0) {
      deadline = setTimeout(() => {
        timedOut = true; requestStop('SIGTERM'); escalation = setTimeout(parentExit, 2000);
      }, maxNoOutput);
    }
    try {
      // The confined launcher patches the real child; a protocol double omits the tree helpers.
      request.teeOptions?.onSpawn?.(child as SupervisedChild);
      const { prompt, worktree, resume, sessionId, model, maxTransientRetries } = request;
      child.send({ kind: 'run', request: { prompt, worktree, resume, sessionId, model, maxTransientRetries } });
    } catch (error) { stop(); finish(error as Error); }
  });
}
