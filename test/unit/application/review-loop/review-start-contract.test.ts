// Review start owns the handoff prerequisite, its failure boundaries, and dry-run.
import test from 'node:test';
import { agentFamily } from '../../../../src/domain/agents.js';
import assert from 'node:assert/strict';
import { runReviewLoop } from '../../../../src/application/review-loop/review-loop.js';
import { ReviewState } from '../../../../src/adapters/review/review-state.js';
import { fakeProvider, fakeReviewLoopPorts } from '../../../helpers/review-loop-ports.js';

const slug = 'review-start-contract';

test("start resumes the review-preparation-assigned reviewer instead of reselecting (TASK-2490, TASK-2647)", async () => {
  const fake = fakeReviewLoopPorts({
    slug,
    routing: {
      eligibleFamilies: () => ['claude', 'codex', 'custom'],
      nominate: () => { return assert.fail("review preparation assignment must take precedence over selection"); },
    },
    reviewPreparation: { reviewPreparation: async () => {
      await fake.ports.state.persist(new ReviewState(slug, { implementer: 'claude', reviewer: 'custom', round: 3 }));
      return { ok: true as const };
    } },
    artifacts: { consumeReviewer: async () => ({ consumed: true, ok: true as const, reviewState: 'APPROVED' }) },
  });
  await runReviewLoop({ slug, implementer: 'claude', maxAttempts: 3 }, fake.ports);
  assert.deepEqual(fake.launches.map(launch => [launch.role, launch.agent, launch.prompt?.attempt]), [['reviewer', 'custom', 3]]);
  assert.equal(fake.current()?.reviewer, 'custom');
  assert.deepEqual(fake.exits, []);
});

test('gatekeeper pushback stops before reviewer, gate, or rebase work (TASK-1303, TASK-2647)', async () => {
  const fake = fakeReviewLoopPorts({
    slug,
    provider: { openPullRequest: () => null },
    reviewPreparation: { reviewPreparation: async () => ({ ok: true as const, gatekeeperPushedBack: true }) },
    preReview: {
      rebase: async () => { return assert.fail('pushback must stop before rebase'); },
      runGate: async () => { return assert.fail('pushback must stop before gate'); },
    },
  });
  await runReviewLoop({ slug, implementer: 'claude', reviewer: 'codex' }, fake.ports);
  assert.deepEqual(fake.launches, []);
  assert.deepEqual(fake.writes, []);
  assert.deepEqual(fake.mirrors, []);
  assert.deepEqual(fake.exits, [1]);
  assert.match(fake.errors.join('\n'), /mandatory mission artifacts are missing/);
});

test('dry-run never self-heals or launches destination work (TASK-1303, TASK-2647)', async () => {
  const fake = fakeReviewLoopPorts({
    slug,
    provider: {
      ensureReachable: async () => { return assert.fail('dry-run must not bootstrap the provider'); },
      openPullRequest: () => { return assert.fail('dry-run must not inspect the provider'); },
    },
    reviewPreparation: { reviewPreparation: async () => { return assert.fail('dry-run must not hand off'); } },
    preReview: {
      rebase: async () => { return assert.fail('dry-run must not rebase'); },
      runGate: async () => { return assert.fail('dry-run must not run gates'); },
    },
  });
  await runReviewLoop({ slug, implementer: 'claude', reviewer: 'codex', dryRun: true }, fake.ports);
  assert.deepEqual(fake.launches, []);
  assert.deepEqual(fake.writes, []);
  assert.deepEqual(fake.mirrors, []);
  assert.deepEqual(fake.exits, []);
  assert.match(fake.logs.join('\n'), /DRY-RUN/);
});

