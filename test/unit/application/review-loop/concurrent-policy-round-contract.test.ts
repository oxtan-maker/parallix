import test from 'node:test';
import assert from 'node:assert/strict';
import { runReviewLoop } from '../../../../src/application/review-loop/review-loop.js';
import { settleConcurrentPolicyRound, startConcurrentPolicyRound } from '../../../../src/application/review-loop/concurrent-policy-round.js';
import { ReviewRound } from '../../../../src/application/review-loop/round.js';
import { missionVersion } from '../../../../src/application/domain-ports.js';
import type { PolicyActionPort, PolicyTestsOutcome } from '../../../../src/application/ports/verification-policy.js';
import { agentFamily } from '../../../../src/domain/agents.js';
import type { Mission } from '../../../../src/domain/mission.js';
import { ReviewState } from '../../../../src/adapters/review/review-state.js';
import { fixtureMission } from '../../../fixtures/mission-builders.js';
import { repeatReview } from '../../../fixtures/repeat-review.js';
import { fakeLoopContext, fakeReviewLoopPorts } from '../../../helpers/review-loop-ports.js';
import { syntheticPolicyArtifactV2 } from '../verification-policy/policy-artifact.fixture.js';

const SLUG = 'task-concurrent-policy-round';
const passed: PolicyTestsOutcome = { kind: 'completed', verdict: 'passed' };
const concurrentRuleA = syntheticPolicyArtifactV2().roundPlan;

function reviewing(): Mission {
  return fixtureMission(SLUG, { status: 'review', assignee: agentFamily('codex'), review: repeatReview() });
}

function storeFor(mission: Mission) {
  return { load: async () => ({ kind: 'found' as const, mission, version: missionVersion(1) }) } as never;
}

function concurrentActions(overrides: Partial<PolicyActionPort>): PolicyActionPort {
  return {
    select: async () => ({ action: 'agent', failure: null }),
    runTests: async () => passed,
    testsActionsSpent: async () => 0,
    rebaseInProgress: () => false,
    selectRound: async () => ({ plan: concurrentRuleA, failure: null }),
    ...overrides,
  };
}

test('rule (a) exposes human, tests and agent starts before either automated verdict (TASK-2867.08)', async () => {
  const order: string[] = [];
  let agentStarted = () => {};
  const agentStart = new Promise<void>(resolve => { agentStarted = resolve; });
  const actions = concurrentActions({
    runConcurrentTests: async () => { order.push('tests-start'); await agentStart; order.push('tests-verdict'); return passed; },
    withdrawHuman: async () => { assert.fail('all-pass round must retain the human request'); },
  });
  const fake = fakeReviewLoopPorts({
    slug: SLUG, missionStore: storeFor(reviewing()), state: new ReviewState(SLUG, { reviewer: 'claude', implementer: 'codex' }),
    policyActions: actions,
    reviewStarts: { observe: async facts => { order.push(`${facts.actualAction}-start`); } },
    agents: { launch: async launch => {
      order.push('agent-launch');
      await launch.onStarted?.({ agent: launch.agent, runId: 'agent-run' });
      agentStarted();
      return { agent: launch.agent, result: { status: 0 } };
    } },
    artifacts: { consumeReviewer: async () => { order.push('agent-verdict'); return { consumed: true, ok: true as const, reviewState: 'APPROVED' }; } },
  });
  await runReviewLoop({ slug: SLUG, implementer: 'codex', reviewer: 'claude', maxAttempts: 2, skipReviewPreparation: true }, fake.ports);
  assert.deepEqual(order.slice(0, 4), ['human-start', 'tests-start', 'agent-launch', 'agent-start']);
  assert.ok(order.indexOf('tests-verdict') > order.indexOf('agent-start'));
  assert.ok(order.indexOf('agent-verdict') > order.indexOf('agent-start'));
  assert.deepEqual(fake.mirrors.filter(lane => lane === 'approved'), ['approved']);
});

