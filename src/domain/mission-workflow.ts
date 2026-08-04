import type { AgentFamily } from './agents.js';
import {
  isClosedMission,
  MissionRuleViolation,
  type Mission,
  type MissionId,
  type OpenMission,
  type MissionStatus,
} from './mission.js';
import {
  assertReviewedChange,
  currentReviewRound,
  reviewStatus,
  sameReviewedChange,
  sameReviewedRevision,
  type ConfiguredReviewerEligibility,
  type Review,
} from './review.js';

/** Names match the workflow operations that persist these transitions. */
export type MissionCommand =
  | { readonly type: 'activate'; readonly agent: AgentFamily }
  | {
    readonly type: 'submit-for-review';
    readonly gatesPassed: boolean;
    readonly review: Review;
    readonly reviewerEligibility: ConfiguredReviewerEligibility;
  }
  | { readonly type: 'request-changes'; readonly review: Review }
  | { readonly type: 'approve'; readonly review: Review }
  | { readonly type: 'integrate' };

export interface MissionTransition {
  readonly missionId: MissionId;
  readonly from: MissionStatus;
  readonly to: MissionStatus;
  readonly trigger: MissionCommand['type'];
  readonly actor: string;
  readonly occurredAt: string;
}

function requireStatus(
  mission: Mission,
  allowed: readonly MissionStatus[],
  command: MissionCommand,
): asserts mission is OpenMission {
  if (isClosedMission(mission)) {
    throw new MissionRuleViolation(`Cannot ${command.type} after ${mission.id} was closed`);
  }
  if (!allowed.includes(mission.status)) {
    throw new MissionRuleViolation(
      `Cannot ${command.type} while ${mission.id} is ${mission.status}; expected ${allowed.join(' or ')}`,
    );
  }
}

function requireSameReviewedRevision(mission: OpenMission, review: Review): void {
  if (
    !mission.review
    || !sameReviewedRevision(
      currentReviewRound(mission.review).subject,
      currentReviewRound(review).subject,
    )
  ) {
    throw new MissionRuleViolation('Review decision must preserve the exact reviewed revision');
  }
}

export function decideMission(mission: Mission, command: MissionCommand): Mission {
  switch (command.type) {
  case 'activate':
    requireStatus(mission, ['backlog', 'refined', 'active'], command);
    return { ...mission, status: 'active', assignee: command.agent };
  case 'submit-for-review':
    requireStatus(mission, ['active', 'review'], command);
    // A handoff that relaunches (gatekeeper pushback, crashed agent, retried
    // CLI invocation) replays this transition against a mission that already
    // reached review. Submission is therefore idempotent: the mission is
    // returned untouched, so the recorded review round cannot be rewritten and
    // no lane event is emitted for a lane that did not move.
    if (mission.status === 'review') {
      return mission;
    }
    if (!command.gatesPassed) {
      throw new MissionRuleViolation('Cannot submit for review before declared gates pass');
    }
    if (!mission.checkpoints.some((checkpoint) => checkpoint.goalCheck.length > 0)) {
      throw new MissionRuleViolation('Cannot submit for review without checkpoint evidence');
    }
    if (reviewStatus(command.review) !== 'awaiting-review') {
      throw new MissionRuleViolation('A submitted review must be awaiting a reviewer decision');
    }
    try {
      const submittedRound = currentReviewRound(command.review);
      if (!command.reviewerEligibility.includes(submittedRound.reviewer)) {
        throw new Error(
          `Reviewer ${submittedRound.reviewer} is not eligible under the configured review policy`,
        );
      }
      assertReviewedChange(submittedRound.subject.change);
      if (
        mission.review
        && (
          !sameReviewedChange(
            currentReviewRound(mission.review).subject.change,
            submittedRound.subject.change,
          )
          || submittedRound.number <= currentReviewRound(mission.review).number
        )
      ) {
        throw new Error('A new review round must advance the same pull request or local branch');
      }
    } catch (error) {
      throw new MissionRuleViolation((error as Error).message);
    }
    return { ...mission, status: 'review', review: command.review };
  case 'request-changes':
    requireStatus(mission, ['review'], command);
    requireSameReviewedRevision(mission, command.review);
    if (reviewStatus(command.review) !== 'awaiting-implementation') {
      throw new MissionRuleViolation('Requested changes must await an implementer response');
    }
    return { ...mission, status: 'active', review: command.review };
  case 'approve':
    requireStatus(mission, ['review'], command);
    requireSameReviewedRevision(mission, command.review);
    if (reviewStatus(command.review) !== 'approved') {
      throw new MissionRuleViolation('Approval requires an approved review');
    }
    return { ...mission, status: 'integration', review: command.review };
  case 'integrate':
    requireStatus(mission, ['integration'], command);
    return { ...mission, status: 'done', closedAt: null };
  }
}