test('review preparation launches without a lifecycle Graphify refresh (TASK-2725)', async () => {
  const calls: string[] = [];
  const fake = fakeReviewLoopPorts({
    slug,
    reviewPreparation: { reviewPreparation: async () => ({ ok: true as const }) },
    preReview: {
      rebase: async () => { calls.push('rebase'); return { ok: true as const }; },
      runGate: async () => { calls.push('gate'); return { ok: true as const }; },
    },
    agents: { launch: async launch => { calls.push(`launch:${launch.role}`); return { agent: launch.agent }; } },
    artifacts: { consumeReviewer: async () => ({ consumed: true, ok: true as const, reviewState: 'APPROVED' }) },
  });

  await runReviewLoop({ slug, implementer: 'claude', reviewer: 'codex' }, fake.ports);

  assert.deepEqual(calls, ['rebase', 'gate', 'launch:reviewer']);
});


test('continuation preparation stops after an unreachable provider even when exit returns (TASK-2696)', async () => {
  const fake = fakeReviewLoopPorts({
    slug,
    state: new ReviewState(slug, { implementer: 'claude', reviewer: 'codex', round: 2 }),
    provider: { ensureReachable: async () => false },
    routing: { nominate: () => { return assert.fail('failed preparation must not select a reviewer'); } },
  });
  await runReviewLoop({ slug, isContinue: true }, fake.ports);
  assert.deepEqual(fake.exits, [1]);
  assert.deepEqual(fake.launches, []);
  assert.deepEqual(fake.writes, []);
});

import { fixtureMission, approvedReview, inMemoryTransitionStore } from '../../../fixtures/mission-builders.js';
import { revokeApprovedDecision } from '../../../../src/domain/review.js';

for (const pendingPreparation of [false, true]) {
test(`continue enters interrupted repair work${pendingPreparation ? ' after early review entry' : ''} before checkpoint checks (TASK-2738, TASK-2822)`, async () => {
  const review = revokeApprovedDecision(approvedReview(slug), 1, {
    revokedAt: '2026-10-01T12:00:00Z', revokedBy: 'workflow', reason: 'gate failed',
    cause: { kind: 'integration-gate-failure', gate: 'npm test' },
  });
  const mission = fixtureMission(slug, { assignee: agentFamily('claude'), review,
    ...(pendingPreparation ? { status: 'review', reviewPreparationPending: true as const } : {}),
    declaredGates: ['npm test'], successCriteria: ['repair works'], checkpoints: [{
    missionId: fixtureMission(slug).id, name: 'CP-6', goalCheck: [], nextActionText: 'repair',
    repair: { incidentId: 'incident-6', command: 'npm test', attempt: 3,
      authorizedGates: ['npm test'], authorizedCriteria: ['repair works'], evidenceRecorded: false, verified: false },
  }] });
  const store = inMemoryTransitionStore(mission);
  const fake = fakeReviewLoopPorts({ slug, missionStore: store, lifecycle: new MissionLifecycleService(store),
    reviewPreparation: { reviewPreparation: async () => { return assert.fail('entering implementer work must not require completed checkpoints'); } },
    agents: { launch: async launch => {
      assert.equal(launch.role, 'implementer');
      assert.equal(store.mission().status, 'active');
      assert.equal(launch.prompt, undefined);
      assert.equal(launch.recovery?.sessionPolicy, 'fresh-ephemeral');
      return { result: { status: 0 } };
    } },
  });
  Object.assign(fake.ports, { retainedRepair: {
    read: async () => ({ evidence: { incidentId: 'retained', command: 'npm test', cwd: fake.ports.worktree,
      exitCode: 1, captureComplete: true, stdoutPath: '/retained/out', stderrPath: '/retained/err' }, stdout: 'failed', stderr: '' }),
    verify: async () => ({ ok: false, command: 'npm test', diagnostic: 'AssertionError: still fails' }),
    checkpoints: { open: async () => ({ name: 'CP-6', version: 1 }), readBlocker: async () => undefined, verify: async () => {} },
  } });
  await runReviewLoop({ slug, isContinue: true, implementer: 'claude' }, fake.ports);
  const loaded = await store.load(mission.id);
  assert.equal(loaded.kind, 'found');
  if (loaded.kind === 'found') { assert.deepEqual(loaded.mission, { ...mission, status: 'active' }); }
  assert.deepEqual(fake.exits, [1]);
});
}

import { RepairCheckpointService } from '../../../../src/application/repair-checkpoint-service.js';