test('dual automated failure withdraws human and releases exactly one joint repair route (TASK-2867.08)', async () => {
  const order: string[] = [];
  let head = 'head-1';
  const actions = concurrentActions({
    runConcurrentTests: async (_beforeGateRepair, sameRevision, jointRepair, preparedRevision) => {
      order.push('tests-failed');
      assert.equal(preparedRevision, 'head-1');
      assert.equal(await sameRevision('head-1'), true);
      assert.equal(await jointRepair('head-1'), true);
      order.push('joint-repair');
      return { kind: 'completed', verdict: 'failed', retryWithoutRepair: true,
        repairBrief: 'Integration tests failed: gate finding' };
    },
    withdrawHuman: async () => { order.push('human-withdrawn'); return true; },
  });
  const fake = fakeReviewLoopPorts({
    slug: SLUG, missionStore: storeFor(reviewing()), state: new ReviewState(SLUG, { reviewer: 'claude', implementer: 'codex' }),
    policyActions: actions,
    reviewStarts: { observe: async facts => { order.push(`${facts.actualAction}-start`); } },
    agents: { launch: async launch => {
      if (launch.role === 'implementer') {
        order.push(`implementer:${launch.prompt?.jointRepair ?? ''}`);
        head = 'head-2';
      } else await launch.onStarted?.({ agent: launch.agent, runId: 'agent-run' });
      return { agent: launch.agent, result: { status: 0 } };
    } },
    artifacts: { consumeImplementer: async () => ({ consumed: true, ok: true as const, disposition: 'CHANGES_MADE', changedRevision: true }), consumeReviewer: async () => {
      order.push('agent-failed');
      return { consumed: true, ok: true as const, reviewState: 'REQUEST_CHANGES', reviewFindings: [{ id: 'A1', summary: 'agent finding' }] };
    } },
  });
  Object.assign(fake.ports.preReview, { head: () => head });
  await runReviewLoop({ slug: SLUG, implementer: 'codex', reviewer: 'claude', maxAttempts: 1, skipReviewPreparation: true }, fake.ports);
  assert.deepEqual(order.filter(item => item === 'human-withdrawn'), ['human-withdrawn']);
  assert.deepEqual(order.filter(item => item === 'joint-repair'), ['joint-repair']);
  assert.ok(order.indexOf('joint-repair') > order.indexOf('agent-failed'), 'repair waits for both automated verdicts');
  assert.equal(fake.launches.filter(launch => launch.role === 'implementer').length, 1,
    'both automated failures enter one implementer attempt');
  assert.match(order.find(item => item.startsWith('implementer:')) ?? '', /gate finding.*A1: agent finding/,
    'the one repair input carries gate and agent findings');
});

test('a reviewer settlement throw drains the concurrent gate and withdraws before propagating (TASK-2867.08)', async () => {
  const order: string[] = [];
  const actions = concurrentActions({
    runConcurrentTests: async (_beforeGateRepair, _sameRevision, jointRepair) => {
      order.push('tests-failed');
      assert.equal(await jointRepair('head-1'), true, 'reviewer cleanup releases the red gate without a gate-only repair');
      order.push('tests-drained');
      return { kind: 'completed', verdict: 'failed', retryWithoutRepair: true };
    },
    withdrawHuman: async () => { order.push('human-withdrawal-attempted'); throw new Error('withdrawal writer failed'); },
  });
  const fake = fakeReviewLoopPorts({
    slug: SLUG, missionStore: storeFor(reviewing()), state: new ReviewState(SLUG, { reviewer: 'claude', implementer: 'codex' }),
    policyActions: actions,
    artifacts: { consumeReviewer: async () => { throw new Error('review settlement exploded'); } },
  });
  await assert.rejects(
    runReviewLoop({ slug: SLUG, implementer: 'codex', reviewer: 'claude', maxAttempts: 1, skipReviewPreparation: true }, fake.ports),
    /review settlement exploded/,
  );
  assert.deepEqual(order, ['tests-failed', 'tests-drained', 'human-withdrawal-attempted'],
    'the rejected reviewer drains its gate and attempts withdrawal without masking the original error');
});

test('an unsettled concurrent test run withdraws human and preserves its typed handoff (TASK-2867.08)', async () => {
  const withdrawals: number[] = [];
  const actions = concurrentActions({
    runConcurrentTests: async () => ({
      kind: 'human-handoff', reason: 'gate-evidence-unavailable', detail: 'gate evidence could not be read',
    }),
    withdrawHuman: async () => { withdrawals.push(1); return true; },
  });
  const fake = fakeReviewLoopPorts({ slug: SLUG, policyActions: actions });
  const context = fakeLoopContext(fake, { slug: SLUG });
  const round = new ReviewRound(1, context);
  round.verifiedRevision = 'head-1';

  assert.equal(await startConcurrentPolicyRound(context, round), true);
  assert.equal(await settleConcurrentPolicyRound(context, round, 'passed'), 'stop');
  assert.deepEqual(withdrawals, [1]);
  assert.deepEqual(fake.errors, ['gate evidence could not be read']);
  assert.deepEqual(fake.stops, ['CONCURRENT_TESTS_GATE_EVIDENCE_UNAVAILABLE']);
});
