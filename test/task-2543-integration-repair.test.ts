import test from 'node:test';
import assert from 'node:assert/strict';
import { agentFamily } from '../src/domain/agents.js';
import { missionId, missionLabels, type Mission } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';
import {
  applyReviewerCommand, applyImplementerCommand, beginNextReviewRound, changeRevision,
  ConfiguredReviewerEligibility, currentReviewRound, requestReviewIntervention,
  reviewFindingId, reviewStatus, startReview,
} from '../src/domain/review.js';
import { MissionLifecycleService } from '../src/application/mission-lifecycle-service.js';
import type { MissionVersion } from '../src/application/domain-ports.js';
import { recoverLegacyIntegrationRepairReview, integrationRepairNeedsReview } from '../src/application/integration-repair-review.js';
import { createIntegrationGateStep, IntegrationRestartRequired } from '../src/application/integrate/gates.js';
import { routeIntegrationGateFailure } from '../src/adapters/cli/commands/integrate-gate-rebound.js';
import { createReviewWorkflowAdapter } from '../src/adapters/review/review-workflow-adapter.js';
import { reviewStateDataFrom } from '../src/adapters/review/review-state-mapping.js';
import { ReviewState } from '../src/adapters/review/review-state.js';
import { getLatestReviewForPr } from '../src/adapters/forgejo/forgejo.js';
import { setLogger } from '../src/application/presentation/cli-format.js';
import { HandoffCommandUseCase } from '../src/application/handoff-command-use-case.js';
import { makePorts, makeRecorder, runOptions } from './helpers/handoff-ports.js';
import { getLatestReviewDecision } from '../src/adapters/forgejo/forgejo.js';

const slug = 'task-2543';
const reviewer = agentFamily('claude');
const implementer = agentFamily('codex');
const eligibility = ConfiguredReviewerEligibility.fromReviewStep({ eligible: [reviewer], strategy: 'random' });
const startedAt = '2026-01-01T00:00:00Z';

function memoryMission(status: Mission['status'] = 'integration') {
  const review = applyReviewerCommand(startReview({
    change: { kind: 'local-branch', sourceBranch: `mission/${slug}`, targetBranch: 'main' },
    revision: changeRevision('approved-commit'),
  }, reviewer, implementer, startedAt, eligibility), {
    type: 'approve', decidedAt: '2026-01-01T00:01:00Z', comment: null, source: { kind: 'local' },
  });
  let mission: Mission = {
    id: missionId(slug), repositoryId: repositoryId('parallix'), title: 'repair',
    labels: missionLabels([]), status, assignee: implementer, review,
    checkpoints: [{ missionId: missionId(slug), name: 'CP-1', rawFilename: null, firstLine: '',
      goalCheck: [{ criterion: 'repair', evidence: 'src/application/handoff-command-use-case.ts' }], nextActionText: 'review' }],
    closedAt: null, netEngineeringLines: null,
  };
  let version = 1;
  const history: Array<{ trigger: string; idempotencyKey: string }> = [];
  const store = {
    async load() { return { kind: 'found' as const, mission, version: version as MissionVersion }; },
    async save(next: Mission, expected: MissionVersion | null) {
      assert.equal(expected, version);
      mission = next;
      return ++version as MissionVersion;
    },
    async saveWithTransition(next: Mission, expected: MissionVersion | null, event: { trigger: string; idempotencyKey: string }) {
      const result = await this.save(next, expected);
      history.push(event);
      return result;
    },
    async findTransitions() { return history; },
  };
  const lifecycle = new MissionLifecycleService(store);
  return { store, lifecycle, history, mission: () => mission };
}

async function transition(fixture: ReturnType<typeof memoryMission>, command: Parameters<MissionLifecycleService['transition']>[0]['command']) {
  const loaded = await fixture.store.load();
  const result = await fixture.lifecycle.transition({
    operationId: 'test', missionId: missionId(slug), expectedVersion: loaded.version,
    capabilities: new Set(['mission:transition']), command, actor: implementer,
    occurredAt: new Date().toISOString(), idempotencyKey: `test:${loaded.version}`,
  });
  assert.equal(result.status, 'completed', result.error?.message);
}

