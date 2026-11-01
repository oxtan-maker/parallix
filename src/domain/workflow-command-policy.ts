import { isClosedMission, type Mission } from './mission.js';
import { reviewStatus, currentReviewRound, sameReviewedRevision, type ReviewedRevision } from './review.js';
import type { WorkflowCommand } from './workflow-operation.js';
import type { ReviewOperation } from './review-command-policy.js';

/** Business eligibility shared by command acceptance, continuation and action projection. */
export function workflowEligible(command: WorkflowCommand, mission: Mission, reviewMode: ReviewOperation = 'status', operatorInvocation = false, approval?: ReviewedRevision | null): boolean {
  if (isClosedMission(mission)) { return false; }
  if (!operatorInvocation && mission.checkpoints.some(cp => cp.repair?.blocker) && ['active:execute', 'review:submit'].includes(command)) { return false; }
  switch (command) {
    case 'draft:create': return mission.status === 'backlog';
    case 'active:execute': return executionEligible(mission);
    case 'review:submit': return ['active', 'review'].includes(mission.status) || mission.status === 'integration' && reviewMode === 'enter';
    case 'integrate:merge': return integrationEligible(mission, approval);
  }
}

function executionEligible(mission: Mission): boolean {
  return ['refined', 'active'].includes(mission.status)
    || mission.status === 'review' && mission.review?.rounds.at(-1)?.phase === 'fixing';
}

function integrationEligible(mission: Mission, approval?: ReviewedRevision | null): boolean {
  if (mission.status === 'integration') { return true; }
  if (!['active', 'review'].includes(mission.status) || !mission.review || reviewStatus(mission.review) !== 'approved') { return false; }
  return approval === undefined || approval !== null && sameReviewedRevision(currentReviewRound(mission.review).subject, approval);
}
