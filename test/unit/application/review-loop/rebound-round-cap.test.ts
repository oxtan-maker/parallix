// TASK-2377.04 CP-3: the per-round relaunch cap.
//
// The application review loop runs over fake mechanism ports; the rebound
// kernel runs for real (it is the code under test together with the loop's
// cap accounting). No agents, no git, no Forgejo.

import test from 'node:test';
import assert from 'node:assert/strict';
import { runReviewLoop } from '../../../../src/application/review-loop/review-loop.js';
import { DEFAULT_REBOUNDS_PER_ROUND, REBOUNDS_PER_ROUND_EXHAUSTED } from '../../../../src/application/review-loop/round.js';
import { POLL_TIMEOUT, type ReviewerArtifactFacts, type ReviewLoopState } from '../../../../src/application/ports/review-round.js';
import { fakeReviewLoopPorts } from '../../../helpers/review-loop-ports.js';

const TEST_SLUG = 'task-2377.04-round-cap';

/**
 * Harness: provider-enabled review loop whose reviewer artifact consumption
 * follows `consume`, a review poll that always times out, and an implementer
 * that reports CHANGES_MADE on a new revision.
 */
function runLoop(options: { consume: () => Promise<ReviewerArtifactFacts>; reboundsPerRound?: number; isContinue?: boolean; state?: { current: ReviewLoopState | null } }) {
  const events: string[] = [];
  let head = 0;
  const stored = options.state;
  const fake = fakeReviewLoopPorts({
    slug: TEST_SLUG,
    routing: { eligibleFamilies: () => ['codex', 'claude', 'gemini', 'custom'] },
    handoff: { handoff: async () => ({ ok: true }) },
    provider: { pollReview: async () => POLL_TIMEOUT, pollDisposition: async () => 'CHANGES_MADE' },
    // A launched implementer whose process has not reported an exit status:
    // the disposition arrives through the provider.
    agents: { launch: async launch => { events.push(`${launch.role === 'reviewer' ? 'review' : 'act-on-review'}:${launch.role}`); return { agent: launch.agent, result: launch.role === 'implementer' ? {} : { status: 0 } }; } },
    artifacts: { consumeReviewer: options.consume },
    preReview: { head: () => `head-${++head}` },
    ...(stored ? { stateport: { read: async () => stored.current, persist: async (next: ReviewLoopState) => { stored.current = next; } } } : {}),
  });
  const run = () => runReviewLoop({ slug: TEST_SLUG, implementer: 'claude', reviewer: 'codex', reboundsPerRound: options.reboundsPerRound, isContinue: options.isContinue }, fake.ports);
  return { events, stops: fake.stops, errors: fake.errors, run };
}

const incomplete = (diagnostic: string): ReviewerArtifactFacts => ({ consumed: true, ok: false, diagnostic });
const complete = (reviewState: string | null): ReviewerArtifactFacts => ({ consumed: true, ok: true, reviewState });

test('task-2377.04: a round reaching the per-round relaunch cap stops with the cap diagnostic and exactly the capped number of bounce launches (SC4)', async () => {
  assert.equal(DEFAULT_REBOUNDS_PER_ROUND, 6, 'the named default cap is 6');
  const cap = 3;
  // [initial consume, verify re-consume 1, verify re-consume 2, timeout-retry consume]
  const results = [
    incomplete('reviewer left incomplete review artifacts'),
    incomplete('reviewer still left incomplete review artifacts'),
    complete(null),
    complete(null),
  ];
  const { events, stops, errors, run } = runLoop({ reboundsPerRound: cap, consume: async () => results.shift() ?? complete(null) });

  await run();

  const reviewerLaunches = events.filter((event) => event === 'review:reviewer').length;
  const bounceLaunches = reviewerLaunches - 1; // the first per-round launch is not a bounce
  assert.equal(bounceLaunches, cap, `the round must stop after exactly ${cap} bounce launches, got ${bounceLaunches}`);
  assert.deepEqual(stops, [REBOUNDS_PER_ROUND_EXHAUSTED], 'the loop stops with the new named escalation reason');
  assert.ok(errors.some((line) => line.includes('Per-round relaunch cap reached')), 'the cap exhaustion log line is emitted');
  assert.equal(events.filter((event) => event === 'act-on-review:implementer').length, 0, 'no further relaunches happen after the cap');
});

