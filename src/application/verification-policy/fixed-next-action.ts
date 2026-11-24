import type { Mission, MissionStatus } from '../../domain/mission.js';
import { effectiveRepairObligations, isRetainedGateRepair, retainedGateRepairIsActionable } from '../../domain/repair-coverage.js';
import { pendingIntegrationApproval } from '../../domain/integration-repair-policy.js';
import { currentReviewRound, reviewStatus } from '../../domain/review.js';
import type { ReviewPhase } from '../../domain/review-phase-policy.js';

/** Facts every production entry presents to the fixed-sequence owner. */
export interface FixedVerificationNextActionFacts {
  readonly status: MissionStatus;
  readonly reviewPhase: ReviewPhase | null;
  /** Recorded checkpoint recovery owned by the existing repair path; never a verification pass. */
  readonly checkpointRepairPending: boolean;
  readonly humanIntervention: boolean;
  readonly ownedAction: boolean;
  readonly humanOnlyReason: string | null;
  /** An interrupted approval-retention repair waits for a recorded run before it can be certified. */
  readonly approvalRetentionPending?: boolean;
  /** Exact-current evidence supplied by integrate; absent readers preserve unknown. */
  readonly agentReviewCurrent?: boolean | null;
  /** Exact-current complete integration-test evidence supplied by integrate. */
  readonly testsCurrent?: boolean | null;
  /** Whether the repository configures integration tests; absent readers preserve unknown. */
  readonly testsConfigured?: boolean | null;
  /**
   * A verification action a policy selected for this mission. The fixed
   * sequence never supplies one; only a policy-selected `tests` is honoured.
   */
  readonly policySelection?: 'tests' | null;
}

export type FixedVerificationNextAction =
  | { readonly kind: 'agent-review'; readonly reason: 'review-unfinished' }
  | { readonly kind: 'repair'; readonly reason: 'checkpoint-repair-pending' | 'findings-pending' }
  | { readonly kind: 'human-review'; readonly reason: 'agent-review-approved' | 'integrate-shortcut-eligible' }
  | { readonly kind: 'tests'; readonly reason: 'policy-selected' | 'tests-not-current' }
  | { readonly kind: 'integration-handoff'; readonly reason: 'fixed-sequence-complete' }
  | { readonly kind: 'wait'; readonly reason: 'action-owned' | 'not-verifying' | 'complete' }
  | { readonly kind: 'human-handoff'; readonly reason: 'recorded-blocker' | 'human-intervention' };

export type HumanReviewDueReason = Extract<FixedVerificationNextAction, { readonly kind: 'human-review' }>['reason'];

/** The one projection fact every human-facing surface carries unchanged. */
export interface HumanReviewDue {
  readonly reason: HumanReviewDueReason;
  readonly detail: string;
}

export type FixedVerificationNextActionInput = FixedVerificationNextActionFacts | {
  readonly mission: Mission;
  readonly ownedAction?: boolean;
  readonly humanOnlyReason?: string | null;
  readonly agentReviewCurrent?: boolean | null;
  readonly testsCurrent?: boolean | null;
  readonly testsConfigured?: boolean | null;
  readonly policySelection?: 'tests' | null;
};

function humanOnlyRepairReason(mission: Mission): string | null {
  const blocker = mission.checkpoints?.find(checkpoint => checkpoint.repair?.blocker)?.repair?.blocker;
  return blocker?.authorityReason ?? null;
}

function checkpointRepairPending(mission: Mission): boolean {
  if (!retainedGateRepairIsActionable(mission)) { return false; }
  return effectiveRepairObligations(mission.checkpoints ?? [], mission.declaredGates, mission.successCriteria)
    .some(checkpoint => isRetainedGateRepair(checkpoint.repair!.command));
}

/**
 * Tests run before landing; never while findings are being fixed. An agent approval already
 * moved the lane to integration, where the policy may still choose tests before the human lands.
 */
function policySelectedTests(facts: FixedVerificationNextActionFacts): boolean {
  return facts.policySelection === 'tests'
    && (facts.status === 'review' || facts.status === 'active' || facts.status === 'integration')
    && facts.reviewPhase !== 'fixing';
}

export function fixedVerificationFacts(input: FixedVerificationNextActionInput): FixedVerificationNextActionFacts {
  if (!('mission' in input)) { return input; }
  const review = input.mission.review;
  return {
    status: input.mission.status,
    reviewPhase: review ? currentReviewRound(review).phase : null,
    checkpointRepairPending: checkpointRepairPending(input.mission),
    humanIntervention: review ? reviewStatus(review) === 'human-intervention' : false,
    ownedAction: input.ownedAction ?? false,
    humanOnlyReason: input.humanOnlyReason ?? humanOnlyRepairReason(input.mission),
    approvalRetentionPending: pendingIntegrationApproval(input.mission) !== null,
    agentReviewCurrent: input.agentReviewCurrent ?? null,
    testsCurrent: input.testsCurrent ?? null,
    testsConfigured: input.testsConfigured ?? null,
    policySelection: input.policySelection ?? null,
  };
}

