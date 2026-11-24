// Review start owns the handoff prerequisite, its failure boundaries, and dry-run.
import test from 'node:test';
import { agentFamily } from '../../../../src/domain/agents.js';
import assert from 'node:assert/strict';
import { runReviewLoop } from '../../../../src/application/review-loop/review-loop.js';
import { ReviewState } from '../../../../src/adapters/review/review-state.js';
import { fakeReviewLoopPorts } from '../../../helpers/review-loop-ports.js';
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
  await runReviewLoop({ slug, implementer: 'claude', actionLimit: 40 }, fake.ports);
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

  await runReviewLoop({ slug: childSlug, actionLimit: 40 }, fake.ports);

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
  await runReviewLoop({ slug, actionLimit: 40 }, fake.ports);
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
  await assert.rejects(runReviewLoop({ slug, actionLimit: 40 }, fake.ports), /store unavailable/);
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
          return 'recorded';
        },
      },
      task: { mirrorApproved: async () => { effects.push('mirror'); } },
    });
    const persist = fake.ports.state.persist;
    fake.ports.state.persist = async state => {
      assert.notEqual(state.phase, 'approved', 'approval must never be a bookkeeping write');
      await persist(state);
    };
    await runReviewLoop({ slug, isContinue: true, actionLimit: 40 }, fake.ports);
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
