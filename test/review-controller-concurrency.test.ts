// review controller concurrency.
// Related scenarios share imports; each contract keeps its own hooks and mutable fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startReviewLoop } from '../src/adapters/review/review-loop.js';
import { ReviewState } from '../src/adapters/review/review-state.js';
import { mkdtemp } from './helpers/temp-dir.js';

// Regression provenance: TASK-2600.
const SLUG = 'task-2600';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

/**
 * TASK-2600: a delayed round-2 reviewer launch used to resume with the
 * outer controller's flattened state after another controller had committed
 * the round-3 approval. The fallback then tried to persist round 2 and the
 * monotonic stale-round guard correctly rejected it, but the parent loop
 * failed and reported the already-approved review as broken.
 */
test('TASK-2600 repro: delayed outer fallback leaves a concurrent round-3 approval authoritative', async () => {
  const root = mkdtemp('task-2600-');
  fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { review: { provider: 'none' } } }));
  const launchEntered = deferred<void>();
  const releaseOuterLaunch = deferred<{ agent: string }>();
  const writes: ReviewState[] = [];
  let authoritative = new ReviewState(SLUG, {
    reviewer: 'codex', implementer: 'claude', round: 2,
    phase: 'reviewing', startedAt: '2026-09-29T10:00:00.000Z',
  });

  const outerOptions: any = {
    worktree: root,
    implementer: 'claude', reviewer: 'codex', maxAttempts: 3, skipHandoff: true,
    maybeUpdateGraphifyBeforeReviewFn: () => {},
    resolveTaskFileFn: () => ({ ok: true, taskFile: path.join(root, 'task.md') }),
    getTaskImplementerFn: () => 'claude', getTaskStatusFn: () => 'review',
    eligibleAgentsForStepFn: () => ['claude', 'codex', 'custom'],
    workflowLauncherStatusFn: () => ({ supported: true }),
    readReviewStateFn: () => authoritative,
    writeReviewStateFn: async (_slug: string, state: ReviewState) => {
      if (state.round < authoritative.round) {
        throw new Error(`Cannot apply review state: supplied round ${state.round} is lower than the current round ${authoritative.round}; a stale flattened write must not renumber an existing round`);
      }
      authoritative = state;
      writes.push(state);
      return { outcome: 'committed' as const };
    },
    transitionTaskFn: () => true, transitionVirtualFn: () => true,
    rebaseBeforeReviewRoundFn: async () => ({ ok: true }),
    runPreReviewGateFn: async () => ({ ok: true, area: 'all', exitCode: 0 }),
    startAgentFn: async () => {
      launchEntered.resolve();
      return releaseOuterLaunch.promise;
    },
    applyAgentFallbackFn: async ({ launchResult, original, state }: any) => {
      state.reviewer = launchResult.agent;
      if (state.round < authoritative.round) {
        throw new Error(`Cannot apply review state: supplied round ${state.round} is lower than the current round ${authoritative.round}; a stale flattened write must not renumber an existing round`);
      }
      authoritative = state;
      return original;
    },
    consumeReviewerArtifactsFn: async () => ({ consumed: false }),
    pollForReviewFn: async () => 'APPROVED',
    buildCompactReviewPromptFn: () => 'review prompt',
    log: () => {}, error: () => {}, exit: (code: number) => { throw new Error(`unexpected exit ${code}`); },
  };
  const outer = startReviewLoop(SLUG, outerOptions);

  try {
    await launchEntered.promise;
    // This models a concurrent `px review --continue`: it has advanced and
    // approved round 3 while the outer round-2 launch is still in flight.
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
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('TASK-2600 controller fence declines a concurrent continue while a start owns the round', async () => {
  const root = mkdtemp('task-2600-controller-');
  fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { review: { provider: 'none' } } }));
  const launchEntered = deferred<void>();
  const releaseLaunch = deferred<{ agent: string }>();
  const logs: string[] = [];
  let launches = 0;
  let state = new ReviewState(SLUG, { reviewer: 'codex', implementer: 'claude', round: 2, phase: 'reviewing' });
  const options: any = {
    worktree: root, implementer: 'claude', reviewer: 'codex', maxAttempts: 2, skipHandoff: true,
    maybeUpdateGraphifyBeforeReviewFn: () => {},
    resolveTaskFileFn: () => ({ ok: true, taskFile: path.join(root, 'task.md') }),
    getTaskImplementerFn: () => 'claude', getTaskStatusFn: () => 'review',
    eligibleAgentsForStepFn: () => ['claude', 'codex'], workflowLauncherStatusFn: () => ({ supported: true }),
    readReviewStateFn: () => state,
    writeReviewStateFn: async (_slug: string, next: ReviewState) => { state = next; return { outcome: 'committed' as const }; },
    transitionTaskFn: () => true, transitionVirtualFn: () => true,
    rebaseBeforeReviewRoundFn: async () => ({ ok: true }), runPreReviewGateFn: async () => ({ ok: true, area: 'all', exitCode: 0 }),
    startAgentFn: async () => { launches++; launchEntered.resolve(); return releaseLaunch.promise; },
    applyAgentFallbackFn: async ({ original }: { original: string }) => original,
    consumeReviewerArtifactsFn: async () => ({ consumed: false }), pollForReviewFn: async () => 'APPROVED',
    buildCompactReviewPromptFn: () => 'review prompt', log: (line: string) => logs.push(line), error: (line: string) => logs.push(line),
    exit: (code: number) => { throw new Error(`unexpected exit ${code}`); },
  };
  const start = startReviewLoop(SLUG, options);
  try {
    await launchEntered.promise;
    await startReviewLoop(SLUG, { ...options, continue: true, isContinue: true });
    assert.equal(launches, 1, 'the concurrent continue must not launch another reviewer');
    assert.ok(logs.some((line) => /not starting a competing loop.*px review task-2600 --continue/i.test(line)), 'the declined invocation names the precise continuation action');
    releaseLaunch.resolve({ agent: 'codex' });
    await start;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
