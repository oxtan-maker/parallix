import * as fmt from '../../application/presentation/cli-format.js';
import type { ReviewLoopPorts } from '../../application/ports/review-round.js';
import type { ReviewStartFailure, ReviewStartFailureKind,
  ReviewStartPolicyPorts } from '../../application/ports/verification-policy.js';
import { observePolicyReviewStart, observePolicyTestsStart } from '../../application/verification-policy/review-start-decision.js';
import type { IntegrationTestsActionObservationPort } from '../../application/ports/integration-verification-evidence.js';

/** Review-loop bindings derived from the two existing application ports. */
export type ReviewStartObservationBindings = {
  readonly reviewStartPolicy?: Omit<ReviewStartPolicyPorts, 'diagnostic'>;
};

/** Count each typed failure separately while retaining the existing warning channel. */
export function createReviewStartFailureDiagnostics(log: (_message: string) => void) {
  const counts = new Map<ReviewStartFailureKind, number>();
  return (failure: ReviewStartFailure) => {
    const count = (counts.get(failure.kind) ?? 0) + 1;
    counts.set(failure.kind, count);
    const label = `verification.review-start-failure.${failure.kind}`;
    log(fmt.status('WARN', `Verification policy observation ${failure.kind}: ${failure.message} [${label} count=${count}]`));
  };
}

/** Bind the policy evaluator to the review loop's existing warning channel. */
export function reviewStartObservationBinding(bindings: ReviewStartObservationBindings,
  log: (_message: string) => void): Pick<ReviewLoopPorts, 'reviewStarts'> | Record<string, never> {
  if (!bindings.reviewStartPolicy) { return {}; }
  const diagnostic = createReviewStartFailureDiagnostics(log);
  return { reviewStarts: { observe: async facts => {
    await observePolicyReviewStart(facts, { ...bindings.reviewStartPolicy!, diagnostic });
  } } };
}

/** Bind the same evaluator and bounded diagnostics to the integration evidence boundary. */
export function testsActionObservationBinding(policy: Omit<ReviewStartPolicyPorts, 'diagnostic'> | undefined,
  log: (_message: string) => void): IntegrationTestsActionObservationPort | undefined {
  if (!policy) { return undefined; }
  const diagnostic = createReviewStartFailureDiagnostics(log);
  return { observe: async facts => { await observePolicyTestsStart(facts, { ...policy, diagnostic }); } };
}
