import assert from 'node:assert/strict';
import test from 'node:test';
import { ReviewRoundUseCase } from '../../../src/application/review-round-use-case.js';
import type { ReviewRoundEntryPort, StartReviewRound } from '../../../src/application/ports/review-round.js';
import { fakeReviewLoopPorts, type ReviewLoopFakeOverrides } from '../../helpers/review-loop-ports.js';
import { ReviewState } from '../../../src/adapters/review/review-state.js';

function fixture(round: number | null = 2, controllerFree = false, overrides: ReviewLoopFakeOverrides = {}, operator = false) {
  const calls: string[] = [];
  const requests: StartReviewRound[] = [];
  const fake = fakeReviewLoopPorts({ slug: 'task-2637', lock: { tryAcquire: () => controllerFree, release: () => {} }, ...overrides });
  const port: ReviewRoundEntryPort = {
    operatorResume: operator ? { acknowledge: async () => { calls.push('acknowledge operator'); } } : undefined,
    loadRound: async () => round === null ? null : { round },
    isKnownMission: async () => true,
    clearHumanIntervention: async () => { calls.push('clear intervention'); },
    invalidateResolvedBlocker: async () => { calls.push('invalidate blocker'); },
    mechanisms: request => { calls.push('bind mechanisms'); requests.push(request); return fake.ports; },
    invalidMaxAttempts: raw => { calls.push(`invalid ${raw}`); },
    missingReviewAggregate: () => { calls.push('missing aggregate'); },
  };
  return { calls, requests, fake, port, useCase: new ReviewRoundUseCase(port) };
}

const base = { slug: 'task-2637', focus: 'all', dryRun: false, reset: false, verbose: false, pollTimeoutSeconds: null };

test('continuing a review clears intervention, invalidates its blocker, then resumes from the persisted round', async () => {
  const { calls, requests, useCase } = fixture(3, false, {}, true);
  await useCase.enter({ ...base, rawMaxAttempts: null });
  assert.deepEqual(calls, ['acknowledge operator', 'clear intervention', 'invalidate blocker', 'bind mechanisms']);
  assert.equal(requests[0].maxAttempts, 7);
  assert.equal(requests[0].isContinue, true);
});

test('continuing a dry-run preserves the intervention ordering without mutating its blocker', async () => {
  const { calls, requests, useCase } = fixture(1);
  await useCase.enter({ ...base, dryRun: true, rawMaxAttempts: '2' });
  assert.deepEqual(calls, ['bind mechanisms']);
  assert.equal(requests[0].maxAttempts, 2);
});

test('starting a review runs the application loop over the bound mechanisms, not an adapter workflow', async () => {
  const { fake, useCase } = fixture(null, true);
  await useCase.enter({ ...base, dryRun: true, rawMaxAttempts: '1' });
  assert.ok(fake.logs.some(line => line.includes('No agents will be launched.')), fake.logs.join('\n'));
  assert.ok(fake.logs.some(line => line.includes('DRY-RUN: reviewer')), fake.logs.join('\n'));
  assert.deepEqual(fake.launches, []);
});

test('rejects an unknown mission without a persisted Review before entry effects (TASK-2696)', async () => {
  const { calls, requests, fake, useCase, port } = fixture(null, true);
  port.isKnownMission = async () => false;
  await useCase.enter({ ...base, rawMaxAttempts: null });
  assert.deepEqual(calls, ['missing aggregate']);
  assert.deepEqual(requests, []);
  assert.deepEqual(fake.launches, []);
});

test('start creates the missing Review through handoff and completes autonomous review (TASK-2696)', async () => {
  let handoffs = 0;
  const { fake, useCase, calls } = fixture(null, true, {
    handoff: { handoff: async () => {
      handoffs += 1;
      await fake.ports.state.persist(new ReviewState(base.slug, { implementer: 'codex', reviewer: 'claude', round: 1 }));
      return { ok: true as const };
    } },
    routing: { nominate: () => { return assert.fail('start must use the handoff reviewer'); } },
    artifacts: { consumeReviewer: async () => ({ consumed: true, ok: true as const, reviewState: 'APPROVED' }) },
  });
  await useCase.enter({ ...base, rawMaxAttempts: '1' });
  assert.equal(handoffs, 1);
  assert.deepEqual(calls, ['bind mechanisms']);
  assert.deepEqual(fake.launches.map(launch => [launch.role, launch.agent]), [['reviewer', 'claude']]);
  assert.deepEqual(fake.exits, []);
  assert.deepEqual(fake.stops, []);
  assert.ok(fake.mirrors.includes('approved'));
});