for (const failure of ['original check', 'new blocker'] as const) {
  test(`acknowledged continuation still stops on ${failure} (TASK-2759)`, async () => {
    const review = revokeApprovedDecision(approvedReview(slug), 1, {
      revokedAt: '2026-10-01T12:00:00Z', revokedBy: 'workflow', reason: 'gate failed',
      cause: { kind: 'integration-gate-failure', gate: 'npm test' },
    });
    const blocker = { command: 'npm test', diagnostic: 'old invalid contract', authorityReason: 'operator decision', proposedCorrection: 'correct contract' };
    const mission = fixtureMission(slug, { assignee: agentFamily('claude'), brief: {} as never, review, declaredGates: ['npm test'], successCriteria: ['repair works'], checkpoints: [{
      missionId: fixtureMission(slug).id, name: 'CP-6', goalCheck: [], nextActionText: 'repair',
      repair: { incidentId: 'incident-6', command: 'npm test', attempt: 1, blocker,
        authorizedGates: ['npm test'], authorizedCriteria: ['repair works'], evidenceRecorded: false, verified: false },
    }] });
    const store = inMemoryTransitionStore(mission);
    const repair = new RepairCheckpointService(store);
    await repair.acknowledgeOperatorResume({ missionId: mission.id, operationId: 'resume', capabilities: new Set(['checkpoint:record']), actor: 'operator', occurredAt: '2026-10-15T08:00:00Z' });
    let checks = 0;
    let launches = 0;
    const newBlocker = { ...blocker, diagnostic: 'new contract blocker' };
    const fake = fakeReviewLoopPorts({ slug, missionStore: store,
      reviewPreparation: { reviewPreparation: async () => { assert.fail("unverified repair must not reach review preparation"); } },
      agents: { launch: async () => {
        launches += 1;
        if (failure === 'new blocker') {
          await repair.report({ missionId: mission.id, operationId: 'new-stop', capabilities: new Set(['checkpoint:record']), name: 'CP-6', blocker: newBlocker });
        }
        return { result: { status: 0 } };
      } },
    });
    Object.assign(fake.ports, { retainedRepair: {
      read: async () => ({ evidence: { incidentId: 'retained', command: 'npm test', cwd: fake.ports.worktree,
        exitCode: 1, captureComplete: true, stdoutPath: '/retained/out', stderrPath: '/retained/err' }, stdout: 'failed', stderr: '' }),
      verify: async () => { checks += 1; return { ok: false, command: 'npm test', diagnostic: 'AssertionError: original check still fails' }; },
      checkpoints: repair,
    } });
    await runReviewLoop({ slug, isContinue: true, implementer: 'claude', reboundsPerRound: 1 }, fake.ports);
    assert.deepEqual(fake.exits, [1]);
    assert.equal(launches, 1);
    assert.equal(checks, failure === 'original check' ? 1 : 0);
    const checkpoint = store.mission().checkpoints.find(cp => cp.name === 'CP-6')!;
    assert.equal(checkpoint.repair?.verified, false);
    assert.deepEqual(checkpoint.repair?.acknowledgedBlocker, blocker);
    if (failure === 'new blocker') { assert.deepEqual(checkpoint.repair?.blocker, newBlocker); }
  });
}

test('start derives the implementer from the Mission assignee when no task file or persisted Review names one (TASK-2737)', async () => {
  const fake = fakeReviewLoopPorts({
    slug,
    task: { implementer: () => null },
    reviewPreparation: { reviewPreparation: async () => ({ ok: true }) },
    missionStore: { load: async () => ({ kind: 'found', mission: { assignee: 'claude' } }) } as never,
    routing: { eligibleFamilies: () => ['claude', 'codex'], nominate: () => 'codex' },
    artifacts: { consumeReviewer: async () => ({ consumed: true, ok: true, reviewState: 'APPROVED' }) },
  });
  await runReviewLoop({ slug, maxAttempts: 1 }, fake.ports);
  assert.ok(fake.writes.some(write => write.implementer === 'claude'));
  assert.ok(!fake.writes.some(write => write.implementer === 'autonomous'));
});