function fixedVerificationPriorityAction(facts: FixedVerificationNextActionFacts): FixedVerificationNextAction | null {
  if (facts.ownedAction) { return { kind: 'wait', reason: 'action-owned' }; }
  if (facts.humanOnlyReason) { return { kind: 'human-handoff', reason: 'recorded-blocker' }; }
  if (facts.humanIntervention) { return { kind: 'human-handoff', reason: 'human-intervention' }; }
  if (facts.status === 'done') { return { kind: 'wait', reason: 'complete' }; }
  if (facts.status === 'backlog' || facts.status === 'refined') { return { kind: 'wait', reason: 'not-verifying' }; }
  if (facts.checkpointRepairPending) { return { kind: 'repair', reason: 'checkpoint-repair-pending' }; }
  if (policySelectedTests(facts)) { return { kind: 'tests', reason: 'policy-selected' }; }
  return null;
}

function integrationNextAction(facts: FixedVerificationNextActionFacts): FixedVerificationNextAction {
  if (facts.agentReviewCurrent === false) { return { kind: 'agent-review', reason: 'review-unfinished' }; }
  return facts.testsConfigured === true && facts.testsCurrent === false
    ? { kind: 'tests', reason: 'tests-not-current' }
    : { kind: 'integration-handoff', reason: 'fixed-sequence-complete' };
}

/** What an approved candidate in the active or review lane owes before a human lands it; null leaves it with agent review. */
function approvedCandidateAction(facts: FixedVerificationNextActionFacts): FixedVerificationNextAction | null {
  if (facts.approvalRetentionPending === true && facts.testsConfigured === true && facts.testsCurrent === false) {
    // Retention certifies from the recorded run and integration never starts one, so the tests action
    // owns it. The original approval is what retention assesses, so agent-review currency is not asked.
    return { kind: 'tests', reason: 'tests-not-current' };
  }
  if ((facts.status === 'active' || facts.status === 'review') && facts.reviewPhase === 'approved'
    && facts.agentReviewCurrent === true && facts.testsCurrent === true) {
    return { kind: 'human-review', reason: 'integrate-shortcut-eligible' };
  }
  if (facts.status !== 'review' || facts.reviewPhase !== 'approved') { return null; }
  // The human turn waits on a current recorded run, so the fixed sequence schedules the tests action
  // before it hands the landing to a person (TASK-2872.02 SC2). Unknown evidence stays a human handoff.
  if (facts.agentReviewCurrent !== false && facts.testsConfigured === true && facts.testsCurrent === false) {
    return { kind: 'tests', reason: 'tests-not-current' };
  }
  return { kind: 'human-review', reason: 'agent-review-approved' };
}

/**
 * The sole application-layer fixed-sequence decision.
 *
 * Entries provide recorded state and execute the returned mechanism. Lifecycle,
 * operation admission, rebase, gates, repair launch and event writers remain in
 * their established owners; this function only decides which one is next.
 * The fixed sequence returns `tests` once agent review has approved and the
 * integration lane holds the candidate, but only when the readers positively
 * know tests are configured and not current; unknown evidence never schedules a
 * run. A policy selection also reaches `tests` for a review or active mission
 * whose round is not fixing (TASK-2859.14, TASK-2859.17). An approved
 * review in the review lane schedules the same run before the human turn, since
 * landing admits only a current recorded pass (TASK-2872.02 SC2).
 */
export function fixedVerificationNextAction(input: FixedVerificationNextActionInput): FixedVerificationNextAction {
  const facts = fixedVerificationFacts(input);
  const priority = fixedVerificationPriorityAction(facts);
  if (priority) { return priority; }
  if (facts.status === 'integration') { return integrationNextAction(facts); }
  if (facts.reviewPhase === 'fixing') { return { kind: 'repair', reason: 'findings-pending' }; }
  return approvedCandidateAction(facts) ?? { kind: 'agent-review', reason: 'review-unfinished' };
}

/** Project a human turn only from the next-action owner's typed result. */
export function humanReviewDue(action: FixedVerificationNextAction): HumanReviewDue | null {
  if (action.kind !== 'human-review') { return null; }
  switch (action.reason) {
    case 'agent-review-approved':
      return { reason: action.reason, detail: 'Human review is due because agent review approved the current change.' };
    case 'integrate-shortcut-eligible':
      return { reason: action.reason, detail: 'Human review is due; px integrate may record it because agent review and tests passed on the current change.' };
  }
}