test('starting a known mission without Review still stops at rejected handoff (TASK-2696)', async () => {
  let handoffs = 0;
  const { fake, useCase } = fixture(null, true, {
    handoff: { handoff: async () => {
      handoffs += 1;
      return { ok: false as const, reason: 'Success criteria 1 are incomplete' as const };
    } },
    routing: { nominate: () => { return assert.fail('rejected handoff must not select a reviewer'); } },
  });
  await useCase.enter({ ...base, rawMaxAttempts: '1' });
  assert.equal(handoffs, 1);
  assert.deepEqual(fake.exits, [1]);
  assert.deepEqual(fake.launches, []);
  assert.deepEqual(fake.writes, []);
});

test('direct operator acknowledgment precedes continuation readiness and dry-run preserves retained stops (TASK-2759)', async () => {
  const direct = fixture(2, false, {}, true);
  await direct.useCase.enter({ ...base, rawMaxAttempts: null });
  assert.deepEqual(direct.calls, ['acknowledge operator', 'clear intervention', 'invalidate blocker', 'bind mechanisms']);
  const dry = fixture(2, false, {}, true);
  await dry.useCase.enter({ ...base, dryRun: true, rawMaxAttempts: null });
  assert.deepEqual(dry.calls, ['bind mechanisms']);
  const missing = fixture(null, false, {}, true);
  await missing.useCase.enter({ ...base, rawMaxAttempts: null });
  assert.deepEqual(missing.calls, ['acknowledge operator', 'bind mechanisms']);
});

test('nested reviewer launch failure blocks outer post-execute review entry (px-0017)', async () => {
  const { fake, useCase } = fixture(1, true, {
    state: new ReviewState(base.slug, { implementer: 'codex', reviewer: 'claude', round: 1 }),
    handoff: { handoff: async () => ({ ok: true }) },
    agents: { launch: async () => { throw new Error('nested reviewer unavailable'); } },
  });
  await useCase.enter({ ...base, rawMaxAttempts: '1' });
  assert.equal(fake.current()?.metadata.humanEscalationReason, 'REVIEWER_LAUNCH_FAILURE');
  assert.equal(fake.launches.length, 1);
  await useCase.enter({ ...base, rawMaxAttempts: '1' });
  assert.equal(fake.launches.length, 1, 'outer entry must stop before another blocked verdict launch');
  assert.ok(fake.errors.some(line => line.includes('REVIEWER_LAUNCH_FAILURE') && line.includes('review task-2637')));
});

test('workflow rejection after launch stops provider polling and output retries (px-0017)', async () => {
  let blocked = false;
  let polls = 0;
  const { fake, useCase } = fixture(null, true, {
    state: new ReviewState(base.slug, { implementer: 'codex', reviewer: 'claude' }),
    provider: { pollReview: async () => { polls++; return null; } },
    agents: { launch: async () => { blocked = true; return { agent: 'claude' }; } },
    stateport: { verdictBlock: async () => blocked ? {
      cause: 'REVIEWER_LAUNCH_FAILURE', diagnostic: 'cause=REVIEWER_LAUNCH_FAILURE; px review task-2637',
      nextAction: 'px review task-2637',
    } : null },
  });
  await useCase.enter({ ...base, rawMaxAttempts: '1' });
  assert.equal(fake.launches.length, 1);
  assert.equal(polls, 0);
  assert.deepEqual(fake.exits, [1]);
  assert.match(fake.errors.join('\n'), /cause=REVIEWER_LAUNCH_FAILURE/);
});

test('workflow blocker during reviewer retry ends recovery without replacing the stop (px-0017)', async () => {
  let launches = 0;
  let polls = 0;
  const { POLL_TIMEOUT } = await import('../../../src/application/ports/review-round.js');
  const { fake, useCase } = fixture(null, true, {
    state: new ReviewState(base.slug, { implementer: 'codex', reviewer: 'claude' }),
    provider: { pollReview: async () => { polls++; return POLL_TIMEOUT; } },
    agents: { launch: async () => { launches++; return { agent: 'claude', result: { status: 0 } }; } },
    stateport: { verdictBlock: async () => launches >= 2 ? {
      cause: 'operator stop', diagnostic: 'operator stop; px review task-2637', nextAction: 'operator continuation',
    } : null },
  });
  await useCase.enter({ ...base, rawMaxAttempts: '1' });
  assert.equal(launches, 2);
  assert.equal(polls, 1);
  assert.deepEqual(fake.stops, [], 'retained authority must not be replaced with retry exhaustion');
  assert.match(fake.errors.join('\n'), /operator stop/);
});