test('start fails closed when the Mission store cannot load the assignee (TASK-2737, TASK-2778 F1)', async () => {
  let loads = 0;
  const fake = fakeReviewLoopPorts({
    slug,
    task: { implementer: () => null },
    reviewPreparation: { reviewPreparation: async () => ({ ok: true }) },
    missionStore: { load: async () => { if (!loads++) { throw new Error('store unavailable'); } return { kind: 'missing' }; } } as never,
    routing: { eligibleFamilies: () => ['claude', 'codex'], nominate: () => 'codex' },
    artifacts: { consumeReviewer: async () => ({ consumed: true, ok: true, reviewState: 'APPROVED' }) },
  });
  await assert.rejects(runReviewLoop({ slug, maxAttempts: 1 }, fake.ports), /store unavailable/);
  assert.deepEqual(fake.launches, []);
  assert.deepEqual(fake.writes, []);
});


import { MissionLifecycleService } from '../../../../src/application/mission-lifecycle-service.js';
import { pendingReview } from '../../../fixtures/mission-builders.js';

for (const dryRun of [false, true]) {
  test(`explicit continue implementer overrides database assignment${dryRun ? ' without dry-run writes' : " before review preparation"}`, async () => {
    const review = pendingReview(slug);
    const mission = fixtureMission(slug, { assignee: agentFamily('custom'), review: {
      ...review, rounds: [{ ...review.rounds[0], implementer: agentFamily('custom') }],
    } });
    const store = inMemoryTransitionStore(mission);
    let reviewPreparations = 0;
    const fake = fakeReviewLoopPorts({ slug, missionStore: store, lifecycle: new MissionLifecycleService(store),
      state: new ReviewState(slug, { implementer: 'custom', reviewer: 'claude', round: 1 }),
      reviewPreparation: { reviewPreparation: async () => {
        reviewPreparations += 1;
        assert.equal(store.mission().assignee, 'codex');
        assert.equal(store.mission().review!.rounds.at(-1)!.implementer, 'codex');
        return { ok: false, error: 'stop after identity observation' };
      } },
    });
    await runReviewLoop({ slug, isContinue: true, implementer: 'codex', dryRun }, fake.ports);
    assert.equal(reviewPreparations, dryRun ? 0 : 1);
    assert.equal(store.mission().assignee, dryRun ? 'custom' : 'codex');
    if (dryRun) { assert.deepEqual(store.mission(), mission); assert.deepEqual(fake.writes, []); }
    assert.deepEqual(fake.launches, []);
  });
}


for (const boundary of ['approved review', 'missing lifecycle authority'] as const) {
  test(`implementer override preserves ${boundary} boundary`, async () => {
    const mission = fixtureMission(slug, { status: 'review', assignee: agentFamily('codex'),
      review: boundary === 'approved review' ? approvedReview(slug) : pendingReview(slug),
    });
    const store = inMemoryTransitionStore(mission);
    const fake = fakeReviewLoopPorts({ slug, missionStore: store,
      lifecycle: boundary === 'approved review' ? new MissionLifecycleService(store) : null,
    });
    await assert.rejects(runReviewLoop({ slug, isContinue: true, implementer: 'custom' }, fake.ports),
      boundary === 'approved review' ? /Revoke the approved review/ : /no lifecycle authority/);
    assert.deepEqual(store.mission(), mission);
    assert.deepEqual(fake.launches, []);
  });
}

for (const refused of [false, true]) {
  test(`polled approval uses the decision owner before success; refused=${refused} (TASK-2821)`, async () => {
    const effects: string[] = [];
    const fake = fakeReviewLoopPorts({
      slug,
      state: new ReviewState(slug, { reviewer: 'codex', implementer: 'claude', startedAt: '2026-10-25T00:00:00Z' }),
      provider: { pollReview: async () => 'APPROVED' },
      stateport: {
        recordApproval: async state => {
          assert.equal(state.phase, 'approved');
          effects.push('decision');
          if (refused) { throw new Error('approval lifecycle refused'); }
        },
      },
      task: { mirrorApproved: async () => { effects.push('mirror'); } },
    });
    const persist = fake.ports.state.persist;
    fake.ports.state.persist = async state => {
      assert.notEqual(state.phase, 'approved', 'approval must never be a bookkeeping write');
      await persist(state);
    };
    await runReviewLoop({ slug, isContinue: true, maxAttempts: 1 }, fake.ports);
    assert.deepEqual(effects, refused ? ['decision'] : ['decision', 'mirror']);
    assert.deepEqual(fake.exits, refused ? [1] : []);
    assert.deepEqual(fake.launches, [], 'existing provider verdict needs no new agent');
  });
}


