import type { PerAction, PolicyAction } from './policy-artifact.js';
import { POLICY_ACTIONS } from './policy-artifact.js';
import { deriveBelief } from './belief.js';
import { recommend } from './recommend.js';
import type { PolicyLoadResult, ReviewStartDecision, ReviewStartDecisionInput, ReviewStartFacts, ReviewStartFailure,
  ReviewStartFailureKind, ReviewStartPolicyPorts, TestsActionStartFacts,
  VerificationActionStartFacts } from '../ports/verification-policy.js';

export const REVIEW_START_DECISION_EVENT = 'verification.review-start-decision';
export const REVIEW_START_OBSERVATION_DEADLINE_MS = 250;

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
