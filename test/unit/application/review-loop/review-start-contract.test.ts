// Review start owns the handoff prerequisite, its failure boundaries, and dry-run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runReviewLoop } from '../../../../src/application/review-loop/review-loop.js';
import { ReviewState } from '../../../../src/adapters/review/review-state.js';
import { fakeReviewLoopPorts } from '../../../helpers/review-loop-ports.js';

const slug = 'review-start-contract';

test('start resumes the handoff-assigned reviewer instead of reselecting (TASK-2490, TASK-2647)', async () => {
  const fake = fakeReviewLoopPorts({
    slug,
    routing: {
      eligibleFamilies: () => ['claude', 'codex', 'custom'],
      nominate: () => { return assert.fail('handoff assignment must take precedence over selection'); },
    },
    handoff: { handoff: async () => {
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
    handoff: { handoff: async () => ({ ok: true as const, gatekeeperPushedBack: true }) },
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
    handoff: { handoff: async () => { return assert.fail('dry-run must not hand off'); } },
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
    handoff: { handoff: async () => ({ ok: true as const }) },
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

test('continue enters interrupted repair work before checkpoint handoff checks (TASK-2738)', async () => {
  const review = revokeApprovedDecision(approvedReview(slug), 1, {
    revokedAt: '2026-10-01T12:00:00Z', revokedBy: 'workflow', reason: 'gate failed',
    cause: { kind: 'integration-gate-failure', gate: 'npm test' },
  });
  const mission = fixtureMission(slug, { review, declaredGates: ['npm test'], successCriteria: ['repair works'], checkpoints: [{
    missionId: fixtureMission(slug).id, name: 'CP-6', goalCheck: [], nextActionText: 'repair',
    repair: { incidentId: 'incident-6', command: 'npm test', attempt: 3,
      authorizedGates: ['npm test'], authorizedCriteria: ['repair works'], evidenceRecorded: false, verified: false },
  }] });
  const store = inMemoryTransitionStore(mission);
  const fake = fakeReviewLoopPorts({ slug, missionStore: store,
    handoff: { handoff: async () => { return assert.fail('entering implementer work must not require completed checkpoints'); } },
    agents: { launch: async launch => {
      assert.equal(launch.role, 'implementer');
      assert.equal(launch.prompt, undefined);
      assert.equal(launch.recovery?.sessionPolicy, 'fresh-ephemeral');
      return { result: { status: 0 } };
    } },
  });
  Object.assign(fake.ports, { retainedRepair: {
    read: async () => ({ evidence: { incidentId: 'retained', command: 'npm test', cwd: fake.ports.worktree,
      exitCode: 1, captureComplete: true, stdoutPath: '/retained/out', stderrPath: '/retained/err' }, stdout: 'failed', stderr: '' }),
    verify: async () => ({ ok: true, command: 'npm test' }),
    checkpoints: { open: async () => ({ name: 'CP-6', version: 1 }), readBlocker: async () => undefined, verify: async () => {} },
  } });
  await runReviewLoop({ slug, isContinue: true, implementer: 'claude' }, fake.ports);
  const loaded = await store.load(mission.id);
  assert.equal(loaded.kind, 'found');
  if (loaded.kind === 'found') { assert.deepEqual(loaded.mission, mission); }
  assert.deepEqual(fake.exits, []);
});

import { RepairCheckpointService } from '../../../../src/application/repair-checkpoint-service.js';

for (const failure of ['original check', 'new blocker'] as const) {
  test(`acknowledged continuation still stops on ${failure} (TASK-2759)`, async () => {
    const review = revokeApprovedDecision(approvedReview(slug), 1, {
      revokedAt: '2026-10-01T12:00:00Z', revokedBy: 'workflow', reason: 'gate failed',
      cause: { kind: 'integration-gate-failure', gate: 'npm test' },
    });
    const blocker = { command: 'npm test', diagnostic: 'old invalid contract', authorityReason: 'operator decision', proposedCorrection: 'correct contract' };
    const mission = fixtureMission(slug, { brief: {} as never, review, declaredGates: ['npm test'], successCriteria: ['repair works'], checkpoints: [{
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
      handoff: { handoff: async () => { assert.fail('unverified repair must not reach handoff'); } },
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