test('continuing pending preparation after a restart re-runs submission before reviewer launch (TASK-2822)', async () => {
  const store = inMemoryTransitionStore(fixtureMission(slug, { status: 'review', assignee: agentFamily('claude'),
    review: pendingReview(slug), reviewPreparationPending: true }));
  let preparations = 0;
  const fake = fakeReviewLoopPorts({ slug, missionStore: store,
    state: new ReviewState(slug, { implementer: 'claude', reviewer: 'codex', round: 1 }),
    reviewPreparation: { reviewPreparation: async () => { preparations++; return { ok: false, error: 'controlled preparation stop' }; } },
  });
  await runReviewLoop({ slug, isContinue: true }, fake.ports);
  assert.equal(preparations, 1);
  assert.deepEqual(fake.launches, []);
  assert.deepEqual(fake.exits, [1]);
});
// TASK-2806: a settled retained repair must reach a distinct, observable outcome.
for (const outcome of ['completed', 'failed', 'cancelled'] as const) {
  test(`retained repair ${outcome} outcome stays distinguishable at continuation (TASK-2806)`, async () => {
    const review = revokeApprovedDecision(approvedReview(slug), 1, {
      revokedAt: '2026-10-01T12:00:00Z', revokedBy: 'workflow', reason: 'gate failed',
      cause: { kind: 'integration-gate-failure', gate: 'npm test' },
    });
    const mission = fixtureMission(slug, { assignee: agentFamily('claude'), review, declaredGates: ['npm test'], successCriteria: ['repair works'], checkpoints: [{
      missionId: fixtureMission(slug).id, name: 'CP-6', goalCheck: [], nextActionText: 'repair',
      repair: { incidentId: 'incident-6', command: 'npm test', attempt: 1,
        authorizedGates: ['npm test'], authorizedCriteria: ['repair works'], evidenceRecorded: false, verified: false },
    }] });
    const store = inMemoryTransitionStore(mission);
    const calls = { launches: 0, checks: 0, certified: 0, handoffs: 0 };
    const fake = fakeReviewLoopPorts({ slug, missionStore: store,
      // The next lifecycle action; stop there so the case observes only the boundary.
      reviewPreparation: { reviewPreparation: async () => { calls.handoffs += 1; return { ok: true, gatekeeperPushedBack: true }; } },
      agents: { launch: async () => {
        calls.launches += 1;
        return { result: outcome === 'cancelled' ? { status: null, signal: 'SIGINT' } : { status: 0 } };
      } },
    });
    Object.assign(fake.ports, { retainedRepair: {
      read: async () => ({ evidence: { incidentId: 'retained', command: 'npm test', cwd: fake.ports.worktree,
        exitCode: 1, captureComplete: true, stdoutPath: '/retained/out', stderrPath: '/retained/err' }, stdout: 'failed', stderr: '' }),
      verify: async () => {
        calls.checks += 1;
        return outcome === 'completed' ? { ok: true, command: 'npm test' } : { ok: false, command: 'npm test', diagnostic: 'AssertionError: still fails' };
      },
      checkpoints: { open: async () => ({ name: 'CP-6', version: 1 }), readBlocker: async () => undefined, verify: async () => { calls.certified += 1; } },
    } });
    await runReviewLoop({ slug, isContinue: true, implementer: 'claude', reboundsPerRound: 1 }, fake.ports);
    const after = store.mission();
    assert.deepEqual(after.review, mission.review, 'no approval is synthesized or round rewritten');
    assert.ok(fake.launches.every(launch => launch.role !== 'reviewer'), 'no reviewer is launched by repair settlement');
    if (outcome === 'completed') {
      assert.deepEqual(calls, { launches: 1, checks: 1, certified: 1, handoffs: 1 }, 'the verified repair proceeds to handoff');
      assert.equal(fake.errors.some(line => line.includes('Retained verification repair failed')), false);
      return;
    }
    assert.equal(calls.handoffs, 0, `${outcome} repair never advances the lifecycle`);
    assert.equal(calls.certified, 0);
    assert.deepEqual(fake.exits, [1]);
    if (outcome === 'failed') {
      assert.deepEqual({ launches: calls.launches, checks: calls.checks }, { launches: 1, checks: 1 });
      assert.match(fake.errors.join('\n'), /still fails/, 'the repair failure is reported');
    } else {
      assert.equal(calls.checks, 0, 'a cancelled agent run is not verified as a repair');
      assert.doesNotMatch(fake.errors.join('\n'), /still fails/);
    }
  });
}

