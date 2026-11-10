import type { InvalidContractBlocker } from '../../domain/rebound-policy.js';

/** What a launched agent run reported; the one launch fact shape the review loop and the repair kernel both read. */
export interface AgentLaunchResult {
  /** The family the launcher actually ran (differs after a capacity fallback). */
  readonly agent?: string | null;
  readonly result?: {
    status?: number | null;
    invalidContract?: InvalidContractBlocker;
    telemetry?: { provider?: string | null; cost_usd?: number } | null;
    stopReason?: string;
    startedAt?: string;
    endedAt?: string;
    [key: string]: unknown;
  } | null;
}
