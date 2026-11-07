import { failureReason } from './failure-reason.js';
import { preserveHistoricalRestoration } from './integration-repair-record.js';
import { retentionEvidenceMatches } from './integration-approval-retention.js';
import type { AgentFamily } from './agents.js';
import { integrationRepairNeedsReview, pendingIntegrationApproval } from './integration-repair-policy.js';
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
  replaceCurrentRound,
  requireSeparateReviewer,
  reviewStatus,
  revokeApprovedDecision,
  sameReviewedChange,
  sameReviewedRevision,
  type ConfiguredReviewerEligibility,
  type Review,
  type ReviewRevocationCause,
} from './review.js';

/** Why a mission returns to implementation; recorded on a withdrawn approval. */
export type ReboundCause = Exclude<ReviewRevocationCause, { readonly kind: 'operator' }>;

const REBOUND_REASONS: Record<ReboundCause['kind'], string> = {
  'integration-gate-failure': 'Integration gates failed; the mission returned to implementation for repair.',
  'review-repair': 'Review repair; the mission returned to implementation.',
  'rebase-repair': 'Rebase repair; the mission returned to implementation.',
};

/** Names match the workflow operations that persist these transitions. */
export type MissionCommand =
  | { readonly type: 'refine' }
  | { readonly type: 'activate'; readonly agent: AgentFamily }
  | { readonly type: 'begin-review-preparation' }
  | { readonly type: 'record-implementer'; readonly agent: AgentFamily }
  | { readonly type: 'abort-activation'; readonly assignee: AgentFamily | null }
  | { readonly type: 'rebound-to-active'; readonly agent: AgentFamily; readonly cause: ReboundCause; readonly occurredAt?: string }
  | {
    readonly type: 'submit-for-review';
    readonly gatesPassed: boolean;
    /** Actual verified HEAD, supplied only when preparation binds its submission. */
    readonly preparedRevision?: import('./review.js').ChangeRevision;
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
 * evidence for them, review reads them, review preparation runs exactly the declared
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
function requiresDefectProvenance(mission: OpenMission, command: MissionCommand): boolean {
  return command.type === 'refine'
    && mission.labels.includes('bug' as MissionLabel)
    && !mission.defectProvenance;
}

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
  if (requiresDefectProvenance(mission, command)) {
    missing.push('defect provenance for this bug mission (`px provenance set`)');
  }
  if (missing.length > 0) {
    throw new MissionRuleViolation(
      `Cannot ${command.type} ${mission.id}: its mission contract is incomplete. `
      + `Missing ${missing.join('; ')}. Record what is missing, then read it back with \`px status ${mission.id}\`.`, failureReason('mission-contract-incomplete', 'lifecycle'),
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
  if (!mission.review) {
    throw new MissionRuleViolation('Review decision must preserve the exact reviewed revision');
  }
  const recorded = currentReviewRound(mission.review);
  const proposed = currentReviewRound(review);
  if (sameReviewedRevision(recorded.subject, proposed.subject)) { return; }
  throw new MissionRuleViolation('Review decision must preserve the exact reviewed revision');
}

/**
 * The revoked round keeps the approved subject, and the round it opens reviews
 * either that subject or the revision a recorded branch move superseded it
 * with — never a revision nobody recorded.
 */
function requireRevocationSubject(recorded: Review, revoked: Review): void {
  const approved = currentReviewRound(recorded);
  const withdrawn = revoked.rounds[revoked.rounds.length - 2];
  const opened = currentReviewRound(revoked);
  const superseding = withdrawn?.decision?.kind === 'approved' ? withdrawn.decision.supersession?.supersedingRevision : undefined;
  if (
    !withdrawn
    || !sameReviewedRevision(approved.subject, withdrawn.subject)
    || !sameReviewedChange(approved.subject.change, opened.subject.change)
    || opened.subject.revision !== (superseding ?? approved.subject.revision)
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
  requireSeparateReviewer(submittedRound.reviewer, submittedRound.implementer, reviewerEligibility);
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
  if (pendingIntegrationApproval(mission)) { throw new MissionRuleViolation('Integration repair must prove approval retention before lifecycle recovery', failureReason('approval-retention-pending', 'lifecycle', { operation: 'lifecycle-recovery' })); }
  // Preparation enters review before the verified Review is stored. A retry
  // preserves the current round; a resolved conversation may advance it.
  if (mission.status === 'review' && mission.review) {
    const recorded = currentReviewRound(mission.review), submitted = currentReviewRound(command.review);
    if (reviewStatus(mission.review) === 'approved' || recorded.number === submitted.number
      && (recorded.number === 1 && !mission.reviewPreparationPending || recorded.decision || sameReviewedRevision(recorded.subject, submitted.subject))) {
      if (mission.reviewPreparationPending && reviewStatus(mission.review) !== 'approved') { validateSubmission(mission, command); }
      return completeReviewPreparation(mission, mission.review, command.preparedRevision);
    }
  }
  if (hasApprovedRecordedRound(mission)) {
    return completeReviewPreparation(mission, mission.review, command.preparedRevision);
  }
  validateSubmission(mission, command);
  return completeReviewPreparation(mission, command.review, command.preparedRevision);
}

function completeReviewPreparation(mission: OpenMission, review: Review | null, preparedRevision?: import('./review.js').ChangeRevision): OpenMission {
  const submitted = { ...mission, status: 'review' as const, review };
  if (review && currentReviewRound(review).subject.revision === preparedRevision) { delete submitted.reviewPreparationPending; }
  return submitted;
}

/**
 * An active Mission is the manually repaired shape (TASK-2514) when the lane was
 * left active while the valid next round awaits review. Only that undecided
 * round may be approved from active. An unresolved integration-gate repair
 * requires implementation and resubmission through review before approval,
 * including after requested changes. Other causes do not reopen a resolved repair.
 */
function approvableFromActiveLane(mission: OpenMission): boolean {
  return Boolean(mission.review && reviewStatus(mission.review) === 'awaiting-review'
    && !integrationRepairNeedsReview(mission));
}

function retainRepairJudgment(review: Review, command: Extract<MissionCommand, { type: 'rebound-to-active' }>): Review {
  if (command.cause.kind !== 'integration-gate-failure') { throw new MissionRuleViolation('Integration repair requires a gate failure'); }
  const round = currentReviewRound(review), revision = String(round.decision!.revision ?? 'unknown');
  return { ...review, rounds: replaceCurrentRound(review, { ...round,
    integrationRepairAssessment: { assessedAt: command.occurredAt!, approvedRevision: revision, candidateRevision: revision,
      ...preserveHistoricalRestoration(round.integrationRepairAssessment),
      failedGate: command.cause.gate, outcome: 'pending', repair: { startedAt: command.occurredAt!, cause: command.cause } } }) };
}

function reboundMission(mission: Mission, command: Extract<MissionCommand, { type: 'rebound-to-active' }>): Mission {
  requireStatus(mission, ['integration', 'review', 'active'], command);
  if (command.cause.kind === 'integration-gate-failure' && !Number.isFinite(Date.parse(command.occurredAt ?? ''))) {
    throw new MissionRuleViolation('Integration repair requires its failure time');
  }
  if (pendingIntegrationApproval(mission)) { return { ...mission, status: 'active', assignee: command.agent }; }
  if (mission.status === 'review' && mission.review && !['awaiting-review', 'awaiting-implementation', 'ready-for-next-round'].includes(reviewStatus(mission.review))) {
    throw new MissionRuleViolation('A review repair rebound requires an undecided review round');
  }
  return {
    ...mission, status: 'active', assignee: command.agent,
    review: mission.review && reviewStatus(mission.review) === 'approved' && command.cause.kind === 'integration-gate-failure'
      ? retainRepairJudgment(mission.review, command)
      : mission.review && reviewStatus(mission.review) === 'approved'
      ? revokeApprovedDecision(mission.review, currentReviewRound(mission.review).number, {
        revokedAt: command.occurredAt ?? '',
        revokedBy: 'workflow',
        reason: REBOUND_REASONS[command.cause.kind],
        cause: command.cause,
      })
      : mission.review,
  };
}

/** Approval retains the implementer selected by the Mission authority.
 * Reviewer separation (including the single-family exception) is checked when
 * the round is created, through ConfiguredReviewerEligibility.
 */
export function requireReviewIdentity(mission: Pick<Mission, 'assignee'>, review: Review): void {
  const round = currentReviewRound(review);
  if (mission.assignee && round.implementer !== mission.assignee) {
    throw new MissionRuleViolation(`Mission implementer identity mismatch: assignee ${mission.assignee}, review implementer ${round.implementer}`);
  }
}

function requireRetainedJudgment(mission: Mission, review: Review, pending: import('./review.js').ReviewRound): void {
  const retained = currentReviewRound(review);
  if (retained.integrationRepairAssessment?.outcome !== 'retained'
    || !retentionEvidenceMatches(retained.integrationRepairAssessment, String(mission.id))
    || retained.integrationRepairAssessment.approvedRevision !== pending.decision?.revision
    || JSON.stringify(pending.decision) !== JSON.stringify(retained.decision)
    || JSON.stringify(pending.subject) !== JSON.stringify(retained.subject)
    || JSON.stringify(pending.integrationRepairAssessment?.repair) !== JSON.stringify(retained.integrationRepairAssessment.repair)
    || mission.review!.rounds.length !== review.rounds.length) {
    throw new MissionRuleViolation('Integration repair may only retain the original judgment with proven evidence');
  }
}

function approveMission(mission: Mission, command: Extract<MissionCommand, { type: 'approve' }>): Mission {
  requireStatus(mission, ['review', 'active'], command);
  const pending = pendingIntegrationApproval(mission);
  if (pending) { requireRetainedJudgment(mission, command.review, pending); }
  if (mission.status === 'active' && !pending && !approvableFromActiveLane(mission)) {
    throw new MissionRuleViolation('Approval from an active Mission requires an awaiting-review round outside an integration repair');
  }
  requireSameReviewedRevision(mission, command.review);
  if (reviewStatus(command.review) !== 'approved') {
    throw new MissionRuleViolation('Approval requires an approved review');
  }
  requireReviewIdentity(mission, command.review);
  return { ...mission, status: 'integration', review: command.review };
}

function revokeMissionApproval(mission: Mission, command: Extract<MissionCommand, { type: 'revoke-approval' }>): Mission {
  requireStatus(mission, ['integration', 'active', 'review'], command);
  if (!mission.review || reviewStatus(mission.review) !== 'approved') {
    throw new MissionRuleViolation('Revocation requires a current effective approval');
  }
  requireRevocationSubject(mission.review, command.review);
  if (reviewStatus(command.review) !== 'awaiting-review') {
    throw new MissionRuleViolation('Revocation must open an awaiting-review round');
  }
  const withdrawn = command.review.rounds.at(-2)?.decision;
  const integrationRepair = mission.status === 'active' && withdrawn?.kind === 'approved'
    && withdrawn.revocation?.cause?.kind === 'integration-gate-failure';
  return { ...mission, status: integrationRepair ? 'active' : 'review', review: command.review };
}

function recordImplementer(mission: Mission, command: Extract<MissionCommand, { type: 'record-implementer' }>): Mission {
  requireStatus(mission, ['active', 'review'], command);
  if (mission.review && reviewStatus(mission.review) === 'approved' && !pendingIntegrationApproval(mission)) {
    throw new MissionRuleViolation('Revoke the approved review before recording a different implementer');
  }
  const previous = mission.review ? currentReviewRound(mission.review) : null;
  const changed = previous && previous.implementer !== command.agent;
  return { ...mission, assignee: command.agent, review: mission.review && previous ? {
    ...mission.review, rounds: replaceCurrentRound(mission.review, { ...previous, implementer: command.agent,
      response: changed ? null : previous.response,
      disposition: changed && previous.decision?.kind === 'changes-requested' ? 'REQUEST_CHANGES' : previous.disposition,
    }),
  } : null };
}

function beginReviewPreparation(mission: Mission, command: Extract<MissionCommand, { type: 'begin-review-preparation' }>): Mission {
  requireStatus(mission, ['active', 'review', 'integration'], command);
  return { ...mission, status: 'review', ...(mission.status === 'active' ? { reviewPreparationPending: true as const } : {}) };
}

export function decideMission(mission: Mission, command: MissionCommand): Mission {
  switch (command.type) {
    case 'begin-review-preparation': return beginReviewPreparation(mission, command);
    case 'refine': return refineMission(mission, command);
    case 'activate':
      requireStatus(mission, ['refined', 'active'], command);
      if (mission.brief) { requireDraftedContract(mission, command); }
      return { ...mission, status: 'active', assignee: command.agent };
    case 'abort-activation':
      requireStatus(mission, ['refined', 'active'], command);
      if (mission.status === 'refined') { return mission; }
      return { ...mission, status: 'refined', assignee: command.assignee };
    case 'record-implementer': return recordImplementer(mission, command);
    case 'rebound-to-active': return reboundMission(mission, command);
    case 'submit-for-review':
      // A review preparation that relaunches (gatekeeper pushback, crashed agent, retried
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
    case 'approve': return approveMission(mission, command);
    case 'revoke-approval': return revokeMissionApproval(mission, command);
    case 'integrate':
      requireStatus(mission, ['integration'], command);
      return { ...mission, status: 'done', closedAt: null };
  }
}

/** Reconcile bookkeeping after Git proves an open Mission payload already landed. */
export function reconcileLandedMission(mission: Mission): Mission {
  requireStatus(mission, ['active', 'review', 'integration'], { type: 'integrate' });
  return { ...mission, status: 'done', closedAt: null };
}

function refineMission(mission: Mission, command: Extract<MissionCommand, { type: 'refine' }>): Mission {
  requireStatus(mission, ['backlog', 'refined'], command);
  requireDraftedContract(mission, command);
  if (mission.labels.includes('unknown' as MissionLabel)) {
    throw new MissionRuleViolation('Cannot refine with unknown classification: record ai_sdlc or user_value with px classification set before finishing the draft');
  }
  return { ...mission, status: 'refined' };
}