import { changeRevision, currentReviewRound, replaceCurrentRound } from '../../../../src/domain/review.js';
import { readReviewState, persistReviewStateOrThrow, writeReviewState } from '../../../../src/adapters/review/review-state.js';
import { recordApproval } from '../../../../src/adapters/review/review-round.js';
import { ReviewSubmissionService } from '../../../../src/application/review-submission-service.js';
import { makePorts, makeRecorder } from '../../../helpers/review-preparation-ports.js';

function changedRepairScenario(status: 'active' | 'review' = 'active') {
  const approved = approvedReview(slug);
  const original = currentReviewRound(approved);
  const cause = { kind: 'integration-gate-failure' as const, gate: 'unit', command: 'npm test' };
  const review = { ...approved, rounds: replaceCurrentRound(approved, { ...original,
    subject: { ...original.subject, baseline: changeRevision('base') },
    decision: { ...original.decision!, revision: changeRevision('fixture-revision') },
    integrationRepairAssessment: { assessedAt: '2026-10-01T12:00:00Z', approvedRevision: 'fixture-revision',
      candidateRevision: 'fixture-revision', failedGate: 'unit', outcome: 'pending' as const,
      repair: { startedAt: '2026-10-01T12:00:00Z', cause } },
  }) };
  const baseMission = fixtureMission(slug);
  const mission = fixtureMission(slug, { status, assignee: agentFamily('codex'), review,
    checkpoints: baseMission.checkpoints.map(cp => ({ ...cp,
      recording: { recordedAt: '2026-10-02T09:00:00Z', recordedRound: 1, missionRevision: 2 },
      goalCheck: cp.goalCheck.map(row => ({ ...row, recordedRound: 1 })),
      repair: { incidentId: 'successful-repair', command: 'npm test', attempt: 1, authorizedGates: [],
        authorizedCriteria: [], evidenceRecorded: true, verified: true },
    })),
  });
  const store = inMemoryTransitionStore(mission);
  const lifecycle = new MissionLifecycleService(store);
  const decisions: string[] = [];
  const fake = fakeReviewLoopPorts({ slug, missionStore: store, lifecycle,
    preReview: { head: () => 'repaired-revision', reviewBaseline: () => 'base' },
    stateport: {
      read: () => readReviewState(slug, fake.ports.worktree, store),
      persist: state => persistReviewStateOrThrow(writeReviewState, slug, state, fake.ports.worktree, store).then(() => {}),
      recordApproval: async (state, observation) => {
        decisions.push(String(observation?.revision ?? fake.ports.preReview.head()));
        const result = await recordApproval(slug, { comment: 'fresh review', revision: observation?.revision ?? fake.ports.preReview.head(),
          decidedAt: observation?.decidedAt ?? '2026-10-02T12:00:00Z' }, { missionStore: store, lifecycleService: lifecycle });
        assert.notEqual(result.outcome, 'failed', JSON.stringify(result));
      },
    },
    reviewPreparation: { reviewPreparation: async () => {
      const loaded = await store.load();
      const current = currentReviewRound(loaded.mission.review!);
      assert.equal(current.number, 2);
      assert.equal(current.decision, null);
      const ports = makePorts(makeRecorder(), {
        git: { git: () => ({ status: 0, signal: null, stdout: 'repaired-revision', stderr: '' }) },
        agentSelection: { eligibleAgentsForStep: () => ['claude', 'codex'], selectAgent: () => 'claude' },
      });
      const result = await new ReviewSubmissionService(ports).submit(slug, {
        rootDir: fake.ports.worktree, missionDirPath: '/fixture/mission', branch: `mission/${slug}`,
        forgejoUser: 'codex', checkpoint: null, submittedPr: null, occurredAt: '2026-10-02T11:00:00Z',
        missionServicesFn: async () => ({ store, lifecycle,
          checkpoints: { record: async () => assert.fail('durable checkpoints must remain unchanged') },
          nel: { recordNel: async () => assert.fail('submission must not rewrite NEL') } }),
        eligibleAgentsForStepFn: ports.agentSelection.eligibleAgentsForStep,
        selectAgentFn: ports.agentSelection.selectAgent, log: () => {}, error: message => assert.fail(message),
      });
      assert.equal(result, null);
      assert.equal(currentReviewRound(store.mission().review!).subject.revision, 'repaired-revision');
      return { ok: true };
    } },
    artifacts: { consumeReviewer: async () => ({ consumed: true, ok: true, reviewState: 'APPROVED' }) },
  });
  Object.assign(fake.ports, { integrationApprovalEvidence: {
    samePatch: async () => false, validation: async () => null,
    reconcileHumanFeedback: async () => true, now: () => '2026-10-02T10:00:00Z',
  } });
  return { fake, store, mission, decisions };
}