for (const mode of ['start', 'continue'] as const) {
  for (const invocation of ['operator', 'operator-corrected', 'nested', 'dry-run'] as const) {
    test(`${mode} ${invocation} reconciles repair authorization only with operator authority (TASK-2807)`, async () => {
      const { fixtureMission, inMemoryTransitionStore } = await import('../../fixtures/mission-builders.js');
      const { bindReviewOperatorResume } = await import('../../../src/composition/review-operator-resume.js');
      const { missionId } = await import('../../../src/domain/mission.js');
      const { repairContractFailure } = await import('../../../src/application/repair-checkpoint-service.js');
      const blocker = { command: 'npm test', diagnostic: 'old contract', authorityReason: 'operator decision', proposedCorrection: 'correct criterion' };
      const mission = fixtureMission(base.slug, { successCriteria: ['corrected criterion'], declaredGates: ['npm test'], checkpoints: [{
        missionId: missionId(base.slug), name: 'CP-1', goalCheck: [], nextActionText: 'repair',
        repair: { incidentId: 'stale-contract', command: 'npm test', attempt: 1,
          ...(invocation === 'operator-corrected' ? { acknowledgedBlocker: blocker } : { blocker }),
          authorizedGates: ['npm test'], authorizedCriteria: ['old criterion'], evidenceRecorded: false, verified: false },
      }] });
      const store = inMemoryTransitionStore(mission);
      const f = fixture(mode === 'start' ? null : 1);
      Object.assign(f.port, { operatorResume: bindReviewOperatorResume(store, invocation !== 'nested', {}) });
      const mechanisms = f.port.mechanisms;
      f.port.mechanisms = request => {
        const current = store.mission();
        const repair = current.checkpoints[0].repair!;
        if (invocation.startsWith('operator')) {
          assert.equal(repairContractFailure(current.checkpoints, current.declaredGates, current.successCriteria), null);
          assert.deepEqual(repair.acknowledgedBlocker, blocker);
          assert.deepEqual(f.calls, mode === 'start' ? [] : ['clear intervention', 'invalidate blocker']);
        } else {
          assert.deepEqual(current, mission, 'nested work and dry-run retain authorization and blockers');
        }
        assert.equal(repair.evidenceRecorded, false);
        assert.equal(repair.verified, false);
        assert.deepEqual(current.checkpoints[0].goalCheck, []);
        return mechanisms(request);
      };
      const request = { ...base, dryRun: invocation === 'dry-run' };
      if (mode === 'start') { await f.useCase.enter({ ...request, rawMaxAttempts: '1' }); }
      else { await f.useCase.enter({ ...request, rawMaxAttempts: null }); }
      assert.equal(f.requests.length, 1);
      assert.deepEqual(f.fake.launches, []);
    });
  }
}

test('inferred entry reaches handoff after an acknowledged criteria correction without a persisted Review (TASK-2810)', async () => {
  const { fixtureMission, inMemoryTransitionStore } = await import('../../fixtures/mission-builders.js');
  const { bindReviewOperatorResume } = await import('../../../src/composition/review-operator-resume.js');
  const { missionId } = await import('../../../src/domain/mission.js');
  const blocker = { command: 'npm test', diagnostic: 'old contract', authorityReason: 'operator decision', proposedCorrection: 'correct criterion' };
  const mission = fixtureMission(base.slug, { successCriteria: ['corrected criterion'], declaredGates: ['npm test'], checkpoints: [{
    missionId: missionId(base.slug), name: 'CP-1', goalCheck: [], nextActionText: 'repair',
    repair: { incidentId: 'criteria-correction', command: 'npm test', attempt: 1, acknowledgedBlocker: blocker,
      authorizedGates: ['npm test'], authorizedCriteria: ['old criterion'], evidenceRecorded: false, verified: false },
  }] });
  const store = inMemoryTransitionStore(mission);
  let handoffs = 0;
  const f = fixture(null, true, { handoff: { handoff: async () => {
    handoffs++;
    assert.deepEqual(store.mission().checkpoints[0].repair?.authorizedCriteria, ['corrected criterion']);
    return { ok: false as const, reason: 'Success criteria 1 are incomplete' };
  } } });
  const { createReviewWorkflowAdapter } = await import('../../../src/adapters/review/review-workflow-adapter.js');
  const { ReviewCommandUseCase } = await import('../../../src/application/review-command-use-case.js');
  const { createReviewCommand } = await import('../../../src/interfaces/cli/review.js');
  const options = {
    operatorResume: bindReviewOperatorResume(store, true, {}),
    missionStore: store, requireReviewAggregate: true,
    inferSlugFn: () => base.slug, resolveWorktreeFn: () => null,
    readReviewStateFn: async () => null,
    // Keep the parent status fallback isolated: its bare entry sees an open PR
    // and reports status instead of reaching handoff (the semantic red).
    getPrStatusFn: () => ({ exists: true as const, raw: 'isolated existing PR' }),
    reviewLoopMechanisms: () => f.fake.ports,
    log: (line: string) => f.fake.logs.push(line),
    error: (line: string) => f.fake.errors.push(line),
    exit: (code: number) => { f.fake.exits.push(code); },
  };
  await createReviewCommand(new ReviewCommandUseCase(createReviewWorkflowAdapter(options)))([base.slug]);
  assert.equal(handoffs, 1, 'known Mission must reach handoff readiness');
  assert.ok(!f.calls.includes('missing aggregate'));
  assert.doesNotMatch([...f.fake.errors, ...f.fake.logs].join('\n'), /push.*PR|no.*Review aggregate/i);
  assert.deepEqual(f.fake.exits, [1], 'missing evidence still fails');
  assert.deepEqual(store.mission().checkpoints[0].repair?.acknowledgedBlocker, blocker);
  assert.deepEqual(store.mission().checkpoints[0].goalCheck, []);
  assert.equal(store.mission().checkpoints[0].repair?.verified, false);
});


