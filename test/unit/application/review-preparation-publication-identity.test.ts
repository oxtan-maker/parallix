// Publication credentials and authoritative implementer identity, using isolated handoff ports.
import test from 'node:test';
import assert from 'node:assert/strict';
import { agentFamily } from '../../../src/domain/agents.js';
import { startReview, changeRevision, ConfiguredReviewerEligibility } from '../../../src/domain/review.js';
import { ReviewPreparationCommandUseCase } from '../../../src/application/review-preparation-command-use-case.js';
import { SLUG, ROOT, BRANCH, MISSION_DIR, RECORDED_MISSION_LOAD, makeRecorder, makePorts, runOptions } from "../../helpers/review-preparation-ports.js";

test('missing implementer credentials use Parallix publication fallback without changing implementer (TASK-2778)', async () => {
  const recorder = makeRecorder();
  const publications: string[] = [];
  const implementers: unknown[] = [];
  const ports = makePorts(recorder, {
    productConfig: { isForgejoReviewEnabled: () => true },
    backlog: { transitionTask: (_slug, _status, options) => { implementers.push(options.implementer); return true; } },
    forgejo: { readToken: user => user === 'human' ? 'owner-token' : null,
      createPr: (_branch, user, token) => { publications.push(`${user}:${token}`); return { ok: true }; } },
    setupReview: { bootstrapReviewSurface: async () => ({ failureReason: { version: 1, code: 'infrastructure', source: 'review-preparation' }, ok: false, error: 'fixture bootstrap denied' }) },
  });
  const result = await new ReviewPreparationCommandUseCase(ports).performReviewPreparation(SLUG, runOptions(recorder));
  assert.equal(result.ok, true, result.error ?? '');
  assert.deepEqual(publications, ['human:owner-token']);
  assert.deepEqual(implementers, ['claude']);
});
test("review preparation stops when neither implementer nor Parallix credentials are available (TASK-2778)", async () => {
  const recorder = makeRecorder();
  const ports = makePorts(recorder, {
    productConfig: { isForgejoReviewEnabled: () => true },
    forgejo: { readToken: () => null, createPr: () => assert.fail('no unauthenticated publication') },
    setupReview: { bootstrapReviewSurface: async () => ({ failureReason: { version: 1, code: 'infrastructure', source: 'review-preparation' }, ok: false, error: 'fixture bootstrap denied' }) },
  });
  const result = await new ReviewPreparationCommandUseCase(ports).performReviewPreparation(SLUG, runOptions(recorder));
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /Parallix publication credentials are also unavailable/);
});
test("review preparation publishes as the database implementer, never its reviewer (TASK-2778 F1)", async () => {
  const recorder = makeRecorder();
  const published: string[] = [];
  const ports = makePorts(recorder, { productConfig: { isForgejoReviewEnabled: () => true },
    agentSelection: { selectAgent: () => 'claude' },
    forgejo: { createPr: (_branch, user, token) => { published.push(`${user}:${token}`); return { ok: true }; },
      readToken: user => `${user}-token` },
  });
  const services = await ports.missionServices!(ROOT, { missionDir: MISSION_DIR });
  services.store.load = async () => ({ ...RECORDED_MISSION_LOAD, mission: {
    ...RECORDED_MISSION_LOAD.mission, assignee: agentFamily('codex'),
  } });
  const result = await new ReviewPreparationCommandUseCase({ ...ports, missionServices: async () => services }).performReviewPreparation(SLUG, runOptions(recorder));
  assert.equal(result.ok, true, recorder.errors.join('\n'));
  assert.deepEqual(published, ['codex:codex-token']);
});
test('PR 739 assignee/review drift stops before publication (TASK-2778 F1)', async () => {
  const recorder = makeRecorder();
  const review = startReview({ change: { kind: 'local-branch', sourceBranch: BRANCH, targetBranch: 'main' }, revision: changeRevision('head') },
    agentFamily('claude'), agentFamily('codex'), '2026-10-19T10:00:00Z',
    ConfiguredReviewerEligibility.fromReviewStep({ eligible: [agentFamily('claude')], strategy: 'random' }));
  const ports = makePorts(recorder, { productConfig: { isForgejoReviewEnabled: () => true },
    forgejo: { createPr: () => assert.fail('must not publish a drifted identity') },
  });
  const services = await ports.missionServices!(ROOT, { missionDir: MISSION_DIR });
  services.store.load = async () => ({ ...RECORDED_MISSION_LOAD, mission: {
    ...RECORDED_MISSION_LOAD.mission, assignee: agentFamily('claude'), review,
  } });
  const result = await new ReviewPreparationCommandUseCase({ ...ports, missionServices: async () => services }).performReviewPreparation(SLUG, runOptions(recorder));
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /implementer identity.*(disagree|mismatch|drift)/i);
});

