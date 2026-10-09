import type { ParallixConfiguration } from "../../application/ports/configuration.js";
import { DEFAULT_CONFIGURATION } from "../../application/ports/configuration.js";
import { wrapWithBubblewrap } from "../process/bubblewrap.js";
import { spawn, type ChildProcess } from 'node:child_process';
import { cliInvocation, type CliInvocation } from '../process/cli-invocation.js';
import { createOutputWatchdog, type NoOutputWatchdog } from '../process/output-watchdog.js';
import type { RenderSink } from './agent-stream-view.js';
import type { PiWorkerMessage, PiWorkerResult as Result } from './pi-worker-protocol.js';
import { DECISION_CREDENTIAL_ENV } from '../../domain/decision-credentials.js';

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
    onSpawn?: (_child: ChildProcess) => void;
  };
}



/** The worker inherits the launch environment without changing the parent's. */
export function startPiWorker(request: PiWorkerRequest, invocation: { command: string; args: string[]; options: { env: NodeJS.ProcessEnv } }, clearStaleMarker: () => Promise<void>, worker: CliInvocation = cliInvocation(process.argv[1])): Promise<Result> {
  const startedAt = new Date().toISOString();
  const cli = worker;
  const environment = { ...invocation.options.env };
  for (const key of DECISION_CREDENTIAL_ENV) { delete environment[key]; }
  return new Promise((resolve) => {
    let result: Result | null = null;
    let settled = false;
    let timedOut = false;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let escalation: ReturnType<typeof setTimeout> | undefined;
    const confined = wrapWithBubblewrap(cli.command, [...cli.args, '--pi-session-worker'], request.worktree, request.configuration ?? DEFAULT_CONFIGURATION);
    const child = spawn(confined.command, confined.args, {
      cwd: request.worktree, env: environment, detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'], serialization: 'advanced',
    });
    const watchdog = createOutputWatchdog(request.teeOptions?.noOutputWatchdog, { ...invocation, pid: child.pid });
    const stop = () => {
      try { process.kill(process.platform === 'win32' ? child.pid! : -child.pid!, 'SIGTERM'); } catch { /* Already exited. */ }
    };
    const parentExit = () => {
      try { process.kill(process.platform === 'win32' ? child.pid! : -child.pid!, 'SIGKILL'); } catch { /* Already exited. */ }
    };
    const parentSignal = () => stop();
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
      resolve(result ?? { status: 1, stdout: '', stderr: failure?.message ?? 'Pi worker exited before returning a result',
        error: failure, signal, sessionId: null, telemetry: null, model: undefined, provider: 'pi', transientRetries: 0,
        startedAt, endedAt: new Date().toISOString() });
    };
    const noteOutput = () => { watchdog.noteOutput(); clearTimeout(deadline); };
    child.stdout!.on('data', (chunk: Buffer) => { noteOutput(); (request.teeOptions?.stdoutSink ?? process.stdout).write(chunk.toString()); });
    child.stderr!.on('data', (chunk: Buffer) => { noteOutput(); (request.teeOptions?.stderrSink ?? process.stderr).write(chunk.toString()); });
    child.on('message', (message: PiWorkerMessage) => {
      if (message?.kind === 'result') { result = message.result; }
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
        timedOut = true; stop(); escalation = setTimeout(parentExit, 2000);
      }, maxNoOutput);
    }
    try {
      request.teeOptions?.onSpawn?.(child);
      const { prompt, worktree, resume, sessionId, model, maxTransientRetries } = request;
      child.send({ kind: 'run', request: { prompt, worktree, resume, sessionId, model, maxTransientRetries } });
    } catch (error) { stop(); finish(error as Error); }
  });
}