test('integration repair withdraws approval before launch, survives review pingpong, and requests integration restart', async () => {
  const fixture = memoryMission();
  let repairs = 0;
  let providerRetracted = false;
  let repaired = false;
  const failedGate = { key: 'integration', command: 'gate', exitCode: 1, stdout: '', stderr: 'regression' };
  const ports = {
    gates: {
      resolveIntegrationVerificationWorktree: () => '/fixture',
      captureFinalIntegrationTree: () => ({ ok: true, rootDir: '/fixture', commit: repaired ? 'repair' : 'approved', tree: repaired ? 'repair' : 'approved' }),
      loadPhaseGates: () => [{ key: 'integration', command: 'gate', order: 1 }],
      loadRequirePreIntegration: () => true,
      runPhaseGates: async () => repaired ? { ok: true } : { ok: false, failedGate, error: 'red' },
    },
    landing: { createAbort: () => Object.assign(new Error('aborted'), { name: 'IntegrationAbort' }) },
    verification: { formatVerificationCommand: () => 'gate' },
  };
  const step = createIntegrationGateStep(ports as never);
  const previous = setLogger({ log: () => {} });
  try {
    await assert.rejects(step.runRequiredLocalGates({
      slug, context: { taskAssignee: implementer, baseWorktree: '/fixture', area: 'all', branch: `mission/${slug}` },
      missionLoad: await fixture.store.load(), missionServices: fixture,
      dryRun: false, noIntegrationGates: false, realAgent: null, realAgentModel: null,
      seams: {
        applyAgentFallbackFn: async () => implementer,
        transitionTaskFn: async () => true,
        startAgentFn: async () => {
          const review = fixture.mission().review!;
          assert.equal(fixture.mission().status, 'active');
          assert.equal(reviewStatus(review), 'awaiting-review');
          assert.ok(review.rounds[0].decision?.kind === 'approved' && review.rounds[0].decision.revocation);
          assert.equal(providerRetracted, true, 'provider approval is retracted before repair launches');
          repaired = true;
          return { agent: implementer, result: { status: 0 } } as never;
        },
        routeIntegrationGateFailureFn: async options => routeIntegrationGateFailure({
          ...options, readReboundsFn: async () => repairs, recordReboundFn: async () => { repairs++; return true; },
          captureFinalTreeFn: ports.gates.captureFinalIntegrationTree as never,
          runPhaseGatesFn: ports.gates.runPhaseGates as never,
          invalidateApprovalFn: async () => { providerRetracted = true; return { ok: true, retracted: ['custom'], errors: [] }; },
          reboundFn: (async (_reason: unknown, context: any) => {
            await context.transitionToImplementer(slug);
            await context.startAgent();
            assert.equal((await context.verify()).ok, true);
            return { outcome: 'fixed', implementer, attempts: 1 };
          }) as never,
        }),
        reReviewFn: async () => {
          let review = fixture.mission().review!;
          const round = currentReviewRound(review);
          review = { ...review, rounds: [...review.rounds.slice(0, -1), {
            ...round, subject: { ...round.subject, revision: changeRevision('repair') },
          }] as unknown as typeof review.rounds };
          await transition(fixture, { type: 'submit-for-review', gatesPassed: true, review, reviewerEligibility: eligibility });
          review = applyReviewerCommand(review, { type: 'request-changes', decidedAt: new Date().toISOString(), comment: null,
            findings: [{ id: reviewFindingId('F1'), summary: 'one more repair', location: null }] });
          await transition(fixture, { type: 'request-changes', review });
          review = applyImplementerCommand(review, { type: 'submit-resolution', respondedAt: new Date().toISOString(),
            resultingRevision: changeRevision('repair-2'), resolutions: [{ findingId: reviewFindingId('F1'), kind: 'fixed', evidence: 'fixed' }] });
          review = beginNextReviewRound(review, reviewer, implementer, new Date().toISOString(), eligibility);
          await transition(fixture, { type: 'submit-for-review', gatesPassed: true, review, reviewerEligibility: eligibility });
          review = applyReviewerCommand(review, { type: 'approve', decidedAt: new Date().toISOString(), comment: null, source: { kind: 'local' } });
          await transition(fixture, { type: 'approve', review });
          return true;
        },
      },
    }), IntegrationRestartRequired);
    assert.equal(fixture.mission().status, 'integration');
    assert.equal(fixture.mission().review!.rounds.length, 3);
    assert.equal(currentReviewRound(fixture.mission().review!).subject.revision, 'repair-2');
    assert.deepEqual(fixture.history.map(event => event.trigger), ['rebound-to-active', 'submit-for-review', 'request-changes', 'submit-for-review', 'approve']);
  } finally { setLogger(previous); }
});

