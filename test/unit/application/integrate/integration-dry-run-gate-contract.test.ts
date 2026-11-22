import assert from 'node:assert/strict';
import test from 'node:test';
import { createIntegrationGateStep, type GateStepRequest } from '../../../../src/application/integrate/gates.js';
import { runReviewStepTestsEntry } from '../../../../src/application/integrate-entry.js';
import { setLogger } from '../../../../src/application/presentation/cli-format.js';
import { createTestsActionExecutor } from '../../../../src/application/integrate/tests-action.js';
import type { IntegrateWorkflowPorts, IntegrationGateFailureRequest, IntegrationGateRunResult } from '../../../../src/application/ports/integrate-workflow.js';
import type { ReviewStartPolicyPorts } from '../../../../src/application/ports/verification-policy.js';
import { reviewEntryPin, selectPolicyAction } from '../../../../src/application/verification-policy/review-start-decision.js';
import { parsePolicyArtifact } from '../../../../src/application/verification-policy/policy-artifact.js';
import { verificationHistoryRecord, type VerificationHistoryEntry } from '../../../../src/application/verification-policy/belief.js';
import { missionVersion } from '../../../../src/application/domain-ports.js';
import { missionId, type Mission } from '../../../../src/domain/mission.js';
import { repositoryId } from '../../../../src/domain/repository.js';
import { integrationContext } from '../../../fixtures/integration-context.js';
import { missionExecutionContext } from '../../../fixtures/mission-execution-context.js';
import { approvedReview, fixtureMission, pendingReview } from '../../../fixtures/mission-builders.js';
import { integrationServices } from '../../../helpers/stub-integration-services.js';
import { stubIntegrateWorkflowPorts } from '../../../helpers/stub-integrate-workflow-ports.js';
import { syntheticPolicyArtifactV2 } from '../verification-policy/policy-artifact.fixture.js';

const gates = [
  { key: 'unit', command: 'npm test -- --unit', order: 0 },
  { key: 'types', command: 'npm run typecheck', order: 1 },
];

function receipt(overrides: Partial<IntegrationGateRunResult> = {}): IntegrationGateRunResult {
  return {
    ok: true,
    phase: 'integration',
    gates,
    executed: gates.length,
    skipped: false,
    dryRun: false,
    cancelled: false,
    failedGate: null,
    outcomes: gates.map(gate => ({ ...gate, exitCode: 0, stdout: '', stderr: '' })),
    proofReusable: true,
    error: null,
    ...overrides,
  };
}

async function fixture(result: IntegrationGateRunResult, configured = gates) {
  let repairRoutes = 0;
  const repairRequests: IntegrationGateFailureRequest[] = [];
  let runnerDryRun: boolean | undefined;
  let targetBranch: string | undefined;
  const unsuccessful: unknown[] = [];
  const services = integrationServices({ operationalHistory: {
    loadLatestByTypeForMission: async () => null,
    recordIntegrationValidation: async input => { unsuccessful.push(input); },
  } });
  const missionLoad = await services.store.load(missionId('px-dry-run'));
  const step = createIntegrationGateStep(stubIntegrateWorkflowPorts({
    gates: {
      resolveIntegrationVerificationWorktree: () => '/fixture/mission',
      captureFinalIntegrationTree: () => ({ ok: true, rootDir: '/fixture/mission', commit: 'a'.repeat(40), tree: 'b'.repeat(40) }),
      loadPhaseGates: () => configured,
      loadRequirePreIntegration: () => true,
      runPhaseGates: async (_phase, options) => { runnerDryRun = options.dryRun; targetBranch = options.targetBranch; return result; },
      routeIntegrationGateFailure: async () => { repairRoutes++; return { route: 'fixed' }; },
    },
    verification: { formatVerificationCommand: () => 'npm test' },
    landing: { createAbort: () => Object.assign(new Error('aborted'), { name: 'IntegrationAbort' }) },
  }));
  const request: GateStepRequest = {
    slug: 'px-dry-run', context: integrationContext({ slug: 'px-dry-run' }), missionLoad, missionServices: services,
    dryRun: true, noIntegrationGates: false, realAgent: null, realAgentModel: null,
    seams: {
      routeIntegrationGateFailureFn: async input => { repairRoutes++; repairRequests.push(input); return { route: 'human-only', diagnostic: 'fixture stop' }; },
      startAgentFn: async () => { throw new Error('fixture route must own launches'); },
      transitionTaskFn: async () => { throw new Error('fixture route must own lifecycle changes'); },
      applyAgentFallbackFn: async () => { throw new Error('fixture route must own fallback selection'); },
    },
  };
  return { step, request, observations: () => ({ repairRoutes, repairRequests, runnerDryRun, targetBranch, unsuccessful }) };
}

