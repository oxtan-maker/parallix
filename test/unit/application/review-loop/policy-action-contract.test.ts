// The pilot's policy-selected integration tests inside the existing review loop (TASK-2859.19).
import test from 'node:test';
import assert from 'node:assert/strict';
import { runReviewLoop } from '../../../../src/application/review-loop/review-loop.js';
import type { PolicyActionPort, PolicyTestsOutcome } from '../../../../src/application/ports/verification-policy.js';
import { missionVersion } from '../../../../src/application/domain-ports.js';
import { agentFamily } from '../../../../src/domain/agents.js';
import { changeRevision, ConfiguredReviewerEligibility, currentReviewRound, startReview } from '../../../../src/domain/review.js';
import type { Mission } from '../../../../src/domain/mission.js';
import { fixtureMission, inMemoryTransitionStore } from '../../../fixtures/mission-builders.js';
import { MissionLifecycleService } from '../../../../src/application/mission-lifecycle-service.js';
import { createReviewObservationRecorder } from '../../../../src/adapters/review/review-observation-recording.js';
import { assertReviewStatePersisted, readReviewState, writeReviewState } from '../../../../src/adapters/review/review-state.js';
import { openReviewRound } from '../../../../src/adapters/review/review-round-open.js';
import { recordApproval } from '../../../../src/adapters/review/review-round.js';
import { configureMissionWriteAuthorization } from '../../../../src/application/ports/mission-write-authorization.js';
import { fixedVerificationNextAction } from '../../../../src/application/verification-policy/fixed-next-action.js';
import { continueVerdictThroughActionOwner } from '../../../../src/composition/cli-authoring-commands.js';
import { resolveConfiguration } from '../../../../src/composition/config.js';
import type { CliCommandContext } from '../../../../src/composition/cli-service-scope.js';
import type { Command } from '../../../../src/interfaces/cli/runtime.js';
import { repeatReview } from '../../../fixtures/repeat-review.js';
import { ReviewState } from '../../../../src/adapters/review/review-state.js';
import { fakeReviewLoopPorts } from '../../../helpers/review-loop-ports.js';
import { observePolicyReviewStart, reviewEntryPin, selectPolicyAction } from '../../../../src/application/verification-policy/review-start-decision.js';
import { parsePolicyArtifact } from '../../../../src/application/verification-policy/policy-artifact.js';
import type { ReviewStartDecisionInput, ReviewStartPolicyPorts } from '../../../../src/application/ports/verification-policy.js';
import { repositoryId } from '../../../../src/domain/repository.js';
import { syntheticPolicyArtifactV2 } from '../verification-policy/policy-artifact.fixture.js';

const SLUG = 'task-policy-action';

function storeFor(mission: Mission) {
  return { load: async () => ({ kind: 'found' as const, mission, version: missionVersion(1) }) } as never;
}

function reviewing(): Mission { return fixtureMission(SLUG, { status: 'review', assignee: agentFamily('codex'), review: repeatReview() }); }

function scripted(selections: Array<'agent' | 'human' | 'tests' | null>, outcome: () => PolicyTestsOutcome,
  rebaseInProgress = () => false) {
  const calls = { select: [] as unknown[], tests: 0, reselect: undefined as undefined | ((_revision: string) => Promise<boolean>) };
  const queue = [...selections];
  const actions: PolicyActionPort = {
    select: async facts => { calls.select.push(facts); return { action: queue.length > 1 ? queue.shift()! : queue[0] ?? null, failure: null }; },
    runTests: async reselect => { calls.tests += 1; calls.reselect = reselect; return outcome(); },
    rebaseInProgress,
  };
  return { actions, calls };
}

function loop(actions: PolicyActionPort | undefined, mission = reviewing(), actionLimit = 40, operatorInvocation = false, humanFeedback?: NonNullable<Parameters<typeof fakeReviewLoopPorts>[0]>['humanFeedback']) {
  const fake = fakeReviewLoopPorts({
    slug: SLUG, ...(humanFeedback ? { humanFeedback } : {}), missionStore: storeFor(mission), state: new ReviewState(SLUG, { reviewer: 'claude', implementer: 'codex' }), ...(actions ? { policyActions: actions } : {}),
    artifacts: { consumeReviewer: async () => ({ consumed: true, ok: true as const, reviewState: 'APPROVED' }) },
  });
  const run = () => runReviewLoop({ slug: SLUG, implementer: 'codex', reviewer: 'claude', actionLimit,
    skipReviewPreparation: true, operatorInvocation }, fake.ports);
  return { fake, run };
}

const passed: PolicyTestsOutcome = { kind: 'completed', verdict: 'passed' };

test('a selected tests action runs before the agent round and returns control to the policy (TASK-2859.19)', async () => {
  const { actions, calls } = scripted(['tests', 'agent'], () => passed);
  const { fake, run } = loop(actions);
  await run();
  assert.equal(calls.tests, 1);
  assert.deepEqual(fake.launches.map(launch => launch.role), ['reviewer'], 'the agent review ran after the tests, as the policy chose');
  assert.equal(fake.current()?.phase, 'approved');
  assert.deepEqual(calls.select[0], { missionId: SLUG, revision: 'head-1' });
});
test('other selections and a refused selection leave the fixed round in charge (TASK-2859.19)', async () => {
  for (const selection of ['agent', 'human', null] as const) {
    const { actions, calls } = scripted([selection], () => passed);
    const { fake, run } = loop(actions);
    await run();
    assert.equal(calls.tests, 0, `${selection} runs no tests`);
    assert.equal(fake.current()?.phase, 'approved');
  }
  const refused = scripted(['tests'], () => ({ kind: 'not-selected' }));
  const { fake, run } = loop(refused.actions);
  await run();
  assert.equal(refused.calls.tests, 2, 'the owner declined before the agent round and again once the approval returned control to the policy');
  assert.equal(fake.launches.length, 1, 'a tests action the owner declined falls through to the fixed round');
});

test('escalation, repair, human intervention, rebase conflict and dry-run make no policy decision (TASK-2859.19)', async () => {
  const intervention = fixtureMission(SLUG, { status: 'review', assignee: agentFamily('codex'), review: { ...repeatReview(),
    intervention: { requestedAt: '2026-11-19T10:00:00Z', requestedBy: 'reviewer', reason: 'needs a human' } } });
  const cases: Array<[string, Mission, () => boolean]> = [
    ['human intervention', intervention, () => false],
    ['rebase conflict', reviewing(), () => true],
  ];
  for (const [name, mission, rebase] of cases) {
    const { actions, calls } = scripted(['tests'], () => passed, rebase);
    const { run } = loop(actions, mission);
    await run();
    assert.deepEqual([calls.select.length, calls.tests], [0, 0], name);
  }
  const dry = scripted(['tests'], () => passed);
  const fake = fakeReviewLoopPorts({ slug: SLUG, missionStore: storeFor(reviewing()), policyActions: dry.actions,
    state: new ReviewState(SLUG, { reviewer: 'claude', implementer: 'codex' }) });
  await runReviewLoop({ slug: SLUG, implementer: 'codex', reviewer: 'claude', actionLimit: 40, dryRun: true,
    skipReviewPreparation: true }, fake.ports);
  assert.deepEqual([dry.calls.select.length, dry.calls.tests], [0, 0], 'dry-run');
});

