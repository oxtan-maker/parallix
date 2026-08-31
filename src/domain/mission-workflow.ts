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
  | { readonly type: 'refine' }
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
  /**
   * The lane the mission left, or `null` when this transition is its intake —
   * the first authoritative entry, with no prior lane to leave. Null is the
   * intake identity itself, not a missing value: a reader that substitutes
   * `to` for it can no longer tell an intake from a self-transition, and every
   * mission then looks as though it existed for the whole history.
   */
  readonly from: MissionStatus | null;
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
  case 'refine':
    // Refinement is what `px draft` produces: the mission leaves the backlog
    // with a mission document to work from. Recording it here is what lets
    // `activate` demand `refined` — without this transition the persisted
    // aggregate would never leave `backlog` and activation could only be
    // spelled as the backlog jump this rule exists to forbid. Re-refining an
    // already refined mission is idempotent so a re-run of `px draft` is safe.
    requireStatus(mission, ['backlog', 'refined'], command);
    return { ...mission, status: 'refined' };
  case 'activate':
    requireStatus(mission, ['refined', 'active'], command);
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
    // An active Mission whose recorded round was already APPROVED is not
    // re-submittable (the approval landed on the provider before the local
    // status advanced to review) and must not be rewritten. Replaying
    // submit-for-review against it would otherwise throw at the awaiting-review
    // guard below. Recognise the approved round and move the lane to review at
    // the existing round's time so the downstream approve transition can run;
    // the round, its decidedAt, and its reviewed change are passed through
    // untouched. Only `approved` matches here: a `changes-requested` round means
    // the implementer fixed the findings and is legitimately resubmitting a new
    // round, which must flow through the normal round-advancement path below.
    // ponytail: trusted-authority ceiling — this accepts a stored `approved`
    // decision as authoritative even without a live provider
    // approval. The integrate recovery path gates this on an active Mission that
    // also carries a provider approval, so an unrelated submit-for-review caller
    // cannot forge the lane move.
    if (mission.status === 'active' && mission.review?.rounds?.length) {
      const recordedRound = currentReviewRound(mission.review);
      if (recordedRound?.decision?.kind === 'approved') {
        return { ...mission, status: 'review' };
      }
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
      if (mission.review) {
        const recordedRound = currentReviewRound(mission.review);
        // Resubmitting the recorded round while it is still undecided is a
        // relaunch of the same handoff, not a new round: the reviewer has not
        // acted, so nothing is being rewritten. Only a genuinely new round has
        // to carry a higher number.
        const resubmission = submittedRound.number === recordedRound.number && !recordedRound.decision;
        if (
          !sameReviewedChange(recordedRound.subject.change, submittedRound.subject.change)
          || (!resubmission && submittedRound.number <= recordedRound.number)
        ) {
          throw new Error('A new review round must advance the same pull request or local branch');
        }
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
