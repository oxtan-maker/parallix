import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';

import {
  bindReviewPersistence,
  reviewLoopBindings,
} from '../src/composition/review-persistence.js';
import { createEvent } from '../src/adapters/review/review-events.js';

/**
 * A Mission with a Review on round 3, so a bound consumer is distinguishable
 * from the unbound default (which reads no state and falls back to round 1).
 */
function missionWithReview() {
  const currentRound = {
    number: 3,
    subject: {
      change: { kind: 'local-branch' as const, sourceBranch: 'mission/task-9001', targetBranch: 'main' },
      revision: 'rev-3',
    },
    reviewer: 'claude',
    implementer: 'codex',
    startedAt: '2026-08-04T09:00:00.000Z',
    decision: null,
    response: null,
    phase: 'reviewing',
    disposition: null,
    reviewerRetryCount: 0,
    implementerRetryCount: 0,
  };
  return {
    id: 'task-9001',
    repositoryId: 'repo',
    title: 'bound review persistence',
    status: 'review',
    rawStatus: 'review',
    assignee: 'claude',
    labels: [],
    checkpoints: [],
    netEngineeringLines: 0,
    closedAt: null,
    review: {
      rounds: [{ ...currentRound, number: 1 }, { ...currentRound, number: 2 }, currentRound],
      intervention: null,
      stageLaunches: [],
      reviewEvents: [],
    },
  };
}

function fakeStore() {
  const state = { mission: missionWithReview(), version: 1, saves: [] as unknown[] };
  return {
    state,
    async load() { return { kind: 'found', mission: state.mission, version: state.version }; },
    async save(mission: any) {
      state.mission = mission;
      state.version += 1;
      state.saves.push(mission);
      return state.version;
    },
    async saveWithTransition(mission: any) { return this.save(mission); },
  };
}

test('reviewLoopBindings supplies persisted-output readers, not only review-state projections', () => {
  const bindings = reviewLoopBindings(fakeStore() as never);
  assert.deepEqual(Object.keys(bindings).sort(), [
    'consumeImplementerArtifactsFn',
    'consumeReviewerArtifactsFn',
    // TASK-2582: the round-open boundary moves an active Mission back to
    // review at the boundary, so the loop needs the lifecycle service.
    'lifecycleService',
    'missionStore',
    'readReviewStateFn',
    'resetReviewStateFn',
    'writeReviewStateFn',
  ]);
});

test('loop reviewer reader uses persisted SQLite events rather than artifacts', async () => {
  const store = fakeStore();
  store.state.mission.review.reviewEvents = [
    { eventType: 'reviewer_findings', roundNumber: 3, actor: 'claude', content: '## F1: persisted finding', createdAt: '2026-08-04T10:00:00.000Z' },
    { eventType: 'reviewer_outcome', roundNumber: 3, actor: 'claude', verdict: 'request-changes', content: 'Outcome: request-changes', createdAt: '2026-08-04T10:00:01.000Z' },
  ];

  const result = await reviewLoopBindings(store as never).consumeReviewerArtifactsFn('task-9001', 'claude', {
    worktree: '/tmp/worktree',
  });

  assert.equal(result.consumed, true);
  assert.equal(result.ok, true);
  assert.equal(result.reviewState, 'REQUEST_CHANGES');
  assert.deepEqual(result.findingSummaries, ['persisted finding']);
});

test('loop reviewer reader ignores events from another round or reviewer', async () => {
  const store = fakeStore();
  store.state.mission.review.reviewEvents = [
    { eventType: 'reviewer_outcome', roundNumber: 2, actor: 'claude', verdict: 'approve', content: 'old', createdAt: '2026-08-04T10:00:00.000Z' },
    { eventType: 'reviewer_outcome', roundNumber: 3, actor: 'codex', verdict: 'approve', content: 'other', createdAt: '2026-08-04T10:00:01.000Z' },
  ];

  const result = await reviewLoopBindings(store as never).consumeReviewerArtifactsFn('task-9001', 'claude', {
    worktree: '/tmp/worktree',
  });

  assert.equal(result.consumed, false);
});

test('loop reviewer reader ignores an outcome from before a reset', async () => {
  const store = fakeStore();
  store.state.mission.review.rounds[2].startedAt = '2026-08-04T11:00:00.000Z';
  store.state.mission.review.reviewEvents = [
    { eventType: 'reviewer_outcome', roundNumber: 3, actor: 'claude', verdict: 'approve', content: 'old approval', createdAt: '2026-08-04T10:00:00.000Z' },
  ];

  const result = await reviewLoopBindings(store as never).consumeReviewerArtifactsFn('task-9001', 'claude', { worktree: '/tmp/worktree' });
  assert.equal(result.consumed, false);
});

test('loop implementer reader uses the persisted disposition event', async () => {
  const store = fakeStore();
  store.state.mission.review.reviewEvents = [
    { eventType: 'implementer_disposition', roundNumber: 3, actor: 'codex', disposition: 'PUSHBACK_ALL', content: 'Autonomous review disposition: PUSHBACK_ALL', createdAt: '2026-08-04T10:00:00.000Z' },
  ];

  const result = await reviewLoopBindings(store as never).consumeImplementerArtifactsFn('task-9001', 'codex', {
    worktree: '/tmp/worktree',
  });

  assert.equal(result.consumed, true);
  assert.equal(result.ok, true);
  assert.equal(result.disposition, 'PUSHBACK_ALL');
});

test('loop implementer reader ignores a disposition from before a reset', async () => {
  const store = fakeStore();
  store.state.mission.review.rounds[2].startedAt = '2026-08-04T11:00:00.000Z';
  store.state.mission.review.reviewEvents = [
    { eventType: 'implementer_disposition', roundNumber: 3, actor: 'codex', disposition: 'CHANGES_MADE', content: 'old', createdAt: '2026-08-04T10:00:00.000Z' },
  ];

  const result = await reviewLoopBindings(store as never).consumeImplementerArtifactsFn('task-9001', 'codex', { worktree: '/tmp/worktree' });
  assert.equal(result.consumed, false);
});

test('bindReviewPersistence exposes the same bound consumers', async () => {
  const persistence = bindReviewPersistence(fakeStore() as never);
  assert.equal(typeof persistence.consumeReviewerArtifacts, 'function');
  assert.equal(typeof persistence.consumeImplementerArtifacts, 'function');
});

test('an unbound event writer reports the missing store, not a missing Review', async () => {
  const messages: string[] = [];
  const result = await createEvent(
    'task-9001',
    'human_note',
    { content: 'note' },
    { worktree: os.tmpdir(), skipGit: true, log: () => {}, error: (msg: string) => messages.push(msg) },
  );

  assert.equal(result.ok, false);
  assert.match(result.error, /No Mission store supplied/);
  assert.match(messages.join('\n'), /no Mission store was supplied/i);
  assert.doesNotMatch(messages.join('\n'), /backfill-review/);
});
