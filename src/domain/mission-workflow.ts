import type { AgentFamily } from './agents.js';
import {
  isClosedMission,
  MissionRuleViolation,
  type Mission,
  type MissionId,
  type MissionLabel,
  type OpenMission,
  type MissionStatus,
} from './mission.js';
import {
  assertReviewedChange,
  currentReviewRound,
  reviewStatus,
  revokeApprovedDecision,
  sameReviewedChange,
  sameReviewedRevision,
  type ConfiguredReviewerEligibility,
  type Review,
} from './review.js';

/** Names match the workflow operations that persist these transitions. */
export type MissionCommand =
  | { readonly type: 'refine' }
  | { readonly type: 'activate'; readonly agent: AgentFamily }
  | { readonly type: 'abort-activation'; readonly assignee: AgentFamily | null }
  | { readonly type: 'rebound-to-active'; readonly agent: AgentFamily; readonly occurredAt?: string }
  | {
    readonly type: 'submit-for-review';
    readonly gatesPassed: boolean;
    readonly review: Review;
    readonly reviewerEligibility: ConfiguredReviewerEligibility;
  }
  | { readonly type: 'request-changes'; readonly review: Review }
  | { readonly type: 'approve'; readonly review: Review }
  | { readonly type: 'revoke-approval'; readonly review: Review }
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

/**
 * A mission cannot start work on a contract nobody finished writing.
 *
 * Draft settles the goal, the reason it exists, what it covers and what
 * verifies it, and every later stage is judged against those: execution records
 * evidence for them, review reads them, handoff runs exactly the declared
 * gates. Leaving completeness to the drafting agent's own reading of its prompt
 * is how a mission reaches execution with a placeholder goal and nothing to
 * verify it — the instruction is followed exactly as often as it is not.
 *
 * Checked at the transition rather than inside `missionBrief()` so the parts can
 * be recorded in any order, and only the move out of draft demands all of them.
 * `refine` is where every draft ends, so a new mission cannot become refined
 * without its contract.
 *
 * `activate` checks it only for a mission with a recorded brief. A refined or
 * active mission with no brief was drafted before the contract was Mission
 * state: its mission document, checkpoint plan and `CP-N.md` evidence remain
 * its contract, and relaunching it (usage block, restart) must keep working.
 *
 * `outOfScope` is deliberately not required: it is new, so no existing mission
 * has one, and demanding it would fail missions whose contract is otherwise
 * complete.
 */
function requireDraftedContract(mission: OpenMission, command: MissionCommand): void {
  const brief = mission.brief ?? null;
  const missing: string[] = [];
  if (!brief) {
    missing.push('a goal and why (`px goal set`)', 'a scope (`px scope set`)');
  } else if (!brief.scope) {
    missing.push('a scope (`px scope set`)');
  }
  if ((mission.successCriteria ?? []).length === 0) {
    missing.push('at least one success criterion (`px criterion add`)');
  }
  if (mission.checkpoints.length === 0) {
    missing.push('a checkpoint plan (`px checkpoint plan`)');
  }
  if ((mission.declaredGates ?? []).length === 0) {
    missing.push('at least one verification gate (`px gate add`)');
  }
  if (!mission.predictedNelBucket) {
    missing.push('a predicted NEL bucket (`px nel set`)');
  }
  if (mission.labels.includes('bug' as MissionLabel) && !mission.reproductionTest) {
    missing.push('a reproduction test for this bug mission (`px repro set`)');
  }
  if (missing.length > 0) {
    throw new MissionRuleViolation(
      `Cannot ${command.type} ${mission.id}: its mission contract is incomplete. `
      + `Missing ${missing.join('; ')}. Record what is missing, then read it back with \`px status ${mission.id}\`.`,
    );
  }
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

type SubmitForReviewCommand = Extract<MissionCommand, { readonly type: 'submit-for-review' }>;

function hasApprovedRecordedRound(mission: OpenMission): boolean {
  return mission.status === 'active'
    && Boolean(mission.review?.rounds?.length)
    && reviewStatus(mission.review!) === 'approved';
}

function validateReviewRound(
  recordedReview: Review | null,
  review: Review,
  reviewerEligibility: ConfiguredReviewerEligibility,
): void {
  const submittedRound = currentReviewRound(review);
  if (!reviewerEligibility.includes(submittedRound.reviewer)) {
    throw new Error(`Reviewer ${submittedRound.reviewer} is not eligible under the configured review policy`);
  }
  assertReviewedChange(submittedRound.subject.change);
  if (!recordedReview) {
    return;
  }
  const recordedRound = currentReviewRound(recordedReview);
  const resubmission = submittedRound.number === recordedRound.number && !recordedRound.decision;
  if (
    !sameReviewedChange(recordedRound.subject.change, submittedRound.subject.change)
    || (!resubmission && submittedRound.number <= recordedRound.number)
  ) {
    throw new Error('A new review round must advance the same pull request or local branch');
  }
}

function validateSubmission(mission: OpenMission, command: SubmitForReviewCommand): void {
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
    validateReviewRound(mission.review, command.review, command.reviewerEligibility);
  } catch (error) {
    throw new MissionRuleViolation((error as Error).message);
  }
}

