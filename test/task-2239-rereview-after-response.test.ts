import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startReviewLoop } from '../src/adapters/review/review-loop.js';

function reviewLoopHarness(overrides: Record<string, unknown> = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2239-rereview-'));
  fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { review: { provider: 'none' } } }));
  const launches: Array<{ step: string; agent: string }> = [];
  const writes: Array<{ round: number; phase: string; disposition: string; metadata: Record<string, unknown> }> = [];
  const logs: string[] = [];
  const errors: string[] = [];
  const exits: number[] = [];
  const opts: Record<string, unknown> = {
    worktree: root,
    implementer: 'claude',
    reviewer: 'codex',
    maxAttempts: 3,
    maybeUpdateGraphifyBeforeReviewFn: () => {},
    resolveTaskFileFn: () => ({ ok: true, taskFile: path.join(root, 'task.md') }),
    getTaskImplementerFn: () => 'claude',
    getTaskStatusFn: () => 'review',
    eligibleAgentsForStepFn: () => ['codex', 'claude'],
    workflowLauncherStatusFn: () => ({ supported: true }),
    readReviewStateFn: () => null,
    writeReviewStateFn: (_slug: string, state: { round: number; phase: string; disposition: string; metadata: Record<string, unknown> }) => writes.push({ round: state.round, phase: state.phase, disposition: state.disposition, metadata: { ...state.metadata } }),
    transitionTaskFn: () => true,
    transitionVirtualFn: () => true,
    rebaseBeforeReviewRoundFn: async () => ({ ok: true }),
    // SC1: a provider-disabled --start now performs the handoff transition.
    performHandoffFn: async () => ({ ok: true }),
    runPreReviewGateFn: async () => ({ ok: true, area: 'all', exitCode: 0 }),
    startAgentFn: async (step: string, options: { agent: string }) => {
      launches.push({ step, agent: options.agent });
      return { agent: options.agent };
    },
    applyAgentFallbackFn: ({ original }: { original: string }) => original,
    buildCompactReviewPromptFn: () => 'review prompt',
    buildCompactActOnReviewPromptFn: () => 'act-on-review prompt',
    log: (message: string) => logs.push(message),
    error: (message: string) => errors.push(message),
    exit: (code: number) => exits.push(code),
    ...overrides,
  };
  return { root, opts, launches, writes, logs, errors, exits };
}

async function runHarness(harness: { root: string; opts: Record<string, unknown> }) {
  try {
    await startReviewLoop('task-2239', harness.opts);
  } finally {
    fs.rmSync(harness.root, { recursive: true, force: true });
  }
}

test('post-response transition re-launches the active reviewer and records exactly one next round before approval', async () => {
  const reviewerOutcomes = ['REQUEST_CHANGES', 'APPROVED'];
  const harness = reviewLoopHarness({
    consumeReviewerArtifactsFn: async () => ({ consumed: true, ok: true, reviewState: reviewerOutcomes.shift() }),
    consumeImplementerArtifactsFn: async () => ({ consumed: true, ok: true, disposition: 'PUSHBACK_ALL' }),
  });

  await runHarness(harness);

  assert.deepEqual(harness.launches.filter((launch) => launch.step === 'review').map((launch) => launch.agent), ['codex', 'codex'], 'PUSHBACK_ALL must transition back to the active reviewer');
  assert.ok(harness.writes.some((state) => state.round === 2 && state.phase === 'reviewing'), 'the next reviewer round must be persisted exactly once before it launches');
  assert.equal(harness.exits.length, 0, `approval-after-response should not escalate: ${harness.errors.join(' | ')}`);
});

test('post-response transition keeps the loop active when the reviewer requests changes again', async () => {
  const reviewerOutcomes = ['REQUEST_CHANGES', 'REQUEST_CHANGES', 'APPROVED'];
  const implementerDispositions = ['PUSHBACK_ALL', 'CHANGES_MADE'];
  const harness = reviewLoopHarness({
    consumeReviewerArtifactsFn: async () => ({ consumed: true, ok: true, reviewState: reviewerOutcomes.shift() }),
    consumeImplementerArtifactsFn: async () => ({ consumed: true, ok: true, disposition: implementerDispositions.shift() }),
  });

  await runHarness(harness);

  assert.equal(harness.launches.filter((launch) => launch.step === 'review').length, 3, 'the repeated REQUEST_CHANGES decision must remain a reviewer decision');
  assert.ok(harness.writes.filter((state) => state.disposition === 'REQUEST_CHANGES').length >= 2, 'each reviewer REQUEST_CHANGES decision must be durable');
  assert.equal(harness.exits.length, 0, `re-review should remain automated: ${harness.errors.join(' | ')}`);
});

test('reviewer launch failure after a response records a reviewer-specific human escalation reason', async () => {
  const harness = reviewLoopHarness({
    consumeReviewerArtifactsFn: async () => ({ consumed: true, ok: true, reviewState: 'REQUEST_CHANGES' }),
    consumeImplementerArtifactsFn: async () => ({ consumed: true, ok: true, disposition: 'PUSHBACK_ALL' }),
    startAgentFn: async (step: string, options: { agent: string }) => {
      if (step === 'review' && harness.launches.filter((launch) => launch.step === 'review').length === 1) {
        throw new Error('reviewer unavailable');
      }
      harness.launches.push({ step, agent: options.agent });
      return { agent: options.agent };
    },
  });

  await runHarness(harness);

  assert.ok(harness.writes.some((state) => state.metadata.humanEscalationReason === 'REVIEWER_LAUNCH_FAILURE'), 'reviewer failure must retain its escalation reason in lifecycle state');
  assert.ok(harness.logs.some((message) => /human review.*reviewer/i.test(message)), 'reviewer failure must use the explicit human-review path');
});

test('post-response transition escalates at the maximum reviewer-attempt boundary without launching another reviewer', async () => {
  const harness = reviewLoopHarness({
    maxAttempts: 1,
    consumeReviewerArtifactsFn: async () => ({ consumed: true, ok: true, reviewState: 'REQUEST_CHANGES' }),
    consumeImplementerArtifactsFn: async () => ({ consumed: true, ok: true, disposition: 'PUSHBACK_ALL' }),
  });

  await runHarness(harness);

  assert.equal(harness.launches.filter((launch) => launch.step === 'review').length, 1, 'the decision beyond maxAttempts must not launch a reviewer');
  assert.ok(harness.writes.some((state) => state.disposition === 'MAX_ATTEMPTS'), 'attempt exhaustion must be retained in lifecycle state');
  assert.ok(harness.logs.some((message) => /reached 1 attempts.*human review/i.test(message)), 'attempt exhaustion must take the explicit human-review path');
});