import { inMemoryTransitionStore } from '../../fixtures/mission-builders.js';
import { makeExecutePorts } from '../../fixtures/execute-mission-ports.js';
import { ExecuteMissionService } from '../../../src/application/execute-mission-service.js';
import { MissionLifecycleService } from '../../../src/application/mission-lifecycle-service.js';
import { MissionCheckpointService } from '../../../src/application/mission-checkpoint-service.js';
import { MissionNelService } from '../../../src/application/mission-nel-service.js';
import { DECLARED_GATES_RETURN_STAGE } from '../../../src/domain/board-event.js';
import { beginReviewPreparation, recordReviewPreparationFailure } from '../../../src/application/review-submission-service.js';
import { currentReviewRound, applyReviewerCommand, applyImplementerCommand, reviewFindingId } from '../../../src/domain/review.js';

function recordedServices() {
  const store = inMemoryTransitionStore({ ...RECORDED_MISSION_LOAD.mission, predictedNelBucket: 'Small' });
  return { store, lifecycle: new MissionLifecycleService(store), checkpoints: new MissionCheckpointService(store), nel: new MissionNelService(store) };
}

test('first review enters review before expensive verification without fabricating a round (TASK-2822)', async () => {
  const services = recordedServices();
  const recorder = makeRecorder();
  let verified = false;
  const ports = makePorts(recorder, { missionServices: async () => services,
    verification: { runVerificationGate: () => {
      assert.equal(services.store.mission().status, 'review');
      assert.equal(services.store.mission().review, null);
      verified = true;
      return { status: 0 };
    } },
  });
  const outcome = await new ReviewPreparationCommandUseCase(ports).performReviewPreparation(SLUG, runOptions(recorder));
  assert.equal(outcome.ok, true, outcome.error ?? '');
  assert.equal(verified, true);
  assert.equal(currentReviewRound(services.store.mission().review!).subject.revision, 'a'.repeat(40));
  assert.deepEqual(services.store.events.map(event => [event.from, event.to]), [['active', 'review']]);
});

test('actionable first-review failure reuses planned checkpoint work; infrastructure adds none (TASK-2822)', async () => {
  const services = recordedServices();
  await beginReviewPreparation(SLUG, services);
  await recordReviewPreparationFailure(SLUG, 'Forgejo network error: token unavailable', services, { kind: 'review-preparation-verification', error: 'Forgejo network error: token unavailable', failureReason: { version: 1, code: 'infrastructure' } }, DECLARED_GATES_RETURN_STAGE);
  assert.equal(services.store.mission().status, 'review');
  assert.equal(services.store.mission().checkpoints.length, 1);
  const failure = 'Planned checkpoint evidence is missing before review preparation: CP-2. Record fresh evidence with px checkpoint record';
  await recordReviewPreparationFailure(SLUG, failure, services, { kind: 'review-preparation-verification', error: failure, failureReason: { version: 1, code: 'incomplete-evidence' } }, DECLARED_GATES_RETURN_STAGE);
  assert.equal(services.store.mission().status, 'active');
  assert.equal(services.store.mission().review, null);
  const repair = services.store.mission().checkpoints.at(-1)!;
  assert.equal(repair.name, 'CP-2');
  assert.match(repair.firstLine ?? '', /Planned checkpoint evidence/);
  assert.deepEqual(repair.goalCheck, []);
  assert.equal(repair.repair, undefined, 'planned evidence work is not a fake failed gate');
  await beginReviewPreparation(SLUG, services);
  await recordReviewPreparationFailure(SLUG, failure, services, { kind: 'review-preparation-verification', error: failure, failureReason: { version: 1, code: 'incomplete-evidence' } }, DECLARED_GATES_RETURN_STAGE);
  assert.equal(services.store.mission().checkpoints.length, 2);
});