test('every non-pass tests exit returns to a typed human handoff, never a silent stop (TASK-2859.19)', async () => {
  const handoffs: Array<[PolicyTestsOutcome, string | null]> = [
    [{ kind: 'completed', verdict: 'cancelled' }, 'TESTS_ACTION_CANCELLED'],
    [{ kind: 'human-handoff', reason: 'interrupted', detail: 'killed' }, 'TESTS_ACTION_INTERRUPTED'],
    [{ kind: 'human-handoff', reason: 'gate-evidence-unavailable', detail: 'no run' }, 'TESTS_ACTION_GATE_EVIDENCE_UNAVAILABLE'],
    [{ kind: 'human-handoff', reason: 'rebase-dead-end', detail: 'conflict' }, 'TESTS_ACTION_REBASE_DEAD_END'],
    [{ kind: 'human-handoff', reason: 'concurrent-entry', detail: 'running in process 4242' }, null],
  ];
  for (const [outcome, escalation] of handoffs) {
    const { actions, calls } = scripted(['tests'], () => outcome);
    const { fake, run } = loop(actions);
    await run();
    assert.equal(calls.tests, 1);
    assert.deepEqual(fake.stops, escalation ? [escalation] : [], escalation ?? 'a refused second actor is not an escalation');
    assert.equal(fake.launches.length, 0, 'no agent round runs after a handoff');
    if (outcome.kind === 'human-handoff') { assert.ok(fake.errors.includes(outcome.detail), 'the refusal names its owner'); }
  }
});

test('a restart after an interrupted tests action rederives the next action from recorded history (TASK-2859.19)', async () => {
  const interrupted = scripted(['tests'], () => ({ kind: 'human-handoff', reason: 'interrupted', detail: 'killed mid-run' }));
  const first = loop(interrupted.actions);
  await first.run();
  assert.deepEqual(first.fake.stops, ['TESTS_ACTION_INTERRUPTED']);
  // A new process holds no memory of the first: the recorded history alone decides.
  const resumed = scripted(['tests', 'agent'], () => passed);
  const second = loop(resumed.actions);
  await second.run();
  assert.equal(resumed.calls.tests, 1);
  assert.equal(second.fake.current()?.phase, 'approved');
  assert.deepEqual(second.fake.launches.map(launch => launch.role), ['reviewer']);
});

test('a pending human change request is routed before any policy action and is not consumed by it (TASK-2859.19)', async () => {
  const feedback = { source: 'review-1', author: 'operator', state: 'current' as const, disposition: 'REQUEST_CHANGES' as const,
    approval: false, reason: 'fix it', reviewId: '1', findings: [] };
  let reads = 0;
  const { actions, calls } = scripted(['tests'], () => passed);
  const { fake, run } = loop(actions, reviewing(), 3, false, { reconcile: async () => { reads += 1; return feedback; } });
  await run();
  assert.deepEqual([calls.select.length, calls.tests], [0, 0], 'the policy made no decision while a human correction was pending');
  assert.equal(reads, 1, 'the policy step read the feedback once and handed it to the round instead of consuming it');
  assert.ok(fake.errors.some(line => line.includes('Operator correction')), 'the round itself handled the pending correction');
  assert.equal(fake.launches.length, 0, 'no reviewer ran ahead of the correction');
});

test('the tests action re-asks the policy on the rebased head (TASK-2859.19)', async () => {
  const { actions, calls } = scripted(['tests', 'agent'], () => passed);
  const { run } = loop(actions);
  await run();
  assert.ok(calls.reselect);
  const before = calls.select.length;
  assert.equal(await calls.reselect('rebased-head'), false, 'the scripted policy now recommends the agent');
  assert.deepEqual(calls.select[before], { missionId: SLUG, revision: 'rebased-head' });
});

test('a rebase that changes the recommendation sends the round back to the policy before any reviewer launches (TASK-2859.19)', async () => {
  const { actions, calls } = scripted(['agent', 'tests', 'tests', 'agent'], () => passed);
  const { fake, run } = loop(actions);
  await run();
  assert.equal(calls.tests, 1, 'the tests the rebased head calls for ran first');
  assert.deepEqual(fake.launches.map(launch => launch.role), ['reviewer'], 'one reviewer launched, after the tests');
  assert.equal(fake.current()?.phase, 'approved');
  const flapping = scripted(['agent', 'tests'], () => ({ kind: 'not-selected' }));
  const bounded = loop(flapping.actions, reviewing(), 5);
  await bounded.run();
  assert.ok(flapping.calls.select.length < 40, 'a recommendation that keeps flipping still reaches the lifetime action limit');
});

test('post-setup selection cannot replan after the fixed-sequence decision closes (TASK-2859.20 review)', async () => {
  const completed = fixtureMission(SLUG, { status: 'done', assignee: agentFamily('codex'), review: repeatReview() });
  let missionReads = 0;
  const policy = scripted(['tests'], () => passed);
  const fake = fakeReviewLoopPorts({
    slug: SLUG,
    missionStore: { load: async () => ({ kind: 'found' as const,
      mission: missionReads++ === 0 ? reviewing() : completed, version: missionVersion(1) }) } as never,
    state: new ReviewState(SLUG, { reviewer: 'claude', implementer: 'codex' }),
    policyActions: policy.actions,
  });

  await runReviewLoop({ slug: SLUG, implementer: 'codex', reviewer: 'claude', actionLimit: 1,
    skipReviewPreparation: true }, fake.ports);

  assert.equal(policy.calls.select.length, 0,
    'both selectors defer to the closed fixed-sequence decision instead of entering an uncounted replan loop');
  assert.deepEqual(fake.stops, ['action limit 1 reached'], 'the next review-step action remains the termination owner');
  assert.deepEqual(fake.launches, [], 'the boundary action is recorded without launching its mechanism');
});

test('a direct operator command overrides the policy and runs no policy-selected tests (TASK-2859.19)', async () => {
  const { actions, calls } = scripted(['tests'], () => passed);
  const { fake, run } = loop(actions, reviewing(), 3, true);
  await run();
  assert.deepEqual([calls.select.length, calls.tests], [0, 0], 'the operator asked for the review, not the policy action');
  assert.deepEqual(fake.launches.map(launch => launch.role), ['reviewer']);
});

test('a transient selection failure survives later successful re-selections until an action start records it (TASK-2859.19 F11)', async () => {
  const failure = { kind: 'policy-exception' as const, message: 'selection blew up' };
  const answers = [{ action: null, failure }, { action: null, failure: null }, { action: null, failure: null }];
  const observed: Array<{ actualAction: string; selectionFailure?: unknown }> = [];
  const actions: PolicyActionPort = { ...scripted([null], () => passed).actions,
    select: async () => answers.length > 1 ? answers.shift()! : answers[0]! };
  const fake = fakeReviewLoopPorts({
    slug: SLUG, missionStore: storeFor(reviewing()), state: new ReviewState(SLUG, { reviewer: 'claude', implementer: 'codex' }),
    policyActions: actions, reviewStarts: { observe: async facts => { observed.push(facts); } },
    agents: { launch: async launch => { await launch.onStarted?.({ agent: launch.agent, runId: 'run-1' }); return { agent: launch.agent, result: { status: 0 } }; } },
    artifacts: { consumeReviewer: async () => ({ consumed: true, ok: true as const, reviewState: 'APPROVED' }) },
  });
  await runReviewLoop({ slug: SLUG, implementer: 'codex', reviewer: 'claude', actionLimit: 40, skipReviewPreparation: true }, fake.ports);
  assert.equal(observed[0]?.actualAction, 'agent');
  assert.deepEqual(observed[0]?.selectionFailure, failure, 'the post-setup selection did not clear the earlier failure');
  assert.equal(observed[1]?.selectionFailure ?? null, null, 'it is carried once, to the next start only');
});

