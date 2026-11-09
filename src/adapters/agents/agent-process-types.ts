import type { StageTelemetry } from '../../application/stats-recording-use-case.js';
import type { spawnAndTee } from '../process/spawn-tee.js';

/** Process output plus metadata attached by the provider launchers. */
export type AgentProcessResult = Partial<Awaited<ReturnType<typeof spawnAndTee>>> & {
  failureReason?: unknown;
  stopReason?: string;
  sessionId?: string | null;
  telemetry?: StageTelemetry | null;
  model?: string | null;
  provider?: string | null;
  transientRetries?: number;
  telemetryFresh?: boolean;
  /** The workflow's persisted outcome completed the assignment before provider exit. */
  completedAuthoritatively?: boolean;
  /**
   * How the provider process itself ended when the launch was settled by an
   * authoritative workflow outcome instead of by that process. The launch result
   * stays successful; durable evidence must still show the interrupted exit.
   */
  providerExit?: { status: number | null; signal: string | null };
  _jsonFallback?: boolean;
};

/** Injectable process boundary; test doubles may omit unused output fields. */
export type AgentProcessSpawn = (...args: Parameters<typeof spawnAndTee>) => Promise<AgentProcessResult>;

export type AgentInvocation = {
  command: string; args: string[]; options?: { cwd?: string; env?: NodeJS.ProcessEnv; [key: string]: unknown }; childPid?: number;
};

export type AgentLauncherInput = {
  configuration?: import('../../application/ports/configuration.js').ParallixConfiguration;
  prompt: string; worktree: string; env?: NodeJS.ProcessEnv; resume?: boolean;
  sessionId?: string | null; model?: string | null; sandbox?: boolean;
  slug?: import('../../domain/mission.js').MissionId | null;
  role?: import('../../domain/session.js').SessionRole | null;
  sessionMarkerPort?: import('../../application/domain-ports.js').SessionMarkerPort;
  teeOptions?: import('../process/spawn-tee.js').SpawnTeeOptions;
};

export type AgentLauncherResult = { invocation?: AgentInvocation | null } & (
  | { resultPromise: Promise<AgentProcessResult>; result?: AgentProcessResult }
  | { result: AgentProcessResult; resultPromise?: never }
);

export type AgentLauncher = (options: AgentLauncherInput) => AgentLauncherResult;