async function quiet<T>(run: () => Promise<T>): Promise<T> {
  const previous = setLogger({ log: () => {}, error: () => {} });
  try { return await run(); } finally { setLogger(previous); }
}

test('integration dry-run executes the complete selected plan through the live runner (PX-0031)', async () => {
  const { step, request, observations } = await fixture(receipt());
  assert.equal(await quiet(() => step.runRequiredLocalGates(request)), '2 integration gate(s) passed');
  assert.equal(observations().runnerDryRun, false);
  assert.equal(observations().targetBranch, request.context.baseBranch);
  assert.equal(observations().repairRoutes, 0);
});

test('integration dry-run routes a repairable red receipt with exact failure evidence (PX-0031)', async () => {
  const failedGate = { ...gates[0], exitCode: 7, stdout: 'bounded stdout', stderr: 'bounded stderr' };
  const { step, request, observations } = await fixture(receipt({ ok: false, executed: 1, failedGate, outcomes: [failedGate], error: 'red gate' }));
  await assert.rejects(quiet(() => step.runRequiredLocalGates(request)), { name: 'IntegrationAbort' });
  assert.equal(observations().repairRoutes, 1);
  assert.equal(observations().repairRequests[0]?.failedGate?.command, gates[0].command);
  assert.equal(observations().repairRequests[0]?.failedGate?.stderr, 'bounded stderr');
  assert.deepEqual(observations().repairRequests[0]?.gates, gates, 'repair verification receives the complete configured plan');
  assert.equal(observations().unsuccessful.length, 1, 'the red run remains recorded as failed evidence');
});

test('an aggregate red receipt records every failed gate while repair keeps the singular projection (px-0050.01)', async () => {
  const unit = { ...gates[0], exitCode: 7, stdout: '', stderr: 'unit defect' };
  const types = { ...gates[1], exitCode: 2, stdout: '', stderr: 'type defect' };
  const { step, request, observations } = await fixture(receipt({ ok: false, failedGate: unit, failures: [unit, types], outcomes: [unit, types], error: 'two failed' }));
  await assert.rejects(quiet(() => step.runRequiredLocalGates(request)), { name: 'IntegrationAbort' });
  assert.equal(observations().repairRequests[0]?.failedGate?.command, unit.command);
  assert.deepEqual((observations().unsuccessful[0] as { hooks: string[]; failed: boolean }).hooks, ['unit', 'types']);
  assert.equal((observations().unsuccessful[0] as { failed: boolean }).failed, true);
});

for (const [scenario, result] of [
  ['cancelled', receipt({ ok: false, cancelled: true, executed: 1, outcomes: [{ ...gates[0], exitCode: null, stdout: '', stderr: 'cancelled' }], error: 'cancelled' })],
  ['partial', receipt({ executed: 1, outcomes: [{ ...gates[0], exitCode: 0, stdout: '', stderr: '' }] })],
  ['malformed', { ok: true }],
] as const) {
  test(`integration dry-run rejects ${scenario} execution without repair or landing (PX-0031)`, async () => {
    const { step, request, observations } = await fixture(result);
    await assert.rejects(quiet(() => step.runRequiredLocalGates(request)), { name: 'IntegrationAbort' });
    assert.equal(observations().runnerDryRun, false);
    assert.equal(observations().repairRoutes, 0);
    assert.equal(observations().unsuccessful.length, 1);
  });
}

test('integration dry-run accepts a complete green receipt when optional reusable proof is unavailable (PX-0031)', async () => {
  const { step, request, observations } = await fixture(receipt({ proofReusable: false }));
  assert.equal(await quiet(() => step.runRequiredLocalGates(request)), '2 integration gate(s) passed');
  assert.equal(observations().repairRoutes, 0);
  assert.deepEqual(observations().unsuccessful, [], 'a green execution must not create failed validation history');
});

test('integration dry-run fails closed when mandatory preIntegration is missing (PX-0031)', async () => {
  const { step, request, observations } = await fixture(receipt({ ok: true, executed: 0, skipped: true, outcomes: [] }), []);
  await assert.rejects(quiet(() => step.runRequiredLocalGates(request)), { name: 'IntegrationAbort' });
  assert.equal(observations().repairRoutes, 0);
});

// ── Tests action in the review step (TASK-2859.14) ─────────────────────────
// The executor drives the real gate-step owner above; rebase, gate runner and
// rebound kernel are the recorded boundaries each case asserts against.

