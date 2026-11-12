import type { ParallixConfiguration } from '../../application/ports/configuration.js';
import type { ReviewerRoutingPort } from '../../application/ports/review-round.js';
import { defaultIsAgentBlockedNow, eligibleAgentsForStep, selectAgent, workflowLauncherStatus } from '../agents/agents.js';
import { buildAutonomousReviewMatrix, formatMatrixSummary } from '../agents/runtime-matrix.js';

/** One source of review launcher, runtime-block and selection facts for loops and explicit verdicts. */
export function reviewerRoutingPort(worktree: string, configuration?: ParallixConfiguration): ReviewerRoutingPort {
  return {
    eligibleFamilies: () => eligibleAgentsForStep('review', { configuration }),
    isBlocked: agent => defaultIsAgentBlockedNow(agent, configuration),
    launcherStatus: agent => {
      const status = workflowLauncherStatus(agent, worktree, configuration);
      return status.supported ? status : { ...status, detail: [status.detail, status.health, status.reason].filter(Boolean).join(' - ') };
    },
    nominate: excluded => selectAgent('review', { exclude: new Set(excluded), worktree, configuration }),
    runtimeMatrix: () => formatMatrixSummary(buildAutonomousReviewMatrix()),
  };
}
