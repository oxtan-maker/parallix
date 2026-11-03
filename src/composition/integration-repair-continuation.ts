import { StructuredFailure, failureReason } from '../domain/failure-reason.js';
import { certifyPendingIntegrationRepair } from '../application/integrate/repair-resumption.js';
import type { IntegrationMissionServices } from '../application/ports/integration-records.js';
import type { ParallixConfiguration } from '../application/ports/configuration.js';
import type { ReviewLoopPorts } from '../application/ports/review-round.js';
import { createIntegratePorts } from '../adapters/cli/commands/integrate.js';
import { retainedRepairPort } from '../adapters/review/retained-repair.js';
import { resolveWorktree } from '../adapters/filesystem/mission-utils.js';

/** Review and execute share integration's certification and retention authority. */
export function integrationRepairContinuation(services: IntegrationMissionServices, configuration: ParallixConfiguration): NonNullable<ReviewLoopPorts['integrationRepair']> {
  return { async resume(slug) {
    const worktree = resolveWorktree(slug);
    if (!worktree) { throw new StructuredFailure('Integration repair checkout is unavailable', failureReason('missing-artifacts', 'filesystem')); }
    const result = await certifyPendingIntegrationRepair(slug, services, createIntegratePorts(configuration), undefined,
      retainedRepairPort(slug, worktree, services.store, configuration));
    return !result || result.outcome === 'not-pending' ? 'none' : result.outcome;
  } };
}
