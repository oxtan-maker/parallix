import test from 'node:test';
import assert from 'node:assert/strict';
import { runReviewLoop } from '../../../../src/application/review-loop/review-loop.js';
import type { ImplementerArtifactFacts, ReviewAgentLaunch, ReviewerArtifactFacts } from '../../../../src/application/ports/review-round.js';
import { fakeLoopContext, fakeReviewLoopPorts } from '../../../helpers/review-loop-ports.js';
import { runReviewerPhase } from '../../../../src/application/review-loop/reviewer-phase.js';
import { ReviewRound } from '../../../../src/application/review-loop/round.js';
import { ReviewState } from '../../../../src/adapters/review/review-state.js';

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
    handoff: { handoff: async () => ({ ok: true as const }) },
    agents: { launch: async launch => (options.launch ? options.launch(launch) : { agent: launch.agent }) },
    artifacts: { consumeReviewer: async () => options.reviewer(), consumeImplementer: async () => options.implementer() },
    preReview: { head: () => `head-${++head}` },
  });
}
const reviewerLaunches = (fake: ReturnType<typeof fakeReviewLoopPorts>) => fake.launches.filter(launch => launch.role === 'reviewer');
const request = { slug: 'task-2239', implementer: 'claude', reviewer: 'codex', maxAttempts: 3 } satisfies Partial<NonNullable<Parameters<typeof runReviewLoop>[0]>>;

test('accepted child request-changes proceeds to fixing despite verdict readiness closing (px-0017)', async () => {
  let decided = false;
  const state = new ReviewState(request.slug, request);
  const accepted = new ReviewState(request.slug, request);
  accepted.transitionTo('fixing');
  accepted.disposition = 'REQUEST_CHANGES';
  const fake = fakeReviewLoopPorts({
    state,
    stateport: {
      read: async () => decided ? accepted : state,
      verdictBlock: async () => decided ? {
        cause: 'awaiting-implementation', diagnostic: 'Resolve the outstanding findings', nextAction: 'resolve',
      } : null,
    },
    agents: { launch: async launch => { decided = true; return { agent: launch.agent }; } },
    artifacts: { consumeReviewer: async () => { assert.fail('accepted verdict needs no artifact polling'); } },
  });
  const context = fakeLoopContext(fake, { state, slug: request.slug });

  const outcome = await runReviewerPhase(context, new ReviewRound(1, context));

  assert.deepEqual(outcome, { reviewState: 'REQUEST_CHANGES' });
  assert.equal(state.phase, 'fixing');
  assert.deepEqual(fake.exits, []);
  assert.equal(fake.launches.length, 1);
});

for (const recovery of ['artifact', 'timeout'] as const) {
  for (const verdict of ['REQUEST_CHANGES', 'APPROVED'] as const) {
    test(`${recovery} retry reconciles accepted ${verdict} before verdict readiness (px-0017 F1)`, async () => {
      let launches = 0;
      let consumes = 0;
      let polls = 0;
      const state = new ReviewState(request.slug, request);
      const accepted = new ReviewState(request.slug, request);
      accepted.transitionTo(verdict === 'APPROVED' ? 'approved' : 'fixing');
      accepted.disposition = verdict;
      const fake = fakeReviewLoopPorts({
        state,
        stateport: {
          read: async () => launches >= 2 ? accepted : state,
          verdictBlock: async () => launches >= 2 ? {
            cause: 'awaiting-implementation', diagnostic: 'Verdict already accepted', nextAction: 'resolve',
          } : null,
        },
        agents: { launch: async launch => { launches++; return { agent: launch.agent, result: { status: 0 } }; } },
        artifacts: { consumeReviewer: async () => {
          consumes++;
          assert.equal(launches, 1, 'accepted retry verdict needs no artifact polling');
          return recovery === 'artifact'
            ? { consumed: true, ok: false, diagnostic: 'Missing reviewer verdict' }
            : { consumed: false, ok: true };
        } },
        provider: { pollReview: async () => { polls++; return null; } },
      });
      const context = fakeLoopContext(fake, { state, slug: request.slug });

      const outcome = await runReviewerPhase(context, new ReviewRound(1, context));

      assert.deepEqual(outcome, verdict === 'APPROVED' ? { outcome: 'stop' } : { reviewState: verdict });
      assert.equal(state.phase, accepted.phase);
      assert.deepEqual(fake.exits, []);
      assert.deepEqual(fake.stops, []);
      assert.equal(launches, 2, 'retry stops after the accepted verdict');
      assert.equal(consumes, 1);
      assert.equal(polls, recovery === 'timeout' ? 1 : 0);
    });
  }
}

test('post-response transition re-launches the active reviewer and records exactly one next round before approval', async () => {
  const reviewerOutcomes = ['REQUEST_CHANGES', 'APPROVED'];
  const fake = reviewLoopHarness({
    reviewer: () => ({ consumed: true, ok: true as const, reviewState: reviewerOutcomes.shift() }),
    implementer: () => ({ consumed: true, ok: true as const, disposition: 'PUSHBACK_ALL' }),
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
    reviewer: () => ({ consumed: true, ok: true as const, reviewState: reviewerOutcomes.shift() }),
    implementer: () => ({ consumed: true, ok: true as const, disposition: implementerDispositions.shift() }),
  });

  await runReviewLoop(request, fake.ports);

  assert.equal(reviewerLaunches(fake).length, 3, 'the repeated REQUEST_CHANGES decision must remain a reviewer decision');
  assert.ok(fake.writes.filter(state => state.disposition === 'REQUEST_CHANGES').length >= 2, 'each reviewer REQUEST_CHANGES decision must be durable');
  assert.equal(fake.exits.length, 0, `re-review should remain automated: ${fake.errors.join(' | ')}`);
});

test('reviewer launch failure after a response records a reviewer-specific human escalation reason', async () => {
  let reviews = 0;
  const fake = reviewLoopHarness({
    reviewer: () => ({ consumed: true, ok: true as const, reviewState: 'REQUEST_CHANGES' }),
    implementer: () => ({ consumed: true, ok: true as const, disposition: 'PUSHBACK_ALL' }),
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
    reviewer: () => ({ consumed: true, ok: true as const, reviewState: 'REQUEST_CHANGES' }),
    implementer: () => ({ consumed: true, ok: true as const, disposition: 'PUSHBACK_ALL' }),
  });

  await runReviewLoop({ ...request, maxAttempts: 1 }, fake.ports);

  assert.equal(reviewerLaunches(fake).length, 1, 'the decision beyond maxAttempts must not launch a reviewer');
  assert.ok(fake.writes.some(state => state.disposition === 'MAX_ATTEMPTS'), 'attempt exhaustion must be retained in lifecycle state');
  assert.ok(fake.logs.some(message => /reached 1 attempts.*human review/i.test(message)), 'attempt exhaustion must take the explicit human-review path');
});