for (const scenario of [
  { lane: 'active', resolution: 'a'.repeat(40), label: '' },
  { lane: 'active', resolution: 'pre-rebase-head', label: ' after rebase' },
  { lane: 'review', resolution: 'pre-rebase-head', label: ' after early-entry rebase' },
] as const) {
test(`early preparation preserves the decided round and submits the repaired next round${scenario.label} (TASK-2822)`, async () => {
  const services = recordedServices();
  const eligibility = ConfiguredReviewerEligibility.fromReviewStep({ eligible: [agentFamily('codex')], strategy: 'random' });
  const first = startReview({ change: { kind: 'local-branch', sourceBranch: BRANCH, targetBranch: 'main' }, revision: changeRevision('first-head') },
    agentFamily('codex'), agentFamily('claude'), '2026-10-26T10:00:00Z', eligibility);
  const requested = applyReviewerCommand(first, { type: 'request-changes', decidedAt: '2026-10-26T10:01:00Z', comment: 'repair evidence',
    findings: [{ id: reviewFindingId('evidence'), summary: 'Cover repaired behavior', location: null }] });
  const resolved = applyImplementerCommand(requested, { type: 'submit-resolution', respondedAt: '2026-10-26T10:02:00Z', resultingRevision: changeRevision(scenario.resolution),
    resolutions: [{ findingId: reviewFindingId('evidence'), kind: 'fixed', evidence: 'test/fixtures/mission-builders.ts' }] });
  await services.store.save({ ...services.store.mission(), status: scenario.lane, closedAt: null, review: resolved });
  const recorded = await services.checkpoints.record({ operationId: 'repaired-evidence', missionId: RECORDED_MISSION_LOAD.mission.id,
    capabilities: new Set(['checkpoint:record']), checkpoint: { ...services.store.mission().checkpoints[0]!,
      goalCheck: [{ criterion: 'Workflow re-homed', evidence: 'test/fixtures/mission-builders.ts' }] } });
  assert.equal(recorded.status, 'completed', recorded.error?.message ?? '');

  const recorder = makeRecorder();
  let head = scenario.resolution;
  const ports = makePorts(recorder, { missionServices: async () => services,
    git: { git: () => ({ status: 0, stdout: head, stderr: '' }) },
    rebase: { rebaseBeforeReviewRound: async () => { head = 'a'.repeat(40); return { ok: true }; } },
  });
  const outcome = await new ReviewPreparationCommandUseCase(ports).performReviewPreparation(SLUG, runOptions(recorder));
  assert.equal(outcome.ok, true, outcome.error ?? '');
  const review = services.store.mission().review!;
  assert.deepEqual(review.rounds[0], resolved.rounds[0]);
  assert.equal(currentReviewRound(review).number, 2);
  assert.equal(currentReviewRound(review).subject.revision, 'a'.repeat(40));
  assert.equal(currentReviewRound(review).decision, null);
  assert.equal(services.store.mission().reviewPreparationPending, undefined);
  const retried = await new ReviewPreparationCommandUseCase(ports).performReviewPreparation(SLUG, runOptions(recorder));
  assert.equal(retried.ok, true, retried.error ?? '');
  assert.deepEqual(services.store.mission().review, review);
});
}

