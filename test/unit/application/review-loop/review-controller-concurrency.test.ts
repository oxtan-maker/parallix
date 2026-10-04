// review controller concurrency.
// The application loop owns the stale-controller policy; the controller lock is
// a process-local mechanism bound by the review-loop adapter.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runReviewLoop } from '../../../../src/application/review-loop/review-loop.js';
import { createReviewLoopPorts } from '../../../../src/adapters/review/review-loop.js';
import { ReviewState } from '../../../../src/adapters/review/review-state.js';
import { fakeReviewLoopPorts } from '../../../helpers/review-loop-ports.js';
import { mkdtemp } from '../../../helpers/temp-dir.js';
import fs from 'node:fs';

// Regression provenance: TASK-2600.
const SLUG = 'task-2600';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

/** One in-process fence shared by every controller in a test. */
function sharedLock() {
  let held = false;
  return { tryAcquire: () => (held ? false : (held = true)), release: () => { held = false; } };
}

/**
 * TASK-2600: a delayed round-2 reviewer launch used to resume with the
 * outer controller's flattened state after another controller had committed
 * the round-3 approval. The fallback then tried to persist round 2 and the
 * monotonic stale-round guard correctly rejected it, but the parent loop
 * failed and reported the already-approved review as broken.
 */
test('TASK-2600 repro: delayed outer fallback leaves a concurrent round-3 approval authoritative', async () => {
  const launchEntered = deferred<void>();
  const releaseOuterLaunch = deferred<{ agent: string }>();
  const writes: ReviewState[] = [];
  let authoritative = new ReviewState(SLUG, {
    reviewer: 'codex', implementer: 'claude', round: 2,
    phase: 'reviewing', startedAt: '2026-09-29T10:00:00.000Z',
  });
  const staleWrite = (state: { round: number }) => {
    if (state.round < authoritative.round) {
      throw new Error(`Cannot apply review state: supplied round ${state.round} is lower than the current round ${authoritative.round}; a stale flattened write must not renumber an existing round`);
    }
  };
  const fake = fakeReviewLoopPorts({
    slug: SLUG,
    routing: { eligibleFamilies: () => ['claude', 'codex', 'custom'] },
    stateport: {
      read: async () => authoritative,
      persist: async state => { staleWrite(state); authoritative = state as ReviewState; writes.push(state as ReviewState); },
    },
    agents: { launch: async () => { launchEntered.resolve(); return await releaseOuterLaunch.promise; } },
    output: { exit: (code: number) => { throw new Error(`unexpected exit ${code}`); } },
  });
  const outer = runReviewLoop({ slug: SLUG, implementer: 'claude', reviewer: 'codex', maxAttempts: 3, skipHandoff: true }, fake.ports);

  await launchEntered.promise;
  // A concurrent `px review --continue` has advanced and approved round 3
  // while the outer round-2 launch is still in flight.
  authoritative = new ReviewState(SLUG, {
    reviewer: 'custom', implementer: 'claude', round: 3,
    phase: 'approved', disposition: 'APPROVED', startedAt: '2026-09-29T11:00:00.000Z',
  });
  const writesBeforeFallback = writes.length;
  releaseOuterLaunch.resolve({ agent: 'custom' });

  await assert.doesNotReject(outer, 'the superseded outer controller must reconcile instead of surfacing a stale write');
  assert.equal(authoritative.round, 3, 'the concurrent round remains current');
  assert.equal(authoritative.phase, 'approved', 'the concurrent approval remains intact');
  assert.equal(authoritative.disposition, 'APPROVED', 'the authoritative approval remains intact');
  assert.ok(writes.slice(writesBeforeFallback).every((state) => state.round >= 3), 'the superseded controller must not persist a round-2 snapshot after the transition');
  assert.ok(fake.logs.some(line => line.includes('was superseded before reviewer-launch fallback by authoritative round 3')), fake.logs.join('\n'));
});

test('TASK-2600 controller fence declines a concurrent continue while a start owns the round', async () => {
  const launchEntered = deferred<void>();
  const releaseLaunch = deferred<{ agent: string }>();
  const lock = sharedLock();
  const state = new ReviewState(SLUG, { reviewer: 'codex', implementer: 'claude', round: 2, phase: 'reviewing' });
  const start = fakeReviewLoopPorts({
    slug: SLUG, state, lock,
    agents: { launch: async () => { launchEntered.resolve(); return await releaseLaunch.promise; } },
    output: { exit: (code: number) => { throw new Error(`unexpected exit ${code}`); } },
  });
  const competing = fakeReviewLoopPorts({ slug: SLUG, state, lock });
  const running = runReviewLoop({ slug: SLUG, implementer: 'claude', reviewer: 'codex', maxAttempts: 2, skipHandoff: true }, start.ports);
  await launchEntered.promise;
  await runReviewLoop({ slug: SLUG, implementer: 'claude', reviewer: 'codex', maxAttempts: 2, skipHandoff: true, isContinue: true }, competing.ports);
  assert.equal(start.launches.length + competing.launches.length, 1, 'the concurrent continue must not launch another reviewer');
  assert.ok(competing.logs.some((line) => /not starting a competing loop.*px review task-2600 --continue/i.test(line)), 'the declined invocation names the precise continuation action');
  releaseLaunch.resolve({ agent: 'codex' });
  await running;
});

test('the review-loop controller lock admits one owner per worktree and mission until released', () => {
  const root = mkdtemp('task-2600-lock-');
  try {
    const first = createReviewLoopPorts(SLUG, { worktree: root }, { log: () => {}, error: () => {} });
    const second = createReviewLoopPorts(SLUG, { worktree: root }, { log: () => {}, error: () => {} });
    const other = createReviewLoopPorts('task-2601', { worktree: root }, { log: () => {}, error: () => {} });
    assert.equal(first.lock.tryAcquire(), true);
    assert.equal(second.lock.tryAcquire(), false, 'a second controller for the same mission worktree is refused');
    assert.equal(other.lock.tryAcquire(), true, 'another mission is independent');
    first.lock.release();
    other.lock.release();
    assert.equal(second.lock.tryAcquire(), true, 'release frees the fence');
    second.lock.release();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
