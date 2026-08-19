// @ts-nocheck -- TASK-2328: partial test doubles from ESM seam migration; resolve in follow-up
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

import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { mockModule, installModuleMocks } from './lib/module-mock.js';
// review-polling is not patched here, so import it directly: POLL_TIMEOUT is an
// identity sentinel and must be the very object review-loop compares against.
import { POLL_TIMEOUT, isPollTimeout } from '../src/adapters/review/review-polling.js';
const startReviewLoopModule = mockModule<typeof import('../src/adapters/review/review-loop.js')>('../src/adapters/review/review-loop.js', import.meta.url);
await installModuleMocks();
test.afterEach(() => mock.restoreAll());
const { startReviewLoop } = startReviewLoopModule;

// ── Helpers ──────────────────────────────────────────────────────────────────

function createWorktree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2233-'));
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

    // The escalation error should mention recovery retries (ADR 0048 bounded retries).
    const escalationError = errors.find(e =>
      e.includes('did not submit a usable formal review outcome') ||
      e.includes('recovery retries')
    );
    assert.ok(
      escalationError,
      `should escalate with "usable formal review outcome after recovery retries" message. Errors: ${errors.join(' | ')}`
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

    // The escalation should use the recovery-retries message, not the bare
    // "did not submit a formal review outcome" from review-loop.ts:1358.
    const hasRecoveryMessage = errors.some(e =>
      e.includes('usable formal review outcome') && e.includes('recovery retries')
    );
    assert.ok(
      hasRecoveryMessage,
      `should escalate with recovery-retries message, not bare non-submission error. Errors: ${errors.join(' | ')}`
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

    // Should escalate with recovery-retries message from the post-loop check,
    // not the bare "did not submit" from review-loop.ts:1358.
    const hasRecoveryMessage = errors.some(e =>
      e.includes('usable formal review outcome') && e.includes('recovery retries')
    );
    assert.ok(
      hasRecoveryMessage,
      `should escalate with recovery-retries message. Errors: ${errors.join(' | ')}`
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
