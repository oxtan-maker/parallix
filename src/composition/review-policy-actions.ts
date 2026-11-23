import * as fmt from '../application/presentation/cli-format.js';
import type { IntegrationMissionServices } from '../application/ports/integration-records.js';
import type { ParallixConfiguration } from '../application/ports/configuration.js';
import type { LiveMissionExecutionContext } from '../application/ports/mission-execution-context.js';
import type { PolicyActionPort, ReviewStartPolicyPorts, VerificationActionPolicyFactory } from '../application/ports/verification-policy.js';
import { selectPolicyAction, selectPolicyRound } from '../application/verification-policy/review-start-decision.js';
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
}): PolicyActionPort | undefined {
  if (input.policy.configuration.mode !== 'pilot') { return undefined; }
  const diagnostic = createReviewStartFailureDiagnostics(fmt.log.plain);
  return {
    select: facts => selectPolicyAction(facts, { ...input.policy, diagnostic }),
    selectRound: facts => selectPolicyRound(facts, { ...input.policy, diagnostic }),
    runTests: stillSelected => runPolicyTestsAction(input.slug, {
      stillSelected,
      executionContext: input.executionContext, configuration: input.configuration,
      missionServicesFn: async () => input.missionServices, verificationActionPolicy: input.policyFactory,
      operatorInvocation: false,
    }),
    runConcurrentTests: async (beforeRepair, stillSelected, jointRepair, preparedRevision) => {
      const result = await runPolicyTestsAction(input.slug, {
        beforeRepair, stillSelected, jointRepair, preparedRevision,
        executionContext: input.executionContext, configuration: input.configuration,
        missionServicesFn: async () => input.missionServices, verificationActionPolicy: input.policyFactory,
        operatorInvocation: false,
      });
      if (result.kind !== 'completed') { return result; }
      return { kind: result.kind, verdict: result.verdict,
        ...('retryWithoutRepair' in result ? { retryWithoutRepair: result.retryWithoutRepair } : {}),
        ...(result.verdict === 'failed' ? { repairBrief: result.evidence
          ? `Integration tests failed on ${result.evidence.revision}: ${result.evidence.outcomes.filter(outcome => outcome.result === 'failed').map(outcome => `${outcome.key}: ${outcome.command} (exit ${outcome.exitCode})`).join('; ') || 'failed gate'}.`
          : 'Integration tests failed without readable gate evidence.' } : {}) };
    },
    withdrawHuman: async facts => {
      const changeIdentity = input.policy.identity.changeIdentity(facts.revision, input.policy.targetBranch);
      if (changeIdentity === null || !input.policy.writer.recordHumanReviewWithdrawal) {
        throw new Error('the concurrent human request cannot be fenced without its durable change identity');
      }
      return await input.policy.writer.recordHumanReviewWithdrawal({ missionId: facts.missionId, changeIdentity,
        round: facts.round, reason: 'automated-failure' });
    },
    rebaseInProgress: () => detectRebaseState(input.executionContext.missionWorktree).inProgress,
  };
}