for (const interrupted of [false, true]) {
test(`committed repair binds its replacement round${interrupted ? ' after interrupted preparation' : ''} (TASK-2822)`, async () => {
  const { revokeApprovedDecision } = await import('../../../src/domain/review.js');
  const services = recordedServices();
  const eligibility = ConfiguredReviewerEligibility.fromReviewStep({ eligible: [agentFamily('codex')], strategy: 'random' });
  const first = startReview({ change: { kind: 'local-branch', sourceBranch: BRANCH, targetBranch: 'main' }, revision: changeRevision('approved-head') },
    agentFamily('codex'), agentFamily('claude'), '2026-10-26T10:00:00Z', eligibility);
  const approved = applyReviewerCommand(first, { type: 'approve', decidedAt: '2026-10-26T10:01:00Z', comment: null, source: { kind: 'local' } });
  const reopened = revokeApprovedDecision(approved, 1, { revokedBy: 'human', revokedAt: '2026-10-26T10:02:00Z', reason: 'Requested repair', cause: { kind: 'operator' } });
  await services.store.save({ ...services.store.mission(), review: reopened });
  const recorded = await services.checkpoints.record({ operationId: 'actual-repair-evidence', missionId: RECORDED_MISSION_LOAD.mission.id,
    capabilities: new Set(['checkpoint:record']), checkpoint: { ...services.store.mission().checkpoints[0]!,
      goalCheck: [{ criterion: 'Workflow re-homed', evidence: 'test/fixtures/mission-builders.ts' }] } });
  assert.equal(recorded.status, 'completed', recorded.error?.message ?? '');
  const recorder = makeRecorder();
  if (interrupted) {
    const interruptedPorts = makePorts(recorder, { missionServices: async () => services,
      verification: { runVerificationGate: () => { throw new Error('preparation interrupted'); } } });
    const stopped = await new ReviewPreparationCommandUseCase(interruptedPorts).performReviewPreparation(SLUG, runOptions(recorder));
    assert.equal(stopped.ok, false); assert.match(stopped.error ?? '', /preparation interrupted/);
    assert.equal(services.store.mission().status, 'review');
    assert.equal(currentReviewRound(services.store.mission().review!).subject.revision, 'approved-head');
    const resumed = await services.lifecycle.transition({ operationId: 'resume-repair-stage', missionId: services.store.mission().id,
      capabilities: new Set(['mission:transition']), actor: 'codex', occurredAt: '2026-10-27T10:00:00Z',
      command: { type: 'submit-for-review', gatesPassed: true, review: services.store.mission().review!, reviewerEligibility: eligibility } });
    assert.equal(resumed.status, 'completed', resumed.error?.message ?? '');
  }
  const outcome = await new ReviewPreparationCommandUseCase(makePorts(recorder, { missionServices: async () => services })).performReviewPreparation(SLUG, runOptions(recorder));
  assert.equal(outcome.ok, true, outcome.error ?? '');
  const review = services.store.mission().review!;
  assert.deepEqual(review.rounds[0], reopened.rounds[0]);
  assert.equal(currentReviewRound(review).subject.revision, 'a'.repeat(40));
  assert.equal(currentReviewRound(review).decision, null);
  const retried = await new ReviewPreparationCommandUseCase(makePorts(recorder, { missionServices: async () => services,
    git: { git: () => ({ status: 0, stdout: 'b'.repeat(40), stderr: '' }) } })).performReviewPreparation(SLUG, runOptions(recorder));
  assert.equal(retried.ok, true, retried.error ?? '');
  assert.deepEqual(services.store.mission().review, review, 'verified submission consumes the binding obligation; later retries preserve the subject');
});
}

test('typed infrastructure gates preserve review; gate incidents keep their existing work owner (TASK-2822)', async () => {
  const services = recordedServices();
  await beginReviewPreparation(SLUG, services);
  const gate = { kind: 'gate-failure' as const, area: 'workflow', command: 'npm test', exitCode: 1, stdout: '', stderr: '' };
  await recordReviewPreparationFailure(SLUG, 'Verification gate failed', services, { ...gate, failureReason: { version: 1, code: 'infrastructure' } }, DECLARED_GATES_RETURN_STAGE);
  assert.equal(services.store.mission().status, 'review');
  assert.equal(services.store.mission().checkpoints.length, 1);
  await recordReviewPreparationFailure(SLUG, 'Verification gate failed', services, gate, DECLARED_GATES_RETURN_STAGE);
  assert.equal(services.store.mission().status, 'active');
  assert.equal(services.store.mission().checkpoints.length, 1, 'the gate-specific repair owner creates its incident, without a duplicate generic plan');
});


