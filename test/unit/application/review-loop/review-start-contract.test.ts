// Review start owns the handoff prerequisite, its failure boundaries, and dry-run.
import test from 'node:test';
import { agentFamily } from '../../../../src/domain/agents.js';
import { missionExecutionContext } from '../../../fixtures/mission-execution-context.js';
import assert from 'node:assert/strict';
import { runReviewLoop } from '../../../../src/application/review-loop/review-loop.js';
import { ReviewState } from '../../../../src/adapters/review/review-state.js';
import { fakeProvider, fakeReviewLoopPorts } from '../../../helpers/review-loop-ports.js';
import { missionId } from '../../../../src/domain/mission.js';

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
  assert.deepEqual(fake.launches.map(launch => [launch.role, launch.agent, launch.prompt?.attempt, launch.sessionPolicy]), [['reviewer', 'custom', 3, 'fresh-ephemeral']]);
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

test('a persisted no-mirror wave child enters the autonomous review loop without a task file (TASK-2847)', async () => {
  const childSlug = 'task-2846.02';
  const mission = fixtureMission(childSlug, {
    assignee: agentFamily('claude'),
    waveParentId: missionId('task-2846'),
  });
  const store = inMemoryTransitionStore(mission);
  let preparations = 0;
  const fake = fakeReviewLoopPorts({
    slug: childSlug,
    missionStore: store,
    task: { task: { ok: false, reason: 'missing', matches: [] } },
    reviewPreparation: { reviewPreparation: async () => {
      preparations += 1;
      return { ok: true, gatekeeperPushedBack: true };
    } },
  });

  await runReviewLoop({ slug: childSlug, maxAttempts: 1 }, fake.ports);

  assert.equal(preparations, 1, 'the missing mirror must not stop the loop before review preparation');
  assert.doesNotMatch(fake.errors.join('\n'), /unresolved task|not found|ambiguous/i);
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
import { requestedChangesReview } from '../../../fixtures/mission-builders.js';
import { applyImplementerCommand, changeRevision, reviewFindingId } from '../../../../src/domain/review.js';
import { reviewStateDataFrom } from '../../../../src/adapters/review/review-state-mapping.js';

for (const dryRun of [false, true]) {
  test(`resolved review continuation ${dryRun ? 'previews without writes' : 'stops if next-round preparation fails'}`, async () => {
    const review = applyImplementerCommand(requestedChangesReview(slug, {
      startedAt: '2026-11-09T07:25:00Z', decidedAt: '2026-11-09T07:32:00Z',
    }), {
      type: 'submit-resolution', respondedAt: '2026-11-09T07:44:00Z', resultingRevision: changeRevision('fixed-revision'),
      resolutions: [{ findingId: reviewFindingId('fixture-finding'), kind: 'fixed', evidence: 'committed fix' }],
    });
    const mission = fixtureMission(slug, { status: 'review', assignee: agentFamily('codex'), review });
    const store = inMemoryTransitionStore(mission);
    let preparations = 0;
    const fake = fakeReviewLoopPorts({ slug, missionStore: store, lifecycle: new MissionLifecycleService(store),
      state: new ReviewState(slug, reviewStateDataFrom(review)), provider: {},
      reviewPreparation: { reviewPreparation: async () => {
        preparations++;
        return { ok: false, error: 'verification unavailable' };
      } },
      preReview: {
        rebase: async () => assert.fail('preparation must finish before reviewer setup'),
        runGate: async () => assert.fail('preparation must finish before reviewer setup'),
      },
    });
    await runReviewLoop({ slug, isContinue: true, dryRun }, fake.ports);
    assert.equal(preparations, dryRun ? 0 : 1);
    assert.deepEqual(fake.exits, dryRun ? [] : [1]);
    assert.deepEqual(fake.launches, []);
    assert.deepEqual(fake.writes, []);
    assert.deepEqual(store.mission(), mission, 'keep the decision and completed response for retry');
    assert.deepEqual(store.events, []);
  });
}

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

import { currentReviewRound, replaceCurrentRound, type ChangeRevision } from '../../../../src/domain/review.js';
import { readReviewState, persistReviewStateOrThrow, writeReviewState } from '../../../../src/adapters/review/review-state.js';
import { recordApproval } from '../../../../src/adapters/review/review-round.js';
import { ReviewSubmissionService } from '../../../../src/application/review-submission-service.js';
import { makePorts, makeRecorder } from '../../../helpers/review-preparation-ports.js';

function changedRepairScenario(status: 'active' | 'review' = 'active', approvedRevision: ChangeRevision | null = changeRevision('fixture-revision')) {
  const approved = approvedReview(slug);
  const original = currentReviewRound(approved);
  const cause = { kind: 'integration-gate-failure' as const, gate: 'unit', command: 'npm test' };
  const review = { ...approved, rounds: replaceCurrentRound(approved, { ...original,
    subject: { ...original.subject, baseline: changeRevision('base') },
    decision: { ...original.decision!, revision: approvedRevision },
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
  // Production review reaches retention only through the composed certification owner.
  const integration = stubIntegrateWorkflowPorts({
    process: { cwd: () => fake.ports.worktree },
    missionPaths: { resolveWorktree: () => fake.ports.worktree, resolveMissionBaseBranch: () => 'main', resolveBaseWorktree: () => fake.ports.worktree, missionBranchName: () => `mission/${slug}` },
    git: { git: () => ({ status: 0, stdout: 'base', stderr: '' }) },
    landing: { createAbort: () => new Error('integration repair aborted') },
    gates: { approvalEvidence: () => fake.ports.integrationApprovalEvidence!,
      captureFinalIntegrationTree: () => { const commit = fake.ports.preReview.head(); return commit ? { ok: true, commit } : { ok: false }; },
      loadPhaseGates: () => [{ key: 'unit', command: 'npm test', order: 1 }], runPhaseGates: async () => ({ ok: true }) },
  });
  const services = integrationServices({ store, lifecycle });
  Object.assign(fake.ports, { integrationRepair: { resume: async () => (await certifyPendingIntegrationRepair(slug, services, integration,
    missionExecutionContext({ missionId: slug, missionWorktree: fake.ports.worktree, baseWorktree: fake.ports.worktree })))?.outcome ?? 'none' } });
  return { fake, store, mission, decisions };
}

test('successful changed integration repair requires a fresh current-revision reviewer decision (TASK-2824)', async () => {
  const { fake, store, mission, decisions } = changedRepairScenario();
  await runReviewLoop({ slug, isContinue: true }, fake.ports);
  assert.deepEqual(fake.launches.map(item => [item.role, item.agent, item.prompt?.attempt, item.sessionPolicy]), [['reviewer', 'claude', 2, 'fresh-ephemeral']], fake.errors.join('\n'));
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
    // An uncommitted candidate or a missing certification owner fails closed with a typed stop.
    if (fault === 'revision') { fake.ports.preReview.head = () => null; }
    if (fault === 'authority') { Object.assign(fake.ports, { integrationRepair: undefined }); }
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
    const typedStop = fault === 'revision' || fault === 'authority';
    const run = runReviewLoop({ slug, isContinue: true, dryRun: fault === 'dry-run' }, fake.ports);
    if (typedStop) {
      await assert.rejects(run, error => fault === 'revision' ? /integration repair aborted/.test(String(error))
        : (error as { failureReason?: FailureReason }).failureReason?.code === 'approval-retention-pending');
    } else { await run; }
    assert.deepEqual(fake.launches, []);
    assert.equal(store.mission().review!.rounds.length, 1);
    assert.deepEqual(store.mission().review!.rounds[0].decision, fault === 'newer decision'
      ? { ...initial.review!.rounds[0].decision!, comment: 'newer independent judgment' } : initial.review!.rounds[0].decision);
    assert.deepEqual(store.mission().checkpoints, initial.checkpoints);
    assert.deepEqual(fake.exits, fault === 'dry-run' || typedStop ? [] : [1]);
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

import { certifyPendingIntegrationRepair } from '../../../../src/application/integrate/repair-resumption.js';
import { stubIntegrateWorkflowPorts } from '../../../helpers/stub-integrate-workflow-ports.js';
import { integrationServices } from '../../../helpers/stub-integration-services.js';
import type { IntegrationApprovalEvidencePort } from '../../../../src/application/ports/integration-approval-evidence.js';

async function approvedRepairScenario() {
  const scenario = changedRepairScenario('review');
  const { fake, store } = scenario;
  const initial = store.mission();
  await store.save({ ...initial, reviewPreparationPending: true, checkpoints: initial.checkpoints.map(cp => ({ ...cp,
    repair: { ...cp.repair!, command: 'npm test', verified: false,
      occurrence: { openedMissionRevision: 1, worktree: fake.ports.worktree, failureRevision: 'fixture-revision', failureEvidenceId: 'original:1' } },
  })) });
  const original = store.mission().review!;
  const calls: string[] = [];
  let validation: Awaited<ReturnType<IntegrationApprovalEvidencePort['validation']>> = null;
  const evidence: IntegrationApprovalEvidencePort = {
    now: () => new Date().toISOString(), reconcileHumanFeedback: async () => true,
    samePatch: async () => { calls.push('compare'); assert.equal(store.mission().checkpoints[0].repair?.verified, true); return true; },
    validation: async () => validation,
  };
  const services = integrationServices({ store, lifecycle: new MissionLifecycleService(store), operationalHistory: {
    loadLatestByTypeForMission: async () => null, recordIntegrationValidation: async input => {
      calls.push('validation'); validation = { ...input, baseline: input.baseline ?? null,
        createdAt: new Date().toISOString(), reference: 'operational_history:manual' };
    },
  } });
  const integration = stubIntegrateWorkflowPorts({
    process: { cwd: () => fake.ports.worktree },
    missionPaths: { resolveWorktree: () => fake.ports.worktree, resolveMissionBaseBranch: () => 'main', resolveBaseWorktree: () => fake.ports.worktree, missionBranchName: () => `mission/${slug}` },
    git: { git: () => ({ status: 0, stdout: 'base', stderr: '' }) },
    gates: { approvalEvidence: () => evidence, captureFinalIntegrationTree: () => ({ ok: true, commit: 'repaired-revision' }),
      loadPhaseGates: () => [{ key: 'unit', command: 'npm test', order: 1 }],
      runPhaseGates: async () => { calls.push('verify'); return { ok: true }; } },
  });
  Object.assign(fake.ports, { retainedRepair: {
    read: async () => ({ evidence: { incidentId: 'original', attempt: 1, command: 'npm test', cwd: fake.ports.worktree,
      exitCode: 1, captureComplete: true, stdoutPath: '/original/out', stderrPath: '/original/err' }, stdout: 'failed', stderr: '' }),
    verify: async (command: string, worktree: string) => { calls.push('exact'); return { ok: true, command, exactExecution: { command, worktree, exitCode: 0 as const } }; }, checkpoints: new RepairCheckpointService(store),
  }, integrationRepair: { resume: async () => (await certifyPendingIntegrationRepair(slug, services, integration, missionExecutionContext({ missionId: slug, missionWorktree: fake.ports.worktree, baseWorktree: fake.ports.worktree }), undefined, fake.ports.retainedRepair))?.outcome ?? 'none' } });
  return { fake, store, original, calls, integration, evidence };
}

test('direct approved review certifies before retaining without generic repair or launch (TASK-2833)', async () => {
  const { fake, store, original, calls } = await approvedRepairScenario();
  await runReviewLoop({ slug, isContinue: true }, fake.ports);
  assert.deepEqual(fake.exits, [], fake.errors.join('\n'));
  assert.deepEqual(calls, ['exact', 'verify', 'validation', 'compare']);
  assert.deepEqual(fake.launches, []);
  assert.equal(store.mission().status, 'integration');
  assert.deepEqual(currentReviewRound(store.mission().review!).decision, currentReviewRound(original).decision);
  assert.match(fake.logs.join('\n'), /human px integrate/);
});

import { failureReason, type FailureReason } from '../../../../src/domain/failure-reason.js';

test('approved direct review requires an available certification owner (TASK-2833)', async () => {
  const s = await approvedRepairScenario();
  const before = structuredClone(s.store.mission());
  Object.assign(s.fake.ports, { integrationRepair: undefined });
  await assert.rejects(runReviewLoop({ slug, isContinue: true }, s.fake.ports), error => {
    assert.equal((error as { failureReason?: FailureReason }).failureReason?.code, 'approval-retention-pending');
    return true;
  });
  assert.deepEqual(s.store.mission(), before, 'unavailable certification preserves approval and original repair evidence');
  assert.deepEqual(s.calls, [], 'cannot verify or retain approval through a missing owner');
  assert.deepEqual(s.fake.launches, []);
});

for (const fault of ['failed', 'missing-evidence', 'missing-receipt', 'incomplete-capture', 'stale-head', 'stale-version', 'human-blocker'] as const) {
  test(`approved direct review stops without certification on ${fault} (TASK-2833)`, async () => {
    const s = await approvedRepairScenario();
    const before = structuredClone(s.store.mission());
    const retained = s.fake.ports.retainedRepair!;
    if (fault === 'missing-evidence') {
      Object.assign(retained, { read: async () => { throw new Error('missing original capture'); } });
    } else if (fault === 'incomplete-capture') {
      const read = retained.read;
      Object.assign(retained, { read: async () => { const original = await read('npm test'); return { ...original, evidence: { ...original.evidence, captureComplete: false } }; } });
    } else if (fault === 'human-blocker') {
      await s.store.save({ ...before, checkpoints: before.checkpoints.map(cp => ({ ...cp, repair: { ...cp.repair!, blocker: {
        command: 'npm test', diagnostic: 'operator-owned contract', authorityReason: 'locked gate', proposedCorrection: 'operator decision',
      } } })) });
    } else {
      Object.assign(retained, { verify: async () => {
        if (fault === 'stale-head') { s.integration.gates.captureFinalIntegrationTree = () => ({ ok: true, commit: 'other-head' }); }
        if (fault === 'stale-version') { await s.store.save({ ...s.store.mission() }); }
        return fault === 'failed' ? { ok: false, diagnostic: 'arbitrary diagnostic', reason: {
          kind: 'gate-failure', area: 'repair', command: 'npm test', exitCode: 1,
          failureReason: failureReason('cpu-budget-exceeded', 'verification'),
        } } : { ok: true, ...(fault !== 'missing-receipt' ? { exactExecution: { command: 'npm test', worktree: s.fake.ports.worktree, exitCode: 0 } } : {}) };
      } });
    }
    await assert.rejects(runReviewLoop({ slug, isContinue: true }, s.fake.ports), error => {
      const reason = (error as { failureReason?: FailureReason }).failureReason;
      assert.equal(reason?.code, fault === 'failed' ? 'cpu-budget-exceeded' : ['incomplete-capture', 'missing-evidence'].includes(fault) ? 'incomplete-evidence'
        : fault === 'human-blocker' ? 'mission-contract-incomplete' : fault.startsWith('stale') ? 'state-machine' : 'incomplete-evidence');
      return true;
    });
    assert.equal(s.store.mission().checkpoints[0].repair?.verified, false);
    assert.deepEqual(currentReviewRound(s.store.mission().review!).decision, currentReviewRound(before.review!).decision);
    assert.equal(s.store.mission().checkpoints[0].repair?.occurrence?.failureEvidenceId, 'original:1');
    assert.deepEqual(s.fake.launches, []);
    assert.deepEqual(s.calls, [], 'neither phase verification nor retention runs on unproven exact evidence');
  });
}

test('dry-run previews pending certification before the generic retained repair (PX-0041.02)', async () => {
  const s = await approvedRepairScenario();
  const before = structuredClone(s.store.mission());
  await runReviewLoop({ slug, isContinue: true, dryRun: true }, s.fake.ports);
  assert.match(s.fake.logs.join('\n'), /certification and approval retention run before any generic repair; dry run certified nothing/);
  assert.doesNotMatch(s.fake.logs.join('\n'), /Retained repair:/, 'the generic retained repair is not the route of a pending approval');
  assert.deepEqual(s.calls, []);
  assert.deepEqual(s.fake.launches, []);
  assert.deepEqual(s.fake.exits, []);
  assert.deepEqual(s.store.mission(), before);
});

test('a repair settled by a concurrent controller hands off idempotently, not as a blocker (PX-0041.02)', async () => {
  const s = await approvedRepairScenario();
  const certify = s.fake.ports.integrationRepair!.resume;
  Object.assign(s.fake.ports, { integrationRepair: { resume: async (id: string) => { await certify(id); return 'none' as const; } } });
  await runReviewLoop({ slug, isContinue: true }, s.fake.ports);
  assert.deepEqual(s.fake.errors, [], 'an already settled repair is not reported as unproven');
  assert.deepEqual(s.fake.exits, []);
  assert.deepEqual(s.fake.launches, []);
  assert.match(s.fake.logs.join('\n'), /Original approval retained .* human px integrate is required to land/, 'the post-effect state routes the settled repair to the operator');
  assert.equal(s.store.mission().status, 'integration');
  assert.deepEqual(currentReviewRound(s.store.mission().review!).decision, currentReviewRound(s.original).decision);
});

test('a legacy withdrawal with no decided revision needs fresh review without a fabricated provider revision (PX-0041.02)', async () => {
  const { fake, store, decisions } = changedRepairScenario('active', null);
  const dismissed: string[] = [];
  // A competing controller settled the obligation on a legacy record whose approval never
  // recorded a decided revision; the withdrawal stays valid and its revision stays unknown.
  Object.assign(fake.ports, { provider: fakeProvider({ dismissApproval: async revision => { dismissed.push(revision); } }),
    integrationRepair: { resume: async () => {
      const current = store.mission();
      const review = revokeApprovedDecision(current.review!, currentReviewRound(current.review!).number, {
        revokedAt: '2026-10-02T10:00:00Z', revokedBy: 'workflow', reason: 'Integration repair changed the approved mission patch.',
        cause: { kind: 'integration-gate-failure', gate: 'unit', command: 'npm test' },
      });
      await store.save({ ...current, review });
      return 'none' as const;
    } } });
  await runReviewLoop({ slug, isContinue: true }, fake.ports);
  assert.deepEqual(dismissed, [], 'no decided revision exists, so the review must not dismiss a fabricated "null"');
  assert.match(fake.logs.join('\n'), /withdrew an approval with no recorded revision; no provider dismissal is possible and fresh review is still required/);
  assert.equal(currentReviewRound(store.mission().review!).number, 2);
  assert.equal(currentReviewRound(store.mission().review!).decision?.revision, 'repaired-revision',
    'the undismissable withdrawal still leaves a fresh current-revision review owed and answered');
  assert.deepEqual(decisions, ['repaired-revision'], 'the opened round still gets a current-revision decision');
});

test('a continuation that lost the CAS hands off the competing retention instead of blocking (PX-0041.02)', async () => {
  const s = await approvedRepairScenario();
  const certify = s.fake.ports.integrationRepair!.resume;
  // The competing controller won the CAS; this caller only reports that its own retention lost.
  Object.assign(s.fake.ports, { integrationRepair: { resume: async (id: string) => { await certify(id); return 'blocked' as const; } } });
  await runReviewLoop({ slug, isContinue: true }, s.fake.ports);
  assert.deepEqual(s.fake.errors, [], 'a CAS loser does not report a settled repair as unproven');
  assert.deepEqual(s.fake.exits, []);
  assert.deepEqual(s.fake.launches, []);
  assert.match(s.fake.logs.join('\n'), /Original approval retained .* human px integrate is required to land/);
  assert.equal(s.store.mission().status, 'integration');
});

test('a repair a competing controller landed owes no second px integrate (PX-0041.02)', async () => {
  const s = await approvedRepairScenario();
  const certify = s.fake.ports.integrationRepair!.resume;
  Object.assign(s.fake.ports, { integrationRepair: { resume: async (id: string) => {
    await certify(id);
    const loaded = await s.store.load();
    await s.store.save({ ...loaded.mission, status: 'done', closedAt: '2026-10-02T12:00:00Z' }, loaded.version);
    return 'none' as const;
  } } });
  await runReviewLoop({ slug, isContinue: true }, s.fake.ports);
  assert.deepEqual(s.fake.errors, []);
  assert.deepEqual(s.fake.exits, []);
  assert.deepEqual(s.fake.launches, [], 'a landed Mission starts no review round');
  assert.match(s.fake.logs.join('\n'), /already landed; no review, launch or px integrate is owed/);
  assert.doesNotMatch(s.fake.logs.join('\n'), /human px integrate is required to land/, 'a landed Mission is not told to land again');
  assert.equal(s.store.mission().status, 'done');
});

test('a CAS loser answers the fresh review a competing controller opened for changed repair code (PX-0041.02)', async () => {
  const { fake, store, decisions } = changedRepairScenario();
  const certify = fake.ports.integrationRepair!.resume;
  const dismissed: string[] = [];
  // The winner revoked the approval and opened round 2; this caller only reports its own CAS loss.
  Object.assign(fake.ports, { provider: fakeProvider({ dismissApproval: async revision => { dismissed.push(revision); } }),
    integrationRepair: { resume: async (id: string) => { await certify(id); return 'blocked' as const; } } });
  await runReviewLoop({ slug, isContinue: true }, fake.ports);
  assert.deepEqual(fake.errors, [], 'a loser must not report an opened fresh review as an unproven blocker');
  assert.deepEqual(fake.exits, []);
  assert.deepEqual(dismissed, ['fixture-revision'], "the provider dismisses the approval the winner actually withdrew");
  assert.equal(currentReviewRound(store.mission().review!).number, 2, 'the round the winner opened is the round this caller answers');
  assert.deepEqual(decisions, ['repaired-revision'], 'that round is decided at the repaired revision');
});

test('a concurrent landing during a retained continuation is reported as landed, not as a second integrate (PX-0041.02)', async () => {
  const s = await approvedRepairScenario();
  const certify = s.fake.ports.integrationRepair!.resume;
  Object.assign(s.fake.ports, { integrationRepair: { resume: async (id: string) => {
    const outcome = await certify(id);
    const loaded = await s.store.load();
    await s.store.save({ ...loaded.mission, status: 'done', closedAt: '2026-10-02T12:00:00Z' }, loaded.version);
    return outcome;
  } } });
  await runReviewLoop({ slug, isContinue: true }, s.fake.ports);
  assert.deepEqual(s.fake.errors, []);
  assert.deepEqual(s.fake.exits, []);
  assert.deepEqual(s.fake.launches, [], 'a landed Mission starts no review round');
  assert.match(s.fake.logs.join('\n'), /already landed; no review, launch or px integrate is owed/);
  assert.doesNotMatch(s.fake.logs.join('\n'), /human px integrate is required to land/, 'the operator is not told to land it again');
  assert.equal(s.store.mission().status, 'done');
});

test('repeated approved direct review does not rerun certification or launch (TASK-2833)', async () => {
  const s = await approvedRepairScenario();
  await runReviewLoop({ slug, isContinue: true }, s.fake.ports);
  const after = structuredClone(s.store.mission());
  s.calls.length = 0;
  await runReviewLoop({ slug, isContinue: true }, s.fake.ports);
  assert.deepEqual(s.store.mission(), after);
  assert.deepEqual(s.fake.launches, []);
  assert.deepEqual(s.calls, []);
});

// TASK-2831: an approved round with an uncertified integration gate repair resumes the
// integration owners (exact check, then retention), never the generic review repair.
const authorizedRepairCommand = 'npm run test:e2e:browser';

function approvedIntegrationRepairScenario(options: { verifyOk?: boolean; blocker?: boolean } = {}) {
  const verifyOk = options.verifyOk !== false;
  const effects: string[] = [];
  const fake = fakeReviewLoopPorts({ slug,
    preReview: { head: () => 'repaired-revision', reviewBaseline: () => 'base' },
    reviewPreparation: { reviewPreparation: async () => assert.fail('an uncertified integration repair must not reach review preparation') },
  });
  const worktree = fake.ports.worktree;
  const approved = approvedReview(slug);
  const original = currentReviewRound(approved);
  const cause = { kind: 'integration-gate-failure' as const, gate: 'browser-e2e', command: authorizedRepairCommand };
  const review = { ...approved, rounds: replaceCurrentRound(approved, { ...original,
    subject: { ...original.subject, baseline: changeRevision('base') },
    decision: { ...original.decision!, revision: changeRevision('approved-revision') },
    integrationRepairAssessment: { assessedAt: '2026-11-01T12:00:00Z', approvedRevision: 'approved-revision',
      candidateRevision: 'approved-revision', failedGate: 'browser-e2e', outcome: 'pending' as const,
      repair: { startedAt: '2026-11-01T12:00:00Z', cause } },
  }) };
  const mission = fixtureMission(slug, { status: 'review', reviewPreparationPending: true, assignee: agentFamily('codex'),
    declaredGates: [authorizedRepairCommand], successCriteria: ['browser e2e passes'], review,
    checkpoints: [{ missionId: fixtureMission(slug).id, name: 'CP-7',
      goalCheck: [{ criterion: 'browser e2e passes', evidence: 'test/e2e/browser.test.ts' }],
      nextActionText: 'rerun the authorized required check',
      recording: { recordedAt: '2026-11-01T11:00:00Z', recordedRound: 7, missionRevision: 1 },
      repair: { incidentId: 'incident-7', command: authorizedRepairCommand, attempt: 1,
        authorizedGates: [authorizedRepairCommand], authorizedCriteria: ['browser e2e passes'],
        evidenceRecorded: true, verified: false,
        ...(options.blocker ? { blocker: { command: authorizedRepairCommand, diagnostic: 'the declared gate cannot prove the criterion',
          authorityReason: 'the criterion names a check the declaration does not run', proposedCorrection: 'operator corrects the declared gate' } } : {}),
        occurrence: { openedMissionRevision: 1, worktree, failureRevision: 'approved-revision', failureEvidenceId: 'incident-7:1' } },
    }] });
  const store = inMemoryTransitionStore(mission);
  const approvalEvidence: IntegrationApprovalEvidencePort = {
    samePatch: async () => { effects.push('same-patch'); return true; },
    validation: async () => { effects.push('validation'); return { missionId: slug, sha: 'repaired-revision', baseline: 'base',
      hooks: ['browser-e2e'], createdAt: '2026-11-01T13:00:00Z', reference: 'operational_history:1' }; },
    reconcileHumanFeedback: async () => true,
    now: () => '2026-11-01T14:00:00Z',
  };
  const services = integrationServices({ store, lifecycle: new MissionLifecycleService(store) });
  const integration = stubIntegrateWorkflowPorts({
    process: { cwd: () => worktree },
    missionPaths: { resolveWorktree: () => worktree, resolveMissionBaseBranch: () => 'main',
      resolveBaseWorktree: () => worktree, missionBranchName: () => `mission/${slug}` },
    git: { git: () => ({ status: 0, stdout: 'base', stderr: '' }) },
    gates: { approvalEvidence: () => approvalEvidence,
      captureFinalIntegrationTree: () => ({ ok: true, commit: 'repaired-revision' }),
      loadPhaseGates: () => [{ key: 'browser-e2e', command: authorizedRepairCommand, order: 1 }],
      runPhaseGates: async () => ({ ok: true }) },
  });
  Object.assign(fake.ports, { missionStore: store, lifecycle: new MissionLifecycleService(store),
    retainedRepair: {
      read: async () => ({ evidence: { version: 1, incidentId: 'incident-7', attempt: 1, command: authorizedRepairCommand,
        cwd: worktree, capturedRevision: 'approved-revision', exitCode: 1, signal: null, stdoutPath: '/retained/out',
        stderrPath: '/retained/err', stdoutBytes: 20, stderrBytes: 0, captureComplete: true, truncatedFrom: null,
        redacted: false, capturedAt: '2026-11-01T12:00:00Z' }, stdout: 'browser e2e failed', stderr: '' }),
      verify: async () => { effects.push('exact-check'); return verifyOk
        ? { ok: true as const, command: authorizedRepairCommand, exactExecution: { command: authorizedRepairCommand, worktree, exitCode: 0 as const } }
        : { ok: false as const, command: authorizedRepairCommand, diagnostic: 'AssertionError: browser e2e still fails' }; },
      checkpoints: new RepairCheckpointService(store),
    },
    integrationApprovalEvidence: approvalEvidence,
    integrationRepair: { resume: async () => (await certifyPendingIntegrationRepair(slug, services, integration,
      missionExecutionContext({ missionId: slug, missionWorktree: worktree, baseWorktree: worktree }), undefined, fake.ports.retainedRepair))?.outcome ?? 'none' } });
  return { fake, store, mission, effects };
}

test('direct review certifies the authorized exact check then assesses retention (TASK-2831)', async () => {
  const { fake, store, mission, effects } = approvedIntegrationRepairScenario();
  const approvedDecision = structuredClone(currentReviewRound(mission.review!).decision);
  await runReviewLoop({ slug, isContinue: true }, fake.ports);
  assert.doesNotMatch(fake.errors.join('\n'), /requires an undecided review round/, 'generic review repair must not gate the integration owners');
  assert.ok(effects.includes('exact-check'), 'the authorized exact check is re-run');
  assert.ok(effects.indexOf('exact-check') < effects.indexOf('same-patch'), 'certification precedes the retention assessment');
  const after = store.mission();
  assert.equal(after.status, 'integration', 'retention returns the mission to the human integrate lane, never the active repair lane');
  assert.deepEqual(currentReviewRound(after.review!).decision, approvedDecision, 'the independent approval is preserved');
  assert.equal(after.review!.rounds.length, 1, 'no duplicate review decision');
  const repaired = after.checkpoints.find(cp => cp.name === 'CP-7')!;
  assert.equal(repaired.repair?.verified, true, 'the exact check certifies the repair');
  assert.equal(repaired.repair?.exactSuccessCoverage?.producer, 'harness-exact-check');
  assert.equal(currentReviewRound(after.review!).integrationRepairAssessment?.outcome, 'retained');
  assert.deepEqual(fake.launches, [], 'no reviewer or implementer is launched to escape the deadlock');
  assert.deepEqual(fake.exits, []);
  assert.match(fake.logs.join('\n'), /px integrate/);
});

test('direct review leaves a locked integration contract to the operator (TASK-2831)', async () => {
  const { fake, store, effects } = approvedIntegrationRepairScenario({ blocker: true });
  const before = structuredClone(store.mission().checkpoints);
  await assert.rejects(runReviewLoop({ slug, isContinue: true }, fake.ports), error => {
    assert.equal((error as { failureReason?: FailureReason }).failureReason?.code, 'mission-contract-incomplete');
    assert.match(String(error), /Invalid locked contract requires human review/);
    assert.match(String(error), /"authorityReason":"the criterion names a check the declaration does not run"/,
      'the blocker evidence survives routing');
    return true;
  });
  assert.deepEqual(effects, [], 'a human-only contract stop consumes no exact-check rerun and no retention assessment');
  assert.deepEqual(store.mission().checkpoints, before, 'the stop and its authorization remain for the operator');
  assert.deepEqual(fake.launches, []);
  assert.deepEqual(fake.exits, []);
});

test('direct review stops on a red exact check without certifying or assessing retention (TASK-2831)', async () => {
  const { fake, store, mission, effects } = approvedIntegrationRepairScenario({ verifyOk: false });
  const approvedDecision = structuredClone(currentReviewRound(mission.review!).decision);
  await assert.rejects(runReviewLoop({ slug, isContinue: true }, fake.ports), error => {
    assert.equal((error as { failureReason?: FailureReason }).failureReason?.code, 'gate-failed');
    assert.match(String(error), /AssertionError: browser e2e still fails/, 'the verifier diagnostic survives routing');
    return true;
  });
  assert.deepEqual(effects, ['exact-check'], 'a red exact check may not reach the retention assessment');
  const after = store.mission();
  assert.equal(after.status, 'review', 'a red exact check keeps the mission in its lane');
  assert.equal(after.checkpoints.find(cp => cp.name === 'CP-7')!.repair?.verified, false, 'a red check certifies nothing');
  assert.equal(after.checkpoints.find(cp => cp.name === 'CP-7')!.repair?.exactSuccessCoverage, undefined);
  assert.deepEqual(currentReviewRound(after.review!).decision, approvedDecision, 'the approval is neither revoked nor claimed retained');
  assert.equal(currentReviewRound(after.review!).integrationRepairAssessment?.outcome, 'pending');
  assert.deepEqual(fake.launches, []);
  assert.deepEqual(fake.exits, []);
});


test('direct review preserves one red-check diagnostic when command exit throws (TASK-2831 F1)', async () => {
  const { fake, store, mission, effects } = approvedIntegrationRepairScenario({ verifyOk: false });
  const stopped = Object.freeze({ kind: 'command-exit' });
  fake.ports.output.exit = code => { fake.exits.push(code!); throw stopped; };
  await assert.rejects(runReviewLoop({ slug, isContinue: true }, fake.ports), error => {
    assert.notEqual(error, stopped, 'typed certification failure must not route through command exit');
    assert.equal((error as { failureReason?: FailureReason }).failureReason?.code, 'gate-failed');
    assert.match(String(error), /AssertionError: browser e2e still fails/);
    return true;
  });
  assert.deepEqual(fake.errors, [], 'the typed failure is surfaced once instead of being reported again');
  assert.deepEqual(fake.exits, []);
  assert.deepEqual(effects, ['exact-check']);
  assert.deepEqual(store.mission().checkpoints, mission.checkpoints, 'the repair remains uncertified');
  assert.deepEqual(store.mission().review, mission.review, 'the original decision and pending assessment survive');
  assert.equal(store.mission().status, 'review');
  assert.deepEqual(fake.launches, []);
});
