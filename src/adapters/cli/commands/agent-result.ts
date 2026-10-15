/** Process facts consumed by the active and draft CLI adapters. */
import type { StageStatsRequest } from '../../../application/stats-recording-use-case.js';

export interface CommandAgentResult {
  status?: number | null;
  error?: unknown;
  startedAt?: string;
  endedAt?: string;
  telemetry?: StageStatsRequest['telemetry'];
}
export interface CommandAgentLaunch {
  agent: string;
  result: CommandAgentResult;
}

/** Messages on process/SDK failures remain optional; keep the original error value opaque. */
export function commandErrorMessage(error: unknown): string | undefined {
  return (error as { message?: string } | null | undefined)?.message;
}