test('legacy gate rebound recovery invalidates its approval once without reopening unrelated approved missions', async () => {
  const fixture = memoryMission('active');
  assert.equal(await recoverLegacyIntegrationRepairReview(fixture.store, slug), false);
  fixture.history.push({ trigger: 'rebound-to-active', idempotencyKey: `integration-gate-rebound:${slug}:1` });
  assert.equal(await recoverLegacyIntegrationRepairReview(fixture.store, slug), true);
  assert.equal(await recoverLegacyIntegrationRepairReview(fixture.store, slug), false);
  assert.equal(integrationRepairNeedsReview(fixture.mission()), true);
  assert.equal(fixture.mission().review!.rounds.length, 2);
});

test('operator continue clears escalation and permits an attempt even when its old round limit was exhausted', async () => {
  const fixture = memoryMission('review');
  const approved = fixture.mission().review!;
  const pending = startReview(approved.rounds[0].subject, reviewer, implementer, startedAt, eligibility);
  const rounds = Array.from({ length: 9 }, (_, index) => ({ ...pending.rounds[0], number: index + 1 }));
  const review = requestReviewIntervention({ ...pending, rounds: rounds as unknown as typeof pending.rounds,
    stageLaunches: [{ stageKey: 'review', fingerprints: ['prior-launch'] }] }, {
    requestedAt: startedAt, requestedBy: 'workflow', reason: 'MAX_ATTEMPTS',
  });
  await fixture.store.save({ ...fixture.mission(), review }, (await fixture.store.load()).version);
  let continued = false;
  const adapter = createReviewWorkflowAdapter({
    missionStore: fixture.store, inferSlugFn: () => slug, resolveWorktreeFn: () => '/fixture',
    readReviewStateFn: async () => ReviewState.from(slug, reviewStateDataFrom(fixture.mission().review!)),
    createEventFn: async () => undefined as never, run: (() => ({ stdout: 'operator' })) as never,
    log: () => {}, error: () => {}, exit: (() => { throw new Error('must resume'); }) as never,
    startReviewLoopFn: async (_slug, options) => {
      continued = true;
      assert.equal(fixture.mission().review!.intervention, null);
      assert.deepEqual(fixture.mission().review!.stageLaunches, []);
      assert.equal(options.isContinue, true);
      assert.ok(options.maxAttempts! >= 9);
    },
  });
  const context = await adapter.preflight([slug, '--continue', '--max-attempts', '1']);
  await adapter.continue(context!);
  assert.equal(continued, true);
});

test('a repair review cannot consume an old or unassigned provider approval', async () => {
  const result = await getLatestReviewForPr(1, 'claude', '2026-01-01T00:03:00Z', 'fake', {
    apiCall: async () => ({ ok: true, data: [
      { user: { login: 'claude' }, state: 'APPROVED', submitted_at: '2026-01-01T00:01:00Z' },
      { user: { login: 'custom' }, state: 'APPROVED', submitted_at: '2026-01-01T00:04:00Z' },
    ] }),
  });
  assert.equal(result, null);
});

