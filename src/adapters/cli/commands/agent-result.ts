/** Process facts consumed by the active and draft CLI adapters. */
import type { StageStatsRequest } from '../../../application/stats-recording-use-case.js';

export interface CommandAgentResult {
  status?: number | null;
  error?: { message?: string; code?: string } | null;
  startedAt?: string;
  endedAt?: string;
  telemetry?: StageStatsRequest['telemetry'];
}
export interface CommandAgentLaunch {
  agent: string;
  result: CommandAgentResult;
}
