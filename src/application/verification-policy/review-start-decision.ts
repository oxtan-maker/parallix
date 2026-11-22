import type { PerAction, PolicyAction } from './policy-artifact.js';
import { deriveBelief } from './belief.js';
import { recommend } from './recommend.js';
import { settleReviewStartOutcomes } from './review-start-outcome.js';
import type { PolicyLoadResult, PolicySelection, ReviewEntryPin, ReviewEntryPinInput, ReviewStartDecision,
  ReviewStartDecisionInput, ReviewStartFacts, ReviewStartFailure,
  ReviewStartFailureKind, ReviewStartPolicyPorts, TestsActionStartFacts,
  VerificationActionStartFacts } from '../ports/verification-policy.js';

export const REVIEW_START_DECISION_EVENT = 'verification.review-start-decision';
export const REVIEW_ENTRY_PIN_EVENT = 'verification.review-entry-assignment';
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

export function reviewStartDecision(input: ReviewStartDecisionInput, actionSequence: number,
  sameRevisionRerun: boolean | null): ReviewStartDecision {
  return {
    ...input,
    schemaVersion: 1,
    actionSequence,
    sameRevisionRerun,
    idempotencyKey: reviewStartDecisionKey({ ...input, actionSequence }),
    recordedAt: new Date().toISOString(),
  };
}

export function reviewEntryPinKey(input: Pick<ReviewEntryPin,
  'missionId' | 'repositoryId' | 'changeIdentity' | 'actionSequence'>): string {
  return ['review-entry', required(input.repositoryId, 'repositoryId'), required(input.missionId, 'missionId'),
    input.changeIdentity === null ? 'unknown' : required(input.changeIdentity, 'changeIdentity'), String(input.actionSequence)]
    .map(encodeURIComponent).join(':');
}