test('a failed selection followed by a replan to tests is not recorded against the policy-selected tests nor leaked to a later start (TASK-2859.19 F15)', async () => {
  const failure = { kind: 'policy-exception' as const, message: 'selection blew up' };
  const answers = [{ action: null, failure }, { action: 'tests' as const, failure: null }, { action: 'tests' as const, failure: null },
    { action: null, failure: null }];
  const observed: Array<{ selectionFailure?: unknown }> = [];
  const base = scripted([null], () => passed);
  const actions: PolicyActionPort = { ...base.actions, select: async () => answers.length > 1 ? answers.shift()! : answers[0]! };
  const fake = fakeReviewLoopPorts({
    slug: SLUG, missionStore: storeFor(reviewing()), state: new ReviewState(SLUG, { reviewer: 'claude', implementer: 'codex' }),
    policyActions: actions, reviewStarts: { observe: async facts => { observed.push(facts); } },
    agents: { launch: async launch => { await launch.onStarted?.({ agent: launch.agent, runId: 'run-1' }); return { agent: launch.agent, result: { status: 0 } }; } },
    artifacts: { consumeReviewer: async () => ({ consumed: true, ok: true as const, reviewState: 'APPROVED' }) },
  });
  await runReviewLoop({ slug: SLUG, implementer: 'codex', reviewer: 'claude', actionLimit: 40, skipReviewPreparation: true }, fake.ports);
  assert.equal(base.calls.tests, 1, 'the replan ran the policy-selected tests once');
  assert.equal(observed.length > 0 && observed.every(facts => (facts.selectionFailure ?? null) === null), true,
    'no fixed action ran under the failed selection, so no start record names it');
});

test('an approved agent round returns to the policy, which dispatches the selected tests once before the human turn begins (PX-0074.01)', async () => {
  const order: string[] = [];
  const starts: Array<{ actualAction: string; gateRunId: string | null }> = [];
  const base = scripted(['agent', 'agent', 'tests', 'human'], () => passed);
  const actions: PolicyActionPort = { ...base.actions,
    runTests: async reselect => {
      order.push('tests');
      starts.push({ actualAction: 'tests', gateRunId: 'gate-1' });
      return await base.actions.runTests(reselect);
    } };
  const fake = fakeReviewLoopPorts({
    slug: SLUG, missionStore: storeFor(reviewing()), state: new ReviewState(SLUG, { reviewer: 'claude', implementer: 'codex' }),
    policyActions: actions,
    reviewStarts: { observe: async facts => { order.push(facts.actualAction); starts.push({ actualAction: facts.actualAction, gateRunId: null }); } },
    agents: { launch: async launch => { await launch.onStarted?.({ agent: launch.agent, runId: 'run-1' }); return { agent: launch.agent, result: { status: 0 } }; } },
    artifacts: { consumeReviewer: async () => ({ consumed: true, ok: true as const, reviewState: 'APPROVED' }) },
    task: { mirrorApproved: async () => { order.push('mirror-approved'); } },
  });
  await runReviewLoop({ slug: SLUG, implementer: 'codex', reviewer: 'claude', actionLimit: 4, skipReviewPreparation: true }, fake.ports);
  assert.deepEqual(order, ['agent', 'tests', 'human', 'mirror-approved'], 'the tests ran after the approval and before the human turn and the lane mirror');
  assert.equal(base.calls.tests, 1, 'the selected action is dispatched exactly once');
  assert.equal(starts.find(start => start.actualAction === 'tests')?.gateRunId, 'gate-1', 'a gate run was recorded for the tests action');
  assert.equal(fake.current()?.phase, 'approved');
  assert.equal(fake.current()?.disposition, 'APPROVED', 'the agent approval stays the only verdict; none is fabricated for the human');
});

test('after approval a completed policy action is not repeated on restart (PX-0074.01)', async () => {
  const forever = scripted(['agent', 'agent', 'tests'], () => passed);
  const bounded = loop(forever.actions, reviewing(), 4);
  await bounded.run();
  assert.equal(forever.calls.tests, 1, 'a policy that keeps choosing tests after the approval still dispatches the completed action once');
  assert.deepEqual(bounded.fake.mirrors.filter(lane => lane === 'approved'), ['approved'], 'the human turn then begins once');
  assert.equal(bounded.fake.current()?.disposition, 'APPROVED');
  // A restart over the approved round sees the recorded history, which no longer recommends tests: nothing is dispatched again.
  const restarted = scripted(['human'], () => passed);
  const approved = new ReviewState(SLUG, { reviewer: 'claude', implementer: 'codex' });
  approved.transitionTo('approved');
  approved.disposition = 'APPROVED';
  const again = fakeReviewLoopPorts({ slug: SLUG, missionStore: storeFor(reviewing()), state: approved, policyActions: restarted.actions });
  await runReviewLoop({ slug: SLUG, implementer: 'codex', reviewer: 'claude', actionLimit: 4, isContinue: true, skipReviewPreparation: true }, again.ports);
  assert.equal(restarted.calls.tests, 0, 'a completed action is not re-dispatched on restart');
  assert.equal(again.launches.length, 0, 'no second reviewer ran for the already approved round');
  assert.deepEqual(again.mirrors.filter(lane => lane === 'approved'), ['approved']);
});

test('a tests action that ends in a handoff or cancellation still begins the human turn of the approval (PX-0074.01)', async () => {
  const outcomes: PolicyTestsOutcome[] = [
    { kind: 'completed', verdict: 'cancelled' },
    { kind: 'human-handoff', reason: 'interrupted', detail: 'killed' },
    { kind: 'human-handoff', reason: 'concurrent-entry', detail: 'running in process 4242' },
  ];
  for (const outcome of outcomes) {
    const order: string[] = [];
    const base = scripted(['agent', 'agent', 'tests'], () => outcome);
    const fake = fakeReviewLoopPorts({
      slug: SLUG, missionStore: storeFor(reviewing()), state: new ReviewState(SLUG, { reviewer: 'claude', implementer: 'codex' }),
      policyActions: base.actions,
      reviewStarts: { observe: async facts => { order.push(facts.actualAction); } },
      agents: { launch: async launch => { await launch.onStarted?.({ agent: launch.agent, runId: 'run-1' }); return { agent: launch.agent, result: { status: 0 } }; } },
      artifacts: { consumeReviewer: async () => ({ consumed: true, ok: true as const, reviewState: 'APPROVED' }) },
      task: { mirrorApproved: async () => { order.push('mirror-approved'); } },
    });
    await runReviewLoop({ slug: SLUG, implementer: 'codex', reviewer: 'claude', actionLimit: 4, skipReviewPreparation: true }, fake.ports);
    assert.deepEqual(order, ['agent', 'human', 'mirror-approved'], JSON.stringify(outcome));
    assert.equal(base.calls.tests, 1);
  }
});

