import assert from 'node:assert/strict';
import test from 'node:test';
import { ReviewRoundUseCase } from '../../../src/application/review-round-use-case.js';
import type { ReviewRoundWorkflowPort, StartReviewRound } from '../../../src/application/ports/review-round-workflow.js';

function fixture(round: number | null = 2) {
  const calls: string[] = [];
  const requests: StartReviewRound[] = [];
  const port: ReviewRoundWorkflowPort = {
    loadRound: async () => round === null ? null : { round },
    isKnownMission: async () => true,
    clearHumanIntervention: async () => { calls.push('clear intervention'); },
    invalidateResolvedBlocker: async () => { calls.push('invalidate blocker'); },
    runRound: async request => { calls.push('run round'); requests.push(request); },
    invalidMaxAttempts: raw => { calls.push(`invalid ${raw}`); },
    missingReviewAggregate: () => { calls.push('missing aggregate'); },
  };
  return { calls, requests, useCase: new ReviewRoundUseCase(port) };
}

const base = { slug: 'task-2637', focus: 'all', dryRun: false, reset: false, verbose: false, pollTimeoutSeconds: null };

test('continuing a review clears intervention, invalidates its blocker, then resumes from the persisted round', async () => {
  const { calls, requests, useCase } = fixture(3);
  await useCase.continue({ ...base, rawMaxAttempts: null });
  assert.deepEqual(calls, ['clear intervention', 'invalidate blocker', 'run round']);
  assert.equal(requests[0].maxAttempts, 7);
  assert.equal(requests[0].isContinue, true);
});

test('continuing a dry-run preserves the intervention ordering without mutating its blocker', async () => {
  const { calls, requests, useCase } = fixture(1);
  await useCase.continue({ ...base, dryRun: true, rawMaxAttempts: '2' });
  assert.deepEqual(calls, ['clear intervention', 'run round']);
  assert.equal(requests[0].maxAttempts, 2);
});
