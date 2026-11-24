import { pendingIntegrationApproval } from '../../domain/integration-repair-policy.js';
import { missionId } from '../../domain/mission.js';
import { fixedVerificationNextAction } from '../verification-policy/fixed-next-action.js';
import type { PolicyTestsOutcome } from '../ports/verification-policy.js';
import type { LoopContext, ReviewRound } from './round.js';
import { startReviewAction } from './action-limit.js';

/**
 * How a policy-selected integration-test action ended for the loop:
 * `none` leaves the fixed policy in charge, `ran` means the check passed and the
 * policy chooses again, `repaired` means a failed check was repaired and the
 * review step must be re-entered, `stop` means the action went to a human.
 */
export type PolicyTestsStep = 'none' | 'ran' | 'repaired' | 'stop';

/** Named escalation prefix for a tests action that needs a human; the suffix is its typed handoff reason. */
export const TESTS_ACTION_HANDOFF = 'TESTS_ACTION';

/**
 * Run the integration tests when the active policy selects them.
 *
 * Only the fixed sequence's own review actions are open to a policy choice:
 * repairs, recorded blockers, human intervention, owned actions and a rebase
 * stopped on conflicts are outside the model and make no decision at all. Agent
 * review and the human turn stay with the loop's existing round, which the
 * fixed policy would also run.
 */
export async function runPolicyTestsAction(context: LoopContext, afterRound = false): Promise<PolicyTestsStep> {
  const { ports, slug } = context;
  const actions = ports.policyActions;
  // A direct operator command overrides the policy: the round runs what was asked and the start record marks the
  // override. Without a policy decision the fixed sequence still owes the recorded run integrate admits, so it
  // enters its tests action for an approved candidate whatever the configured policy mode.
  if (!actions || context.policyDisabled || context.operatorInvocation) { return afterRound ? 'none' : runFixedTestsAction(context); }
  if (!await decisionIsOpen(context)) { return 'none'; }
  const revision = ports.preReview.head();
  if (!revision) { return 'none'; }
  if (await humanCorrectionPending(context)) { return 'none'; }
  // Each step is a new selection; a transient fallback it meets is kept until an action start records it.
  context.selectionFailure = null;
  const selection = await actions.select({ missionId: missionId(slug), revision });
  context.selectionFailure ??= selection.failure;
  context.selectedAction = selection.action;
  if (selection.action === 'tests') {
    if (!await startReviewAction(context, 'tests', `tests:${revision}:${context.actionCount + 1}`, revision)) { return 'stop'; }
    const reselect = async (head: string) => {
      const again = await actions.select({ missionId: missionId(slug), revision: head });
      context.selectionFailure ??= again.failure;
      return again.action === 'tests';
    };
    // The policy run is this loop's tests action; the fixed fallback must not ask for a second one.
    context.fixedTestsRan = true;
    const outcome = await actions.runTests(reselect);
    // The tests took time: an empty reading is stale, while unconsumed feedback must still reach the round.
    if (context.reconciledFeedback === null) { context.reconciledFeedback = undefined; }
    return await settleTestsAction(context, outcome);
  }
  // A positive non-tests choice is the policy's decision and stays in charge. A null selection names no
  // check, so it is no decision: the fixed sequence keeps charge and still owes the recorded run integrate admits.
  if (selection.action !== null) { return 'none'; }
  return afterRound ? 'none' : runFixedTestsAction(context);
}

/**
 * Wherever no policy decision applies (no pilot, or a direct operator command under one) the fixed sequence
 * owns the tests action when `px review` or `px active` is entered on an already-approved candidate: the operator-typed command records the run that `px integrate` later
 * admits, because integrate starts no gate (TASK-2872.02 SC2). An approval the same loop just recorded
 * schedules no tests (TASK-2859.17), so the post-round settle never reaches here. The tests-action owner
 * re-reads its own evidence facts and declines when a current run already exists; the loop-level flag
 * keeps that decline from costing a second review-step action.
 */
