import type { runPiSdk } from './pi-session-runtime.js';

export type PiWorkerPayload = Pick<Parameters<typeof runPiSdk>[0], 'prompt' | 'worktree' | 'resume' | 'sessionId' | 'model' | 'maxTransientRetries'>;
export type PiWorkerResult = Omit<Awaited<ReturnType<typeof runPiSdk>>, 'signal'> & { signal: NodeJS.Signals | null };
export type PiWorkerMessage =
  | { kind: 'run'; request: PiWorkerPayload }
  | { kind: 'result'; result: PiWorkerResult }
  | { kind: 'clear-stale-marker' }
  | { kind: 'marker-cleared'; error?: string };