test('the real handoff binds an invalidated round to the committed repair and mirrors the review lane', async () => {
  const fixture = memoryMission();
  await transition(fixture, { type: 'rebound-to-active', agent: implementer, occurredAt: new Date().toISOString() });
  const recorder = makeRecorder();
  const base = makePorts(recorder);
  const ports = makePorts(recorder, {
    missionServices: async () => ({ ...fixture,
      handoff: { recordNel: async () => ({ status: 'completed' }) },
      checkpoints: { record: async () => ({ status: 'completed' }) },
    }),
    git: { ...base.git, git: args => args.includes('rev-parse') && args.includes('HEAD')
      ? { status: 0, stdout: 'committed-repair\n', stderr: '' } : base.git.git(args) },
    reviewIdentity: { resolveReviewIdentity: async () => ({ forgejoUser: 'codex' }) },
    agentSelection: { eligibleAgentsForStep: () => ['claude', 'codex'], selectAgent: () => 'claude' },
  });
  const result = await new HandoffCommandUseCase(ports).performHandoff(slug, runOptions(recorder));
  assert.equal(result.ok, true, result.error);
  assert.equal(fixture.mission().status, 'review');
  assert.equal(currentReviewRound(fixture.mission().review!).subject.revision, 'committed-repair');
  assert.equal(fixture.mission().review!.rounds[0].subject.revision, 'approved-commit');
  assert.ok(recorder.transitions.includes('review'));
});

test('integration excludes a legacy approval from an earlier round but retains its holder for retraction', () => {
  const decision = getLatestReviewDecision(`mission/${slug}`, {
    token: 'fake', reviewerUser: 'claude', sinceIso: '2026-01-01T00:03:00Z',
    apiCall: (_method: string, url: string) => ({ ok: true, data: url.includes('/reviews')
      ? [{ user: { login: 'claude' }, state: 'APPROVED', submitted_at: '2026-01-01T00:01:00Z' }]
      : [{ number: 1, head: { ref: `mission/${slug}` } }] }),
  });
  assert.equal(decision.reviewerApproved, false);
  assert.equal(decision.reviewState, null);
});

for (const route of ['limit-reached', 'revision-changed'] as const) {
  test(`a ${route} repair route leaves the old approval invalid and continuation available`, async () => {
    const fixture = memoryMission();
    let reviewed = false;
    const step = createIntegrationGateStep({
      gates: {
        resolveIntegrationVerificationWorktree: () => '/fixture',
        captureFinalIntegrationTree: () => ({ ok: true, rootDir: '/fixture', commit: 'old', tree: 'old' }),
        loadPhaseGates: () => [{ key: 'gate', command: 'gate', order: 1 }],
        loadRequirePreIntegration: () => true,
        runPhaseGates: async () => ({ ok: false, failedGate: { key: 'gate' }, error: 'red' }),
      },
      landing: { createAbort: () => Object.assign(new Error('aborted'), { name: 'IntegrationAbort' }) },
      verification: { formatVerificationCommand: () => 'gate' },
    } as never);
    const previous = setLogger({ log: () => {} });
    try {
      await assert.rejects(step.runRequiredLocalGates({
        slug, context: { taskAssignee: implementer, area: 'all', baseWorktree: '/fixture' },
        missionLoad: await fixture.store.load(), missionServices: fixture,
        dryRun: false, noIntegrationGates: false, realAgent: null, realAgentModel: null,
        seams: {
          transitionTaskFn: async () => true, startAgentFn: async () => { throw new Error('no launch'); },
          applyAgentFallbackFn: async () => implementer,
          routeIntegrationGateFailureFn: async () => {
            assert.equal(fixture.mission().status, 'active');
            assert.equal(reviewStatus(fixture.mission().review!), 'awaiting-review');
            return { route, rebounds: 2, repairedRevision: 'new', invalidation: { ok: false } } as never;
          },
          reReviewFn: async () => { reviewed = true; return false; },
        },
      }), { name: 'IntegrationAbort' });
      assert.equal(integrationRepairNeedsReview(fixture.mission()), true);
      assert.equal(reviewed, route === 'revision-changed', 'failed provider retraction does not prevent the fresh review');
    } finally { setLogger(previous); }
  });
}
