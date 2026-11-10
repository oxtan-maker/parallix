import { StructuredFailure, failureReason } from '../domain/failure-reason.js';
import { certifyPendingIntegrationRepair } from '../application/integrate/repair-resumption.js';
import type { IntegrationMissionServices, IntegrationRepairContinuationPort } from '../application/ports/integration-records.js';
import type { ParallixConfiguration } from '../application/ports/configuration.js';
import { createIntegratePorts } from '../adapters/cli/commands/integrate.js';
import { retainedRepairPort } from '../adapters/review/retained-repair.js';
import { resolveMissionExecutionContext } from '../adapters/git/mission-execution-context.js';
import { findLandedSquashOnBaseBranch } from '../adapters/cli/commands/landed-squash.js';
import * as git from '../adapters/git/git.js';

/** Review and execute share integration's certification and retention authority. */
export function integrationRepairContinuation(services: IntegrationMissionServices, configuration: ParallixConfiguration,
  rootDir: string): IntegrationRepairContinuationPort {
  return { async resume(slug) {
    // The repair runs in the mission checkout resolved from Mission identity;
    // `rootDir` only locates the repository, and a landing already proven on the
    // receiving base still leaves no checkout to repair in.
    const resolved = resolveMissionExecutionContext(slug, rootDir, configuration,
      args => git.git(args), (baseWorktree, landedSlug) => findLandedSquashOnBaseBranch(baseWorktree, landedSlug));
    if (!resolved.ok) { throw new StructuredFailure(resolved.reason, failureReason('missing-artifacts', 'filesystem')); }
    const worktree = resolved.context.missionWorktree;
    if (!worktree) { throw new StructuredFailure('Integration repair checkout is unavailable', failureReason('missing-artifacts', 'filesystem')); }
    const result = await certifyPendingIntegrationRepair(slug, services, createIntegratePorts(configuration), resolved.context, undefined,
      retainedRepairPort(slug, worktree, services.store, configuration));
    return !result || result.outcome === 'not-pending' ? 'none' : result.outcome;
  } };
}