function submitForReview(mission: Mission, command: SubmitForReviewCommand): Mission {
  requireStatus(mission, ['active', 'review'], command);
  // A previous attempt may have reached review before its Review was stored.
  // A retry supplies the verified handoff record and completes that write.
  if (mission.status === 'review' && mission.review) {
    return mission;
  }
  if (hasApprovedRecordedRound(mission)) {
    return { ...mission, status: 'review' };
  }
  validateSubmission(mission, command);
  return { ...mission, status: 'review', review: command.review };
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
    requireDraftedContract(mission, command);
    return { ...mission, status: 'refined' };
  case 'activate':
    requireStatus(mission, ['refined', 'active'], command);
    if (mission.brief) { requireDraftedContract(mission, command); }
    return { ...mission, status: 'active', assignee: command.agent };
  case 'abort-activation':
    requireStatus(mission, ['refined', 'active'], command);
    if (mission.status === 'refined') { return mission; }
    return { ...mission, status: 'refined', assignee: command.assignee };
  case 'rebound-to-active':
    requireStatus(mission, ['integration', 'review', 'active'], command);
    if (mission.status === 'review' && (!mission.review || reviewStatus(mission.review) !== 'awaiting-review')) {
      throw new MissionRuleViolation('A review repair rebound requires an undecided review round');
    }
    return {
      ...mission, status: 'active', assignee: command.agent,
      review: mission.review && reviewStatus(mission.review) === 'approved'
        ? revokeApprovedDecision(mission.review, currentReviewRound(mission.review).number, {
          revokedAt: command.occurredAt ?? '',
          revokedBy: 'workflow',
          reason: 'Integration gates failed; the mission returned to implementation for repair.',
        })
        : mission.review,
    };
  case 'submit-for-review':
    // A handoff that relaunches (gatekeeper pushback, crashed agent, retried
    // CLI invocation) replays this transition against a mission that already
    // reached review. Submission is therefore idempotent: the mission is
    // returned untouched, so the recorded review round cannot be rewritten and
    // no lane event is emitted for a lane that did not move.
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
    return submitForReview(mission, command);
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
  case 'revoke-approval':
    requireStatus(mission, ['integration', 'active'], command);
    if (!mission.review || reviewStatus(mission.review) !== 'approved') {
      throw new MissionRuleViolation('Revocation requires a current effective approval');
    }
    requireSameReviewedRevision(mission, command.review);
    if (reviewStatus(command.review) !== 'awaiting-review') {
      throw new MissionRuleViolation('Revocation must open an awaiting-review round');
    }
    return { ...mission, status: 'review', review: command.review };
  case 'integrate':
    requireStatus(mission, ['integration'], command);
    return { ...mission, status: 'done', closedAt: null };
  }
}
