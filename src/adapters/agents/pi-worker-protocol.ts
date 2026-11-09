import type { runPiSdk } from './pi-session-runtime.js';

export type PiWorkerPayload = Pick<Parameters<typeof runPiSdk>[0], 'prompt' | 'worktree' | 'resume' | 'sessionId' | 'model' | 'maxTransientRetries'>;
export type PiWorkerResult = Omit<Awaited<ReturnType<typeof runPiSdk>>, 'signal'> & { signal: NodeJS.Signals | null };

/**
 * Provider facts the worker has resolved. It publishes them as soon as the Pi
 * session exists, so a shutdown that stops the worker before it returns its
 * final result — a verdict-first stop after the review recorded its
 * authoritative outcome, a liveness timeout — still carries the model, provider
 * session and usage it really observed instead of inventing nulls.
 */
export interface PiWorkerObservation {
  readonly provider: string;
  readonly model?: string;
  readonly sessionId?: string;
  readonly telemetry?: PiWorkerResult['telemetry'] | null;
}

export type PiWorkerMessage =
  | { kind: 'run'; request: PiWorkerPayload }
  | { kind: 'result'; result: PiWorkerResult }
  | { kind: 'observed'; observation: PiWorkerObservation }
  /** Ask the worker to settle now; its wrapper cannot forward a stop signal. */
  | { kind: 'stop' }
  | { kind: 'clear-stale-marker' }
  | { kind: 'marker-cleared'; error?: string };