test('the review tests entry resolves the mission checkout and passes the composed repair launcher to the executor (TASK-2859.17)', async () => {
  const slug = 'px-review-tests-entry';
  const executionContext = missionExecutionContext({ missionId: slug, missionWorktree: '/fixture/mission' });
  const missionServicesFn = async () => integrationServices();
  const launches: Array<{ step: string; worktree?: string }> = [];
  const ports = stubIntegrateWorkflowPorts({
    missionContext: { resolve: (resolvedSlug, root) => {
      assert.equal(resolvedSlug, slug);
      assert.equal(root, '/fixture/operator-root', 'composition supplies the repository root, not process.cwd');
      return { ok: true, context: executionContext };
    } },
    agents: { startAgent: async (step, options) => {
      launches.push({ step, worktree: options.worktree });
      return { agent: 'codex', result: { status: 0 } };
    } },
  });
  const outcome = await runReviewStepTestsEntry(slug, { executionRoot: '/fixture/operator-root', missionServicesFn }, ports, {
    runTestsAction: async request => {
      assert.equal(request.slug, slug);
      assert.equal(request.policySelection, null, 'the executor owns exact-current fixed-policy selection');
      assert.equal(request.executionContext, executionContext);
      assert.equal(request.missionServicesFn, missionServicesFn);
      assert.deepEqual(await request.seams.startAgentFn('act-on-review', {
        prompt: 'repair the failed integration gate', worktree: executionContext.missionWorktree,
      }), { agent: 'codex', result: { status: 0 } });
      return { kind: 'human-handoff', reason: 'repair-refused', detail: 'fixture stop after launch' };
    },
  });

  assert.deepEqual(launches, [{ step: 'act-on-review', worktree: '/fixture/mission' }]);
  assert.deepEqual(outcome, { kind: 'human-handoff', reason: 'repair-refused', detail: 'fixture stop after launch' });
});

test('the review tests entry fails closed when its mission context or services are unavailable (TASK-2859.17)', async () => {
  const slug = 'px-review-tests-unavailable';
  let executions = 0;
  const executor = { runTestsAction: async () => {
    executions++;
    return { kind: 'not-selected' as const, next: null };
  } };
  const unresolved = stubIntegrateWorkflowPorts({
    missionContext: { resolve: () => ({ ok: false, reason: 'mission checkout is unavailable' }) },
  });
  assert.deepEqual(await runReviewStepTestsEntry(slug, { executionRoot: '/fixture/operator' }, unresolved, executor), {
    kind: 'human-handoff', reason: 'mission-unavailable', detail: 'mission checkout is unavailable',
  });

  const resolved = stubIntegrateWorkflowPorts({ missionContext: { resolve: () => ({
    ok: true, context: missionExecutionContext({ missionId: slug, missionWorktree: '/fixture/mission' }),
  }) } });
  assert.deepEqual(await runReviewStepTestsEntry(slug, { executionRoot: '/fixture/operator' }, resolved, executor), {
    kind: 'human-handoff', reason: 'mission-unavailable', detail: `Mission services are unavailable for ${slug}.`,
  });
  assert.equal(executions, 0, 'an incomplete entry never reaches the tests-action owner');
});

type GateRunRecord = NonNullable<ReturnType<NonNullable<IntegrateWorkflowPorts['gates']['readGateRun']>>>;
const HEAD = 'c'.repeat(40);
const plan = gates.map(({ key, command }) => ({ key, command }));
const passedRun = (gateRunId: string | null, revision = HEAD, ran = plan): GateRunRecord => ({ gateRunId, revision, status: 'passed',
  current: true, carried: null, gates: ran, outcomes: ran.map(gate => ({ ...gate, exitCode: 0, result: 'passed' as const })) });