// Six passing orders of agent review, human review and integration tests (PX-0074.02).
//
// Each row drives one order over a real Mission store through the owners production uses, and
// asserts the current change advances exactly once.
//   starting lane  `review`, one unfinished round whose subject revision is `head-1`, opened by
//                  the domain `startReview` owner; the loop ports report the same head, so the
//                  recorded decision carries the change identity.
//   agent check    `runReviewLoop` over the production state, observation-recording and
//                  round-open adapters, which records the reviewer approval through the approve
//                  owner and moves the lane.
//   human check    the approve owner `recordApproval`, the owner `px verdict approve` reaches;
//                  its CLI wiring is proven at the integration boundary.
//   tests check    the composition dispatch owner `continueVerdictThroughActionOwner` with the
//                  action read back from the persisted mission, or the loop's policy-selected
//                  tests action when the order places tests before the approval.
//   expected lane  `integration`, reached by exactly one `review -> integration` lane event and
//                  exactly one tests action, with one human turn and no repair or re-review.
// Contract-bound collapses, argued rather than tested: once the approval stands, a later agent
// verdict launches no reviewer and a later human approve is refused (`mission is already in
// integration`); the loop never selects a tests action after the decision closed
// (`decisionIsOpen`), so a post-approval tests action only comes from the decision owner; and a
// verdict recorded inside an owned workflow operation defers its continuation
// (`wait: action-owned`), which is what lets a later check land before the dispatched tests.
type Check = 'agent' | 'human' | 'tests';
interface PassingOrder {
  readonly order: readonly Check[];
  /** Selections the loop's policy port is offered, in order. */
  readonly selections: Check[];
  /** Which owner delivers the tests check for this order. */
  readonly testsBy: 'loop' | 'owner' | 'verdict';
  /** The verdict lands inside an owned workflow operation, so its continuation defers. */
  readonly verdictOwned: boolean;
  /** The human verdict lands while the reviewer is running, so the agent verdict is late. */
  readonly verdictDuringRound: boolean;
  readonly launches: number;
  readonly inLoopTests: number;
  readonly handoffs: number;
  readonly verdict: 'recorded' | 'unchanged';
  /** Next action read from the persisted mission after each check, in order. */
  readonly offered: readonly string[];
}

const DONE = 'integration/integration-handoff:fixed-sequence-complete';
const OWED = 'review/agent-review:review-unfinished';

const PASSING_ORDERS: ReadonlyArray<PassingOrder> = [
  { order: ['agent', 'human', 'tests'], selections: ['agent', 'human'], testsBy: 'verdict', verdictOwned: false, verdictDuringRound: false, launches: 1, inLoopTests: 0, handoffs: 1, verdict: 'unchanged', offered: [DONE, DONE, DONE] },
  { order: ['agent', 'tests', 'human'], selections: ['agent', 'human'], testsBy: 'owner', verdictOwned: true, verdictDuringRound: false, launches: 1, inLoopTests: 0, handoffs: 1, verdict: 'unchanged', offered: [DONE, DONE, DONE] },
  { order: ['tests', 'agent', 'human'], selections: ['tests', 'agent'], testsBy: 'loop', verdictOwned: true, verdictDuringRound: false, launches: 1, inLoopTests: 1, handoffs: 0, verdict: 'unchanged', offered: [OWED, DONE, DONE] },
  { order: ['human', 'agent', 'tests'], selections: ['agent'], testsBy: 'owner', verdictOwned: true, verdictDuringRound: false, launches: 0, inLoopTests: 0, handoffs: 1, verdict: 'recorded', offered: [DONE, DONE, DONE] },
  { order: ['human', 'tests', 'agent'], selections: ['agent'], testsBy: 'verdict', verdictOwned: false, verdictDuringRound: false, launches: 0, inLoopTests: 0, handoffs: 1, verdict: 'recorded', offered: [DONE, DONE, DONE] },
  { order: ['tests', 'human', 'agent'], selections: ['tests', 'agent', 'human'], testsBy: 'loop', verdictOwned: true, verdictDuringRound: true, launches: 1, inLoopTests: 1, handoffs: 0, verdict: 'recorded', offered: [OWED, OWED, DONE] },
];

const ORDER_HEAD = 'head-1';
const ORDER_REVIEWER = agentFamily('claude');
const ORDER_IMPLEMENTER = agentFamily('codex');

function orderStore() {
  const review = startReview(
    { change: { kind: 'local-branch', sourceBranch: `mission/${SLUG}`, targetBranch: 'main' }, revision: changeRevision(ORDER_HEAD) },
    ORDER_REVIEWER, ORDER_IMPLEMENTER, '2026-12-01T10:00:00Z',
    ConfiguredReviewerEligibility.fromReviewStep({ eligible: [ORDER_REVIEWER], strategy: 'random' }));
  const store = inMemoryTransitionStore(fixtureMission(SLUG, { status: 'review', assignee: ORDER_IMPLEMENTER, review }));
  return { store, lifecycle: new MissionLifecycleService(store) };
}

interface OrderEffects {
  launches: number; mirrors: string[]; inLoopTests: number; handoffs: number; commands: string[]; verdicts: string[]; offered: string[];
}

function orderDispatch(effects: OrderEffects) {
  const registry: Record<string, Command> = {
    active: async () => { effects.commands.push('active'); },
    review: async () => { effects.commands.push('review'); },
  };
  return {
    rootDir: '/fixture', packageDir: '/fixture', configuration: resolveConfiguration({}),
    scope: { withMissionAndGraph: async () => { effects.handoffs += 1; } } as unknown as CliCommandContext['scope'],
    active: registry.active!, commands: () => registry,
  } satisfies CliCommandContext;
}

