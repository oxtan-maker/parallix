import assert from 'node:assert/strict';
import test from 'node:test';
import { ReviewRoundUseCase } from '../../../src/application/review-round-use-case.js';
import type { ReviewRoundEntryPort, StartReviewRound } from '../../../src/application/ports/review-round.js';
import { fakeReviewLoopPorts, type ReviewLoopFakeOverrides } from '../../helpers/review-loop-ports.js';
import { ReviewState } from '../../../src/adapters/review/review-state.js';

function fixture(round: number | null = 2, controllerFree = false, overrides: ReviewLoopFakeOverrides = {}) {
  const calls: string[] = [];
  const requests: StartReviewRound[] = [];
  const fake = fakeReviewLoopPorts({ slug: 'task-2637', lock: { tryAcquire: () => controllerFree, release: () => {} }, ...overrides });
  const port: ReviewRoundEntryPort = {
    loadRound: async () => round === null ? null : { round },
    isKnownMission: async () => true,
    clearHumanIntervention: async () => { calls.push('clear intervention'); },
    invalidateResolvedBlocker: async () => { calls.push('invalidate blocker'); },
    mechanisms: request => { calls.push('bind mechanisms'); requests.push(request); return fake.ports; },
    invalidMaxAttempts: raw => { calls.push(`invalid ${raw}`); },
    missingReviewAggregate: () => { calls.push('missing aggregate'); },
  };
  return { calls, requests, fake, useCase: new ReviewRoundUseCase(port) };
}

const base = { slug: 'task-2637', focus: 'all', dryRun: false, reset: false, verbose: false, pollTimeoutSeconds: null };

test('continuing a review clears intervention, invalidates its blocker, then resumes from the persisted round', async () => {
  const { calls, requests, useCase } = fixture(3);
  await useCase.continue({ ...base, rawMaxAttempts: null });
  assert.deepEqual(calls, ['clear intervention', 'invalidate blocker', 'bind mechanisms']);
  assert.equal(requests[0].maxAttempts, 7);
  assert.equal(requests[0].isContinue, true);
});

test('continuing a dry-run preserves the intervention ordering without mutating its blocker', async () => {
  const { calls, requests, useCase } = fixture(1);
  await useCase.continue({ ...base, dryRun: true, rawMaxAttempts: '2' });
  assert.deepEqual(calls, ['clear intervention', 'bind mechanisms']);
  assert.equal(requests[0].maxAttempts, 2);
});

test('starting a review runs the application loop over the bound mechanisms, not an adapter workflow', async () => {
  const { fake, useCase } = fixture(null, true);
  await useCase.start({ ...base, dryRun: true, maxAttempts: 1 });
  assert.ok(fake.logs.some(line => line.includes('No agents will be launched.')), fake.logs.join('\n'));
  assert.ok(fake.logs.some(line => line.includes('DRY-RUN: reviewer')), fake.logs.join('\n'));
  assert.deepEqual(fake.launches, []);
});

test('rejects a known mission without a persisted Review before continuation effects (TASK-2696)', async () => {
  const { calls, requests, fake, useCase } = fixture(null, true);
  await useCase.continue({ ...base, rawMaxAttempts: null });
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
      return { ok: true };
    } },
    routing: { nominate: () => { assert.fail('start must use the handoff reviewer'); } },
    artifacts: { consumeReviewer: async () => ({ consumed: true, ok: true, reviewState: 'APPROVED' }) },
  });
  await useCase.start({ ...base, maxAttempts: 1 });
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
      return { ok: false, reason: 'Success criteria 1 are incomplete' };
    } },
    routing: { nominate: () => { assert.fail('rejected handoff must not select a reviewer'); } },
  });
  await useCase.start({ ...base, maxAttempts: 1 });
  assert.equal(handoffs, 1);
  assert.deepEqual(fake.exits, [1]);
  assert.deepEqual(fake.launches, []);
  assert.deepEqual(fake.writes, []);
});
