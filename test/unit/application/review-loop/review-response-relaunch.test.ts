import test from 'node:test';
import assert from 'node:assert/strict';
import { runReviewLoop } from '../../../../src/application/review-loop/review-loop.js';
import type { ImplementerArtifactFacts, ReviewAgentLaunch, ReviewerArtifactFacts } from '../../../../src/application/ports/review-round.js';
import { fakeReviewLoopPorts } from '../../../helpers/review-loop-ports.js';

// TASK-2239: after the implementer's response the loop decides whether the
// reviewer runs again, and records each decision durably.
function reviewLoopHarness(options: {
  reviewer: () => ReviewerArtifactFacts;
  implementer: () => ImplementerArtifactFacts;
  launch?: (_launch: ReviewAgentLaunch) => { agent: string };
}) {
  let head = 0;
  return fakeReviewLoopPorts({
    slug: 'task-2239',
    routing: { eligibleFamilies: () => ['codex', 'claude'] },
    handoff: { handoff: async () => ({ ok: true }) },
    agents: { launch: async launch => (options.launch ? options.launch(launch) : { agent: launch.agent }) },
    artifacts: { consumeReviewer: async () => options.reviewer(), consumeImplementer: async () => options.implementer() },
    preReview: { head: () => `head-${++head}` },
  });
}
const reviewerLaunches = (fake: ReturnType<typeof fakeReviewLoopPorts>) => fake.launches.filter(launch => launch.role === 'reviewer');
const request = { slug: 'task-2239', implementer: 'claude', reviewer: 'codex', maxAttempts: 3 };

test('post-response transition re-launches the active reviewer and records exactly one next round before approval', async () => {
  const reviewerOutcomes = ['REQUEST_CHANGES', 'APPROVED'];
  const fake = reviewLoopHarness({
    reviewer: () => ({ consumed: true, ok: true, reviewState: reviewerOutcomes.shift() }),
    implementer: () => ({ consumed: true, ok: true, disposition: 'PUSHBACK_ALL' }),
  });

  await runReviewLoop(request, fake.ports);

  assert.deepEqual(reviewerLaunches(fake).map(launch => launch.agent), ['codex', 'codex'], 'PUSHBACK_ALL must transition back to the active reviewer');
  assert.ok(fake.writes.some(state => state.round === 2 && state.phase === 'reviewing'), 'the next reviewer round must be persisted exactly once before it launches');
  assert.equal(fake.exits.length, 0, `approval-after-response should not escalate: ${fake.errors.join(' | ')}`);
});

test('post-response transition keeps the loop active when the reviewer requests changes again', async () => {
  const reviewerOutcomes = ['REQUEST_CHANGES', 'REQUEST_CHANGES', 'APPROVED'];
  const implementerDispositions = ['PUSHBACK_ALL', 'CHANGES_MADE'];
  const fake = reviewLoopHarness({
    reviewer: () => ({ consumed: true, ok: true, reviewState: reviewerOutcomes.shift() }),
    implementer: () => ({ consumed: true, ok: true, disposition: implementerDispositions.shift() }),
  });

  await runReviewLoop(request, fake.ports);

  assert.equal(reviewerLaunches(fake).length, 3, 'the repeated REQUEST_CHANGES decision must remain a reviewer decision');
  assert.ok(fake.writes.filter(state => state.disposition === 'REQUEST_CHANGES').length >= 2, 'each reviewer REQUEST_CHANGES decision must be durable');
  assert.equal(fake.exits.length, 0, `re-review should remain automated: ${fake.errors.join(' | ')}`);
});

test('reviewer launch failure after a response records a reviewer-specific human escalation reason', async () => {
  let reviews = 0;
  const fake = reviewLoopHarness({
    reviewer: () => ({ consumed: true, ok: true, reviewState: 'REQUEST_CHANGES' }),
    implementer: () => ({ consumed: true, ok: true, disposition: 'PUSHBACK_ALL' }),
    launch: launch => {
      if (launch.role === 'reviewer' && ++reviews === 2) { throw new Error('reviewer unavailable'); }
      return { agent: launch.agent };
    },
  });

  await runReviewLoop(request, fake.ports);

  assert.ok(fake.writes.some(state => (state.metadata as Record<string, unknown>)?.humanEscalationReason === 'REVIEWER_LAUNCH_FAILURE'), 'reviewer failure must retain its escalation reason in lifecycle state');
  assert.ok(fake.logs.some(message => /human review.*reviewer/i.test(message)), 'reviewer failure must use the explicit human-review path');
});

test('post-response transition escalates at the maximum reviewer-attempt boundary without launching another reviewer', async () => {
  const fake = reviewLoopHarness({
    reviewer: () => ({ consumed: true, ok: true, reviewState: 'REQUEST_CHANGES' }),
    implementer: () => ({ consumed: true, ok: true, disposition: 'PUSHBACK_ALL' }),
  });

  await runReviewLoop({ ...request, maxAttempts: 1 }, fake.ports);

  assert.equal(reviewerLaunches(fake).length, 1, 'the decision beyond maxAttempts must not launch a reviewer');
  assert.ok(fake.writes.some(state => state.disposition === 'MAX_ATTEMPTS'), 'attempt exhaustion must be retained in lifecycle state');
  assert.ok(fake.logs.some(message => /reached 1 attempts.*human review/i.test(message)), 'attempt exhaustion must take the explicit human-review path');
});