async function runPassingOrder(row: PassingOrder) {
  const { store, lifecycle } = orderStore();
  const effects: OrderEffects = { launches: 0, mirrors: [], inLoopTests: 0, handoffs: 0, commands: [], verdicts: [], offered: [] };
  const offered = () => {
    const mission = store.mission();
    const action = fixedVerificationNextAction({ mission });
    return `${mission.status}/${action.kind}${'reason' in action ? `:${action.reason}` : ''}`;
  };
  const base = scripted(row.selections, () => passed);
  const policy: PolicyActionPort = {
    ...base.actions,
    runTests: async reselect => { effects.inLoopTests += 1; return await base.actions.runTests(reselect); },
  };
  const verdict = async () => {
    const result = await recordApproval(SLUG, { comment: 'Human approved', decidedAt: '2026-12-01T11:00:00Z', revision: ORDER_HEAD,
      source: { kind: 'local' } }, { missionStore: store, lifecycleService: lifecycle });
    effects.verdicts.push(result.outcome);
    const action = fixedVerificationNextAction({ mission: store.mission(), ownedAction: row.verdictOwned });
    await continueVerdictThroughActionOwner(orderDispatch(effects), SLUG, action);
  };
  const loop = async (isContinue: boolean, duringRound?: () => Promise<void>) => {
    const fake = fakeReviewLoopPorts({
      slug: SLUG, missionStore: store, lifecycle, policyActions: policy,
      stateport: {
        read: () => readReviewState(SLUG, undefined, store),
        persist: async state => {
          assertReviewStatePersisted(await writeReviewState(SLUG, state, fake.ports.worktree, { missionStore: store }), { slug: SLUG, round: state.round });
        },
        ...createReviewObservationRecorder(SLUG, () => ORDER_HEAD, false, { missionStore: store, lifecycleService: lifecycle }),
        openRound: async state => (await openReviewRound(SLUG, state, {
          worktree: fake.ports.worktree, log: () => {}, error: message => { throw new Error(message); }, missionStore: store, lifecycleService: lifecycle,
        })).ok,
      },
      agents: { launch: async launch => {
        effects.launches += 1;
        if (launch.role === 'reviewer' && duringRound) { await duringRound(); }
        return { agent: launch.agent, result: { status: 0 } };
      } },
      artifacts: { consumeReviewer: async () => ({ consumed: true, ok: true as const, reviewState: 'APPROVED' }) },
      task: { mirrorApproved: async () => { effects.mirrors.push('approved'); } },
    });
    await runReviewLoop({ slug: SLUG, implementer: ORDER_IMPLEMENTER, reviewer: ORDER_REVIEWER, actionLimit: 4, skipReviewPreparation: true, isContinue }, fake.ports);
    assert.deepEqual(fake.errors, [], row.order.join('>'));
    return fake;
  };
  const dispatch = async () => {
    await continueVerdictThroughActionOwner(orderDispatch(effects), SLUG, fixedVerificationNextAction({ mission: store.mission() }));
  };

  // The order is driven literally: each check runs at its turn, and the persisted next action is
  // read back after it. A tests check that the loop's policy port or the verdict continuation
  // delivers needs no separate step; only an owned-operation dispatch does.
  const humanFirst = row.order[0] === 'human';
  for (const check of row.order) {
    if (check === 'agent') { await loop(humanFirst, row.verdictDuringRound ? verdict : undefined); }
    else if (check === 'human') { if (!row.verdictDuringRound) { await verdict(); } }
    else if (row.testsBy === 'owner') { await dispatch(); }
    effects.offered.push(offered());
  }
  return { store, effects };
}

test('each passing order of agent review, human review and integration tests advances the persisted change once (PX-0074.02)', async t => {
  configureMissionWriteAuthorization({ operationId: 'px-0074.02-matrix', generation: 1, assert: async () => {} });
  t.after(() => configureMissionWriteAuthorization(null));
  for (const row of PASSING_ORDERS) {
    const label = row.order.join('>');
    const { store, effects } = await runPassingOrder(row);
    const mission = store.mission();
    const round = currentReviewRound(mission.review!);
    assert.deepEqual(store.events.map(event => [event.from, event.to]), [['review', 'integration']],
      `${label}: the current change advances exactly once`);
    assert.equal(mission.status, 'integration', `${label}: the lane after the order`);
    assert.equal(mission.review!.rounds.length, 1, `${label}: no second round is opened`);
    assert.equal(round.decision?.kind, 'approved', `${label}: one approved decision`);
    assert.equal(round.decision?.revision, ORDER_HEAD, `${label}: the decision names the judged change revision`);
    assert.equal(effects.launches, row.launches, `${label}: the reviewer is owed only while the round is undecided`);
    assert.deepEqual([effects.inLoopTests, effects.handoffs], [row.inLoopTests, row.handoffs], `${label}: the tests check arrives once, from ${row.testsBy}`);
    assert.deepEqual(effects.verdicts, [row.verdict], `${label}: the human verdict advances the change only while the round still awaits it`);
    assert.deepEqual(effects.mirrors, ['approved'], `${label}: the approval reaches one human turn`);
    assert.deepEqual(effects.commands, [], `${label}: no repair or re-review is dispatched`);
    assert.deepEqual(effects.offered, [...row.offered],
      `${label}: each check leaves the persisted mission offering one next action, and once the approval stands it is the same automatic work, never a second agent review or a human-review wait`);
  }
});

// Negative verdicts, repair ownership, resumption and interruption (PX-0074.03).

type Verdict = 'APPROVED' | 'REQUEST_CHANGES';

/** A loop whose reviewer verdicts are scripted per launch and whose implementer commits a new head on every launch. */
function repairing(verdicts: Verdict[], base: ReturnType<typeof scripted>, extra: Parameters<typeof fakeReviewLoopPorts>[0] = {}) {
  let head = 1;
  const resolutions: string[] = [];
  const fake = fakeReviewLoopPorts({
    slug: SLUG, missionStore: storeFor(reviewing()), state: new ReviewState(SLUG, { reviewer: 'claude', implementer: 'codex' }),
    policyActions: base.actions,
    agents: { launch: async launch => {
      if (launch.role === 'implementer') { head += 1; resolutions.push(`implementer@head-${head}`); }
      await launch.onStarted?.({ agent: launch.agent, runId: `run-${resolutions.length}` });
      return { agent: launch.agent, result: { status: 0 } };
    } },
    artifacts: {
      consumeReviewer: async () => ({ consumed: true, ok: true as const, reviewState: verdicts.length > 1 ? verdicts.shift()! : verdicts[0]!,
        reviewFindings: [{ id: 'F1', summary: 'fix it' }] }),
      consumeImplementer: async () => ({ consumed: true, ok: true as const, disposition: 'CHANGES_MADE' }),
    },
    preReview: { head: () => `head-${head}` },
    ...extra,
  });
  const run = (actionLimit = 40, operatorInvocation = false) => runReviewLoop({ slug: SLUG, implementer: 'codex', reviewer: 'claude',
    actionLimit, skipReviewPreparation: true, operatorInvocation }, fake.ports);
  return { fake, run, resolutions };
}

/** An active Mission whose current round durably records a changes-requested decision awaiting repair. */
function changesRecordedMission(state: ReviewState, finding: { id: string; summary: string }): Mission {
  const review = repeatReview();
  const round = review.rounds[1]!;
  return fixtureMission(SLUG, { status: 'active', assignee: agentFamily('codex'), review: { ...review, rounds: [{ ...round, number: 1,
    startedAt: state.startedAt, phase: 'fixing' as const,
    decision: { kind: 'changes-requested' as const, revision: round.subject.revision, decidedAt: '2026-10-01T00:04:00Z', comment: 'fix it',
      findings: [{ ...finding, id: finding.id as never, location: null }] } }] } });
}

