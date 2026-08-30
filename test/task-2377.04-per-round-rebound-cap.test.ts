// @ts-nocheck -- TASK-2328: partial test doubles from ESM seam migration; resolve in follow-up

// TASK-2377.04 CP-3: the per-round relaunch cap.
//
// Mock-only: every collaborator of `startReviewLoop` is injected; the rebound
// kernel runs for real (it is the code under test together with the loop's
// cap accounting), with the launch port and the artifact re-consume injected.
// No agents, no git, no Forgejo.

import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mockModule, installModuleMocks } from './lib/module-mock.js';
const startReviewLoopModule = mockModule<typeof import('../src/adapters/review/review-loop.js')>('../src/adapters/review/review-loop.js', import.meta.url);
await installModuleMocks();
test.afterEach(() => mock.restoreAll());
const { startReviewLoop, DEFAULT_REBOUNDS_PER_ROUND, REBOUNDS_PER_ROUND_EXHAUSTED } = startReviewLoopModule;
const { POLL_TIMEOUT } = await import('../src/adapters/review/review-polling.js');

const TEST_SLUG = `task-2377.04-round-cap-${process.pid}`;
let previousHome;
let temporaryHome;

test.beforeEach(() => {
  temporaryHome = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2377.04-cap-home-'));
  previousHome = process.env.PARALLIX_HOME;
  process.env.PARALLIX_HOME = temporaryHome;
});

test.afterEach(() => {
  if (previousHome === undefined) delete process.env.PARALLIX_HOME;
  else process.env.PARALLIX_HOME = previousHome;
  fs.rmSync(temporaryHome, { recursive: true, force: true });
});

/**
 * Harness: forgejo-enabled review loop with an injected reviewer whose
 * artifact consumption follows `consumeResults` (shifted per call), a poll
 * that always times out, and an implementer that reports CHANGES_MADE.
 */
function runLoop(options: Record<string, unknown>) {
  const events: string[] = [];
  const stops: string[] = [];
  const errors: string[] = [];
  const base = {
    eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'custom'],
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
    transitionTaskFn: async () => {},
    transitionVirtualFn: async () => {},
    implementer: 'claude', reviewer: 'codex', dryRun: false,
    // Hermetic seams: no real worktree resolution and no real git CLI inside
    // the loop (each would spawn the shimmed git, ~50-100 ms per call).
    worktree: temporaryHome,
    gitFn: () => ({ status: 0, stdout: '', stderr: '' }),
    workflowLauncherStatusFn: () => ({ supported: true }),
    isForgejoReviewEnabledFn: () => true,
    forgejoAvailableFn: async () => true,
    getPrStatusFn: () => ({ exists: true, state: 'open', number: 41 }),
    performHandoffFn: async () => ({ ok: true }),
    maybeUpdateGraphifyBeforeReviewFn: () => {},
    enforceTaskAssigneeFn: () => true,
    resolveForgejoUserFn: () => 'gemini', readTokenFn: () => 'token',
    readReviewStateFn: () => null,
    writeReviewStateFn: async () => ({ outcome: 'committed' }),
    rebaseBeforeReviewRoundFn: async () => ({ ok: true, sharedFileConflicts: false }),
    runPreReviewGateFn: async () => ({ ok: true, area: 'lib', command: 'true', exitCode: 0, stdout: '', stderr: '' }),
    startAgentFn: async (step: string, opts: Record<string, unknown>) => {
      events.push(`${step}:${(opts as any).role}`);
      return { agent: (opts as any).agent, result: { status: 0 } };
    },
    applyAgentFallbackFn: ({ original }: { original: string }) => original,
    buildCompactReviewPromptFn: () => 'review prompt',
    buildCompactActOnReviewPromptFn: () => 'act-on-review prompt',
    log: () => {},
    error: (msg: string) => { errors.push(String(msg)); },
    exit: () => { throw new Error('unexpected process.exit'); },
    consumeReviewerArtifactsFn: async () => { throw new Error('consumeReviewerArtifactsFn must be provided'); },
    consumeImplementerArtifactsFn: async () => ({ consumed: false }),
    pollForReviewFn: async () => POLL_TIMEOUT,
    pollForDispositionFn: async () => 'CHANGES_MADE',
    hasNewCommittedChangeFn: () => false,
    pushReviewRefFn: () => ({ status: 0 }),
    onAutonomousStop: async (reason: string) => { stops.push(reason); },
  };
  return { events, stops, errors, run: () => startReviewLoop(TEST_SLUG, { ...base, ...options }) };
}

const incomplete = (diagnostic: string) => ({ consumed: true, ok: false, diagnostic });
const complete = (reviewState: unknown) => ({ consumed: true, ok: true, reviewState });

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
  const { events, stops, errors, run } = runLoop({
    reboundsPerRound: cap,
    consumeReviewerArtifactsFn: async () => results.shift() ?? complete(null),
  });

  await run();

  const reviewerLaunches = events.filter((event) => event === 'review:reviewer').length;
  const bounceLaunches = reviewerLaunches - 1; // the first per-round launch is not a bounce
  assert.equal(bounceLaunches, cap, `the round must stop after exactly ${cap} bounce launches, got ${bounceLaunches}`);
  assert.deepEqual(stops, [REBOUNDS_PER_ROUND_EXHAUSTED], 'the loop stops with the new named escalation reason');
  assert.ok(errors.some((line) => line.includes('Per-round relaunch cap reached')), 'the cap exhaustion log line is emitted');
  assert.equal(events.filter((event) => event === 'act-on-review:implementer').length, 0, 'no further relaunches happen after the cap');
});

test('task-2377.04: a round under the per-round cap is unaffected and keeps the per-kind exhaustion reason (SC4)', async () => {
  const { events, stops, errors, run } = runLoop({
    // No reboundsPerRound option: the default 6 must apply.
    consumeReviewerArtifactsFn: async () => incomplete('reviewer still left incomplete review artifacts'),
  });

  await run();

  const reviewerLaunches = events.filter((event) => event === 'review:reviewer').length;
  const bounceLaunches = reviewerLaunches - 1;
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
  const { events, stops, errors, run } = runLoop({
    reboundsPerRound: cap,
    consumeReviewerArtifactsFn: async () => results.shift() ?? complete('REQUEST_CHANGES'),
  });

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
  // occurrence spent may carry over — the persisted cumulative counters are
  // gone, so the next same-kind occurrence starts from a fresh budget of 2.
  let storedState: unknown = null;
  const makeRun = (isContinue: boolean) => runLoop({
    isContinue,
    readReviewStateFn: () => storedState,
    writeReviewStateFn: async (_slug: string, state: unknown) => { storedState = state; return { outcome: 'committed' }; },
    consumeReviewerArtifactsFn: async () => incomplete('reviewer still left incomplete review artifacts'),
  });

  const first = makeRun(false);
  await first.run();
  const firstBounce = first.events.filter((event) => event === 'review:reviewer').length - 1;
  assert.equal(firstBounce, 2, 'the first occurrence consumes its full per-occurrence budget');

  const second = makeRun(true);
  await second.run();
  const secondBounce = second.events.filter((event) => event === 'review:reviewer').length - 1;
  assert.equal(secondBounce, 2, 'the later same-kind occurrence gets a fresh budget of 2 — no cumulative carryover');
  assert.deepEqual(second.stops, ['REVIEWER_ARTIFACT_RETRY_EXHAUSTED'], 'the resumed occurrence strands on the per-kind reason');
});
