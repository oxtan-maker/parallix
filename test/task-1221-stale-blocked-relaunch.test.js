const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { startReviewLoop } = require('../lib/review/review-loop');
const { ReviewState } = require('../lib/review/review-state');

async function createWorktree(slug, config) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `task-1221-${slug}-`));
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