test('agent changes requested dispatches the implementer repair, records it and returns control to the decision owner (PX-0074.03)', async () => {
  const base = scripted(['agent'], () => passed);
  const { fake, run, resolutions } = repairing(['REQUEST_CHANGES', 'APPROVED'], base);
  await run();
  assert.deepEqual(fake.launches.map(launch => launch.role), ['reviewer', 'implementer', 'reviewer'], 'review, repair, then the re-review the decision owner chose');
  assert.deepEqual(resolutions, ['implementer@head-2']);
  const phases = fake.writes.map(write => `${String(write.round)}:${String(write.phase)}`);
  assert.ok(phases.includes('1:fixing'), 'the negative verdict is durable before the repair launches');
  assert.ok(phases.indexOf('1:fixing') < phases.findIndex(phase => phase.startsWith('2:')), 'the repair is recorded before round 2 opens');
  assert.deepEqual([fake.current()?.round, fake.current()?.phase, fake.current()?.disposition], [2, 'approved', 'APPROVED']);
  assert.ok(base.calls.select.length >= 2, 'the decision owner is consulted again after the repair');
  assert.deepEqual(base.calls.select.at(-1), { missionId: SLUG, revision: 'head-2' }, 'on the repaired revision');
  assert.deepEqual(fake.mirrors.filter(lane => lane === 'active'), ['active'], 'the lane moved to the implementer once');
});

test('human changes requested records the operator correction, repairs before any reviewer and returns to the decision owner (PX-0074.03)', async () => {
  const state = new ReviewState(SLUG, { reviewer: 'claude', implementer: 'codex' });
  const finding = { id: 'F1', summary: 'fix it' };
  const base = changesRecordedMission(state, finding);
  const events: string[] = [];
  let pending = true;
  const feedback = { source: 'review-1', author: 'operator', state: 'current' as const, disposition: 'REQUEST_CHANGES' as const,
    approval: false, reason: 'fix it', reviewId: '1', findings: [finding as never] };
  const policy = scripted(['agent'], () => passed);
  let head = 1;
  const fake = fakeReviewLoopPorts({
    slug: SLUG, missionStore: storeFor(base), state, policyActions: policy.actions,
    humanFeedback: { reconcile: async () => pending ? feedback : null, acknowledge: async () => { pending = false; events.push('acknowledge'); } },
    stateport: { recordRequestedChanges: async (_state, decision) => { events.push(`record:${decision.source?.kind}`); return 'recorded'; } },
    agents: { launch: async launch => { events.push(launch.role); if (launch.role === 'implementer') { head += 1; } return { agent: launch.agent, result: { status: 0 } }; } },
    artifacts: { consumeReviewer: async () => ({ consumed: true, ok: true as const, reviewState: 'APPROVED' }),
      consumeImplementer: async () => ({ consumed: true, ok: true as const, disposition: 'CHANGES_MADE' }) },
    preReview: { head: () => `head-${head}` },
  });
  await runReviewLoop({ slug: SLUG, implementer: 'codex', reviewer: 'claude', actionLimit: 4, skipReviewPreparation: true }, fake.ports);
  assert.deepEqual(events.slice(0, 3), ['record:operator', 'acknowledge', 'implementer'], 'the correction is durable and acknowledged before the repair launches');
  assert.equal(events.filter(event => event === 'implementer').length, 1, 'the repair is dispatched once');
  assert.equal(events.indexOf('reviewer') > events.indexOf('implementer'), true, 'no reviewer ran ahead of the correction');
  assert.equal(fake.current()?.disposition, 'APPROVED', 'the decision owner then re-reviewed the repaired change');
  assert.deepEqual(fake.errors, []);
});

test('a failed integration-test check is dispatched once by the loop and returns to the decision owner (PX-0074.03)', async () => {
  const base = scripted(['tests', 'agent'], () => ({ kind: 'completed', verdict: 'failed' }), () => false);
  const { fake, run } = repairing(['APPROVED'], base);
  await run(5);
  // The repair itself belongs to the tests action owner (the rebound kernel behind runTests); its own
  // contract is asserted in test/unit/application/integrate/integration-dry-run-gate-contract.test.ts
  // and rehearsed end to end by test/fixtures/changed-repair-continuation-manual.ts --policy-tests-repair.
  assert.equal(base.calls.tests, 1, 'the failed check was dispatched once and the loop never re-ran it');
  assert.ok(base.calls.select.length >= 2, 'the decision owner is consulted again once the check owner returns');
  assert.deepEqual(fake.launches.map(launch => launch.role), ['reviewer'], 'control returned to the decision owner, which chose the agent review');
  assert.equal(fake.current()?.phase, 'approved');
  assert.deepEqual(fake.stops, [], 'a repaired check is not a handoff');
});

test('a failed check whose repair cannot finish stops on a typed handoff and dispatches no reviewer (PX-0074.03)', async () => {
  const base = scripted(['tests'], () => ({ kind: 'human-handoff', reason: 'rebase-dead-end', detail: 'repair needs a human' }));
  const { fake, run } = repairing(['APPROVED'], base);
  await run(5);
  assert.deepEqual(fake.stops, ['TESTS_ACTION_REBASE_DEAD_END']);
  assert.equal(fake.launches.length, 0);
  assert.equal(base.calls.tests, 1, 'the loop does not retry a check that went to a human');
});

test('a repeated approval delivery is ignored and never begins a second human turn (PX-0074.03)', async () => {
  const starts: string[] = [];
  const base = scripted(['agent'], () => passed);
  const { fake, run } = repairing(['APPROVED'], base, {
    stateport: { recordApproval: async () => 'ignored' },
    reviewStarts: { observe: async facts => { starts.push(facts.actualAction); } },
  });
  await run(3);
  assert.deepEqual(fake.stops, ['REVIEWER_NON_APPROVAL'], 'an ignored verdict ends in a typed stop, not a silent one');
  assert.deepEqual(fake.mirrors.filter(lane => lane === 'approved'), [], 'no approved lane for an ignored delivery');
  assert.equal(starts.includes('human'), false, 'no human turn began');
  assert.ok(fake.launches.length <= 1 + 3, 'recovery relaunches stay bounded');
});

test('an approval recorded for another round is stale and never reaches the human turn (PX-0074.03)', async () => {
  const state = new ReviewState(SLUG, { reviewer: 'claude', implementer: 'codex' });
  state.advanceRound();
  const stale = ReviewState.from(SLUG, { ...state, round: state.round - 1, phase: 'approved', disposition: 'APPROVED' } as ReviewState);
  const base = scripted(['agent'], () => passed);
  let launched = () => false;
  const fake = fakeReviewLoopPorts({
    slug: SLUG, missionStore: storeFor(reviewing()), state, policyActions: base.actions,
    stateport: { read: async () => launched() ? stale : state },
    artifacts: { consumeReviewer: async () => ({ consumed: true, ok: true as const, reviewState: 'REQUEST_CHANGES' }),
      consumeImplementer: async () => ({ consumed: true, ok: true as const, disposition: 'PUSHBACK_ALL' }) },
  });
  launched = () => fake.launches.length > 0;
  await runReviewLoop({ slug: SLUG, implementer: 'codex', reviewer: 'claude', actionLimit: 2, skipReviewPreparation: true }, fake.ports);
  assert.deepEqual(fake.mirrors.filter(lane => lane === 'approved'), [], 'a previous round approval is not this round outcome');
  assert.ok(fake.launches.some(launch => launch.role === 'reviewer'), 'the current round still ran its own reviewer');
});