test('gatekeeper artifact repair enters active before launching and re-enters review after repair (TASK-2822)', async () => {
  const services = recordedServices();
  const recorder = makeRecorder();
  let checks = 0;
  const launchLanes: string[] = [];
  const ports = makePorts(recorder, { missionServices: async () => services,
    gatekeeper: { runGatekeeper: () => ++checks === 1
      ? { ok: false, posted: true, skipped: false, missing: ['CP-2.md'] } : { ok: true, missing: [] } },
    agents: { startAgent: async () => {
      launchLanes.push(services.store.mission().status);
      return { agent: 'claude', result: { status: 0 } };
    } },
  });
  let reviewers = 0;
  const { ports: execution } = makeExecutePorts({ missionTransitions: services.store,
    agentExecution: { launch: async () => ({ agent: 'claude', rebaseDeferred: false, errored: false, errorMessage: null, exitStatus: 0, detail: null }) },
    reviewPreparationExecution: { run: async () => {
      const result = await new ReviewPreparationCommandUseCase(ports).performReviewPreparation(SLUG, runOptions(recorder));
      return { ...result, gateFailure: result.gateFailure ? { kind: 'gate-failure' as const, ...result.gateFailure } : undefined };
    } },
    autonomousReview: { start: async () => { reviewers++; assert.equal(currentReviewRound(services.store.mission().review!).reviewer, 'codex'); } },
  });
  const result = await new ExecuteMissionService(execution).execute({ operationId: 'repaired-review', slug: SLUG, agent: 'claude', capabilities: new Set(['active:execute']) });
  assert.equal(result.status, 'completed', result.error?.message ?? '');
  assert.equal(reviewers, 1, 'successful gatekeeper repair must reach independent review');
  assert.deepEqual(launchLanes, ['active']);
  assert.equal(checks, 2);
  assert.deepEqual(services.store.events.map(event => [event.from, event.to]),
    [['active', 'review'], ['review', 'active'], ['active', 'review']]);
  assert.equal(services.store.mission().status, 'review');
});


for (const interrupted of [false, true]) {
  test(`pending first-round repair binds verified HEAD${interrupted ? ' after interruption' : ''} and stays bound on retry (TASK-2822)`, async () => {
    const services = recordedServices();
    const eligibility = ConfiguredReviewerEligibility.fromReviewStep({ eligible: [agentFamily('codex')], strategy: 'random' });
    const first = startReview({ change: { kind: 'local-branch', sourceBranch: BRANCH, targetBranch: 'main' }, revision: changeRevision('old-first-head') },
      agentFamily('codex'), agentFamily('claude'), '2026-10-27T10:00:00Z', eligibility);
    await services.store.save({ ...services.store.mission(), review: first });
    const recorder = makeRecorder();
    if (interrupted) {
      const ports = makePorts(recorder, { missionServices: async () => services,
        verification: { runVerificationGate: () => { throw new Error('first preparation interrupted'); } } });
      const stopped = await new ReviewPreparationCommandUseCase(ports).performReviewPreparation(SLUG, runOptions(recorder));
      assert.equal(stopped.ok, false); assert.match(stopped.error ?? '', /first preparation interrupted/);
    }
    const preparation = new ReviewPreparationCommandUseCase(makePorts(recorder, { missionServices: async () => services }));
    const result = await preparation.performReviewPreparation(SLUG, runOptions(recorder));
    assert.equal(result.ok, true, result.error ?? '');
    const bound = services.store.mission().review!;
    assert.equal(currentReviewRound(bound).number, 1);
    assert.equal(currentReviewRound(bound).subject.revision, 'a'.repeat(40));
    assert.equal(services.store.mission().reviewPreparationPending, undefined);
    const retry = await new ReviewPreparationCommandUseCase(makePorts(recorder, { missionServices: async () => services,
      git: { git: () => ({ status: 0, stdout: 'b'.repeat(40), stderr: '' }) } })).performReviewPreparation(SLUG, runOptions(recorder));
    assert.equal(retry.ok, true, retry.error ?? '');
    assert.deepEqual(services.store.mission().review, bound, 'a submitted first round is stable across retries');
  });
}


for (const pending of [false, true]) {
  for (const explicit of [false, true]) {
    test(`${pending ? 'pending binding' : 'fresh submission'} rejects self-review under a multi-family policy${explicit ? ' with explicit selection' : ' with automatic selection'} (TASK-2822)`, async () => {
      const services = recordedServices();
      const eligibility = ConfiguredReviewerEligibility.fromReviewStep({ eligible: [agentFamily('claude'), agentFamily('codex')], strategy: 'random' });
      const original = startReview({ change: { kind: 'local-branch', sourceBranch: BRANCH, targetBranch: 'main' }, revision: changeRevision('before-repair') },
        agentFamily('codex'), agentFamily('claude'), '2026-10-27T10:00:00Z', eligibility);
      if (pending) { await services.store.save({ ...services.store.mission(), review: original }); }
      const recorder = makeRecorder();
      const ports = makePorts(recorder, { missionServices: async () => services,
        agentSelection: { eligibleAgentsForStep: () => ['claude', 'codex'], selectAgent: () => 'claude' } });
      const result = await new ReviewPreparationCommandUseCase(ports).performReviewPreparation(SLUG,
        runOptions(recorder, explicit ? { reviewer: agentFamily('claude') } : {}))
        .catch(error => ({ ok: false, error: String(error) }));
      assert.equal(result.ok, false);
      assert.match(result.error ?? '', /may not review its own work/);
      assert.notEqual(services.store.mission().status, 'integration');
      assert.deepEqual(services.store.mission().review, pending ? original : null);
    });
  }
}