async function testsAction(options: { status?: Mission['status']; review?: Mission['review']; result?: IntegrationGateRunResult;
  previous?: GateRunRecord | null; claim?: boolean; holder?: string; stillSelected?: (_revision: string) => Promise<boolean>; rebase?: () => void; selection?: 'tests' | null; refuseRepair?: string;
  redUnreadable?: boolean; results?: IntegrationGateRunResult[]; validationWriteFails?: boolean; configured?: typeof gates } = {}) {
  const slug = 'px-tests-action';
  const calls: string[] = [];
  let mission = fixtureMission(slug, { repositoryId: repositoryId('test-repo'), status: options.status ?? 'review',
    review: options.review === undefined ? pendingReview(slug) : options.review, checkpoints: [] });
  let record: GateRunRecord | null = options.previous ?? null;
  const received: { runner?: Parameters<IntegrateWorkflowPorts['gates']['runPhaseGates']>[1]; rebase?: unknown; route?: IntegrationGateFailureRequest } = {};
  const unsuccessful: unknown[] = [];
  const services = integrationServices({
    store: { load: async id => ({ kind: 'found', mission: { ...mission, id }, version: missionVersion(1) }) },
    operationalHistory: { loadLatestByTypeForMission: async () => null,
      recordIntegrationValidation: async input => {
        if (options.validationWriteFails) { throw new Error('operator database unavailable'); }
        unsuccessful.push(input);
      } },
  });
  let runs = 1;
  const ports = stubIntegrateWorkflowPorts({
    process: { cwd: () => '/fixture/mission',
      claimIntegration: async () => options.claim === false ? null : async () => { calls.push('release'); },
      integrationClaimHolder: () => options.holder ?? null },
    git: { git: () => ({ status: 0, stdout: '', stderr: '' }), getCurrentBranch: () => `mission/${slug}` },
    gates: {
      readGateRun: () => record,
      resolveIntegrationVerificationWorktree: () => '/fixture/mission',
      captureFinalIntegrationTree: () => ({ ok: true, rootDir: '/fixture/mission', commit: HEAD, tree: 'd'.repeat(40) }),
      loadPhaseGates: () => options.configured ?? gates,
      loadRequirePreIntegration: () => true,
      runPhaseGates: async (_phase, runnerOptions) => {
        calls.push('gates');
        received.runner = runnerOptions;
        const result = options.results?.shift() ?? options.result ?? receipt();
        const status = result.cancelled ? 'cancelled' : result.ok ? 'passed' : 'failed';
        // The single writer persists the outcomes the runner settled, with the run's input-identity currency.
        record = options.redUnreadable && status === 'failed' ? null : { gateRunId: `run-${++runs}`, revision: HEAD, status,
          current: true, carried: null, gates: plan,
          outcomes: (result.outcomes ?? []).map(outcome => ({ key: outcome.key, command: outcome.command, exitCode: outcome.exitCode ?? null })) };
        return result;
      },
    },
    verification: { formatVerificationCommand: () => 'npm test' },
    landing: { createAbort: () => Object.assign(new Error('aborted'), { name: 'IntegrationAbort' }),
      isAbort: error => (error as Error)?.name === 'IntegrationAbort' },
  });
  const executor = createTestsActionExecutor(ports, {
    buildIntegrationContext: async (contextSlug, contextOptions) => integrationContext({ slug: contextSlug,
      executionContext: contextOptions.executionContext, reviewState: { implementer: 'codex' } }),
    runIntegrationRebase: async (_slug, target) => { calls.push('rebase'); received.rebase = target; options.rebase?.(); },
    runRequiredLocalGates: request => createIntegrationGateStep(ports).runRequiredLocalGates(request),
  });
  const executionContext = missionExecutionContext({ missionId: slug, missionWorktree: '/fixture/mission' });
  const run = () => quiet(() => executor.runTestsAction({ slug, policySelection: options.selection === undefined ? 'tests' : options.selection,
    executionContext, missionServicesFn: async () => services, stillSelected: options.stillSelected,
    seams: {
      // The rebound kernel boundary: it owns the transition to active and the repair rerun.
      routeIntegrationGateFailureFn: async input => {
        calls.push('rebound');
        received.route = input;
        if (options.refuseRepair) { throw new Error(options.refuseRepair); }
        mission = { ...mission, status: 'active', closedAt: null } as Mission;
        record = passedRun('run-3', 'e'.repeat(40));
        return { route: 'blocked', rebounds: 1 };
      },
      startAgentFn: async () => { throw new Error('the rebound kernel owns launches'); },
      transitionTaskFn: async () => { throw new Error('the rebound kernel owns lifecycle changes'); },
      applyAgentFallbackFn: async () => { throw new Error('the rebound kernel owns fallback selection'); },
    } }));
  return { run, calls, received, unsuccessful, executionContext, mission: () => mission };
}