test('a rebase that moves the head re-evaluates the decision on the new identity, while an unchanged head keeps the existing pass (PX-0074.03)', async () => {
  const rebased = { head: 'head-1' };
  const byRevision = (changed: string) => {
    const calls = { select: [] as string[], tests: 0 };
    const actions: PolicyActionPort = { select: async facts => { calls.select.push(facts.revision);
      return { action: facts.revision === changed && calls.tests === 0 ? 'tests' : 'agent', failure: null }; },
    runTests: async () => { calls.tests += 1; rebased.head = 'head-2'; return passed; }, rebaseInProgress: () => false };
    return { actions, calls };
  };
  rebased.head = 'head-1';
  const moved = byRevision('head-2');
  const changed = fakeReviewLoopPorts({ slug: SLUG, missionStore: storeFor(reviewing()), policyActions: moved.actions,
    state: new ReviewState(SLUG, { reviewer: 'claude', implementer: 'codex' }),
    preReview: { head: () => rebased.head, rebase: async () => { rebased.head = 'head-2'; return { ok: true as const }; } },
    artifacts: { consumeReviewer: async () => ({ consumed: true, ok: true as const, reviewState: 'APPROVED' }) } });
  await runReviewLoop({ slug: SLUG, implementer: 'codex', reviewer: 'claude', actionLimit: 4, skipReviewPreparation: true }, changed.ports);
  assert.ok(moved.calls.select.includes('head-2'), 'the rebased change identity was evaluated');
  assert.equal(moved.calls.tests, 1, 'the new identity owed the tests check, which ran before any reviewer launched');
  assert.equal(changed.launches[0]?.role, 'reviewer');
  const order = moved.calls.select;
  assert.ok(order.indexOf('head-2') > order.indexOf('head-1'), 'the decision was first made on the old identity');

  rebased.head = 'head-1';
  const same = byRevision('never');
  const unchanged = fakeReviewLoopPorts({ slug: SLUG, missionStore: storeFor(reviewing()), policyActions: same.actions,
    state: new ReviewState(SLUG, { reviewer: 'claude', implementer: 'codex' }),
    preReview: { head: () => rebased.head, rebase: async () => ({ ok: true as const }) },
    artifacts: { consumeReviewer: async () => ({ consumed: true, ok: true as const, reviewState: 'APPROVED' }) } });
  await runReviewLoop({ slug: SLUG, implementer: 'codex', reviewer: 'claude', actionLimit: 4, skipReviewPreparation: true }, unchanged.ports);
  assert.equal(same.calls.tests, 0, 'a same-identity rebase dispatches nothing new');
  assert.deepEqual(unchanged.launches.map(launch => launch.role), ['reviewer'], 'the existing pass stands: one review, no replan');
  assert.deepEqual(unchanged.mirrors.filter(lane => lane === 'approved'), ['approved']);
});

const parsedPolicy = parsePolicyArtifact(syntheticPolicyArtifactV2());
if (!parsedPolicy.ok) { throw new Error(parsedPolicy.rejection.message); }
// Narrowed here, at module scope: a hoisted function body never inherits the
// guard's narrowing, so the factory below reads this already-parsed artifact.
const parsedPolicyArtifact = parsedPolicy.artifact;

function realPolicyPorts(overrides: Partial<ReviewStartPolicyPorts> = {}) {
  const records: ReviewStartDecisionInput[] = [];
  const ports: ReviewStartPolicyPorts = {
    configuration: { mode: 'pilot', artifact: 'policy.json' }, repositoryId: repositoryId('repository-1'), targetBranch: 'main',
    operationId: 'operation-1', loadPolicy: () => ({ mode: 'shadow', hash: 'pinned-hash', artifact: parsedPolicyArtifact }),
    readHistory: async () => ({ ok: true, entries: [], record: { passed: [], failed: [] }, tests: 'unobserved' }),
    identity: { branchHead: () => 'head-1', changeIdentity: () => 'patch-1', onlyBookkeepingSince: () => false },
    writer: { recordReviewStartDecision: async input => { records.push(input); return true; },
      resolveReviewEntryPin: async input => input.configuredMode === 'pilot' ? reviewEntryPin(input) : null,
      settleReviewStartOutcomes: async () => 0 },
    readOutcomeFacts: async () => ({ review: null, runs: [] }),
    diagnostic: () => {}, ...overrides,
  };
  return { ports, records };
}

/** The real selector and start recorder drive the real loop; only the mechanisms are fakes. */
async function runWithRealPolicy(policy: ReturnType<typeof realPolicyPorts>, operatorInvocation: boolean) {
  const actions: PolicyActionPort = { select: facts => selectPolicyAction(facts, policy.ports),
    runTests: async () => ({ kind: 'not-selected' }), rebaseInProgress: () => false };
  const fake = fakeReviewLoopPorts({ slug: SLUG, missionStore: storeFor(reviewing()), policyActions: actions,
    state: new ReviewState(SLUG, { reviewer: 'claude', implementer: 'codex' }),
    reviewStarts: { observe: async facts => { await observePolicyReviewStart(facts, policy.ports); } },
    agents: { launch: async launch => { await launch.onStarted?.({ agent: launch.agent, runId: 'run-1' }); return { agent: launch.agent, result: { status: 0 } }; } },
    artifacts: { consumeReviewer: async () => ({ consumed: true, ok: true as const, reviewState: 'APPROVED' }) } });
  await runReviewLoop({ slug: SLUG, implementer: 'codex', reviewer: 'claude', actionLimit: 3, skipReviewPreparation: true, operatorInvocation }, fake.ports);
  return fake;
}

test('policy fallbacks are recorded with their typed reason and the fixed sequence still completes (PX-0074.03)', async () => {
  const cases: Array<[string, Partial<ReviewStartPolicyPorts>]> = [
    ['mode-changed-in-flight', { writer: { recordReviewStartDecision: async () => true, resolveReviewEntryPin: async () => null, settleReviewStartOutcomes: async () => 0 } }],
    ['artifact-missing', { loadPolicy: () => ({ mode: 'fixed', reason: 'missing' }) }],
    ['history-unavailable', { readHistory: async () => ({ ok: false, failure: { kind: 'unavailable', message: 'gone' } }) }],
  ];
  for (const [kind, overrides] of cases) {
    const policy = realPolicyPorts(overrides);
    const records = policy.records;
    const fake = await runWithRealPolicy({ ...policy, ports: { ...policy.ports, writer: { ...policy.ports.writer,
      recordReviewStartDecision: async input => { records.push(input); return true; } } } }, false);
    assert.equal(fake.current()?.phase, 'approved', `${kind}: the fixed sequence ran to approval`);
    assert.deepEqual(fake.launches.map(launch => launch.role), ['reviewer'], kind);
    const agentStart = records.find(record => record.actualAction === 'agent');
    assert.equal(agentStart?.effectiveMode, 'fixed', kind);
    assert.equal(agentStart?.failureReason?.kind, kind);
    assert.equal(agentStart?.recommendedAction, null);
    assert.equal(records.find(record => record.actualAction === 'human')?.failureReason?.kind, kind, `${kind}: the human turn carries it too`);
  }
});

