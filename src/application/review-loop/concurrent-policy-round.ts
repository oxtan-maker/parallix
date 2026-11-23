import { missionId } from '../../domain/mission.js';
import { currentReviewRound } from '../../domain/review.js';
import type { PolicyTestsOutcome } from '../ports/verification-policy.js';
import { observeHumanReviewStart } from './review-start-observation.js';
import type { LoopContext, ReviewRound } from './round.js';

export type ConcurrentAgentVerdict = 'passed' | 'failed' | 'stopped';
export type ConcurrentRoundSettlement = 'continue' | 'joint-repair' | 'repair-routed' | 'stop' | null;

function handoffReason(outcome: Extract<PolicyTestsOutcome, { kind: 'human-handoff' }>): string {
  return `CONCURRENT_TESTS_${outcome.reason.toUpperCase().replaceAll('-', '_')}`;
}

async function joinedAgentFindings(context: LoopContext, round: ReviewRound): Promise<string> {
  let findings: readonly { id: string; summary: string }[] = round.blockingFindings;
  if (findings.length === 0 && context.ports.missionStore) {
    const loaded = await context.ports.missionStore.load(missionId(context.slug));
    if (loaded.kind === 'found' && loaded.mission.review) {
      const decision = currentReviewRound(loaded.mission.review).decision;
      findings = decision?.kind === 'changes-requested' ? decision.findings : [];
    }
  }
  return findings.map(finding => `${finding.id}: ${finding.summary}`).join('; ');
}

/**
 * Start TASK-2866.03 rule (a) after rebase and declared-gate setup fixed the reviewable revision.
 * The human request is durable before either automated mechanism starts. Tests may record a red
 * verdict immediately, but their repair owner waits until the agent verdict joins it.
 */
export async function startConcurrentPolicyRound(context: LoopContext, round: ReviewRound): Promise<boolean> {
  const actions = context.ports.policyActions;
  const revision = round.verifiedRevision;
  if (context.dryRun || context.operatorInvocation || context.policyDisabled || !revision
    || !actions?.selectRound || !actions.runConcurrentTests || !actions.withdrawHuman) {
    return false;
  }
  const selected = await actions.selectRound({ missionId: missionId(context.slug), revision });
  context.selectionFailure ??= selected.failure;
  if (!selected.plan) { return false; }

  await observeHumanReviewStart(context, round);
  let settleAgent = (_verdict: ConcurrentAgentVerdict) => {};
  const agentVerdict = new Promise<ConcurrentAgentVerdict>(resolve => { settleAgent = resolve; });
  let withdrawal: Promise<boolean> | null = null;
  const withdraw = () => withdrawal ??= (async () => {
    try {
      await actions.withdrawHuman!({ missionId: missionId(context.slug), revision, round: round.attempt });
      context.ports.output.log(`Withdrew the pending human review request for ${context.slug} after an automated failure.`);
      return true;
    } catch (error) {
      context.ports.output.error(`Could not fence the pending human review request for ${context.slug}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  })();
  const tests = actions.runConcurrentTests(async () => {
    if (!await withdraw()) { throw new Error('Concurrent human review withdrawal could not be fenced.'); }
  },
    async testedRevision => testedRevision === revision,
    async testedRevision => testedRevision === revision && await agentVerdict !== 'passed', revision);
  round.concurrentVerification = { plan: selected.plan, revision, tests, settleAgent, withdraw };
  context.ports.output.log(`Started agent review, integration tests, and the human review request together for ${revision}.`);
  return true;
}

async function stopForUnsettledTests(context: LoopContext, round: ReviewRound,
  tests: PolicyTestsOutcome): Promise<'stop'> {
  await round.concurrentVerification!.withdraw();
  if (tests.kind === 'human-handoff') {
    context.ports.output.error(tests.detail);
    if (tests.reason !== 'concurrent-entry') { await context.escalateToHumanReview(handoffReason(tests)); }
  } else {
    await context.escalateToHumanReview('CONCURRENT_TESTS_UNSETTLED');
  }
  return 'stop';
}

async function settleFailedTests(context: LoopContext, round: ReviewRound,
  tests: Extract<PolicyTestsOutcome, { kind: 'completed' }>,
  agent: ConcurrentAgentVerdict): Promise<ConcurrentRoundSettlement> {
  const concurrent = round.concurrentVerification!;
  if (!tests.retryWithoutRepair || agent === 'passed') {
    // The existing gate-only owner performed the sole repair when the agent passed.
    return 'repair-routed';
  }
  if (!await concurrent.withdraw()) {
    await context.escalateToHumanReview('CONCURRENT_HUMAN_WITHDRAWAL_FAILED');
    return 'stop';
  }
  if (agent === 'stopped') { return 'stop'; }
  const reviewFindings = await joinedAgentFindings(context, round);
  round.jointRepair = `${tests.repairBrief ?? `Integration tests failed on pinned revision ${concurrent.revision}.`}`
    + (reviewFindings ? ` Joint agent findings: ${reviewFindings}` : '');
  return 'joint-repair';
}

async function settlePassingTests(context: LoopContext, round: ReviewRound,
  agent: ConcurrentAgentVerdict): Promise<ConcurrentRoundSettlement> {
  if (agent !== 'passed' && !await round.concurrentVerification!.withdraw()) {
    await context.escalateToHumanReview('CONCURRENT_HUMAN_WITHDRAWAL_FAILED');
    return 'stop';
  }
  return agent === 'stopped' ? 'stop' : 'continue';
}

/** Join both automated verdicts, then either preserve the human request or enter one existing repair route. */
export async function settleConcurrentPolicyRound(context: LoopContext, round: ReviewRound,
  agent: ConcurrentAgentVerdict): Promise<ConcurrentRoundSettlement> {
  const concurrent = round.concurrentVerification;
  if (!concurrent) { return null; }
  concurrent.settleAgent(agent);
  let tests: PolicyTestsOutcome;
  try { tests = await concurrent.tests; }
  catch (error) {
    await concurrent.withdraw();
    context.ports.output.error(`Concurrent integration tests failed to settle: ${error instanceof Error ? error.message : String(error)}`);
    await context.escalateToHumanReview('CONCURRENT_TESTS_INTERRUPTED');
    return 'stop';
  }
  if (context.ports.preReview.head() !== concurrent.revision) {
    await concurrent.withdraw();
    await context.escalateToHumanReview('CONCURRENT_REVIEW_REVISION_DRIFT');
    return 'stop';
  }
  if (tests.kind !== 'completed' || tests.verdict === 'cancelled') {
    return await stopForUnsettledTests(context, round, tests);
  }
  return tests.verdict === 'failed'
    ? await settleFailedTests(context, round, tests, agent)
    : await settlePassingTests(context, round, agent);
}

/** A reviewer infrastructure throw must release, drain and fence every concurrent child before propagating. */
export async function abortConcurrentPolicyRound(context: LoopContext, round: ReviewRound): Promise<void> {
  const concurrent = round.concurrentVerification;
  if (!concurrent) { return; }
  concurrent.settleAgent('stopped');
  try { await concurrent.tests; }
  catch (error) { context.ports.output.error(`Concurrent integration tests failed while reviewer cleanup ran: ${error instanceof Error ? error.message : String(error)}`); }
  await concurrent.withdraw();
}