test('pending binding preserves the existing single-family self-review exception (TASK-2822)', async () => {
  const services = recordedServices();
  const eligibility = ConfiguredReviewerEligibility.fromReviewStep({ eligible: [agentFamily('codex')], strategy: 'random' });
  const original = startReview({ change: { kind: 'local-branch', sourceBranch: BRANCH, targetBranch: 'main' }, revision: changeRevision('before-repair') },
    agentFamily('codex'), agentFamily('claude'), '2026-10-27T10:00:00Z', eligibility);
  await services.store.save({ ...services.store.mission(), review: original });
  const recorder = makeRecorder();
  const ports = makePorts(recorder, { missionServices: async () => services,
    agentSelection: { eligibleAgentsForStep: () => ['claude'] } });
  const result = await new ReviewPreparationCommandUseCase(ports).performReviewPreparation(SLUG, runOptions(recorder, { reviewer: agentFamily('claude') }));
  assert.equal(result.ok, true, result.error ?? '');
  const current = currentReviewRound(services.store.mission().review!);
  assert.equal(current.reviewer, 'claude'); assert.equal(current.implementer, 'claude');
  assert.equal(current.subject.revision, 'a'.repeat(40));
  assert.equal(services.store.mission().reviewPreparationPending, undefined);
});

for (const disposition of ['REQUEST_CHANGES', 'CHANGES_MADE'] as const) {
  test(`verified repair resumes an undecided fixing projection with ${disposition} in review (PX-0058.01)`, async () => {
    const services = recordedServices();
    const reviewer = agentFamily('codex');
    const eligibility = ConfiguredReviewerEligibility.fromReviewStep({ eligible: [reviewer], strategy: 'random' });
    const original = startReview({ change: { kind: 'local-branch', sourceBranch: BRANCH, targetBranch: 'main' }, revision: changeRevision('old-head') },
      reviewer, agentFamily('claude'), '2026-10-27T10:00:00Z', eligibility);
    const publication = { publicationId: 'older-negative', reviewerId: 'codex', agentFamily: reviewer,
      revision: changeRevision('old-head'), decision: 'changes-requested' as const,
      findings: [{ id: reviewFindingId('F1'), summary: 'old finding', location: null }],
      outcome: 'completed' as const, status: 0, publishedAt: '2026-10-27T10:01:00Z' };
    const review = { ...original, rounds: [{ ...currentReviewRound(original), phase: 'fixing' as const, disposition,
      implementerResponseContent: 'Fixed the feedback in the repaired revision', reviewerResults: [publication] }] as const };
    await services.store.save({ ...services.store.mission(), status: 'review', closedAt: null, reviewPreparationPending: true, review });
    const recorder = makeRecorder();
    const result = await new ReviewPreparationCommandUseCase(makePorts(recorder, { missionServices: async () => services }))
      .performReviewPreparation(SLUG, runOptions(recorder));
    assert.equal(result.ok, true, result.error ?? '');
    const current = currentReviewRound(services.store.mission().review!);
    assert.equal(current.phase, 'reviewing', 'a flat fixing marker cannot bypass review of verified HEAD');
    assert.equal(current.subject.revision, 'a'.repeat(40));
    assert.equal(current.decision, null, 'preparation cannot invent a reviewer judgment');
    assert.equal(current.disposition, disposition, 'role-owned response evidence remains intact');
    assert.equal(current.implementerResponseContent, review.rounds[0].implementerResponseContent);
    assert.deepEqual(current.reviewerResults, [publication], 'old findings remain immutable history');
  });
}