test('successful changed integration repair requires a fresh current-revision reviewer decision (TASK-2824)', async () => {
  const { fake, store, mission, decisions } = changedRepairScenario();
  await runReviewLoop({ slug, isContinue: true }, fake.ports);
  assert.deepEqual(fake.launches.map(item => [item.role, item.agent, item.prompt?.attempt]), [['reviewer', 'claude', 2]], fake.errors.join('\n'));
  assert.deepEqual(decisions, ['repaired-revision'], 'historical approval must never be replayed');
  assert.deepEqual(fake.exits, []);
  const result = store.mission();
  assert.equal(result.status, 'integration', 'landing remains a human action');
  assert.equal(currentReviewRound(result.review!).decision?.revision, 'repaired-revision');
  assert.equal(result.review!.rounds[0].decision?.revision, 'fixture-revision');
  assert.equal(result.review!.rounds[0].decision?.kind === 'approved' && result.review!.rounds[0].decision.revocation?.cause?.kind, 'integration-gate-failure');
  assert.deepEqual(result.checkpoints, mission.checkpoints);
  assert.equal(result.assignee, 'codex');
});

for (const lane of ['active', 'review'] as const) {
  test(`interrupted changed repair resumes the undecided round from ${lane} without stale replay (TASK-2824)`, async () => {
    const { fake, store, decisions } = changedRepairScenario(lane);
    const prepare = fake.ports.reviewPreparation!.reviewPreparation;
    fake.ports.reviewPreparation!.reviewPreparation = async () => ({ ok: false, error: 'interrupted before preparation' });
    await runReviewLoop({ slug, isContinue: true }, fake.ports);
    assert.equal(currentReviewRound(store.mission().review!).number, 2);
    assert.equal(currentReviewRound(store.mission().review!).decision, null);
    assert.deepEqual(decisions, []);
    assert.deepEqual(fake.launches, []);
    fake.ports.reviewPreparation!.reviewPreparation = prepare;
    await runReviewLoop({ slug, isContinue: true }, fake.ports);
    assert.equal(currentReviewRound(store.mission().review!).number, 2);
    assert.equal(store.mission().status, 'integration');
    assert.equal(currentReviewRound(store.mission().review!).subject.revision, 'repaired-revision');
    assert.deepEqual(decisions, ['repaired-revision']);
    const accepted = structuredClone(store.mission().review);
    await runReviewLoop({ slug, isContinue: true }, fake.ports);
    assert.deepEqual(store.mission().review, accepted, 'retry preserves the accepted decision and time');
    assert.equal(fake.launches.length, 1);
    assert.equal(decisions.join(','), 'repaired-revision,repaired-revision');
  });
}

