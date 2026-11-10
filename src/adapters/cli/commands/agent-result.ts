/** Process facts consumed by the active and draft CLI adapters. */
import type { ProviderResourceObservation } from '../../../application/run-history-types.js';

export interface CommandAgentResult {
  status?: number | null;
  error?: unknown;
  runId?: string;
  startedAt?: string;
  endedAt?: string;
  telemetry?: Record<string, unknown> | ProviderResourceObservation | null;
  providerResources?: ProviderResourceObservation | null;
}
export interface CommandAgentLaunch {
  agent: string;
  result: CommandAgentResult;
}

/** Messages on process/SDK failures remain optional; keep the original error value opaque. */
export function commandErrorMessage(error: unknown): string | undefined {
  return (error as { message?: string } | null | undefined)?.message;
}
