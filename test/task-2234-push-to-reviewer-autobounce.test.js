const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('child_process');
const { mock } = test;

const { runDeclaredGates } = require('../lib/commands/handoff');
const { startReviewLoop, submitForReview } = require('../lib/review/review');

// Reproduction tests for task-2234 (push-to-reviewer autobounce).
//
// When a reviewer-push attempt fails because a declared verification gate
// is invalid (explanatory dash suffix such as "true — some description"),
// the mission should auto-bounce back to the repairable workflow state
// rather than stranding as a terminal failure.
//
// The auto-bounce lives in the performHandoff failure path and its callers
// (submitForReview, review-loop self-heal), not in pushRound's createPr path.

// ============================================================================
// CP-1: Strict dash-suffix rejection (behavioral, unchanged from round 1)
// ============================================================================

test('task-2234 repro: runDeclaredGates rejects explanatory em-dash suffix before execution', () => {
  const missionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2234-gates-dash-'));
  const rootDir = missionDir;

  fs.writeFileSync(
    path.join(missionDir, 'MISSION.md'),
    '# Mission\n\n## Gates\n\n- [ ] true — some description\n'
  );

  try {
    const result = runDeclaredGates(missionDir, rootDir, {
      log: () => {},
      error: () => {}
    });

    assert.equal(result.ok, false, 'gate with em-dash suffix must be rejected');
    assert.equal(result.reason, 'validation-failed', 'rejection reason must be validation-failed');
    assert.ok(
      result.error && /exact.*runnable.*command/i.test(result.error),
      'error message must explain that gate declaration must be an exact runnable command'
    );
  } finally {
    fs.rmSync(missionDir, { recursive: true, force: true });
  }
});

test('task-2234 repro: runDeclaredGates rejects explanatory en-dash and double-dash suffixes', () => {
  for (const gateText of ['true – brief note', 'true -– legacy note']) {
    const missionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2234-gates-dash-'));
    const rootDir = missionDir;

    fs.writeFileSync(
      path.join(missionDir, 'MISSION.md'),
      `# Mission\n\n## Gates\n\n- [ ] ${gateText}\n`
    );

    try {
      const result = runDeclaredGates(missionDir, rootDir, {
        log: () => {},
        error: () => {}
      });

      assert.equal(result.ok, false, `gate "${gateText}" must be rejected`);
      assert.equal(result.reason, 'validation-failed', `reason for "${gateText}"`);
    } finally {
      fs.rmSync(missionDir, { recursive: true, force: true });
    }
  }
});

// ============================================================================
// CP-2: Auto-bounce behavior (behavioral via startReviewLoop seams)
// ============================================================================