test('task-2377.04: a round under the per-round cap is unaffected and keeps the per-kind exhaustion reason (SC4)', async () => {
  // No reboundsPerRound option: the default 6 must apply.
  const { events, stops, errors, run } = runLoop({ consume: async () => incomplete('reviewer still left incomplete review artifacts') });

  await run();

  const bounceLaunches = events.filter((event) => event === 'review:reviewer').length - 1;
  assert.equal(bounceLaunches, 2, 'the artifact occurrence still gets its full per-occurrence budget of 2 under the cap');
  assert.deepEqual(stops, ['REVIEWER_ARTIFACT_RETRY_EXHAUSTED'], 'the per-kind exhaustion reason is kept below the cap');
  assert.ok(!errors.some((line) => line.includes('Per-round relaunch cap reached')), 'no cap diagnostic below the cap');
});

test('task-2377.04: the per-round relaunch counter resets when the next round starts (SC4)', async () => {
  const cap = 3;
  const results = [
    // Round 1: artifact bounce fixed on the second attempt (2 relaunches).
    incomplete('round 1: incomplete review artifacts'),
    incomplete('round 1: still incomplete'),
    complete('REQUEST_CHANGES'),
    // Round 2: a fresh artifact occurrence fails both attempts.
    incomplete('round 2: incomplete review artifacts'),
    incomplete('round 2: still incomplete'),
    incomplete('round 2: still incomplete'),
  ];
  const { events, stops, errors, run } = runLoop({ reboundsPerRound: cap, consume: async () => results.shift() ?? complete('REQUEST_CHANGES') });

  await run();

  const reviewerLaunches = events.filter((event) => event === 'review:reviewer').length;
  // Round 1: first launch + 2 bounce launches; round 2: first launch + 2 bounce
  // launches. If the round counter did not reset, round 2's occurrence would be
  // clamped to 1 launch and the cap reason would fire instead.
  assert.equal(reviewerLaunches, 6, `both rounds must get a full per-occurrence budget (6 total reviewer launches), got ${reviewerLaunches}`);
  assert.deepEqual(stops, ['REVIEWER_ARTIFACT_RETRY_EXHAUSTED'], 'round 2 strands on the per-kind reason, not the cap reason');
  assert.ok(!errors.some((line) => line.includes('Per-round relaunch cap reached')), 'the cap is never reached across the reset');
  assert.equal(events.filter((event) => event === 'act-on-review:implementer').length, 1, 'round 1 reaches the implementer phase exactly once');
});

test('task-2377.04: an exhausted artifact occurrence gets a fresh per-occurrence budget on the next occurrence (SC7)', async () => {
  // The loop is re-entered on a persisted round (resume); nothing a previous
  // occurrence spent may carry over, so the next same-kind occurrence starts
  // from a fresh budget of 2.
  const state = { current: null as ReviewLoopState | null };
  const consume = async () => incomplete('reviewer still left incomplete review artifacts');

  const first = runLoop({ consume, state });
  await first.run();
  assert.equal(first.events.filter((event) => event === 'review:reviewer').length - 1, 2, 'the first occurrence consumes its full per-occurrence budget');

  const second = runLoop({ consume, state, isContinue: true });
  await second.run();
  assert.equal(second.events.filter((event) => event === 'review:reviewer').length - 1, 2, 'the later same-kind occurrence gets a fresh budget of 2 — no cumulative carryover');
  assert.deepEqual(second.stops, ['REVIEWER_ARTIFACT_RETRY_EXHAUSTED'], 'the resumed occurrence strands on the per-kind reason');
});