test('an explicit operator override of the recommendation is recorded and the requested action runs (PX-0074.03)', async () => {
  const shadow = realPolicyPorts({ configuration: { mode: 'shadow', artifact: 'policy.json' } });
  const overridden = await (async () => {
    const fake = fakeReviewLoopPorts({ slug: SLUG, missionStore: storeFor(reviewing()),
      state: new ReviewState(SLUG, { reviewer: 'claude', implementer: 'codex' }),
      reviewStarts: { observe: async facts => { await observePolicyReviewStart(facts, shadow.ports); } },
      agents: { launch: async launch => { await launch.onStarted?.({ agent: launch.agent, runId: 'run-1' }); return { agent: launch.agent, result: { status: 0 } }; } },
      artifacts: { consumeReviewer: async () => ({ consumed: true, ok: true as const, reviewState: 'APPROVED' }) } });
    await runReviewLoop({ slug: SLUG, implementer: 'codex', reviewer: 'claude', actionLimit: 3, skipReviewPreparation: true, operatorInvocation: true }, fake.ports);
    return fake;
  })();
  const agentRow = shadow.records.find(record => record.actualAction === 'agent');
  assert.equal(agentRow?.recommendedAction, 'tests', 'the policy recommended another check');
  assert.equal(agentRow?.operatorOverride, true, 'the operator asked for the agent review instead');
  assert.deepEqual(overridden.launches.map(launch => launch.role), ['reviewer'], 'the requested action ran');
  assert.equal(overridden.current()?.phase, 'approved');
});

test('negative verdicts that never clear stop at the lifetime action limit (PX-0074.03)', async () => {
  const base = scripted(['agent'], () => passed);
  const { fake, run } = repairing(['REQUEST_CHANGES'], base);
  await run(5);
  assert.deepEqual(fake.stops, ['action limit 5 reached']);
  assert.equal(fake.current()?.metadata.humanEscalationReason, 'action limit 5 reached');
  assert.equal(fake.launches.filter(launch => launch.role === 'reviewer').length, 2);
  assert.equal(fake.launches.filter(launch => launch.role === 'implementer').length, 2);
  assert.deepEqual(fake.mirrors.filter(lane => lane === 'approved'), []);
});

test('blocked, parked and no-change implementer exits stay explicit typed stops with the round durable (PX-0074.03)', async () => {
  const outcomes: Array<[string, { disposition: string; changed: boolean }, string]> = [
    ['blocked', { disposition: 'BLOCKED', changed: false }, 'implementer reported BLOCKED'],
    ['parked', { disposition: 'PARKED', changed: false }, 'implementer reported PARKED'],
    ['no change', { disposition: 'CHANGES_MADE', changed: false }, 'implementer reported CHANGES_MADE with no new revision'],
  ];
  for (const [name, outcome, stop] of outcomes) {
    const base = scripted(['agent'], () => passed);
    const { fake, run } = repairing(['REQUEST_CHANGES'], base, {
      artifacts: { consumeReviewer: async () => ({ consumed: true, ok: true as const, reviewState: 'REQUEST_CHANGES' }),
        consumeImplementer: async () => ({ consumed: true, ok: true as const, disposition: outcome.disposition }) },
      ...(outcome.changed ? {} : { preReview: { head: () => 'head-1' } }),
    });
    await run(4);
    assert.deepEqual(fake.stops, [stop], name);
    assert.equal(fake.launches.filter(launch => launch.role === 'reviewer').length, 1, `${name}: no second review after the stop`);
    assert.equal(fake.current()?.phase, 'fixing', `${name}: the unrepaired round stays durable for a restart`);
  }
});

test('an implementer launch that throws is a typed stop and leaves the repair resumable (PX-0074.03)', async () => {
  const base = scripted(['agent'], () => passed);
  const { fake, run } = repairing(['REQUEST_CHANGES'], base, {
    agents: { launch: async launch => { if (launch.role === 'implementer') { throw new Error('launcher interrupted'); } return { agent: launch.agent, result: { status: 0 } }; } },
  });
  await run(4);
  assert.deepEqual(fake.exits, [1]);
  assert.equal(fake.launches.filter(launch => launch.role === 'implementer').length, 1, 'the interrupted repair is not retried in-process');
  assert.equal(fake.current()?.phase, 'fixing');
});

test('a restart on a round recorded as fixing repairs once and never re-runs the recorded review (PX-0074.03)', async () => {
  const fixing = new ReviewState(SLUG, { reviewer: 'claude', implementer: 'codex' });
  fixing.transitionTo('fixing');
  fixing.disposition = 'REQUEST_CHANGES';
  let head = 1;
  const base = scripted(['agent'], () => passed);
  const fake = fakeReviewLoopPorts({ slug: SLUG, missionStore: storeFor(changesRecordedMission(fixing, { id: 'F1', summary: 'fix it' })), policyActions: base.actions, state: fixing,
    agents: { launch: async launch => { if (launch.role === 'implementer') { head += 1; } return { agent: launch.agent, result: { status: 0 } }; } },
    artifacts: { consumeReviewer: async () => ({ consumed: true, ok: true as const, reviewState: 'APPROVED' }),
      consumeImplementer: async () => ({ consumed: true, ok: true as const, disposition: 'CHANGES_MADE' }) },
    preReview: { head: () => `head-${head}` } });
  await runReviewLoop({ slug: SLUG, implementer: 'codex', reviewer: 'claude', actionLimit: 4, isContinue: true, skipReviewPreparation: true }, fake.ports);
  assert.deepEqual(fake.launches.map(launch => launch.role), ['implementer', 'reviewer'], 'the recorded negative verdict is repaired, not re-reviewed');
});

test('a recorded human-intervention blocker stops the entry with no decision, launch or action (PX-0074.03)', async () => {
  const intervention = fixtureMission(SLUG, { status: 'review', assignee: agentFamily('codex'), review: { ...repeatReview(),
    intervention: { requestedAt: '2026-11-19T10:00:00Z', requestedBy: 'reviewer', reason: 'needs a human' } } });
  const base = scripted(['tests'], () => passed);
  const { fake, run } = repairing(['APPROVED'], base, { missionStore: storeFor(intervention) });
  await run(4);
  assert.deepEqual(fake.exits, [1]);
  assert.ok(fake.errors.some(line => line.includes('requires human intervention')), 'the stop is named');
  assert.deepEqual([base.calls.select.length, base.calls.tests, fake.launches.length], [0, 0, 0]);
});

test('a check that fails after the agent approval is repaired once, then the approval reaches its human turn exactly once (PX-0074.03)', async () => {
  const order: string[] = [];
  const base = scripted(['agent', 'agent', 'tests', 'human'], () => ({ kind: 'completed', verdict: 'failed' }), () => false);
  const { fake, run } = repairing(['APPROVED'], base, {
    reviewStarts: { observe: async facts => { order.push(facts.actualAction); } },
    task: { mirrorApproved: async () => { order.push('mirror-approved'); } },
  });
  await run(4);
  assert.equal(base.calls.tests, 1, 'the failed check was dispatched once');
  assert.deepEqual(order.filter(entry => entry === 'agent'), ['agent'], 'the repair did not re-dispatch the agent review');
  assert.deepEqual(order.filter(entry => entry === 'human'), ['human'], 'one human turn');
  assert.deepEqual(order.filter(entry => entry === 'mirror-approved'), ['mirror-approved']);
  assert.deepEqual(fake.launches.map(launch => launch.role), ['reviewer']);
});
