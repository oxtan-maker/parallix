import type { InvalidContractBlocker } from '../domain/rebound-policy.js';
import { describeLaunchFailure, isDeterministicLaunchFailure, launchFailureOf, type LaunchFailure } from '../domain/launch-failure.js';
import type { ReboundStartAgent } from './ports/repair-agent-launch.js';

/** Outcome of one repair launch, before the failing check is re-run. */
export interface FixLaunch {
  ok: boolean;
  implementer: string;
  diagnostic: string;
  repairAttempted: boolean;
  provider: string | null;
  model: string | null;
  invalidContract?: InvalidContractBlocker;
  /** Spawn evidence when the child did not report an exit status. */
  launchFailure?: LaunchFailure;
  /** The same launch would fail again, so it must not be retried unchanged. */
  deterministic?: boolean;
}

/** Provider and model the agent run reported, when it did. */
function reportedRun(result: unknown): { provider: string | null; model: string | null } {
  const run = (result ?? {}) as Record<string, unknown>;
  const text = (value: unknown) => typeof value === 'string' ? value : null;
  return { provider: text(run.provider), model: text(run.model) };
}

/** Classify one repair launch result; a null/ambiguous exit status is a launch failure. */
export function launchStatus(launchResult: Awaited<ReturnType<ReboundStartAgent>>, implementer: string): FixLaunch {
  const invalidContract = launchResult?.result?.invalidContract;
  if (invalidContract) { return { ok: false, implementer, diagnostic: JSON.stringify(invalidContract), repairAttempted: true, invalidContract, provider: null, model: null }; }
  const status = launchResult?.result?.status;
  if (typeof status !== 'number') {
    const launchFailure = launchFailureOf(launchResult?.result);
    if (launchFailure) {
      const deterministic = isDeterministicLaunchFailure(launchFailure);
      return {
        ok: false, implementer, repairAttempted: false, provider: null, model: null, launchFailure, deterministic,
        diagnostic: `Implementer (${implementer}) did not start or report an exit status; treating the launch as failed${deterministic ? ' and not retrying it unchanged' : ''}: ${describeLaunchFailure(launchFailure)}`,
      };
    }
    return {
      ok: false,
      implementer,
      diagnostic: `Implementer (${implementer}) returned an ambiguous exit status (null); treating the launch as failed — a null-exit fix is no evidence of a fix.`, repairAttempted: false, provider: null, model: null,
    };
  }
  if (status !== 0) {
    return { ok: false, implementer, diagnostic: `Implementer (${implementer}) exited with status ${status}.`, repairAttempted: true, ...reportedRun(launchResult?.result) };
  }
  return { ok: true, implementer, diagnostic: '', repairAttempted: true, ...reportedRun(launchResult?.result) };
}
