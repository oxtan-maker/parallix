import { pendingIntegrationApproval } from './integration-repair-policy.js';
import { isClosedMission, type Mission } from './mission.js';
import { reviewStatus, currentReviewRound, sameReviewedRevision, type ReviewedRevision } from './review.js';
import type { WorkflowCommand } from './workflow-operation.js';
import type { ReviewOperation } from './review-command-policy.js';

/** Business eligibility shared by command acceptance, continuation and action projection. */
export function workflowEligible(command: WorkflowCommand, mission: Mission, reviewMode: ReviewOperation = 'status', operatorInvocation = false, approval?: ReviewedRevision | null): boolean {
  if (isClosedMission(mission)) { return false; }
  if (blockedByRepair(command, mission, operatorInvocation)) { return false; }
  switch (command) {
    case 'draft:create': return mission.status === 'backlog';
    case 'active:execute': return executionEligible(mission);
    case 'review:submit': return reviewEligible(mission, reviewMode);
    case 'rebase:run': return ['refined', 'active', 'review', 'integration'].includes(mission.status);
    case 'integrate:merge': return integrationEligible(mission, approval);
  }
}

function blockedByRepair(command: WorkflowCommand, mission: Mission, operatorInvocation: boolean): boolean {
  return !operatorInvocation && mission.checkpoints.some(cp => cp.repair?.blocker)
    && ['active:execute', 'review:submit'].includes(command);
}

function reviewEligible(mission: Mission, reviewMode: ReviewOperation): boolean {
  const integrationAllowed = !pendingIntegrationApproval(mission) || ['enter', 'status'].includes(reviewMode);
  const statusAllowed = ['active', 'review'].includes(mission.status) || mission.status === 'integration' && reviewMode === 'enter';
  return integrationAllowed && statusAllowed;
}

function executionEligible(mission: Mission): boolean {
  return Boolean(pendingIntegrationApproval(mission)) || ['refined', 'active'].includes(mission.status)
    || mission.status === 'review' && mission.review?.rounds.at(-1)?.phase === 'fixing';
}

function integrationEligible(mission: Mission, approval?: ReviewedRevision | null): boolean {
  if (mission.status === 'integration') { return true; }
  if (!['active', 'review'].includes(mission.status) || !mission.review || reviewStatus(mission.review) !== 'approved') { return false; }
  return approval === undefined || approval !== null && sameReviewedRevision(currentReviewRound(mission.review).subject, approval);
}
