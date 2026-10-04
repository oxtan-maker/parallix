import assert from 'node:assert/strict';
import test from 'node:test';
import { ReviewRoundUseCase } from '../../../src/application/review-round-use-case.js';
import type { ReviewRoundEntryPort, StartReviewRound } from '../../../src/application/ports/review-round.js';
import { fakeReviewLoopPorts } from '../../helpers/review-loop-ports.js';

function fixture(round: number | null = 2, controllerFree = false) {
  const calls: string[] = [];
  const requests: StartReviewRound[] = [];
  const fake = fakeReviewLoopPorts({ slug: 'task-2637', lock: { tryAcquire: () => controllerFree, release: () => {} } });
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