async function withTempGitRepo(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2234-e2e-'));
  try {
    childProcess.spawnSync('git', ['init', '-b', 'master'], { cwd: root });
    childProcess.spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
    childProcess.spawnSync('git', ['config', 'user.name', 'Test'], { cwd: root });
    fs.writeFileSync(path.join(root, 'README.md'), '# repo');
    childProcess.spawnSync('git', ['add', '.'], { cwd: root });
    childProcess.spawnSync('git', ['commit', '-m', 'initial'], { cwd: root });
    const result = fn(root);
    if (result && typeof result.then === 'function') {
      await result;
    }
    return result;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// The self-heal handoff (and its auto-bounce) only runs when a review
// provider is enabled and reachable and no open PR exists for the mission
// branch, so the harness enables the provider and stubs it reachable.
// Every test asserts on `logs`/`errors` that the self-heal path actually
// executed, so these tests cannot pass by skipping the code under test.
function baseLoopHarness(root, overrides = {}) {
  const taskFile = path.join(root, 'task.md');
  fs.writeFileSync(taskFile, '# task');
  const logs = [];
  const errors = [];
  const exitCodes = [];
  const opts = {
    slug: 'task-2234',
    implementer: 'claude',
    reviewer: 'codex',
    worktree: root,
    dryRun: false,
    isForgejoReviewEnabledFn: () => true,
    getPrStatusFn: () => ({ exists: false }),
    forgejoAvailableFn: async () => true,
    readTokenFn: () => 'token',
    pollForReviewFn: async () => 'TIMEOUT',
    pollForDispositionFn: async () => 'TIMEOUT',
    getLatestReviewForPrFn: async () => null,
    maybeUpdateGraphifyBeforeReviewFn: () => {},
    resolveTaskFileFn: () => ({ ok: true, taskFile }),
    getTaskStatusFn: () => 'review',
    transitionTaskFn: () => {},
    transitionVirtualFn: () => {},
    toVirtualFn: (s) => s,
    workflowLauncherStatusFn: () => ({ supported: true }),
    eligibleAgentsForStepFn: () => ['codex', 'claude'],
    enforceTaskAssigneeFn: () => true,
    applyAgentFallbackFn: (a) => a.original,
    readReviewStateFn: () => null,
    writeReviewStateFn: () => {},
    startAgentFn: async () => ({ agent: null }),
    rebaseBeforeReviewRoundFn: async () => ({ ok: true, sharedFileConflicts: false }),
    buildCompactReviewPromptFn: () => 'review prompt',
    buildCompactActOnReviewPromptFn: () => 'act-on-review prompt',
    log: (m) => logs.push(m),
    error: (m) => errors.push(m),
    exit: (c) => exitCodes.push(c),
    ...overrides
  };
  return { opts, logs, errors, exitCodes };
}

function assertSelfHealAttempted(logs) {
  assert.ok(
    logs.some(m => /attempting automatic handoff/.test(m)),
    'test harness must reach the self-heal handoff path (guards against vacuous pass)'
  );
}

test('task-2234 repro: review-loop self-heal auto-bounces to active on validation-failed handoff', async () => {
  await withTempGitRepo(async (root) => {
    const transitions = [];
    const writtenStates = [];

    const { opts, logs, exitCodes } = baseLoopHarness(root, {
      performHandoffFn: async () => ({
        ok: false,
        reason: 'validation-failed',
        error: 'Declared gate "true — some description" failed for task-2234: Gate declaration must contain an exact runnable command only. Blocking handoff — task remains in active.'
      }),
      transitionTaskFn: (slug, status) => { transitions.push({ slug, status }); },
      writeReviewStateFn: (slug, state) => { writtenStates.push({ slug, state }); },
    });

    // @ts-expect-error TS2345 Argument of type '{ slug: string; implementer: string; reviewer: string; worktre
    await startReviewLoop('task-2234', opts);

    assertSelfHealAttempted(logs);
    assert.deepEqual(
      transitions,
      [{ slug: 'task-2234', status: 'active' }],
      'self-heal must transition exactly this task to active on validation-failed'
    );
    const bounced = writtenStates.find(
      s => s.slug === 'task-2234' && s.state && s.state.metadata
        && s.state.metadata.gateFailureReason === 'validation-failed'
    );
    assert.ok(bounced, 'self-heal must persist gateFailureReason in review-state metadata');
    assert.match(
      String(bounced.state.metadata.gateFailureError),
      /true — some description/,
      'persisted gateFailureError must retain the invalid gate text for the follow-up action'
    );
    assert.ok(
      logs.some(m => /Auto-bounced task-2234 to active/.test(m)),
      'self-heal must surface the auto-bounce and repair guidance in output'
    );
    assert.deepEqual(exitCodes, [1], 'loop must stop after bouncing (no reviewer launch)');
  });
});

test('task-2234 repro: review-loop self-heal fails closed when validation-failure state cannot commit', async () => {
  await withTempGitRepo(async (root) => {
    const { opts, logs, exitCodes } = baseLoopHarness(root, {
      performHandoffFn: async () => ({
        ok: false,
        reason: 'validation-failed',
        error: 'Declared gate is invalid'
      }),
      writeReviewStateFn: () => ({
        outcome: 'commit-failed-dirty',
        stage: 'commit',
        diagnostic: 'simulated commit failure'
      })
    });

    await assert.rejects(
      // @ts-expect-error TS2345 Argument of type '{ slug: string; implementer: string; reviewer: string; worktre
      () => startReviewLoop('task-2234', opts),
      /Review-state persistence failed for mission task-2234, phase unknown, round unknown, stage commit: simulated commit failure/
    );
    assertSelfHealAttempted(logs);
    assert.deepEqual(exitCodes, [], 'fail-closed persistence must stop before the explicit error exit');
  });
});

test('task-2234 repro: review-loop self-heal does NOT bounce on gate-failed (execution failure)', async () => {
  await withTempGitRepo(async (root) => {
    const transitions = [];

    const { opts, logs, errors, exitCodes } = baseLoopHarness(root, {
      performHandoffFn: async () => ({
        ok: false,
        reason: 'gate-failed',
        error: 'Declared gate "./scripts/verify-local.sh all" failed for task-2234: Gate exited with status 1. Blocking handoff — task remains in active.'
      }),
      transitionTaskFn: (slug, status) => { transitions.push({ slug, status }); },
    });

    // @ts-expect-error TS2345 Argument of type '{ slug: string; implementer: string; reviewer: string; worktre
    await startReviewLoop('task-2234', opts);

    assertSelfHealAttempted(logs);
    // The self-heal only bounces for validation-failed, not gate-failed:
    // the task stays in review and the loop exits with manual guidance.
    assert.deepEqual(
      transitions,
      [],
      'gate-failed (execution failure) must NOT trigger any task transition'
    );
    assert.ok(
      errors.some(m => /No open review PR found/.test(m)),
      'gate-failed must fall through to the manual-guidance failure path'
    );
    assert.deepEqual(exitCodes, [1], 'loop must exit non-zero without bouncing');
  });
});

test('task-2234 repro: infra/auth errors do NOT bounce (mission risk: narrow classification boundary)', async () => {
  await withTempGitRepo(async (root) => {
    const transitions = [];

    const { opts, logs, errors, exitCodes } = baseLoopHarness(root, {
      performHandoffFn: async () => ({
        ok: false,
        error: 'Forgejo authentication failed: token expired'
      }),
      transitionTaskFn: (slug, status) => { transitions.push({ slug, status }); },
    });

    // @ts-expect-error TS2345 Argument of type '{ slug: string; implementer: string; reviewer: string; worktre
    await startReviewLoop('task-2234', opts);

    assertSelfHealAttempted(logs);
    assert.deepEqual(
      transitions,
      [],
      'infra/auth errors must NOT trigger auto-bounce (mission risk: broad failure matching)'
    );
    assert.ok(
      errors.some(m => /Forgejo authentication failed: token expired/.test(m)),
      'the original infra error must be surfaced in the failure guidance'
    );
    assert.deepEqual(exitCodes, [1], 'loop must exit non-zero without bouncing');
  });
});

// ============================================================================
// CP-2: Auto-bounce in submitForReview (px review --submit path)
// ============================================================================

function submitHarness(root, performHandoffResult) {
  const taskFile = path.join(root, 'task.md');
  fs.writeFileSync(taskFile, '# task');
  const transitions = [];
  const logs = [];
  const exitCodes = [];
  const options = {
    resolveWorktreeFn: () => root,
    readReviewStateFn: () => null,
    resolveTaskFileFn: () => ({ ok: true, taskFile }),
    getTaskImplementerFn: () => 'claude',
    isReviewProviderEnabledFn: () => false,
    performHandoffFn: async () => performHandoffResult,
    transitionTaskFn: (slug, status) => { transitions.push({ slug, status }); return true; },
    log: (m) => logs.push(m),
    exit: (c) => exitCodes.push(c),
  };
  return { options, transitions, logs, exitCodes };
}

test('task-2234 repro: submitForReview auto-bounces to active on validation-failed handoff', async () => {
  await withTempGitRepo(async (root) => {
    const { options, transitions, logs, exitCodes } = submitHarness(root, {
      ok: false,
      reason: 'validation-failed',
      error: 'Declared gate "true — some description" failed for task-2234: Gate declaration must contain an exact runnable command only.'
    });

    // @ts-expect-error TS2345 Argument of type '{ resolveWorktreeFn: () => any; readReviewStateFn: () => any;
    await submitForReview('task-2234', false, options);

    assert.deepEqual(
      transitions,
      [{ slug: 'task-2234', status: 'active' }],
      'submitForReview must transition the task to active on validation-failed'
    );
    assert.ok(
      logs.some(m => /Auto-bounced task-2234 to active/.test(m)),
      'submitForReview must surface the auto-bounce and repair guidance'
    );
    assert.deepEqual(exitCodes, [1], 'submitForReview must still report the failed handoff');
  });
});

test('task-2234 repro: submitForReview does NOT bounce on gate-failed (execution failure)', async () => {
  await withTempGitRepo(async (root) => {
    const { options, transitions, exitCodes } = submitHarness(root, {
      ok: false,
      reason: 'gate-failed',
      error: 'Declared gate "./scripts/verify-local.sh all" failed for task-2234: Gate exited with status 1.'
    });

    // @ts-expect-error TS2345 Argument of type '{ resolveWorktreeFn: () => any; readReviewStateFn: () => any;
    await submitForReview('task-2234', false, options);

    assert.deepEqual(
      transitions,
      [],
      'gate-failed (execution failure) must NOT trigger auto-bounce in submitForReview'
    );
    assert.deepEqual(exitCodes, [1], 'submitForReview must exit non-zero without bouncing');
  });
});
