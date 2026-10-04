// @ts-nocheck -- Retained legacy partial request doubles (TASK-2328).
// review loop retry contract.
// Related scenarios share imports; each contract keeps its own hooks and mutable fixtures.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mkdtemp as registeredMkdtemp } from '../../../helpers/temp-dir.js';
import { startReviewLoop } from '../../../../src/adapters/review/review-loop.js';
import { ReviewState } from '../../../../src/adapters/review/review-state.js';
import { POLL_TIMEOUT, isPollTimeout } from '../../../../src/adapters/review/review-polling.js';

// Regression provenance: TASK-1221.
describe("stale blocked relaunch", { concurrency: false }, () => {
  async function createWorktree(slug, config) {
    const root = registeredMkdtemp(`task-1221-${slug}-`);
    if (config) {
      fs.writeFileSync(
        path.join(root, 'workflow.config.json'),
        JSON.stringify(config)
      );
    }
    return root;
  }

  test('SC1: --continue skip-check BLOCKED re-launches implementer instead of skipping', async () => {
    const root = await createWorktree('task-1221-sc1', {
      product: {},
      adapters: { review: { provider: 'forgejo' } }
    });
    const logs = [];
    const launches = [];

    try {
      const state = new ReviewState('task-1221-sc1', {
        reviewer: 'codex',
        implementer: 'custom',
        phase: 'fixing',
        round: 1
      });

      await startReviewLoop('task-1221-sc1', {
        worktree: root,
        continue: true,
        isContinue: true,
        maxAttempts: 1,
        dryRun: false,
        maybeUpdateGraphifyBeforeReviewFn: () => {},
        resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task-1221-sc1.md' }),
        getTaskImplementerFn: () => null,
        readReviewStateFn: () => state,
        eligibleAgentsForStepFn: () => ['codex', 'custom'],
        selectAgentFn: () => 'codex',
        forgejoAvailableFn: () => true,
        getPrStatusFn: () => ({ exists: true, state: 'open', number: 208 }),
        rebaseBeforeReviewRoundFn: async () => ({ ok: true }),
        startAgentFn: async (mode) => {
          launches.push(mode);
          return { agent: 'custom' };
        },
        consumeImplementerArtifactsFn: async () => ({ consumed: true, ok: true, disposition: 'CHANGES_MADE' }),
        transitionTaskFn: () => true,
        transitionVirtualFn: () => true,
        writeReviewStateFn: () => {},
        getLatestReviewForPrFn: () => ({ state: 'REQUEST_CHANGES' }),
        pollForReviewFn: async () => 'REQUEST_CHANGES',
        log: (msg) => logs.push(msg),
        error: (msg) => {},
        exit: () => {},
        pollForDispositionFn: () => 'BLOCKED' // skip-check finds stale BLOCKED
      });

      // The implementer should have been re-launched with act-on-review
      assert.ok(
        launches.some(l => l === 'act-on-review'),
        `Expected implementer re-launch (act-on-review) after stale BLOCKED; got launches: ${JSON.stringify(launches)}`
      );

      // Must contain the re-launch log message
      assert.ok(
        logs.some(m => m.includes('Re-launching implementer') || m.includes('re-launching implementer')),
        `Expected re-launch log message; got: ${logs.join(' | ')}`
      );

      // Must NOT contain the "Skipping implementer launch" message (old behaviour)
      assert.ok(
        !logs.some(m => m.includes('Skipping implementer launch') && m.includes('BLOCKED')),
        `Should NOT log "Skipping implementer launch" for BLOCKED; got: ${logs.join(' | ')}`
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('SC2: Re-launched implementer posts CHANGES_MADE → loop continues to next round', async () => {
    const root = await createWorktree('task-1221-sc2', {
      product: {},
      adapters: { review: { provider: 'forgejo' } }
    });
    const logs = [];
    const launches = [];

    try {
      const state = new ReviewState('task-1221-sc2', {
        reviewer: 'codex',
        implementer: 'custom',
        phase: 'fixing',
        round: 1
      });

      await startReviewLoop('task-1221-sc2', {
        worktree: root,
        continue: true,
        isContinue: true,
        maxAttempts: 2,
        dryRun: false,
        maybeUpdateGraphifyBeforeReviewFn: () => {},
        resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task-1221-sc2.md' }),
        getTaskImplementerFn: () => null,
        readReviewStateFn: () => state,
        eligibleAgentsForStepFn: () => ['codex', 'custom'],
        selectAgentFn: () => 'codex',
        forgejoAvailableFn: () => true,
        getPrStatusFn: () => ({ exists: true, state: 'open', number: 208 }),
        rebaseBeforeReviewRoundFn: async () => ({ ok: true }),
        startAgentFn: async (mode) => {
          launches.push(mode);
          return { agent: 'custom' };
        },
        consumeImplementerArtifactsFn: async () => ({ consumed: true, ok: true, disposition: 'CHANGES_MADE' }),
        consumeReviewerArtifactsFn: async () => ({ consumed: true, ok: true, reviewState: 'REQUEST_CHANGES' }),
        transitionTaskFn: () => true,
        transitionVirtualFn: () => true,
        writeReviewStateFn: () => {},
        getLatestReviewForPrFn: () => ({ state: 'REQUEST_CHANGES' }),
        pollForReviewFn: () => 'REQUEST_CHANGES',
        log: (msg) => logs.push(msg),
        error: (msg) => {},
        exit: () => {},
        pollForDispositionFn: () => 'BLOCKED' // skip-check always finds stale BLOCKED
      });

      // Implementer launched twice: once for re-launch, once for round 2
      const actOnReviewCalls = launches.filter(l => l === 'act-on-review');
      assert.equal(actOnReviewCalls.length, 2, `Expected 2 act-on-review launches (re-launch + round 2); got: ${JSON.stringify(launches)}`);

      // Must contain the re-launch log message
      assert.ok(
        logs.some(m => m.includes('Re-launching implementer') || m.includes('re-launching implementer')),
        `Expected re-launch log in: ${logs.join(' | ')}`
      );

      // Must contain the continue message
      assert.ok(
        logs.some(m => m.includes('implementer made changes') && m.includes('Continuing to round')),
        `Expected continue-to-next-round message; got: ${logs.join(' | ')}`
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('SC3: Re-launched implementer still BLOCKED → loop stops with handoff', async () => {
    const root = await createWorktree('task-1221-sc3', {
      product: {},
      adapters: { review: { provider: 'forgejo' } }
    });
    const logs = [];
    const launches = [];
    const dispositions = ['BLOCKED', 'BLOCKED'];
    let consumeCall = 0;

    try {
      const state = new ReviewState('task-1221-sc3', {
        reviewer: 'codex',
        implementer: 'custom',
        phase: 'fixing',
        round: 1
      });

      const loopState = {};

      await startReviewLoop('task-1221-sc3', {
        worktree: root,
        continue: true,
        isContinue: true,
        maxAttempts: 1,
        dryRun: false,
        maybeUpdateGraphifyBeforeReviewFn: () => {},
        resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task-1221-sc3.md' }),
        getTaskImplementerFn: () => null,
        readReviewStateFn: () => state,
        eligibleAgentsForStepFn: () => ['codex', 'custom'],
        selectAgentFn: () => 'codex',
        forgejoAvailableFn: () => true,
        getPrStatusFn: () => ({ exists: true, state: 'open', number: 208 }),
        rebaseBeforeReviewRoundFn: async () => ({ ok: true }),
        startAgentFn: async (mode) => {
          launches.push(mode);
          return { agent: 'custom' };
        },
        consumeImplementerArtifactsFn: async () => {
          const disp = dispositions[consumeCall] || 'BLOCKED';
          consumeCall++;
          return { consumed: true, ok: true, disposition: disp };
        },
        consumeReviewerArtifactsFn: async () => ({ consumed: true, ok: true, reviewState: 'REQUEST_CHANGES' }),
        transitionTaskFn: () => true,
        transitionVirtualFn: () => true,
        writeReviewStateFn: (slug, s) => {
  // @ts-expect-error -- Legacy fixture intentionally accesses runtime-only `disposition` absent from its inferred mock shape.
          loopState.disposition = s.disposition;
        },
        getLatestReviewForPrFn: () => ({ state: 'REQUEST_CHANGES' }),
        pollForReviewFn: async () => 'REQUEST_CHANGES',
        log: (msg) => logs.push(msg),
        error: (msg) => {},
        exit: () => {},
        pollForDispositionFn: () => 'BLOCKED' // skip-check finds stale BLOCKED
      });

      // The implementer should have been re-launched
      const actOnReviewCalls = launches.filter(l => l === 'act-on-review');
      assert.equal(actOnReviewCalls.length, 1, `Expected 1 act-on-review re-launch; got: ${JSON.stringify(launches)}`);

      // Must log the stop message
      assert.ok(
        logs.some(m => m.includes('Autonomous review stopped') && m.includes('BLOCKED') && m.includes('Hand off')),
        `Expected stop/handoff message; got: ${logs.join(' | ')}`
      );

      // Disposition should be persisted
  // @ts-expect-error -- Legacy fixture intentionally accesses runtime-only `equal` absent from its inferred mock shape.
      assert.equal(loopState.disposition, 'BLOCKED', 'Disposition should be BLOCKED');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('SC4: Non-continue (fresh start) path is unaffected', async () => {
    const root = await createWorktree('task-1221-sc4', {
      product: {},
      adapters: { review: { provider: 'forgejo' } }
    });
    const logs = [];

    try {
      // New review loop, not --continue
      await startReviewLoop('task-1221-sc4', {
        worktree: root,
        continue: false,
        isContinue: false,
        maxAttempts: 1,
        dryRun: true,
        maybeUpdateGraphifyBeforeReviewFn: () => {},
        resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task-1221-sc4.md' }),
        getTaskImplementerFn: () => null,
        readReviewStateFn: () => null,
        eligibleAgentsForStepFn: () => ['codex', 'custom'],
        selectAgentFn: () => 'codex',
        forgejoAvailableFn: () => true,
        getPrStatusFn: () => ({ exists: true, state: 'open' }),
        rebaseBeforeReviewRoundFn: async () => ({ ok: true }),
        startAgentFn: async () => ({ agent: 'custom' }),
        getLatestReviewForPrFn: () => ({ state: 'REQUEST_CHANGES' }),
        pollForReviewFn: async () => 'REQUEST_CHANGES',
        log: (msg) => logs.push(msg),
        error: (msg) => {},
        exit: () => {}
      });

      // In dryRun fresh start, should see DRY-RUN markers for both reviewer and implementer
      assert.ok(logs.some(m => m.includes('DRY-RUN')), 'Expected DRY-RUN marker in logs');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('SC5: PARKED disposition also triggers re-launch (not just BLOCKED)', async () => {
    const root = await createWorktree('task-1221-sc5', {
      product: {},
      adapters: { review: { provider: 'forgejo' } }
    });
    const logs = [];
    const launches = [];

    try {
      const state = new ReviewState('task-1221-sc5', {
        reviewer: 'codex',
        implementer: 'custom',
        phase: 'fixing',
        round: 1
      });

      await startReviewLoop('task-1221-sc5', {
        worktree: root,
        continue: true,
        isContinue: true,
        maxAttempts: 1,
        dryRun: false,
        maybeUpdateGraphifyBeforeReviewFn: () => {},
        resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task-1221-sc5.md' }),
        getTaskImplementerFn: () => null,
        readReviewStateFn: () => state,
        eligibleAgentsForStepFn: () => ['codex', 'custom'],
        selectAgentFn: () => 'codex',
        forgejoAvailableFn: () => true,
        getPrStatusFn: () => ({ exists: true, state: 'open', number: 208 }),
        rebaseBeforeReviewRoundFn: async () => ({ ok: true }),
        startAgentFn: async (mode) => {
          launches.push(mode);
          return { agent: 'custom' };
        },
        consumeImplementerArtifactsFn: async () => ({ consumed: true, ok: true, disposition: 'CHANGES_MADE' }),
        transitionTaskFn: () => true,
        transitionVirtualFn: () => true,
        writeReviewStateFn: () => {},
        getLatestReviewForPrFn: () => ({ state: 'REQUEST_CHANGES' }),
        pollForReviewFn: async () => 'REQUEST_CHANGES',
        log: (msg) => logs.push(msg),
        error: (msg) => {},
        exit: () => {},
        pollForDispositionFn: () => 'PARKED' // skip-check finds stale PARKED
      });

      // Must re-launch implementer (not skip) for PARKED
      assert.ok(
        launches.some(l => l === 'act-on-review'),
        `Expected implementer re-launch after stale PARKED; got launches: ${JSON.stringify(launches)}`
      );

      assert.ok(
        logs.some(m => m.includes('Re-launching implementer') || m.includes('re-launching implementer')),
        `Expected re-launch log message for PARKED; got: ${logs.join(' | ')}`
      );

      // Non-BLOCKED/PARKED dispositions (CHANGES_MADE) should NOT trigger re-launch in skip-check
      // They already work correctly — the skip-check for non-blocked disposition logs "Skipping"
      // and the disposition is accepted directly. We just verify the old non-blocking skip still works.
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('Skip-check non-BLOCKED/PARKED disposition still skips (existing behaviour preserved)', async () => {
    const root = await createWorktree('task-1221-skip-normal', {
      product: {},
      adapters: { review: { provider: 'forgejo' } }
    });
    const logs = [];

    try {
      const state = new ReviewState('task-1221-skip-normal', {
        reviewer: 'codex',
        implementer: 'custom',
        phase: 'fixing',
        round: 1
      });

      await startReviewLoop('task-1221-skip-normal', {
        worktree: root,
        continue: true,
        isContinue: true,
        maxAttempts: 1,
        dryRun: false,
        maybeUpdateGraphifyBeforeReviewFn: () => {},
        resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task-1221-skip-normal.md' }),
        getTaskImplementerFn: () => null,
        readReviewStateFn: () => state,
        eligibleAgentsForStepFn: () => ['codex', 'custom'],
        selectAgentFn: () => 'codex',
        forgejoAvailableFn: () => true,
        getPrStatusFn: () => ({ exists: true, state: 'open', number: 208 }),
        rebaseBeforeReviewRoundFn: async () => ({ ok: true }),
        startAgentFn: async () => ({ agent: 'custom' }),
        consumeImplementerArtifactsFn: async () => ({ consumed: true, ok: true, disposition: 'CHANGES_MADE' }),
        transitionTaskFn: () => true,
        transitionVirtualFn: () => true,
        writeReviewStateFn: () => {},
        getLatestReviewForPrFn: () => ({ state: 'REQUEST_CHANGES' }),
        log: (msg) => logs.push(msg),
        error: (msg) => {},
        exit: () => {},
        pollForDispositionFn: () => 'CHANGES_MADE' // skip-check finds non-blocking disposition
      });

      // For non-BLOCKED/PARKED disposition, should skip implementer launch
      assert.ok(
        logs.some(m => m.includes('Skipping implementer launch')),
        `Expected "Skipping implementer launch" for non-blocking disposition; got: ${logs.join(' | ')}`
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('SC1-Fix: Post-relaunch poll uses updated sinceIso, not stale state.startedAt', async () => {
    const root = await createWorktree('task-1221-sc1-forge-race', {
      product: {},
      adapters: { review: { provider: 'forgejo' } }
    });
    const logs = [];
    const launches = [];
    let consumeCall = 0;

    try {
      const state = new ReviewState('task-1221-sc1-forge-race', {
        reviewer: 'codex',
        implementer: 'custom',
        phase: 'fixing',
        round: 1
      });

      const pollCalls = [];

      await startReviewLoop('task-1221-sc1-forge-race', {
        worktree: root,
        continue: true,
        isContinue: true,
        maxAttempts: 1,
        dryRun: false,
        maybeUpdateGraphifyBeforeReviewFn: () => {},
        resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task-1221-sc1-forge-race.md' }),
        getTaskImplementerFn: () => null,
        readReviewStateFn: () => state,
        eligibleAgentsForStepFn: () => ['codex', 'custom'],
        selectAgentFn: () => 'codex',
        forgejoAvailableFn: () => true,
        getPrStatusFn: () => ({ exists: true, state: 'open', number: 208 }),
        rebaseBeforeReviewRoundFn: async () => ({ ok: true }),
        startAgentFn: async (mode) => {
          launches.push(mode);
          return { agent: 'custom' };
        },
        consumeImplementerArtifactsFn: async () => {
          consumeCall++;
          if (consumeCall === 1) {
            return { consumed: false };
          }
          return { consumed: true, ok: true, disposition: 'BLOCKED' };
        },
        transitionTaskFn: () => true,
        transitionVirtualFn: () => true,
        writeReviewStateFn: () => {},
        getLatestReviewForPrFn: () => ({ state: 'REQUEST_CHANGES' }),
        pollForReviewFn: async () => 'REQUEST_CHANGES',
        log: (msg) => logs.push(msg),
        error: (msg) => {},
        exit: () => {},
        pollForDispositionFn: async (prNumber, implementer, sinceIso, token, options) => {
          pollCalls.push({ sinceIso });
          const sinceMs = new Date(sinceIso).getTime();
          const startedMs = new Date(state.startedAt).getTime();
          if (sinceMs === startedMs) {
            return 'BLOCKED';
          }
          return 'BLOCKED';
        }
      });

      // The implementer should have been re-launched
      const actOnReviewCalls = launches.filter(l => l === 'act-on-review');
      assert.equal(actOnReviewCalls.length, 1, `Expected 1 act-on-review re-launch; got: ${JSON.stringify(launches)}`);

      // Must log the re-launch message
      assert.ok(
        logs.some(m => m.includes('Re-launching implementer') || m.includes('re-launching implementer')),
        `Expected re-launch log; got: ${logs.join(' | ')}`
      );

      // pollForDispositionFn must have been called with at least two different sinceIso values:
      // 1) the original state.startedAt (skip-check)
      // 2) a newer sinceIso (post-relaunch poll)
      assert.ok(pollCalls.length >= 2, `Expected >=2 poll calls; got ${pollCalls.length}`);

      const postRelaunchSince = pollCalls[pollCalls.length - 1].sinceIso;
      assert.ok(
        new Date(postRelaunchSince).getTime() > new Date(state.startedAt).getTime(),
        `Post-relaunch poll must use a newer sinceIso than state.startedAt`
      );

      // Must log the stop message (still BLOCKED after re-launch)
      assert.ok(
        logs.some(m => m.includes('Autonomous review stopped') && m.includes('BLOCKED') && m.includes('Hand off')),
        `Expected stop/handoff message; got: ${logs.join(' | ')}`
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

// Regression provenance: TASK-2233.
describe("reviewer non submission bounce", { concurrency: false }, () => {
  // task-2233: Check the bounce on review errors
  // Reproduction test: reviewer-non-submission error fires without completing
  // the recovery loop (ADR 0048 bounded retries).
  //
  // Bug: the recovery loop's break condition `if (!isPollTimeout(reviewState))`
  // treats `null` as "not a timeout" and breaks prematurely, causing the
  // `!reviewState` check at review-loop.ts:1353-1365 to fire the error
  // "Reviewer X did not submit a formal review outcome" WITHOUT completing
  // the bounded recovery retries.
  //
  // TASK-2377.04: the recovery retry counter is now in-memory round-local
  // scratch (the persisted review-state field is deleted), so these tests
  // observe the loop through its relaunches: one first launch plus the two
  // recovery relaunches = 3 reviewer launches before escalation.

  // review-polling is not patched here, so import it directly: POLL_TIMEOUT is an
  // identity sentinel and must be the very object review-loop compares against.

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function createWorktree() {
    const root = registeredMkdtemp('task-2233-');
    fs.writeFileSync(
      path.join(root, 'workflow.config.json'),
      JSON.stringify({
        product: {},
        adapters: { review: { provider: 'forgejo' } }
      })
    );
    return root;
  }

  // ── CP-1: Red reproduction — reviewer-non-submission bypasses recovery loop ──

  test('reviewer-non-submission: error fires without completing recovery retries (forgejoEnabled=true, poll returns POLL_TIMEOUT)', async () => {
    const root = createWorktree();
    const logs = [];
    const errors = [];
    const escalations = [];
    let reviewerLaunches = 0;

    try {
      await startReviewLoop('task-9001', {
        worktree: root,
        maxAttempts: 1,
        dryRun: false,
        maybeUpdateGraphifyBeforeReviewFn: () => {},
        resolveTaskFileFn: () => ({ ok: true, taskFile: path.join(root, 'task-9001.md') }),
        getTaskImplementerFn: () => 'custom',
        getTaskStatusFn: () => 'review',
        readReviewStateFn: () => ({
          slug: 'task-9001',
          reviewer: 'custom',
          implementer: 'custom',
          round: 1,
          phase: 'reviewing',
          startedAt: new Date().toISOString(),
          disposition: null,
          metadata: {},
        }),
        eligibleAgentsForStepFn: () => ['custom'],
        selectAgentFn: () => 'custom',
        workflowLauncherStatusFn: () => ({ supported: true, detail: '' }),
        buildAutonomousReviewMatrixFn: () => [],
        formatMatrixSummaryFn: () => [],
        rebaseBeforeReviewRoundFn: async () => ({ ok: true }),
        startAgentFn: async (step) => {
          // Simulates custom agent exiting without producing review artifacts
          if (step === 'review') { reviewerLaunches += 1; }
          return { agent: 'custom', result: { status: 0 } };
        },
        consumeReviewerArtifactsFn: async () => {
          // Reviewer produces no artifacts (consumed: false)
          return { consumed: false };
        },
        consumeImplementerArtifactsFn: async () => ({ consumed: true, ok: true, disposition: 'CHANGES_MADE' }),
        transitionTaskFn: () => true,
        transitionVirtualFn: () => true,
        writeReviewStateFn: () => {},
        log: (msg) => logs.push(msg),
        error: (msg) => errors.push(msg),
        exit: (code) => { throw new Error(`exit(${code})`); },
        // Forgejo enabled
        isReviewProviderEnabledFn: () => true,
        forgejoAvailableFn: async () => true,
        // pollForReview returns POLL_TIMEOUT (reviewer didn't post to Forgejo)
        pollForReviewFn: async () => POLL_TIMEOUT,
        // Reviewer fallback identity
        resolveReviewUserFn: () => 'custom',
        readTokenFn: () => 'test-token',
        // Pre-review gate passes
        runPreReviewGateFn: async () => ({ ok: true, area: 'lib', command: 'echo ok', exitCode: 0, stdout: '', stderr: '' }),
        // PR exists
        getPrStatusFn: () => ({ exists: true, state: 'open', number: 1 }),
      });

      // The recovery loop should have run 2 retries before escalating.
      // BUG: the loop used to stop at 0 retries because the !reviewState check
      // at review-loop.ts:1353 fired BEFORE the recovery loop completes. One
      // first launch plus the two recovery relaunches = 3 reviewer launches.
      assert.equal(
        reviewerLaunches,
        3,
        `recovery loop should complete 2 retries before escalation (got ${reviewerLaunches} reviewer launches)`
      );

      // Exhaustion reports the kernel's evidence-rich recovery dossier.
      const escalationError = errors.find(e =>
        e.includes('Recovery dossier for task-9001') &&
        e.includes('No usable review outcome')
      );
      assert.ok(
        escalationError,
        `should escalate with the recovery dossier and root timeout evidence. Errors: ${errors.join(' | ')}`
      );

      // The REVIEWER_NON_APPROVAL escalation should be recorded.
      const escalationLog = logs.find(l =>
        l.includes('human review required') && l.includes('REVIEWER_NON_APPROVAL')
      );
      assert.ok(
        escalationLog,
        `should log human review escalation with REVIEWER_NON_APPROVAL. Logs: ${logs.join(' | ')}`
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('reviewer-non-submission: null poll result breaks recovery loop prematurely (forgejoEnabled=true, poll returns null)', async () => {
    const root = createWorktree();
    const logs = [];
    const errors = [];
    let reviewerLaunches = 0;

    try {
      await startReviewLoop('task-9001', {
        worktree: root,
        maxAttempts: 1,
        dryRun: false,
        maybeUpdateGraphifyBeforeReviewFn: () => {},
        resolveTaskFileFn: () => ({ ok: true, taskFile: path.join(root, 'task-9001.md') }),
        getTaskImplementerFn: () => 'custom',
        getTaskStatusFn: () => 'review',
        readReviewStateFn: () => ({
          slug: 'task-9001',
          reviewer: 'custom',
          implementer: 'custom',
          round: 1,
          phase: 'reviewing',
          startedAt: new Date().toISOString(),
          disposition: null,
          metadata: {},
        }),
        eligibleAgentsForStepFn: () => ['custom'],
        selectAgentFn: () => 'custom',
        workflowLauncherStatusFn: () => ({ supported: true, detail: '' }),
        buildAutonomousReviewMatrixFn: () => [],
        formatMatrixSummaryFn: () => [],
        rebaseBeforeReviewRoundFn: async () => ({ ok: true }),
        startAgentFn: async (step) => {
          if (step === 'review') { reviewerLaunches += 1; }
          return { agent: 'custom', result: { status: 0 } };
        },
        consumeReviewerArtifactsFn: async () => ({ consumed: false }),
        consumeImplementerArtifactsFn: async () => ({ consumed: true, ok: true, disposition: 'CHANGES_MADE' }),
        transitionTaskFn: () => true,
        transitionVirtualFn: () => true,
        writeReviewStateFn: () => {},
        log: (msg) => logs.push(msg),
        error: (msg) => errors.push(msg),
        exit: (code) => { throw new Error(`exit(${code})`); },
        isReviewProviderEnabledFn: () => true,
        forgejoAvailableFn: async () => true,
        // pollForReview returns null (no token / no review found) — triggers the
        // premature break bug because !isPollTimeout(null) is true
        pollForReviewFn: async () => null,
        resolveReviewUserFn: () => 'custom',
        readTokenFn: () => 'test-token',
        runPreReviewGateFn: async () => ({ ok: true, area: 'lib', command: 'echo ok', exitCode: 0, stdout: '', stderr: '' }),
        getPrStatusFn: () => ({ exists: true, state: 'open', number: 1 }),
      });

      // BUG: with poll returning null, the recovery loop used to break on the
      // first iteration because !isPollTimeout(null) is true. One first launch
      // plus two recovery relaunches = 3 reviewer launches.
      assert.equal(
        reviewerLaunches,
        3,
        `recovery loop should complete 2 retries even when poll returns null (got ${reviewerLaunches} reviewer launches)`
      );

      // The escalation should retain the root timeout evidence in the dossier.
      const hasRecoveryMessage = errors.some(e =>
        e.includes('Recovery dossier for task-9001') && e.includes('No usable review outcome')
      );
      assert.ok(
        hasRecoveryMessage,
        `should escalate with the recovery dossier, not a bare non-submission error. Errors: ${errors.join(' | ')}`
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('reviewer-non-submission: forgejoEnabled=false — recovery loop breaks on null reviewState', async () => {
    const root = createWorktree();
    const logs = [];
    const errors = [];
    let reviewerLaunches = 0;

    try {
      await startReviewLoop('task-9001', {
        worktree: root,
        maxAttempts: 1,
        dryRun: false,
        maybeUpdateGraphifyBeforeReviewFn: () => {},
        resolveTaskFileFn: () => ({ ok: true, taskFile: path.join(root, 'task-9001.md') }),
        getTaskImplementerFn: () => 'custom',
        getTaskStatusFn: () => 'review',
        readReviewStateFn: () => ({
          slug: 'task-9001',
          reviewer: 'custom',
          implementer: 'custom',
          round: 1,
          phase: 'reviewing',
          startedAt: new Date().toISOString(),
          disposition: null,
          metadata: {},
        }),
        eligibleAgentsForStepFn: () => ['custom'],
        selectAgentFn: () => 'custom',
        workflowLauncherStatusFn: () => ({ supported: true, detail: '' }),
        buildAutonomousReviewMatrixFn: () => [],
        formatMatrixSummaryFn: () => [],
        rebaseBeforeReviewRoundFn: async () => ({ ok: true }),
        startAgentFn: async (step) => {
          if (step === 'review') { reviewerLaunches += 1; }
          return { agent: 'custom', result: { status: 0 } };
        },
        consumeReviewerArtifactsFn: async () => ({ consumed: false }),
        consumeImplementerArtifactsFn: async () => ({ consumed: true, ok: true, disposition: 'CHANGES_MADE' }),
        transitionTaskFn: () => true,
        transitionVirtualFn: () => true,
        writeReviewStateFn: () => {},
        log: (msg) => logs.push(msg),
        error: (msg) => errors.push(msg),
        exit: (code) => { throw new Error(`exit(${code})`); },
        // Forgejo disabled — no pollForReview call, reviewState stays null
        isReviewProviderEnabledFn: () => false,
        // SC1: a provider-disabled --start still performs the handoff transition.
        performHandoffFn: async () => ({ ok: true }),
        runPreReviewGateFn: async () => ({ ok: true, area: 'lib', command: 'echo ok', exitCode: 0, stdout: '', stderr: '' }),
      });

      // BUG: with forgejoEnabled=false, pollForReview is never called, reviewState
      // stays null in the recovery loop, and !isPollTimeout(null) is true so the
      // loop used to break on the first iteration. One first launch plus two
      // recovery relaunches = 3 reviewer launches.
      assert.equal(
        reviewerLaunches,
        3,
        `recovery loop should complete 2 retries with forgejoEnabled=false (got ${reviewerLaunches} reviewer launches)`
      );

      // Local review exhaustion should retain the same root timeout evidence.
      const hasRecoveryMessage = errors.some(e =>
        e.includes('Recovery dossier for task-9001') && e.includes('No usable review outcome')
      );
      assert.ok(
        hasRecoveryMessage,
        `should escalate with the recovery dossier. Errors: ${errors.join(' | ')}`
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // ── ADR 0048 mapping: verify isPollTimeout behavior ─────────────────────────

  test('isPollTimeout correctly distinguishes POLL_TIMEOUT from null and undefined', () => {
    assert.equal(isPollTimeout(POLL_TIMEOUT), true, 'POLL_TIMEOUT sentinel should return true');
    assert.equal(isPollTimeout(null), false, 'null should NOT be treated as POLL_TIMEOUT');
    assert.equal(isPollTimeout(undefined), false, 'undefined should NOT be treated as POLL_TIMEOUT');
    assert.equal(isPollTimeout('APPROVED'), false, 'string state should NOT be treated as POLL_TIMEOUT');
  });
});