export function reviewEntryPin(input: ReviewEntryPinInput): ReviewEntryPin {
  const actionSequence = 1 as const;
  return {
    ...input,
    configuredMode: 'pilot',
    schemaVersion: 1,
    idempotencyKey: reviewEntryPinKey({ ...input, actionSequence }),
    actionSequence,
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

/** The facts the policy needs to evaluate one mission; every action start supplies them. */
export type PolicyEvaluationFacts = Pick<VerificationActionStartFacts, 'missionId' | 'revision'>;

/** What the policy concluded for one mission at one moment, before an action's own facts are attached. */
interface PolicyEvaluation {
  readonly changeIdentity: string | null;
  readonly effectiveMode: ReviewStartDecision['effectiveMode'];
  readonly artifactSha256: string | null;
  readonly recommendedAction: PolicyAction | null;
  readonly probabilities: PerAction<number | null>;
  readonly failureReason: ReviewStartFailure | null;
}

type LoadedPolicy = Exclude<PolicyLoadResult, { mode: 'off' }>;
type ActivePolicy = Extract<LoadedPolicy, { mode: 'shadow' }>;
type PolicyLoadOutcome = { readonly loaded: LoadedPolicy } | { readonly failure: ReviewStartFailure };
type PolicyHistory = Awaited<ReturnType<ReviewStartPolicyPorts['readHistory']>>;

interface EvaluationContext {
  readonly facts: PolicyEvaluationFacts;
  readonly ports: ReviewStartPolicyPorts;
  readonly changeIdentity: string | null;
}

/** A pilot mission acts on the policy; shadow only observes it. */
function activeMode(ports: ReviewStartPolicyPorts): 'shadow' | 'pilot' {
  return ports.configuration.mode === 'pilot' ? 'pilot' : 'shadow';
}

function fallback(context: EvaluationContext, failure: ReviewStartFailure,
  effectiveMode: PolicyEvaluation['effectiveMode'] = 'fixed', artifactSha256: string | null = null,
  probabilities: PerAction<number | null> = unknownProbabilities()): PolicyEvaluation {
  context.ports.diagnostic(failure);
  return evaluation(context, effectiveMode, artifactSha256, null, probabilities, failure);
}

function evaluation(context: EvaluationContext, effectiveMode: PolicyEvaluation['effectiveMode'],
  artifactSha256: string | null, recommendedAction: PolicyAction | null,
  probabilities: PerAction<number | null>, failureReason: ReviewStartFailure | null): PolicyEvaluation {
  return { changeIdentity: context.changeIdentity, effectiveMode, artifactSha256, recommendedAction, probabilities, failureReason };
}

/** Attach the started action's own facts; an operator-invoked action that differs from the recommendation is an override. */
function decisionInput(input: VerificationActionStartFacts, ports: ReviewStartPolicyPorts,
  concluded: PolicyEvaluation): ReviewStartDecisionInput {
  return {
    missionId: input.missionId, repositoryId: ports.repositoryId, changeIdentity: concluded.changeIdentity,
    configuredMode: ports.configuration.mode, effectiveMode: concluded.effectiveMode,
    artifactSha256: concluded.artifactSha256,
    recommendedAction: concluded.recommendedAction, predictedPassProbability: concluded.probabilities,
    actualAction: input.actualAction,
    operatorOverride: input.operatorInvocation && concluded.recommendedAction !== null
      && concluded.recommendedAction !== input.actualAction,
    verdictCorrelation: input.verdictCorrelation, agentRunId: input.agentRunId,
    gateRunId: input.actualAction === 'tests' ? input.gateRunId : null,
    operationId: ports.operationId, failureReason: concluded.failureReason,
  };
}

function loadPolicy(ports: ReviewStartPolicyPorts, expectedHash?: string): PolicyLoadOutcome {
  try { return { loaded: ports.loadPolicy(expectedHash) }; }
  catch (error) {
    return { failure: { kind: 'policy-exception',
      message: error instanceof Error ? error.message : String(error) } };
  }
}

async function resolvePin(facts: PolicyEvaluationFacts, ports: ReviewStartPolicyPorts,
  changeIdentity: string | null): Promise<{ readonly pin: ReviewEntryPin | null;
    readonly initialLoad?: PolicyLoadOutcome; readonly failure?: ReviewStartFailure }> {
  let initialLoad: PolicyLoadOutcome | undefined;
  let artifactSha256: string | null = null;
  let failureReason: ReviewStartFailure | null = null;
  if (ports.configuration.mode === 'pilot') {
    initialLoad = loadPolicy(ports);
    if ('failure' in initialLoad) { failureReason = initialLoad.failure; }
    else if (initialLoad.loaded.mode === 'fixed') { failureReason = artifactFailure(initialLoad.loaded.reason); }
    else { artifactSha256 = initialLoad.loaded.hash; }
  }
  const candidate: ReviewEntryPinInput = {
    missionId: facts.missionId, repositoryId: ports.repositoryId, changeIdentity,
    configuredMode: ports.configuration.mode, artifactSha256, failureReason,
  };
  try {
    return { pin: await ports.writer.resolveReviewEntryPin(candidate), ...(initialLoad ? { initialLoad } : {}) };
  } catch (error) {
    return { pin: null, ...(initialLoad ? { initialLoad } : {}), failure: {
      kind: 'writer-failure', message: error instanceof Error ? error.message : String(error),
    } };
  }
}

/** The pin fixes the mode and artifact a mission entered review under; a mode change finishes it on the fixed policy. */
function pinEvaluation(context: EvaluationContext,
  resolved: Awaited<ReturnType<typeof resolvePin>>): PolicyEvaluation | undefined {
  const { ports } = context;
  if (resolved.failure) { return fallback(context, resolved.failure); }
  const pin = resolved.pin;
  if (pin?.failureReason) { return fallback(context, pin.failureReason, 'fixed', pin.artifactSha256); }
  if ((ports.configuration.mode === 'pilot') !== (pin !== null)) {
    return fallback(context, { kind: 'mode-changed-in-flight',
      message: 'the verification policy mode changed after this mission entered review' }, 'fixed', pin?.artifactSha256 ?? null);
  }
  return undefined;
}

function policyException(error: unknown): ReviewStartFailure {
  return { kind: 'policy-exception', message: error instanceof Error ? error.message : String(error) };
}

function evaluateHistory(context: EvaluationContext, loaded: ActivePolicy,
  history: Extract<PolicyHistory, { ok: true }>): PolicyEvaluation {
  let belief: ReturnType<typeof deriveBelief>;
  try { belief = deriveBelief(loaded.artifact, history.entries); }
  catch (error) { return fallback(context, policyException(error), 'fixed', loaded.hash); }
  if (!belief.ok) { return fallback(context, observationFailure('belief', belief.failure), 'fixed', loaded.hash); }
  const failed = new Set(history.record.failed);
  if ([...failed].some(check => check !== 'tests')) {
    return fallback(context, { kind: 'belief-unmodelled-history', message: `${[...failed][0]} repair is pending` },
      'fixed', loaded.hash);
  }
  const passed = new Set(history.record.passed);
  let recommendation: ReturnType<typeof recommend>;
  try {
    recommendation = recommend(loaded.artifact, belief.belief, history.record);
  } catch (error) { return fallback(context, policyException(error), 'fixed', loaded.hash); }
  if (recommendation.kind === 'invalid-belief') {
    return fallback(context, { kind: 'belief-invalid', message: `policy belief is ${recommendation.reason}` }, 'fixed', loaded.hash);
  }
  const mode = activeMode(context.ports);
  if (recommendation.kind === 'no-recommendation') {
    return fallback(context, { kind: 'no-recommendation', message: 'policy has no permitted recommendation' },
      mode, loaded.hash, recommendation.passProbabilities);
  }
  // A human verdict is recorded against the round only after agent review approved it;
  // recommending it earlier cannot be attributed to the human check, so the fixed policy runs.
  if (mode === 'pilot' && recommendation.action === 'human' && !passed.has('agent')) {
    return fallback(context, { kind: 'human-turn-unavailable', message: 'human review cannot be recorded before agent review approved the change' },
      'fixed', loaded.hash, recommendation.passProbabilities);
  }
  return evaluation(context, mode, loaded.hash, recommendation.action, recommendation.passProbabilities, null);
}

async function evaluateWithPolicy(context: EvaluationContext, resolved: Awaited<ReturnType<typeof resolvePin>>,
  signal: AbortSignal): Promise<PolicyEvaluation | null> {
  const { ports } = context;
  const pinned = resolved.pin?.artifactSha256 ?? null;
  const outcome = resolved.pin
    ? loadPolicy(ports, pinned ?? undefined)
    : resolved.initialLoad ?? loadPolicy(ports);
  if ('failure' in outcome) { return fallback(context, outcome.failure, 'fixed', pinned); }
  const loaded = outcome.loaded;
  if (loaded.mode === 'fixed') { return fallback(context, artifactFailure(loaded.reason), 'fixed', pinned); }
  let history: PolicyHistory;
  try { history = await ports.readHistory(signal); }
  catch (error) { return fallback(context, policyException(error), 'fixed', loaded.hash); }
  if (signal.aborted) { return null; }
  if (!history.ok) { return fallback(context, observationFailure('history', history.failure), 'fixed', loaded.hash); }
  return evaluateHistory(context, loaded, history);
}

/** The one policy evaluator: shadow records and pilot selections both read its conclusion. */
async function evaluatePolicy(facts: PolicyEvaluationFacts, ports: ReviewStartPolicyPorts,
  signal: AbortSignal): Promise<PolicyEvaluation | null> {
  if (signal.aborted) { return null; }
  const changeIdentity = ports.identity.changeIdentity(facts.revision, ports.targetBranch);
  const context = { facts, ports, changeIdentity };
  const resolved = await resolvePin(facts, ports, changeIdentity);
  if (signal.aborted) { return null; }
  return pinEvaluation(context, resolved) ?? await evaluateWithPolicy(context, resolved, signal);
}

/** A lost or already-failed evaluation keeps its typed reason with every unknown left unknown. */
function unknownEvaluation(failure: ReviewStartFailure): PolicyEvaluation {
  return { changeIdentity: null, effectiveMode: 'fixed', artifactSha256: null, recommendedAction: null,
    probabilities: unknownProbabilities(), failureReason: failure };
}

async function buildDecision(input: VerificationActionStartFacts, ports: ReviewStartPolicyPorts,
  signal: AbortSignal): Promise<ReviewStartDecisionInput | null> {
  const concluded = await evaluatePolicy(input, ports, signal);
  if (!concluded) { return null; }
  const decision = decisionInput(input, ports, concluded);
  // A selection that already fell back keeps its own reason; the pin and change identity stay as resolved.
  return input.selectionFailure ? { ...decision, effectiveMode: 'fixed', recommendedAction: null,
    predictedPassProbability: unknownProbabilities(), failureReason: input.selectionFailure } : decision;
}

/** Failures a later evaluation of the same facts need not reproduce, so the selection hands them to the start record. */
const TRANSIENT_FAILURES: ReadonlySet<ReviewStartFailureKind> = new Set(['observation-timeout', 'policy-exception', 'writer-failure']);

function unusable(ports: ReviewStartPolicyPorts, failure: ReviewStartFailure): PolicySelection {
  try { ports.diagnostic(failure); } catch { /* Diagnostics cannot steer the mission. */ }
  return { action: null, failure };
}

/**
 * The pilot's choice of the next unfinished check for the current change. A null
 * action leaves the fixed policy in charge; a transient fallback also returns its
 * typed reason so the next recorded decision carries it, not a re-derived one.
 */
export async function selectPolicyAction(facts: PolicyEvaluationFacts,
  ports: ReviewStartPolicyPorts): Promise<PolicySelection> {
  if (ports.configuration.mode !== 'pilot') { return { action: null, failure: null }; }
  const controller = new AbortController();
  const lost = { kind: 'observation-timeout' as const, message: `policy selection exceeded ${REVIEW_START_OBSERVATION_DEADLINE_MS} ms` };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<PolicySelection>(resolve => {
    timer = setTimeout(() => { controller.abort(); resolve(unusable(ports, lost)); }, REVIEW_START_OBSERVATION_DEADLINE_MS);
    timer.unref?.();
  });
  try {
    const concluded = await Promise.race([evaluatePolicy(facts, ports, controller.signal), timeout]);
    if (concluded === null) { return unusable(ports, lost); }
    if ('action' in concluded) { return concluded; }
    const reason = concluded.failureReason;
    return { action: concluded.effectiveMode === 'pilot' ? concluded.recommendedAction : null,
      failure: reason && TRANSIENT_FAILURES.has(reason.kind) ? reason : null };
  } catch (error) { return unusable(ports, policyException(error)); }
  finally { if (timer !== undefined) { clearTimeout(timer); } }
}

/** The sole policy evaluator used by every durable verification-action start boundary. */
async function observePolicyVerificationActionStart(input: VerificationActionStartFacts,
  ports: ReviewStartPolicyPorts): Promise<ReviewStartObservationOutcome> {
  const outcome = await recordStartDecision(input, ports);
  // Earlier starts of the Mission have ended or been superseded; their outcomes are stored now.
  await settleReviewStartOutcomes(input.missionId, ports, REVIEW_START_OBSERVATION_DEADLINE_MS);
  return outcome;
}

async function recordStartDecision(input: VerificationActionStartFacts,
  ports: ReviewStartPolicyPorts): Promise<ReviewStartObservationOutcome> {
  const outcome = await observeReviewStartDecision(signal => buildDecision(input, ports, signal),
    ports.writer, ports.diagnostic);
  if (outcome !== 'timed-out') { return outcome; }
  const lost = unknownEvaluation({ kind: 'observation-timeout', message: `policy evaluation exceeded ${REVIEW_START_OBSERVATION_DEADLINE_MS} ms` });
  return await observeReviewStartDecision(async () => decisionInput(input, ports, lost), ports.writer, ports.diagnostic);
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

/** `write-timed-out`: the deadline passed while the writer was running, so that write may still land and no second one is made. */
type ReviewStartObservationOutcome = 'recorded' | 'duplicate' | 'skipped' | 'failed' | 'timed-out' | 'write-timed-out';

/** Failure-isolated deadline around metadata/evaluation and the durable writer. */
export async function observeReviewStartDecision(
  build: (_signal: AbortSignal) => Promise<ReviewStartDecisionInput | null>,
  writer: Pick<ReviewStartPolicyPorts['writer'], 'recordReviewStartDecision'>,
  diagnostic: (_failure: ReviewStartFailure) => void,
  options: { readonly deadlineMs?: number } = {},
): Promise<ReviewStartObservationOutcome> {
  const controller = new AbortController();
  const deadlineMs = options.deadlineMs ?? REVIEW_START_OBSERVATION_DEADLINE_MS;
  const report = (failure: ReviewStartFailure) => {
    try { diagnostic(failure); } catch { /* Diagnostics cannot alter review control flow. */ }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let writing = false;
  const timeout = new Promise<'timed-out' | 'write-timed-out'>(resolve => {
    const scheduled = setTimeout(() => {
      controller.abort();
      report({ kind: 'observation-timeout', message: `review-start observation exceeded ${deadlineMs} ms` });
      resolve(writing ? 'write-timed-out' : 'timed-out');
    }, deadlineMs);
    timer = scheduled;
    scheduled.unref?.();
  });
  const work = (async (): Promise<Exclude<ReviewStartObservationOutcome, 'timed-out' | 'write-timed-out'>> => {
    let input: ReviewStartDecisionInput | null;
    try { input = await build(controller.signal); }
    catch (error) {
      report({ kind: 'policy-exception', message: error instanceof Error ? error.message : String(error) });
      return 'failed';
    }
    if (input === null || controller.signal.aborted) { return 'skipped'; }
    try { writing = true; return await writer.recordReviewStartDecision(input) ? 'recorded' : 'duplicate'; }
    catch (error) {
      report({ kind: 'writer-failure', message: error instanceof Error ? error.message : String(error) });
      return 'failed';
    }
  })();
  try { return await Promise.race([work, timeout]); }
  finally { if (timer !== undefined) { clearTimeout(timer); } }
}