test('review entry parser rejects removed mode flags and infers the loop (TASK-2810)', async () => {
  const { parseReviewCliRequest } = await import('../../../src/interfaces/cli/review.js');
  const { reviewOperation } = await import('../../../src/domain/review-command-policy.js');
  for (const flag of ['--start', '--continue']) {
    assert.throws(() => parseReviewCliRequest([base.slug, flag]), /Unknown flag for px review/);
  }
  assert.equal(reviewOperation([]), 'enter');
  assert.equal(reviewOperation([base.slug, '--reviewer', 'claude']), 'enter');
});


test('review vocabulary has independent purposes and retires duplicate record switches (TASK-2810)', async () => {
  const { REVIEW_OPTIONS, REVIEW_USAGE, reviewExplicitSlug } = await import('../../../src/domain/review-cli-options.js');
  const { parseReviewCliRequest } = await import('../../../src/interfaces/cli/review.js');
  const { unknownReviewFlags } = await import('../../../src/adapters/review/review-cli-flags.js');
  for (const flag of ['--create-event', '--import-legacy', '--resume', '--mission', '--input-file', '--verdict']) {
    assert.throws(() => parseReviewCliRequest([base.slug, flag]), /Unknown flag/);
    assert.deepEqual(unknownReviewFlags([flag]), [flag]);
    assert.ok(!REVIEW_USAGE.includes(flag));
  }
  assert.ok(REVIEW_USAGE.split('\n').every(line => line.length <= 100));
  assert.ok(!REVIEW_USAGE.includes('<slug>'), 'operator help uses the mission worktree (TASK-2810 H7)');
  for (const [flag, option] of Object.entries(REVIEW_OPTIONS)) {
    assert.ok(REVIEW_USAGE.includes(flag));
    assert.ok(option.purpose.length > 10);
    const args = option.value ? [flag, 'value'] : [flag];
    assert.deepEqual(unknownReviewFlags(args), []);
    assert.deepEqual(parseReviewCliRequest(args).flags, [flag]);
  }
  assert.equal(reviewExplicitSlug(['--reviewer', 'claude']), undefined);
  assert.equal(reviewExplicitSlug(['--reviewer=claude', base.slug]), base.slug);
  assert.equal(reviewExplicitSlug(['--comment', 'some text', base.slug]), base.slug);
});


for (const stopped of [false, true]) {
  test(`dry-run or retained stop prevents reset before authority checks: ${stopped} (TASK-2810)`, async () => {
    let resets = 0;
    const state = new ReviewState(base.slug, { implementer: 'codex', reviewer: 'claude',
      ...(stopped ? { metadata: { humanEscalationReason: 'operator stop' } } : {}) });
    const f = fixture(1, true, { state,
      stateport: { reset: async () => { resets++; return true; } },
    });
    await f.useCase.enter({ ...base, reset: true, dryRun: !stopped, rawMaxAttempts: '1' });
    assert.equal(resets, 0);
    assert.deepEqual(f.calls, ['bind mechanisms']);
    if (stopped) { assert.deepEqual(f.fake.exits, [1]); }
  });
}


test('invocation options cannot grant or replace the composed operator acknowledgment port (TASK-2810)', async () => {
  const { createReviewWorkflowAdapter } = await import('../../../src/adapters/review/review-workflow-adapter.js');
  const forged = { acknowledge: async () => assert.fail('forged authority') };
  const unbound = createReviewWorkflowAdapter({ inferSlugFn: () => base.slug });
  const nested = await unbound.preflight([], { operatorResume: forged });
  assert.equal(nested?.options.operatorResume, undefined);
  const bound = { acknowledge: async () => {} };
  const direct = createReviewWorkflowAdapter({ inferSlugFn: () => base.slug, operatorResume: bound });
  assert.equal((await direct.preflight([], { operatorResume: forged }))?.options.operatorResume, bound);
});