async function runFixedTestsAction(context: LoopContext): Promise<PolicyTestsStep> {
  const { ports, slug } = context;
  const entry = ports.fixedTestsAction;
  if (!entry || context.dryRun || context.fixedTestsRan || !ports.missionStore) { return 'none'; }
  const revision = ports.preReview.head();
  if (!revision || await humanCorrectionPending(context)) { return 'none'; }
  const loaded = await ports.missionStore.load(missionId(slug));
  if (loaded.kind !== 'found') { return 'none'; }
  const fixed = fixedVerificationNextAction({ mission: loaded.mission });
  // The run is offered for an approved candidate: the integration lane's handoff, the review lane's human
  // turn, or a `tests` the fixed sequence already names. Unfinished review and repair work stays with the round.
  // An interrupted approval-retention repair waits on the same recorded run, so it is offered one too.
  if (fixed.kind !== 'integration-handoff' && fixed.kind !== 'human-review' && fixed.kind !== 'tests'
    && !pendingIntegrationApproval(loaded.mission)) { return 'none'; }
  if (!await startReviewAction(context, 'tests', `tests:${revision}:${context.actionCount + 1}`, revision)) { return 'stop'; }
  context.fixedTestsRan = true;
  return await settleTestsAction(context, await entry.runTests(), 'fixed');
}

/** Human feedback is read once and handed to the next round, so a policy action never consumes it. */
export async function reconciledHumanFeedback(context: LoopContext) {
  const held = context.reconciledFeedback;
  context.reconciledFeedback = undefined;
  return held !== undefined ? held : await context.ports.humanFeedback.reconcile(context.state);
}

/** A current human change request is newer authority than any policy action: the round routes it to repair first. */
async function humanCorrectionPending(context: LoopContext): Promise<boolean> {
  if (context.reconciledFeedback === undefined) { context.reconciledFeedback = await context.ports.humanFeedback.reconcile(context.state); }
  const feedback = context.reconciledFeedback;
  return feedback?.disposition === 'REQUEST_CHANGES' && feedback.state === 'current';
}

/** Only a live review-entry action the fixed sequence itself owns is open to a policy decision. */
async function decisionIsOpen(context: LoopContext): Promise<boolean> {
  const { ports, slug } = context;
  if (context.dryRun || !ports.missionStore || ports.policyActions?.rebaseInProgress()) { return false; }
  const loaded = await ports.missionStore.load(missionId(slug));
  if (loaded.kind !== 'found') { return false; }
  const fixed = fixedVerificationNextAction({ mission: loaded.mission });
  // After an agent approval the lane is already integration and the fixed sequence reports its handoff; the human lands.
  return fixed.kind === 'agent-review' || fixed.kind === 'human-review' || fixed.kind === 'integration-handoff';
}

async function settleTestsAction(context: LoopContext, outcome: PolicyTestsOutcome, source: 'policy' | 'fixed' = 'policy'): Promise<PolicyTestsStep> {
  const { ports, slug } = context;
  switch (outcome.kind) {
    case 'not-selected': return 'none';
    case 'completed':
      ports.output.log(`${source === 'policy' ? 'Policy-selected ' : ''}Integration tests ${outcome.verdict} for ${slug}.`);
      if (outcome.verdict === 'passed') { return 'ran'; }
      if (outcome.verdict === 'failed') { return 'repaired'; }
      await context.escalateToHumanReview(`${TESTS_ACTION_HANDOFF}_CANCELLED`);
      return 'stop';
    case 'human-handoff':
      ports.output.error(outcome.detail);
      // Another actor owns the action: refuse without escalating a mission nobody abandoned.
      if (outcome.reason !== 'concurrent-entry') {
        await context.escalateToHumanReview(`${TESTS_ACTION_HANDOFF}_${outcome.reason.toUpperCase().replaceAll('-', '_')}`);
      }
      return 'stop';
  }
}

/** After the pre-review rebase the change identity may differ: true when the policy now recommends tests on the head about to be reviewed. */
export async function testsPreferredAfterSetup(context: LoopContext, round: ReviewRound): Promise<boolean> {
  const actions = context.ports.policyActions;
  // A tests choice the executor already declined is not asked again; a conflicted rebase makes no decision.
  if (!actions || context.policyDisabled || context.dryRun || context.operatorInvocation || !round.verifiedRevision
    || context.selectedAction === 'tests' || actions.rebaseInProgress() || !await decisionIsOpen(context)) { return false; }
  const selection = await actions.select({ missionId: missionId(context.slug), revision: round.verifiedRevision });
  context.selectionFailure ??= selection.failure;
  return selection.action === 'tests';
}
