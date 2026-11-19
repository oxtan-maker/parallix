import type { PerAction, PolicyAction } from './policy-artifact.js';
import { POLICY_ACTIONS } from './policy-artifact.js';
import { deriveBelief } from './belief.js';
import { recommend } from './recommend.js';
import { currentIntegrationRepair } from '../../domain/integration-repair-policy.js';
import type { Mission, MissionStatus } from '../../domain/mission.js';
import { effectiveRepairObligations, isRetainedGateRepair, retainedGateRepairIsActionable } from '../../domain/repair-coverage.js';
import { currentReviewRound, reviewStatus } from '../../domain/review.js';
import type { ReviewPhase } from '../../domain/review-phase-policy.js';
import type { PolicyLoadResult, ReviewStartDecision, ReviewStartDecisionInput, ReviewStartFacts, ReviewStartFailure,
  ReviewStartFailureKind, ReviewStartPolicyPorts, TestsActionStartFacts,
  VerificationActionStartFacts } from '../ports/verification-policy.js';

export const REVIEW_START_DECISION_EVENT = 'verification.review-start-decision';
export const REVIEW_START_OBSERVATION_DEADLINE_MS = 250;

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
  | { readonly kind: 'tests'; readonly reason: 'policy-selected' }
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

/** Tests run in the review step, before landing; never while findings are being fixed. */
function policySelectedTests(facts: FixedVerificationNextActionFacts): boolean {
  return facts.policySelection === 'tests' && (facts.status === 'review' || facts.status === 'active')
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
 * The fixed sequence never returns `tests`: integration tests run in the review
 * step only when a policy selection is presented for a review or active
 * mission whose round is not fixing (TASK-2859.14).
 */
export function fixedVerificationNextAction(input: FixedVerificationNextActionInput): FixedVerificationNextAction {
  const facts = fixedVerificationFacts(input);
  const priority = fixedVerificationPriorityAction(facts);
  if (priority) { return priority; }
  if (facts.status === 'integration') { return { kind: 'integration-handoff', reason: 'fixed-sequence-complete' }; }
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

function required(value: string, field: string): string {
  if (!value.trim()) { throw new Error(`${field} is required`); }
  return value;
}

/** Stable across restarts; deliberately contains only the three W8 identities. */
export function reviewStartDecisionKey(input: Pick<ReviewStartDecision,
  'missionId' | 'changeIdentity' | 'actionSequence'>): string {
  if (!Number.isSafeInteger(input.actionSequence) || input.actionSequence < 1) {
    throw new Error('actionSequence must be a positive safe integer');
  }
  return ['review-start', required(input.missionId, 'missionId'),
    input.changeIdentity === null ? 'unknown' : required(input.changeIdentity, 'changeIdentity'), String(input.actionSequence)]
    .map(encodeURIComponent).join(':');
}

export function reviewStartDecision(input: ReviewStartDecisionInput, actionSequence: number): ReviewStartDecision {
  return {
    ...input,
    schemaVersion: 1,
    actionSequence,
    idempotencyKey: reviewStartDecisionKey({ ...input, actionSequence }),
    recordedAt: new Date().toISOString(),
  };
}

function unknownProbabilities(): PerAction<null> { return { agent: null, human: null, tests: null }; }

function artifactFailure(reason: Extract<PolicyLoadResult, { mode: 'fixed' }>['reason']): ReviewStartFailure {
  return { kind: `artifact-${reason}`, message: `verification policy artifact is ${reason}` };
}

function observationFailure(scope: 'history' | 'belief',
  failure: { readonly kind: string; readonly message: string }): ReviewStartFailure {
  return { kind: `${scope}-${failure.kind}` as ReviewStartFailureKind, message: failure.message };
}

function fallback(input: VerificationActionStartFacts, ports: ReviewStartPolicyPorts, changeIdentity: string | null,
  failure: ReviewStartFailure, effectiveMode: ReviewStartDecision['effectiveMode'] = 'fixed', artifactSha256: string | null = null,
  probabilities: PerAction<number | null> = unknownProbabilities()): ReviewStartDecisionInput {
  ports.diagnostic(failure);
  return decisionInput(input, ports, changeIdentity, effectiveMode, artifactSha256, null, probabilities, failure);
}

function decisionInput(input: VerificationActionStartFacts, ports: ReviewStartPolicyPorts, changeIdentity: string | null,
  effectiveMode: ReviewStartDecision['effectiveMode'], artifactSha256: string | null, recommendedAction: PolicyAction | null,
  probabilities: PerAction<number | null>, failureReason: ReviewStartFailure | null): ReviewStartDecisionInput {
  return {
    missionId: input.missionId, repositoryId: ports.repositoryId, changeIdentity,
    configuredMode: ports.configuration.mode, effectiveMode,
    artifactSha256,
    recommendedAction, predictedPassProbability: probabilities, actualAction: input.actualAction,
    operatorOverride: input.operatorInvocation && recommendedAction !== null && recommendedAction !== input.actualAction,
    verdictCorrelation: input.verdictCorrelation, agentRunId: input.agentRunId,
    gateRunId: input.actualAction === 'tests' ? input.gateRunId : null,
    operationId: ports.operationId, failureReason,
  };
}

async function buildDecision(input: VerificationActionStartFacts, ports: ReviewStartPolicyPorts,
  signal: AbortSignal): Promise<ReviewStartDecisionInput | null> {
  if (signal.aborted) { return null; }
  const changeIdentity = ports.identity.changeIdentity(input.revision, ports.targetBranch);
  const loaded = ports.loadPolicy();
  if (loaded.mode === 'fixed') { return fallback(input, ports, changeIdentity, artifactFailure(loaded.reason)); }
  const history = await ports.readHistory(signal);
  if (signal.aborted) { return null; }
  if (!history.ok) { return fallback(input, ports, changeIdentity, observationFailure('history', history.failure)); }
  const belief = deriveBelief(loaded.artifact, history.entries);
  if (!belief.ok) {
    return fallback(input, ports, changeIdentity, observationFailure('belief', belief.failure));
  }
  if (belief.record.kind === 'pending-repair') {
    return fallback(input, ports, changeIdentity,
      { kind: 'belief-unmodelled-history', message: `${belief.record.check} repair is pending` });
  }
  const passed = new Set(belief.record.passed);
  const recommendation = recommend(loaded.artifact, belief.belief,
    new Set(POLICY_ACTIONS.filter(action => !passed.has(action))));
  if (recommendation.kind === 'invalid-belief') {
    return fallback(input, ports, changeIdentity,
      { kind: 'belief-invalid', message: `policy belief is ${recommendation.reason}` });
  }
  if (recommendation.kind === 'no-recommendation') {
    const failure = { kind: 'no-recommendation' as const, message: 'policy has no permitted recommendation' };
    return fallback(input, ports, changeIdentity, failure, 'shadow', loaded.hash, recommendation.passProbabilities);
  }
  return decisionInput(input, ports, changeIdentity, 'shadow', loaded.hash, recommendation.action,
    recommendation.passProbabilities, null);
}

/** The sole policy evaluator used by every durable verification-action start boundary. */
async function observePolicyVerificationActionStart(input: VerificationActionStartFacts,
  ports: ReviewStartPolicyPorts): Promise<ReviewStartObservationOutcome> {
  return await observeReviewStartDecision(signal => buildDecision(input, ports, signal),
    ports.writer, ports.diagnostic);
}

/** Review-loop binding retained at its existing two durable review-start boundaries. */
export async function observePolicyReviewStart(input: ReviewStartFacts,
  ports: ReviewStartPolicyPorts): Promise<ReviewStartObservationOutcome> {
  return await observePolicyVerificationActionStart(input, ports);
}

/** Integration binding invoked after the gate-run start record commits. */
export async function observePolicyTestsStart(input: TestsActionStartFacts,
  ports: ReviewStartPolicyPorts): Promise<ReviewStartObservationOutcome> {
  return await observePolicyVerificationActionStart(input, ports);
}

type ReviewStartObservationOutcome = 'recorded' | 'duplicate' | 'skipped' | 'failed' | 'timed-out';

interface ObservationOptions {
  readonly deadlineMs?: number;
}

/** Failure-isolated deadline around metadata/evaluation and the durable writer. */
export async function observeReviewStartDecision(
  build: (_signal: AbortSignal) => Promise<ReviewStartDecisionInput | null>,
  writer: ReviewStartPolicyPorts['writer'],
  diagnostic: (_failure: ReviewStartFailure) => void,
  options: ObservationOptions = {},
): Promise<ReviewStartObservationOutcome> {
  const controller = new AbortController();
  const deadlineMs = options.deadlineMs ?? REVIEW_START_OBSERVATION_DEADLINE_MS;
  const report = (failure: ReviewStartFailure) => {
    try { diagnostic(failure); } catch { /* Diagnostics cannot alter review control flow. */ }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timed-out'>(resolve => {
    const scheduled = setTimeout(() => {
      controller.abort();
      report({ kind: 'observation-timeout', message: `review-start observation exceeded ${deadlineMs} ms` });
      resolve('timed-out');
    }, deadlineMs);
    timer = scheduled;
    scheduled.unref?.();
  });
  const work = (async (): Promise<Exclude<ReviewStartObservationOutcome, 'timed-out'>> => {
    let input: ReviewStartDecisionInput | null;
    try { input = await build(controller.signal); }
    catch (error) {
      report({ kind: 'policy-exception', message: error instanceof Error ? error.message : String(error) });
      return 'failed';
    }
    if (input === null || controller.signal.aborted) { return 'skipped'; }
    try { return await writer.recordReviewStartDecision(input) ? 'recorded' : 'duplicate'; }
    catch (error) {
      report({ kind: 'writer-failure', message: error instanceof Error ? error.message : String(error) });
      return 'failed';
    }
  })();
  try { return await Promise.race([work, timeout]); }
  finally { if (timer !== undefined) { clearTimeout(timer); } }
}