for (const [lane, review] of [['review', pendingReview('px-tests-action')], ['active', null]] as const) {
  test(`a selected tests action in ${lane} rebases, then runs the full plan without landing eligibility or approval (TASK-2859.14)`, async () => {
    const fixture = await testsAction({ status: lane, review });
    const outcome = await fixture.run();
    assert.deepEqual(fixture.calls, ['rebase', 'gates', 'release'], 'rebase precedes every gate; no preflight, recovery or landing boundary ran');
    assert.deepEqual(outcome, { kind: 'completed', verdict: 'passed', recorded: false, repairRoute: null,
      evidence: { gateRunId: 'run-2', revision: HEAD, outcomes: plan.map(gate => ({ ...gate, exitCode: 0 })) },
      next: { kind: 'agent-review', reason: 'review-unfinished' } });
    assert.equal(fixture.mission().status, lane, 'no approval or lane change was fabricated');
    assert.deepEqual(fixture.unsuccessful, [], 'a green first run writes no integration-validation marker for landing to reuse');
    assert.deepEqual(fixture.received.runner?.gates, gates, 'the complete configured plan ran, not a validated subset');
    assert.equal(fixture.received.runner?.slug, 'px-tests-action');
    assert.equal(fixture.received.runner?.checkoutPath, '/fixture/mission');
    assert.equal(fixture.received.runner?.targetBranch, 'main');
    assert.deepEqual((fixture.received.rebase as { executionContext: unknown }).executionContext, fixture.executionContext);
  });
}

test('a failed tests action routes repair through the rebound kernel and returns control unlanded (TASK-2859.14)', async () => {
  const failedGate = { ...gates[0], exitCode: 7, stdout: '', stderr: 'unit defect' };
  let selections = 0;
  const fixture = await testsAction({
    result: receipt({ ok: false, executed: 1, failedGate, outcomes: [failedGate], error: 'red gate' }),
    stillSelected: async () => selections++ === 0,
  });
  const outcome = await fixture.run();
  assert.deepEqual(fixture.calls, ['rebase', 'gates', 'rebound', 'release']);
  assert.deepEqual(outcome, { kind: 'completed', verdict: 'failed', recorded: false, repairRoute: { route: 'blocked', rebounds: 1 },
    evidence: { gateRunId: 'run-2', revision: HEAD, outcomes: [{ ...plan[0], exitCode: 7 }] },
    next: { kind: 'agent-review', reason: 'review-unfinished' } }, 'the red run is the verdict, not the repair rerun');
  assert.equal(fixture.received.route?.implementer, 'codex');
  assert.equal(fixture.received.route?.repositoryId, 'test-repo');
  assert.equal(fixture.received.route?.testedRevision, HEAD);
  assert.deepEqual(fixture.received.route?.executionContext, fixture.executionContext);
  assert.equal(fixture.unsuccessful.length, 1, 'the failed run stays recorded once through the validation writer');
  assert.equal(selections, 2, 'a policy decline after the red verdict retains the rebound path');
});

test('a synthetic policy re-selection re-runs failed tests through the gate owner without repair (TASK-2867.05)', async () => {
  const failedGate = { ...gates[0], exitCode: 7, stdout: '', stderr: 'synthetic flake' };
  const parsed = parsePolicyArtifact(syntheticPolicyArtifactV2(undefined, undefined, 0.25));
  assert.ok(parsed.ok);
  let evaluations = 0;
  const selectionPorts: ReviewStartPolicyPorts = {
    configuration: { mode: 'pilot', artifact: 'synthetic.json' }, repositoryId: repositoryId('test-repo'),
    targetBranch: 'main', operationId: null,
    loadPolicy: () => ({ mode: 'shadow', hash: 'synthetic-hash', artifact: parsed.artifact }),
    readHistory: async () => {
      const entries: VerificationHistoryEntry[] = evaluations++ === 0 ? []
        : [{ kind: 'verdict', check: 'tests', passed: false }];
      return { ok: true, entries, record: verificationHistoryRecord(entries), tests: 'observed' };
    },
    identity: { branchHead: () => HEAD, changeIdentity: () => HEAD, onlyBookkeepingSince: () => false },
    writer: { recordReviewStartDecision: async () => true, resolveReviewEntryPin: async input => reviewEntryPin(input),
      settleReviewStartOutcomes: async () => 0 },
    readOutcomeFacts: async () => ({ review: null, runs: [] }),
    diagnostic: failure => { throw new Error(failure.message); },
  };
  const fixture = await testsAction({
    results: [receipt({ ok: false, executed: 1, failedGate, outcomes: [failedGate], error: 'red gate' }), receipt()],
    stillSelected: async revision => (await selectPolicyAction({ missionId: missionId('px-tests-action'), revision }, selectionPorts)).action === 'tests',
  });
  const failed = await fixture.run();
  assert.deepEqual(failed, { kind: 'completed', verdict: 'failed', recorded: false, repairRoute: null,
    retryWithoutRepair: true,
    evidence: { gateRunId: 'run-2', revision: HEAD, outcomes: [{ ...plan[0], exitCode: 7 }] },
    next: { kind: 'tests', reason: 'policy-selected' } });
  assert.equal(fixture.calls.includes('rebound'), false, 'the renewed tests selection bypassed only the repair launch');

  const passed = await fixture.run();
  assert.equal(passed.kind === 'completed' && passed.verdict, 'passed');
  assert.deepEqual(fixture.calls, ['rebase', 'gates', 'release', 'rebase', 'gates', 'release'],
    'the same gate owner executed the unchanged-revision re-run; no parallel runner or rebound was created');
  assert.equal(evaluations, 3, 'the artifact selected tests before the first run, after its failed verdict, and before the re-run');
  assert.equal(fixture.unsuccessful.length, 1, 'only the red verdict wrote the unsuccessful validation fact');
});

