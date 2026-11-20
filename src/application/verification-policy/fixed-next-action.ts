import { currentIntegrationRepair } from '../../domain/integration-repair-policy.js';
import type { Mission, MissionStatus } from '../../domain/mission.js';
import { effectiveRepairObligations, isRetainedGateRepair, retainedGateRepairIsActionable } from '../../domain/repair-coverage.js';
import { currentReviewRound, reviewStatus } from '../../domain/review.js';
import type { ReviewPhase } from '../../domain/review-phase-policy.js';

/** Facts every production entry presents to the fixed-sequence owner. */
export interface FixedVerificationNextActionFacts {
  readonly status: MissionStatus;
  readonly reviewPhase: ReviewPhase | null;
  readonly pendingRepair: boolean;
  readonly reviewRequired: boolean;
  readonly humanIntervention: boolean;
  readonly ownedAction: boolean;
  readonly humanOnlyReason: string | null;
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
  | { readonly kind: 'repair'; readonly reason: 'repair-pending' | 'findings-pending' }
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

function retainedGateRepairPending(mission: Mission): boolean {
  if (!retainedGateRepairIsActionable(mission)) { return false; }
  const obligations = effectiveRepairObligations(mission.checkpoints ?? [], mission.declaredGates, mission.successCriteria);
  return obligations.some(checkpoint => isRetainedGateRepair(checkpoint.repair!.command));
}

function humanOnlyRepairReason(mission: Mission): string | null {
  const blocker = mission.checkpoints?.find(checkpoint => checkpoint.repair?.blocker)?.repair?.blocker;
  return blocker?.authorityReason ?? null;
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
  const integrationRepair = currentIntegrationRepair(input.mission);
  return {
    status: input.mission.status,
    reviewPhase: review ? currentReviewRound(review).phase : null,
    pendingRepair: integrationRepair?.kind === 'approval-retention' || retainedGateRepairPending(input.mission),
    reviewRequired: integrationRepair?.kind === 'review-required',
    humanIntervention: review ? reviewStatus(review) === 'human-intervention' : false,
    ownedAction: input.ownedAction ?? false,
    humanOnlyReason: input.humanOnlyReason ?? humanOnlyRepairReason(input.mission),
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
  if (facts.pendingRepair) { return { kind: 'repair', reason: 'repair-pending' }; }
  if (facts.reviewRequired) { return { kind: 'agent-review', reason: 'review-unfinished' }; }
  if (policySelectedTests(facts)) { return { kind: 'tests', reason: 'policy-selected' }; }
  return null;
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
 * whose round is not fixing (TASK-2859.14, TASK-2859.17).
 */
export function fixedVerificationNextAction(input: FixedVerificationNextActionInput): FixedVerificationNextAction {
  const facts = fixedVerificationFacts(input);
  const priority = fixedVerificationPriorityAction(facts);
  if (priority) { return priority; }
  if (facts.status === 'integration') {
    return facts.testsConfigured === true && facts.testsCurrent === false
      ? { kind: 'tests', reason: 'tests-not-current' }
      : { kind: 'integration-handoff', reason: 'fixed-sequence-complete' };
  }
  if (facts.reviewPhase === 'fixing') { return { kind: 'repair', reason: 'findings-pending' }; }
  if (facts.status === 'review' && facts.reviewPhase === 'approved') {
    return { kind: 'human-review', reason: facts.agentReviewCurrent === true && facts.testsCurrent === true
      ? 'integrate-shortcut-eligible' : 'agent-review-approved' };
  }
  return { kind: 'agent-review', reason: 'review-unfinished' };
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
