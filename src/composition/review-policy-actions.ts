import * as fmt from '../application/presentation/cli-format.js';
import type { IntegrationMissionServices } from '../application/ports/integration-records.js';
import type { ParallixConfiguration } from '../application/ports/configuration.js';
import type { LiveMissionExecutionContext } from '../application/ports/mission-execution-context.js';
import type { PolicyActionPort, ReviewStartPolicyPorts, VerificationActionPolicyFactory } from '../application/ports/verification-policy.js';
import { selectPolicyAction } from '../application/verification-policy/review-start-decision.js';
import { runPolicyTestsAction } from '../adapters/cli/commands/integrate.js';
import { createReviewStartFailureDiagnostics } from '../adapters/review/review-start-observation.js';
import { detectRebaseState } from '../adapters/git/git.js';

/**
 * The pilot's choices for one review loop. Shadow and off return nothing, so the
 * fixed policy runs with no policy work; tests run through the integrate
 * workflow's own claim, rebase and gate owners.
 */
export function createPolicyActionPort(input: {
  readonly slug: string;
  readonly executionContext: LiveMissionExecutionContext;
  readonly configuration: ParallixConfiguration;
  readonly policy: Omit<ReviewStartPolicyPorts, 'diagnostic'>;
  readonly policyFactory: VerificationActionPolicyFactory;
  readonly missionServices: IntegrationMissionServices;
  readonly history: { countTestsActions(_missionId: string): Promise<number> };
}): PolicyActionPort | undefined {
  if (input.policy.configuration.mode !== 'pilot') { return undefined; }
  const diagnostic = createReviewStartFailureDiagnostics(fmt.log.plain);
  return {
    select: facts => selectPolicyAction(facts, { ...input.policy, diagnostic }),
    runTests: stillSelected => runPolicyTestsAction(input.slug, {
      stillSelected,
      executionContext: input.executionContext, configuration: input.configuration,
      missionServicesFn: async () => input.missionServices, verificationActionPolicy: input.policyFactory,
      operatorInvocation: false,
    }),
    testsActionsSpent: () => input.history.countTestsActions(input.slug),
    rebaseInProgress: () => detectRebaseState(input.executionContext.missionWorktree).inProgress,
  };
}