test('a cancelled tests action records its verdict and returns control without repair (TASK-2859.14)', async () => {
  const fixture = await testsAction({ result: receipt({ ok: false, cancelled: true, executed: 1,
    outcomes: [{ ...gates[0], exitCode: null, stdout: '', stderr: 'cancelled' }], error: 'cancelled' }) });
  const outcome = await fixture.run();
  assert.deepEqual(fixture.calls, ['rebase', 'gates', 'release']);
  assert.equal(outcome.kind === 'completed' && outcome.verdict, 'cancelled');
  assert.deepEqual(outcome.kind === 'completed' && outcome.next, { kind: 'agent-review', reason: 'review-unfinished' });
});

test('a restarted tests action reuses the settled exact-head run instead of writing it twice (TASK-2859.14)', async () => {
  const fixture = await testsAction({ previous: passedRun('run-1') });
  const outcome = await fixture.run();
  assert.deepEqual(fixture.calls, ['rebase', 'release'], 'no second gate run or record');
  assert.equal(outcome.kind === 'completed' && outcome.recorded, true);
  assert.equal(outcome.kind === 'completed' && outcome.evidence?.gateRunId, 'run-1');
});

test('a policy selection runs the tests action after an agent approval moved the lane, never landing, and not before a review lane exists (TASK-2859.14, PX-0074.01)', async () => {
  const fixture = await testsAction({ status: 'integration', review: approvedReview('px-tests-action') });
  assert.equal((await fixture.run()).kind, 'completed', 'integration-lane');
  assert.deepEqual(fixture.calls, ['rebase', 'gates', 'release'], 'tests ran without landing');
  assert.equal(fixture.mission().status, 'integration', 'no approval, lane change or landing was recorded');
  const reviewLane = await testsAction({ selection: null });
  assert.equal((await reviewLane.run()).kind, 'not-selected', 'the fixed sequence reviews before it tests');
  assert.deepEqual(reviewLane.calls, ['release']);
});

// The fixed sequence (decisions 5 and 7): an approved candidate in the landing lane owes the tests action
// when configured tests have no exact-current passing run; nothing else schedules it (TASK-2859.17).
test('the fixed sequence runs missing tests for an approved landing candidate: rebase first, full plan, no landing (TASK-2859.17)', async () => {
  const fixture = await testsAction({ status: 'integration', review: approvedReview('px-tests-action'), selection: null });
  const outcome = await fixture.run();
  assert.deepEqual(fixture.calls, ['rebase', 'gates', 'release']);
  assert.deepEqual(outcome, { kind: 'completed', verdict: 'passed', recorded: false, repairRoute: null,
    evidence: { gateRunId: 'run-2', revision: HEAD, outcomes: plan.map(gate => ({ ...gate, exitCode: 0 })) },
    next: { kind: 'integration-handoff', reason: 'fixed-sequence-complete' } });
  assert.equal(fixture.mission().status, 'integration', 'no approval, lane change or landing was recorded');
  assert.deepEqual(fixture.received.runner?.gates, gates, 'the complete configured plan ran');
  assert.equal(fixture.received.runner?.slug, 'px-tests-action');
});

test('the fixed sequence routes a red landing-candidate run through the rebound kernel (TASK-2859.17)', async () => {
  const failedGate = { ...gates[0], exitCode: 7, stdout: '', stderr: 'unit defect' };
  const fixture = await testsAction({ status: 'integration', review: approvedReview('px-tests-action'), selection: null,
    result: receipt({ ok: false, executed: 1, failedGate, outcomes: [failedGate], error: 'red gate' }) });
  const outcome = await fixture.run();
  assert.deepEqual(fixture.calls, ['rebase', 'gates', 'rebound', 'release']);
  assert.equal(outcome.kind === 'completed' && outcome.verdict, 'failed');
  assert.equal(fixture.received.route?.testedRevision, HEAD);
  assert.equal(fixture.mission().status, 'active', 'the rebound kernel owns the repair transition');
});