for (const fault of ['comparison', 'revision', 'authority', 'newer decision', 'dry-run'] as const) {
  test(`pending integration assessment preserves judgment on ${fault} (TASK-2824)`, async () => {
    const { fake, store } = changedRepairScenario();
    const initial = structuredClone(store.mission());
    if (fault === 'comparison') { fake.ports.integrationApprovalEvidence!.samePatch = async () => { throw new Error('unreadable git'); }; }
    if (fault === 'revision') { fake.ports.preReview.head = () => null; }
    if (fault === 'authority') { Object.assign(fake.ports, { lifecycle: null }); }
    if (fault === 'newer decision') {
      fake.ports.integrationApprovalEvidence!.samePatch = async () => {
        const current = store.mission();
        const round = currentReviewRound(current.review!);
        await store.save({ ...current, closedAt: null, status: 'integration', review: { ...current.review!, rounds: replaceCurrentRound(current.review!, {
          ...round, decision: { ...round.decision!, comment: 'newer independent judgment' },
        }) } });
        return false;
      };
    }
    await runReviewLoop({ slug, isContinue: true, dryRun: fault === 'dry-run' }, fake.ports);
    assert.deepEqual(fake.launches, []);
    assert.equal(store.mission().review!.rounds.length, 1);
    assert.deepEqual(store.mission().review!.rounds[0].decision, fault === 'newer decision'
      ? { ...initial.review!.rounds[0].decision!, comment: 'newer independent judgment' } : initial.review!.rounds[0].decision);
    assert.deepEqual(store.mission().checkpoints, initial.checkpoints);
    assert.deepEqual(fake.exits, fault === 'dry-run' ? [] : [1]);
  });
}

test('equivalent repair continuation retains the original judgment with existing validation (TASK-2824)', async () => {
  const { fake, store, mission, decisions } = changedRepairScenario();
  fake.ports.integrationApprovalEvidence!.samePatch = async () => true;
  fake.ports.integrationApprovalEvidence!.validation = async () => ({ missionId: slug, sha: 'repaired-revision', baseline: 'base',
    hooks: ['unit'], createdAt: '2026-10-02T09:00:00Z', reference: 'operational_history:1' });
  await runReviewLoop({ slug, isContinue: true }, fake.ports);
  assert.equal(store.mission().status, 'integration');
  assert.equal(store.mission().review!.rounds.length, 1);
  assert.deepEqual(currentReviewRound(store.mission().review!).decision, currentReviewRound(mission.review!).decision);
  assert.deepEqual(fake.launches, []);
  assert.deepEqual(decisions, []);
  assert.deepEqual(fake.exits, []);
});

for (const interrupted of [false, true]) {
  test(`changed repair dismisses only its historical provider revision; interrupted=${interrupted} (TASK-2824)`, async () => {
    const { fake, store, decisions } = changedRepairScenario();
    const dismissed: string[] = [];
    Object.assign(fake.ports, { provider: fakeProvider({ dismissApproval: async revision => {
      dismissed.push(revision);
      if (interrupted) { throw new Error('provider dismissal interrupted'); }
    } }) });
    if (interrupted) {
      await assert.rejects(runReviewLoop({ slug, isContinue: true }, fake.ports), /dismissal interrupted/);
      assert.deepEqual(fake.launches, []);
      assert.deepEqual(decisions, []);
      assert.equal(currentReviewRound(store.mission().review!).decision, null);
    }
    await runReviewLoop({ slug, isContinue: true }, fake.ports);
    assert.deepEqual(dismissed, ['fixture-revision']);
    assert.equal(currentReviewRound(store.mission().review!).number, 2);
    assert.equal(store.mission().status, 'integration');
    assert.equal(currentReviewRound(store.mission().review!).subject.revision, 'repaired-revision');
    assert.deepEqual(decisions, ['repaired-revision']);
  });
}