for (const [name, options] of [
  ['an exact-current passing run', { previous: passedRun('run-1') }],
  ['no configured tests', { configured: [] as unknown as typeof gates }],
] as const) {
  test(`the fixed sequence leaves an approved landing candidate for the human with ${name} (TASK-2859.17)`, async () => {
    const fixture = await testsAction({ status: 'integration', review: approvedReview('px-tests-action'), selection: null, ...options });
    assert.deepEqual(await fixture.run(), { kind: 'not-selected', next: { kind: 'integration-handoff', reason: 'fixed-sequence-complete' } });
    assert.deepEqual(fixture.calls, ['release'], 'no rebase or gate ran');
  });
}

test('a tests recommendation is asked again on the rebased head and a changed choice runs no gate (TASK-2859.19)', async () => {
  const asked: string[] = [];
  const declined = await testsAction({ stillSelected: async revision => { asked.push(revision); return false; } });
  const outcome = await declined.run();
  assert.equal(outcome.kind, 'not-selected');
  assert.deepEqual(declined.calls, ['rebase', 'release'], 'the mandatory rebase ran, then no gate');
  assert.equal(asked.length, 1);
  assert.match(asked[0] ?? '', /^[0-9a-f]{40}$/, 'the policy is asked about the head that would be tested');
  const kept = await testsAction({ stillSelected: async () => true });
  assert.equal((await kept.run()).kind, 'completed');
  assert.deepEqual(kept.calls, ['rebase', 'gates', 'release']);
});

test('tests-action entries that cannot complete hand off with a typed reason (TASK-2859.14)', async () => {
  const concurrent = await testsAction({ claim: false });
  assert.deepEqual(await concurrent.run(), { kind: 'human-handoff', reason: 'concurrent-entry',
    detail: 'Integration of px-tests-action is already running in another process.' });
  assert.deepEqual(concurrent.calls, []);
  const named = await testsAction({ claim: false, holder: 'process 4242' });
  assert.deepEqual(await named.run(), { kind: 'human-handoff', reason: 'concurrent-entry',
    detail: 'Integration of px-tests-action is already running in process 4242.' }, 'the refused second actor is told who owns the claim (TASK-2859.19)');
  assert.deepEqual(named.calls, [], 'the refused actor starts nothing');
  const conflict = await testsAction({ rebase: () => { throw Object.assign(new Error('conflict'), { name: 'IntegrationAbort' }); } });
  assert.equal((await conflict.run() as { reason?: string }).reason, 'rebase-dead-end');
  assert.deepEqual(conflict.calls, ['rebase', 'release'], 'no gate runs after a rebase dead end');
  const interrupted = await testsAction({ rebase: () => { throw new Error('SIGINT'); } });
  assert.deepEqual(await interrupted.run(), { kind: 'human-handoff', reason: 'interrupted', detail: 'SIGINT' });
  assert.deepEqual(interrupted.calls, ['rebase', 'release'], 'the claim is released on interruption');
});

test('a lifecycle refusal of the tests repair is a typed hand-off, never a completed repair (TASK-2859.14)', async () => {
  const failedGate = { ...gates[0], exitCode: 7, stdout: '', stderr: 'unit defect' };
  const fixture = await testsAction({ review: approvedReview('px-tests-action'), refuseRepair: 'A review repair rebound requires an undecided review round',
    result: receipt({ ok: false, executed: 1, failedGate, outcomes: [failedGate], error: 'red gate' }) });
  assert.deepEqual(await fixture.run(), { kind: 'human-handoff', reason: 'repair-refused',
    detail: 'A review repair rebound requires an undecided review round' });
  assert.deepEqual(fixture.calls, ['rebase', 'gates', 'rebound', 'release']);
  assert.equal(fixture.mission().status, 'review', 'the refused repair leaves the mission unlanded where it was');
});

for (const [name, previous] of [
  ['failed', { ...passedRun('run-1'), status: 'failed' as const, outcomes: [{ ...plan[0], exitCode: 7 }] }],
  ['cancelled', { ...passedRun('run-1'), status: 'cancelled' as const, outcomes: [{ ...plan[0], exitCode: null }] }],
  ['partial-plan', passedRun('run-1', HEAD, [plan[0]])],
  ['other-plan', passedRun('run-1', HEAD, plan.map(gate => ({ ...gate, command: `${gate.command} --changed` })))],
  ['unidentified', passedRun(null)],
  ['non-current', { ...passedRun('run-1'), current: false }],
  ['duplicated-outcome', { ...passedRun('run-1'), outcomes: [...passedRun('run-1').outcomes, passedRun('run-1').outcomes[0]!] }],
] as const) {
  test(`a ${name} exact-head record never stands in for the tests action; it reruns and routes red runs (TASK-2859.14)`, async () => {
    const failedGate = { ...gates[0], exitCode: 7, stdout: '', stderr: 'unit defect' };
    const fixture = await testsAction({ previous, result: receipt({ ok: false, executed: 1, failedGate, outcomes: [failedGate], error: 'red gate' }) });
    const outcome = await fixture.run();
    assert.deepEqual(fixture.calls, ['rebase', 'gates', 'rebound', 'release'], 'the gates run again and the red run reaches repair');
    assert.equal(outcome.kind === 'completed' && outcome.verdict, 'failed');
    assert.equal(outcome.kind === 'completed' && outcome.recorded, false);
  });
}

test('an unreadable red run stays a failed verdict with unknown evidence, never the repair rerun (TASK-2859.14)', async () => {
  const failedGate = { ...gates[0], exitCode: 7, stdout: '', stderr: 'unit defect' };
  const fixture = await testsAction({ redUnreadable: true, result: receipt({ ok: false, executed: 1, failedGate, outcomes: [failedGate], error: 'red gate' }) });
  const outcome = await fixture.run();
  assert.deepEqual(fixture.calls, ['rebase', 'gates', 'rebound', 'release']);
  assert.equal(outcome.kind === 'completed' && outcome.verdict, 'failed', 'the gate step routed a red run');
  assert.equal(outcome.kind === 'completed' && outcome.evidence, null, 'the green repair run run-3 is not the action evidence');
});

test('a gate-step refusal of an incomplete green receipt is a typed hand-off, never a passed verdict (TASK-2859.14)', async () => {
  const fixture = await testsAction({ result: receipt({ executed: 1, outcomes: [{ ...gates[0], exitCode: 0, stdout: '', stderr: '' }] }) });
  const outcome = await fixture.run();
  assert.deepEqual(fixture.calls, ['rebase', 'gates', 'release']);
  assert.equal(outcome.kind, 'human-handoff');
  assert.equal((outcome as { reason?: string }).reason, 'gate-evidence-refused',
    'the record says passed, but the gate step refused it fail-closed');
});

test('a run the gate step refused never becomes a passing restart, even when the refusal could not be recorded (TASK-2859.14)', async () => {
  // The runner settled one of two gates while reporting ok; the writer stores status passed with that one outcome.
  const partial = () => receipt({ executed: 1, outcomes: [{ ...gates[0], exitCode: 0, stdout: '', stderr: '' }] });
  for (const validationWriteFails of [false, true]) {
    const fixture = await testsAction({ results: [partial(), partial()], validationWriteFails });
    const first = await fixture.run();
    assert.equal((first as { reason?: string }).reason, validationWriteFails ? 'interrupted' : 'gate-evidence-refused');
    const restart = await fixture.run();
    assert.deepEqual(fixture.calls, ['rebase', 'gates', 'release', 'rebase', 'gates', 'release'],
      `failed-validation write ${validationWriteFails ? 'lost' : 'kept'}: the refused head is tested again, never reused`);
    assert.notEqual(restart.kind === 'completed' && restart.verdict, 'passed');
  }
});

test('a successful retry after a cancelled run is reused on the next restart (TASK-2859.14)', async () => {
  const cancelled = receipt({ ok: false, cancelled: true, executed: 1, outcomes: [{ ...gates[0], exitCode: null, stdout: '', stderr: 'cancelled' }], error: 'cancelled' });
  const fixture = await testsAction({ results: [cancelled, receipt()] });
  assert.equal((await fixture.run() as { verdict?: string }).verdict, 'cancelled');
  assert.equal((await fixture.run() as { verdict?: string }).verdict, 'passed');
  const restart = await fixture.run();
  assert.deepEqual(fixture.calls, ['rebase', 'gates', 'release', 'rebase', 'gates', 'release', 'rebase', 'release'],
    'the stale cancellation does not force a third gate run');
  assert.equal(restart.kind === 'completed' && restart.recorded, true);
  assert.equal(restart.kind === 'completed' && restart.evidence?.gateRunId, 'run-3');
});
