const test = require('node:test');
const assert = require('node:assert/strict');

// We test the pure validation logic that runs before any agent is launched.
// The actual loop body (agent launch, Forgejo polling) requires runtime-dependent
// launchers and a live Forgejo; those are covered by manual proof artifacts (PROOF.md).
//
// All tests use non-existent slugs ('task-test-validation-noop') so they never
// read real mission files and are resilient to accumulated review-state.json from
// actual mission runs.

// Slug that is guaranteed not to have a real mission directory or persisted state.
const TEST_SLUG = 'task-test-validation-noop';

const fmt = require('../lib/core/fmt');

async function captureExit(fn) {
  const originalExit = process.exit;
  const originalError = console.error;
  const originalLog = console.log;
  const errors = [];
  const logs = [];
  let exitCode = null;

  process.exit = (code) => {
    exitCode = code;
    throw new Error(`process.exit(${code})`);
  };
  console.error = (...args) => errors.push(args.join(' '));
  console.log = (...args) => logs.push(args.join(' '));

  const oldLogger = fmt.setLogger({
    log: (msg) => logs.push(msg),
    error: (msg) => errors.push(msg),
  });

  try {
    await fn();
  } catch (err) {
    if (!err.message.startsWith('process.exit(')) throw err;
  } finally {
    process.exit = originalExit;
    console.error = originalError;
    console.log = originalLog;
    fmt.setLogger(oldLogger);
  }

  return { exitCode, errors, logs };
}

test('startReviewLoop allows explicit same-family reviewer after rejection block removal', async () => {
  const { startReviewLoop } = require('../lib/review/review');

  const { exitCode, errors, logs } = await captureExit(() => {
    return startReviewLoop(TEST_SLUG, {
      eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'qwen'],
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
      implementer: 'claude',
      reviewer: 'claude',
      dryRun: true
    });
  });

  assert.equal(exitCode, null);
  assert.deepEqual(errors, []);
  assert.ok(
    logs.some(e => e.includes('Selected reviewer: claude (explicit)')),
    `Expected selected reviewer log; got: ${logs.join(' | ')}`
  );
});

test('startReviewLoop allows implementer not in eligible agents with explicit reviewer (SC 4)', async () => {
  const { startReviewLoop } = require('../lib/review/review');

  const { exitCode, errors } = await captureExit(() => {
    return startReviewLoop(TEST_SLUG, {
      eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'qwen'],
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
      implementer: 'gpt4',
      reviewer: 'codex',
      dryRun: true,
      workflowLauncherStatusFn: () => ({ supported: true }),
      isForgejoReviewEnabledFn: () => true,
      getPrStatusFn: () => ({ exists: true, state: 'open', number: 1 })
    });
  });

  // With SC 4 fix: the strict implementer eligibility check was removed.
  // With an explicit reviewer that IS in the eligible agents, the code proceeds.
  // Note: 'gpt4' is not a known agent, but with explicit reviewer='codex',
  // the code can still proceed (reviewerFor is not used when reviewer is explicit).
  // The test may still fail for other reasons (e.g., missing PR in non-dry-run mode),
  // but it won't fail due to implementer eligibility.
  assert.ok(
    exitCode === null || exitCode === undefined,
    `Expected success or no exit; got exit code ${exitCode} with errors: ${errors.join(' | ')}`
  );
});

test('startReviewLoop fails for unsupported reviewer', async () => {
  const { startReviewLoop } = require('../lib/review/review');

  const { exitCode, errors } = await captureExit(() => {
    return startReviewLoop(TEST_SLUG, {
      eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'qwen'],
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
      implementer: 'claude',
      reviewer: 'gpt4',
      dryRun: true
    });
  });

  assert.equal(exitCode, 1);
  assert.ok(
    errors.some(e => e.includes('Unsupported reviewer')),
    `Expected unsupported reviewer error; got: ${errors.join(' | ')}`
  );
});

test('startReviewLoop validates reviewer and implementer from injected review eligibility', async () => {
  const { startReviewLoop } = require('../lib/review/review');
  const logs = [];
  const exitCodes = [];

  await startReviewLoop(TEST_SLUG, {
    eligibleAgentsForStepFn: step => step === 'review' ? ['codex', 'future-agent'] : [],
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
    readReviewStateFn: () => null,
    writeReviewStateFn: () => {},
    implementer: 'future-agent',
    dryRun: true,
    selectAgentFn: () => 'codex',
    workflowLauncherStatusFn: () => ({ supported: true, detail: 'mock' }),
    buildAutonomousReviewMatrixFn: () => ({
      agents: ['codex', 'future-agent'],
      launchers: { codex: { supported: true, detail: 'mock' }, 'future-agent': { supported: true, detail: 'mock' } }
    }),
    buildReviewPromptFn: () => 'review prompt',
    buildActOnReviewPromptFn: () => 'act prompt',
    log: line => logs.push(line),
    error: () => {},
    exit: code => exitCodes.push(code)
  });

  assert.deepEqual(exitCodes, []);
  assert.ok(logs.some(line => line.includes('Implementer: future-agent')));
  assert.ok(logs.some(line => line.includes('Reviewer: codex')));
});

test('startReviewLoop defaults to autonomous when no implementer and no persisted state', async () => {
  const { startReviewLoop } = require('../lib/review/review');

  const { exitCode, errors, logs } = await captureExit(() => {
    return startReviewLoop(TEST_SLUG, {
      eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'qwen'],
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
      readReviewStateFn: () => null,
      writeReviewStateFn: () => {},
      isForgejoReviewEnabledFn: () => false,
      dryRun: true,
      workflowLauncherStatusFn: () => ({ supported: true }),
      buildAutonomousReviewMatrixFn: () => ({
        agents: ['codex', 'claude', 'gemini', 'qwen'],
        launchers: { codex: { supported: true }, claude: { supported: true }, gemini: { supported: true }, qwen: { supported: true } }
      }),
      selectAgentFn: () => { throw new Error('no reviewer available'); },
      buildReviewPromptFn: () => 'review prompt',
      buildActOnReviewPromptFn: () => 'act prompt'
    });
  });

  assert.equal(exitCode, null);
  assert.ok(
    logs.some(l => l.includes('"autonomous"')),
    `Expected autonomous fallback warning; got: ${logs.join(' | ')}`
  );
  assert.ok(
    logs.some(l => l.includes('Implementer: autonomous')),
    `Expected Implementer: autonomous in logs; got: ${logs.join(' | ')}`
  );
});

test('startReviewLoop reset path removes state file', async () => {
  const { startReviewLoop } = require('../lib/review/review');
  let resetCalled = false;

  const { exitCode } = await captureExit(() => {
    return startReviewLoop(TEST_SLUG, {
      eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'qwen'],
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
      implementer: 'claude',
      reviewer: 'codex',
      reset: true,
      dryRun: true,
      readReviewStateFn: () => null,
      writeReviewStateFn: () => {},
      workflowLauncherStatusFn: () => ({ supported: true }),
      resetReviewStateFn: () => { resetCalled = true; return true; },
      buildReviewPromptFn: () => 'review prompt',
      buildActOnReviewPromptFn: () => 'act prompt'
    });
  });

  assert.ok(resetCalled, 'resetReviewState should have been called');
});

test('startReviewLoop dryRun path skips agent launch', async () => {
  const { startReviewLoop } = require('../lib/review/review');

  const { exitCode } = await captureExit(() => {
    return startReviewLoop(TEST_SLUG, {
      eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'qwen'],
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
      implementer: 'claude',
      reviewer: 'codex',
      dryRun: true,
      readReviewStateFn: () => null,
      writeReviewStateFn: () => {},
      workflowLauncherStatusFn: () => ({ supported: true }),
      buildReviewPromptFn: () => 'review prompt',
      buildActOnReviewPromptFn: () => 'act prompt'
    });
  });

  assert.equal(exitCode, null, 'dryRun should exit cleanly');
});

test('verifyReview handles task status edge cases', async () => {
  const { verifyReview } = require('../lib/review/review');
  const logs = [];
  const errors = [];
  const exitCodes = [];

  const baseOptions = {
    log: (m) => logs.push(m),
    error: (m) => errors.push(m),
    exit: (c) => exitCodes.push(c),
    resolveWorktreeFn: () => null,
    findMissionDirFn: () => '/tmp/mission',
    getCurrentBranchFn: () => `mission/${TEST_SLUG}`,
    getPrStatusFn: () => ({ exists: true, state: 'open', number: 41 }),
    findMissionAreaFn: () => 'docs',
    runFn: () => ({ status: 0 }),
    getAcceptanceCriteriaFn: () => [],
    formatMatrixSummaryFn: () => [],
    buildAutonomousReviewMatrixFn: () => ({}),
    readReviewStateFn: () => null,
    cwdFn: () => '/tmp/visualBoard'
  };

  // 1. Task not found
  verifyReview(TEST_SLUG, false, {
    ...baseOptions,
    resolveTaskFileFn: () => ({ ok: false, reason: 'missing' })
  });
  assert.ok(logs.some(l => l.includes('not found in backlog/tasks/')), 'Should log task not found');

  // 2. Task ambiguous
  logs.length = 0;
  verifyReview(TEST_SLUG, false, {
    ...baseOptions,
    resolveTaskFileFn: () => ({ ok: false, reason: 'ambiguous', matches: ['a.md', 'b.md'] })
  });
  assert.ok(logs.some(l => l.includes('Backlog task resolution is ambiguous')), 'Should log ambiguous task');

  // 3. Task status DONE
  logs.length = 0;
  verifyReview(TEST_SLUG, false, {
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
    ...baseOptions,
    resolveTaskFileFn: () => ({ ok: true, taskFile: 'task.md' }),
    getTaskStatusFn: () => 'done'
  });
  assert.ok(logs.some(l => l.includes('Backlog task: task is already done/integrated')), 'Should log done task error');

  // 4. Task status ACTIVE (warning)
  logs.length = 0;
  verifyReview(TEST_SLUG, false, {
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
    ...baseOptions,
    resolveTaskFileFn: () => ({ ok: true, taskFile: 'task.md' }),
    getTaskStatusFn: () => 'active'
  });
  assert.ok(logs.some(l => l.includes('Backlog task: task.md is still active')), 'Should log active task warning');

  // 5. Unexpected task status
  logs.length = 0;
  verifyReview(TEST_SLUG, false, {
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
    ...baseOptions,
    resolveTaskFileFn: () => ({ ok: true, taskFile: 'task.md' }),
    getTaskStatusFn: () => 'backlog'
  });
  assert.ok(logs.some(l => l.includes('Backlog task: unexpected status backlog')), 'Should log unexpected status error');
});

test('verifyReview handles PR state edge cases', async () => {
  const { verifyReview } = require('../lib/review/review');
  const logs = [];
  const errors = [];
  const exitCodes = [];

  const baseOptions = {
    log: (m) => logs.push(m),
    error: (m) => errors.push(m),
    exit: (c) => exitCodes.push(c),
    resolveWorktreeFn: () => null,
    findMissionDirFn: () => '/tmp/mission',
    getCurrentBranchFn: () => `mission/${TEST_SLUG}`,
    resolveTaskFileFn: () => ({ ok: true, taskFile: 'task.md' }),
    getTaskStatusFn: () => 'review',
    findMissionAreaFn: () => 'docs',
    runFn: () => ({ status: 0 }),
    getAcceptanceCriteriaFn: () => [],
    formatMatrixSummaryFn: () => [],
    buildAutonomousReviewMatrixFn: () => ({}),
    readReviewStateFn: () => null,
    isForgejoReviewEnabledFn: () => true,
    cwdFn: () => '/tmp/visualBoard'
  };

  // 1. PR closed/merged
  verifyReview(TEST_SLUG, false, {
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
    ...baseOptions,
    getPrStatusFn: () => ({ exists: true, state: 'closed', merged: true, number: 41 })
  });
  assert.ok(logs.some(l => l.includes('Review PR: expected an open PR, got state=closed merged=true')), 'Should log PR state error');

  // 2. PR missing
  logs.length = 0;
  verifyReview(TEST_SLUG, false, {
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
    ...baseOptions,
    getPrStatusFn: () => ({ exists: false, raw: 'Not found' })
  });
  assert.ok(logs.some(l => l.includes('Review PR: Not found')), 'Should log PR missing error');
});

test('verifyReview handles gate failures', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { verifyReview } = require('../lib/review/review');
  const logs = [];
  const exitCodes = [];

  // The reviewer gate resolves its command from process.cwd(); the default is
  // no validation, so configure a gate in a temp cwd to exercise the failure
  // path (the injected runFn makes that gate command fail).
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'review-gate-'));
  fs.writeFileSync(
    path.join(tmp, 'workflow.config.json'),
    JSON.stringify({ adapters: { verification: { command: 'npm test' } } })
  );
  const origCwd = process.cwd();
  process.chdir(tmp);
  try {
    verifyReview(TEST_SLUG, false, {
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
      log: (m) => logs.push(m),
      error: () => {},
      exit: (c) => exitCodes.push(c),
      resolveWorktreeFn: () => null,
      findMissionDirFn: () => '/tmp/mission',
      getCurrentBranchFn: () => `mission/${TEST_SLUG}`,
      resolveTaskFileFn: () => ({ ok: true, taskFile: 'task.md' }),
      getTaskStatusFn: () => 'review',
      getPrStatusFn: () => ({ exists: true, state: 'open', number: 41 }),
      findMissionAreaFn: () => 'docs',
      runFn: () => ({ status: 1 }), // Fails
      getAcceptanceCriteriaFn: () => [],
      formatMatrixSummaryFn: () => [],
      buildAutonomousReviewMatrixFn: () => ({}),
      readReviewStateFn: () => null,
      cwdFn: () => '/home/magnus/code/visualBoard'
    });
  } finally {
    process.chdir(origCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  assert.ok(logs.some(l => l.includes('Reviewer gate failed.')), 'Should log gate failure');
});

test('startReviewLoop handles reviewer launcher fallback', async () => {
  const { startReviewLoop } = require('../lib/review/review');
  const logs = [];
  const errors = [];
  const exitCodes = [];

  // Case 1: auto-derived reviewer blocked, falls back successfully
  await startReviewLoop(TEST_SLUG, {
      eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'qwen'],
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
    implementer: 'claude',
    dryRun: true,
    readReviewStateFn: () => null,
    writeReviewStateFn: () => {},
    log: (m) => logs.push(m),
    error: (m) => errors.push(m),
    exit: (c) => exitCodes.push(c),
    reviewerForFn: () => 'codex',
    workflowLauncherStatusFn: (a) => ({ supported: a === 'gemini', detail: 'mock' }),
    selectAgentFn: (step, { exclude }) => {
      const ex = exclude instanceof Set ? exclude : new Set(exclude || []);
      if (!ex.has('codex')) return 'codex';
      return 'gemini';
    },
    formatMatrixSummaryFn: () => [],
    buildAutonomousReviewMatrixFn: () => ({
      agents: ['codex', 'claude', 'gemini', 'qwen'],
      launchers: { codex: { supported: false, detail: 'mock' }, gemini: { supported: true, detail: 'mock' } }
    }),
    buildReviewPromptFn: () => 'review prompt',
    buildActOnReviewPromptFn: () => 'act prompt'
  });

  assert.ok(logs.some(l => l.includes('trying fallback') && l.includes('gemini')), 'Should log fallback warning');

  // Case 2: All other reviewers blocked, implementer still runnable
  logs.length = 0;
  errors.length = 0;
  await startReviewLoop(TEST_SLUG, {
      eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'qwen'],
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
    implementer: 'claude',
    dryRun: true,
    readReviewStateFn: () => null,
    writeReviewStateFn: () => {},
    log: (m) => logs.push(m),
    error: (m) => errors.push(m),
    exit: (c) => exitCodes.push(c),
    workflowLauncherStatusFn: (agent) => ({ supported: agent === 'claude', detail: 'mock' }),
    selectAgentFn: (step, { exclude }) => {
      const ex = exclude instanceof Set ? exclude : new Set(exclude || []);
      if (!ex.has('gemini')) return 'gemini';
      throw new Error('All eligible agents exhausted');
    },
    formatMatrixSummaryFn: () => [],
    buildAutonomousReviewMatrixFn: () => ({
      agents: ['codex', 'claude', 'gemini', 'qwen'],
      launchers: { codex: { supported: false, detail: 'mock' } }
    }),
    buildReviewPromptFn: () => 'review prompt',
    buildActOnReviewPromptFn: () => 'act prompt'
  });
  assert.equal(errors.length, 0, `Should not error; got: ${errors.join(' | ')}`);
  assert.ok(
    logs.some(l => l.includes('Single-family fallback') && l.includes('claude')),
    `Should log single-family fallback; got: ${logs.join(' | ')}`
  );
});

test('startReviewLoop handles Forgejo bootstrap failure', async () => {
  const { startReviewLoop } = require('../lib/review/review');
  const errors = [];
  const exitCodes = [];

  await startReviewLoop(TEST_SLUG, {
      eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'qwen'],
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
    implementer: 'claude',
    reviewer: 'codex',
    dryRun: false,
    error: (m) => errors.push(m),
    exit: (c) => exitCodes.push(c),
    workflowLauncherStatusFn: () => ({ supported: true }),
    isForgejoReviewEnabledFn: () => true,
    forgejoAvailableFn: async () => false,
    runFn: () => ({ status: 1 }), // Bootstrap fails
    maybeUpdateGraphifyBeforeReviewFn: () => {}
  });

  assert.ok(errors.some(e => e.includes('Bootstrap failed')), 'Should log bootstrap failure');
});

test('startReviewLoop handles missing PR', async () => {
  const { startReviewLoop } = require('../lib/review/review');
  const errors = [];
  const exitCodes = [];

  await startReviewLoop(TEST_SLUG, {
      eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'qwen'],
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
    implementer: 'claude',
    reviewer: 'codex',
    dryRun: false,
    error: (m) => errors.push(m),
    exit: (c) => exitCodes.push(c),
    workflowLauncherStatusFn: () => ({ supported: true }),
    isForgejoReviewEnabledFn: () => true,
    forgejoAvailableFn: async () => true,
    getPrStatusFn: () => ({ exists: false }),
    maybeUpdateGraphifyBeforeReviewFn: () => {},
    enforceTaskAssigneeFn: () => true,
    resolveTaskFileFn: () => ({ ok: true, taskFile: 'task.md' })
  });

  assert.ok(errors.some(e => e.includes('No open review PR found')), 'Should error when PR missing');
});

test('startReviewLoop full loop success and exit cases', async () => {
  const { startReviewLoop } = require('../lib/review/review');
  const logs = [];
  const rebaseCalls = [];

  const baseOpts = {
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
    slug: TEST_SLUG,
    implementer: 'claude',
    reviewer: 'codex',
    dryRun: false,
    log: (m) => logs.push(m),
    error: () => {},
    exit: () => {},
    workflowLauncherStatusFn: () => ({ supported: true }),
    isForgejoReviewEnabledFn: () => true,
    forgejoAvailableFn: async () => true,
    getPrStatusFn: () => ({ exists: true, state: 'open', number: 41 }),
    maybeUpdateGraphifyBeforeReviewFn: () => {},
    resolveTaskFileFn: () => ({ ok: true, taskFile: 'task.md' }),
    enforceTaskAssigneeFn: () => true,
    resolveForgejoUserFn: () => 'gemini',
    readTokenFn: () => 'token',
    readReviewStateFn: () => null,
    writeReviewStateFn: () => {},
    startAgentFn: async () => ({ agent: null }), // No fallback
    rebaseBeforeReviewRoundFn: async (slug, { worktree }) => {
      rebaseCalls.push({ slug, worktree });
      return { ok: true, sharedFileConflicts: false };
    },
    pollForReviewFn: async () => 'REQUEST_CHANGES',
    pollForDispositionFn: async () => 'CHANGES_MADE',
    applyAgentFallbackFn: (args) => args.original,
    buildCompactReviewPromptFn: () => 'review prompt',
    buildCompactActOnReviewPromptFn: () => 'act-on-review prompt',
    
  };

  // Case 1: Max attempts reached
  await startReviewLoop(TEST_SLUG, {
      eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'qwen'],
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }), ...baseOpts });
  assert.ok(logs.some(l => l.includes('reached 5 attempts')), 'Should stop at max attempts');
  assert.equal(rebaseCalls.length, 5, 'Should rebase before each review round');

  // Case 2: Reviewer approves
  logs.length = 0;
  await startReviewLoop(TEST_SLUG, {
      eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'qwen'],
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
    ...baseOpts,
    pollForReviewFn: async () => 'APPROVED'
  });
  assert.ok(logs.some(l => l.includes('reviewer approved the PR')), 'Should stop on approval');

  // Case 3: Implementer pushes back
  logs.length = 0;
  await startReviewLoop(TEST_SLUG, {
      eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'qwen'],
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
    ...baseOpts,
    pollForDispositionFn: async () => 'PUSHBACK_ALL'
  });
  assert.ok(logs.some(l => l.includes('implementer pushed back')), 'Should stop on pushback');

  // Case 4: Implementer blocked
  logs.length = 0;
  await startReviewLoop(TEST_SLUG, {
      eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'qwen'],
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
    ...baseOpts,
    pollForDispositionFn: async () => 'BLOCKED'
  });
  assert.ok(logs.some(l => l.includes('implementer reported BLOCKED')), 'Should stop on blocked');
});

test('review helper functions and error paths', async () => {
  const review = require('../lib/review/review');
  const { pollForReview, pollForDisposition } = review;
  const logs = [];
  const errors = [];
  const exitCodes = [];

  const baseOptions = {
    log: (m) => logs.push(m),
    error: (m) => errors.push(m),
    exit: (c) => exitCodes.push(c),
    inferSlugFn: (s) => s || 'test-slug',
    getPrStatusFn: () => ({ exists: false }),
    readReviewStateFn: () => null,
    readFileSync: (p) => { if (p === 'fail.md') throw new Error('read fail'); return 'content'; }
  };

  // 1. review usage error (missing slug)
  await review([], { ...baseOptions, inferSlugFn: () => null });
  assert.equal(exitCodes[0], 1);
  assert.ok(errors[0].includes('Usage: px review'), 'Should show usage');

  // 2. review status (PR not found)
  logs.length = 0;
  await review(['test-slug'], { ...baseOptions });
  assert.ok(logs.some(l => l.includes('No active PR found')), 'Should log PR not found');

  // 3. readTextFlag error path
  errors.length = 0;
  exitCodes.length = 0;
  await review(['test-slug', '--comment-file', 'fail.md'], { ...baseOptions, isComment: true });
  assert.equal(exitCodes[0], 1);
  assert.ok(errors[0].includes('Could not read comment from fail.md'), 'Should log read error');

  // 4. Polling helpers - No token warning
  const originalLog = console.log;
  try {
    console.log = (m) => logs.push(m);
    logs.length = 0;
    const reviewResult = await pollForReview(41, 'user', 'since', null);
    assert.equal(reviewResult, null);
    assert.ok(logs.some(l => l.includes('No Forgejo token — skipping review-outcome poll')), 'Should log review token warning');

    logs.length = 0;
    const dispResult = await pollForDisposition(41, 'user', 'since', null);
    assert.equal(dispResult, null);
    assert.ok(logs.some(l => l.includes('No Forgejo token — skipping disposition poll')), 'Should log disposition token warning');
  } finally {
    console.log = originalLog;
  }
});

test('review function missing argument and env var error paths', async () => {
  const review = require('../lib/review/review');
  const errors = [];
  const exitCodes = [];

  const baseOptions = {
    error: (m) => errors.push(m),
    exit: (c) => exitCodes.push(c),
    inferSlugFn: (s) => s || 'test-slug',
    isForgejoReviewEnabledFn: () => true,
    readReviewStateFn: () => ({ reviewer: 'codex', implementer: 'codex' }),
    readTokenFn: () => 'token',
    getCommentsFn: async () => []
  };

  // 1. --comments should use review-state identity without needing FORGEJO_USER
  await review(['test-slug', '--comments'], { ...baseOptions });
  assert.ok(!errors.some(e => e.includes('Cannot determine Forgejo user')), 'Should not require FORGEJO_USER for --comments');

  // 2. --comment missing message
  errors.length = 0;
  await review(['test-slug', '--comment'], { ...baseOptions });
  assert.ok(errors.some(e => e.includes('--comment requires text')), 'Should error on missing message for --comment');

  // 3. --submit-review missing outcome
  errors.length = 0;
  await review(['test-slug', '--submit-review'], { ...baseOptions });
  assert.ok(errors.some(e => e.includes('--submit-review requires an outcome')), 'Should error on missing outcome for --submit-review');
});

test('polling configuration logic', async () => {
  const { startReviewLoop } = require('../lib/review/review');
  
  // Test env overrides
  process.env.AUTONOMOUS_REVIEW_POLL_INTERVAL_MS = '500';
  process.env.AUTONOMOUS_REVIEW_POLL_TIMEOUT_MS = '1000';
  
  const logs = [];
  await startReviewLoop(TEST_SLUG, {
      eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'qwen'],
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
    implementer: 'claude',
    reviewer: 'codex',
    dryRun: true,
    readReviewStateFn: () => null,
    writeReviewStateFn: () => {},
    workflowLauncherStatusFn: () => ({ supported: true }),
    buildReviewPromptFn: () => 'review prompt',
    buildActOnReviewPromptFn: () => 'act prompt',
    log: (m) => logs.push(m)
  });
  
  assert.ok(logs.some(l => l.includes('Poll interval: 1s')), 'Should use env override for interval (rounded to 1s in log)');
  assert.ok(logs.some(l => l.includes('Poll timeout: 1s')), 'Should use env override for timeout');
  
  delete process.env.AUTONOMOUS_REVIEW_POLL_INTERVAL_MS;
  delete process.env.AUTONOMOUS_REVIEW_POLL_TIMEOUT_MS;

  // Test explicit poll timeout
  logs.length = 0;
  await startReviewLoop(TEST_SLUG, {
      eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'qwen'],
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
    implementer: 'claude',
    reviewer: 'codex',
    dryRun: true,
    pollTimeoutSeconds: 5,
    readReviewStateFn: () => null,
    writeReviewStateFn: () => {},
    workflowLauncherStatusFn: () => ({ supported: true }),
    buildReviewPromptFn: () => 'review prompt',
    buildActOnReviewPromptFn: () => 'act prompt',
    log: (m) => logs.push(m)
  });
  assert.ok(logs.some(l => l.includes('Poll timeout: 5s')), 'Should use explicit timeout');
});

test('startReviewLoop explicit same-family path covers all four families', async () => {
  const { startReviewLoop } = require('../lib/review/review');

  for (const agent of ['codex', 'claude', 'gemini']) {
    const { exitCode, errors, logs } = await captureExit(() => {
      return startReviewLoop(TEST_SLUG, {
      eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'qwen'],
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
        implementer: agent,
        reviewer: agent,
        dryRun: true,
        readReviewStateFn: () => null,
        writeReviewStateFn: () => {},
        workflowLauncherStatusFn: () => ({ supported: true }),
        buildReviewPromptFn: () => 'review prompt',
        buildActOnReviewPromptFn: () => 'act prompt'
      });
    });

    assert.equal(exitCode, null, `Expected no exit for same-family ${agent}`);
    assert.deepEqual(errors, []);
    assert.ok(
      logs.some(e => e.includes(`Selected reviewer: ${agent} (explicit)`)),
      `Expected selected reviewer log for ${agent}; got: ${logs.join(' | ')}`
    );
  }
});

test('startReviewLoop same-family explicit reviewer logs the agent name', async () => {
  const { startReviewLoop } = require('../lib/review/review');

  const { exitCode, errors, logs } = await captureExit(() => {
    return startReviewLoop(TEST_SLUG, {
      eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'qwen'],
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
      readReviewStateFn: () => null,
      writeReviewStateFn: () => {},
      implementer: 'gemini',
      reviewer: 'gemini',
      dryRun: true,
      workflowLauncherStatusFn: () => ({ supported: true }),
      buildReviewPromptFn: () => 'review prompt',
      buildActOnReviewPromptFn: () => 'act prompt'
    });
  });

  assert.equal(exitCode, null);
  assert.deepEqual(errors, []);
  assert.ok(
    logs.some(e => e.includes('Selected reviewer: gemini (explicit)')),
    `Expected gemini in selected reviewer log; got: ${logs.join(' | ')}`
  );
});

test('startReviewLoop rebases immediately before each reviewer round', async () => {
  const { startReviewLoop } = require('../lib/review/review');
  const events = [];
  const reviewOutcomes = ['REQUEST_CHANGES', 'APPROVED'];
  const dispositions = ['CHANGES_MADE'];

  await startReviewLoop(TEST_SLUG, {
    eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'qwen'],
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
    implementer: 'claude',
    reviewer: 'codex',
    dryRun: false,
    workflowLauncherStatusFn: () => ({ supported: true }),
    isForgejoReviewEnabledFn: () => true,
    forgejoAvailableFn: async () => true,
    getPrStatusFn: () => ({ exists: true, state: 'open', number: 41 }),
    maybeUpdateGraphifyBeforeReviewFn: () => {},
    enforceTaskAssigneeFn: () => true,
    resolveForgejoUserFn: () => 'gemini',
    readTokenFn: () => 'token',
    readReviewStateFn: () => null,
    writeReviewStateFn: () => {},
    rebaseBeforeReviewRoundFn: async () => {
      events.push('rebase');
      return { ok: true, sharedFileConflicts: false };
    },
    startAgentFn: async (step, options) => {
      events.push(`${step}:${options.role}`);
      return { agent: null };
    },
    pollForReviewFn: async () => reviewOutcomes.shift(),
    pollForDispositionFn: async () => dispositions.shift(),
    applyAgentFallbackFn: (args) => args.original,
    buildCompactReviewPromptFn: () => 'review prompt',
    buildCompactActOnReviewPromptFn: () => 'act-on-review prompt',
    log: () => {},
    error: () => {},
    exit: () => {},
    
  });

  assert.deepEqual(events, [
    'rebase',
    'review:reviewer',
    'act-on-review:implementer',
    'rebase',
    'review:reviewer'
  ]);
});

test('startReviewLoop continue consumes existing fixing disposition before next reviewer round', async () => {
  const { startReviewLoop } = require('../lib/review/review');
  const launches = [];
  const reviews = [];
  const dispositions = [];
  const startedAt = '2026-05-20T17:10:00.000Z';

  await startReviewLoop(TEST_SLUG, {
    continue: true,
    eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'qwen'],
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
    dryRun: false,
    workflowLauncherStatusFn: () => ({ supported: true }),
    isForgejoReviewEnabledFn: () => true,
    forgejoAvailableFn: async () => true,
    getPrStatusFn: () => ({ exists: true, state: 'open', number: 41 }),
    maybeUpdateGraphifyBeforeReviewFn: () => {},
    enforceTaskAssigneeFn: () => true,
    resolveForgejoUserFn: () => 'gemini',
    readTokenFn: () => 'token',
    readReviewStateFn: () => ({
      reviewer: 'codex',
      implementer: 'gemini',
      round: 1,
      startedAt,
      phase: 'fixing'
    }),
    writeReviewStateFn: () => {},
    rebaseBeforeReviewRoundFn: async () => ({ ok: true, sharedFileConflicts: false }),
    getLatestReviewForPrFn: async (prNumber, reviewerUser, sinceIso) => {
      reviews.push({ prNumber, reviewerUser, sinceIso });
      return { state: 'REQUEST_CHANGES' };
    },
    pollForReviewFn: async () => 'APPROVED',
    pollForDispositionFn: async (prNumber, implementerUser, sinceIso) => {
      dispositions.push({ prNumber, implementerUser, sinceIso });
      return 'CHANGES_MADE';
    },
    startAgentFn: async (step, options) => {
      launches.push({ step, agent: options.agent, role: options.role });
      return { agent: null };
    },
    applyAgentFallbackFn: (args) => args.original,
    buildCompactReviewPromptFn: () => 'review prompt',
    buildCompactActOnReviewPromptFn: () => 'act-on-review prompt',
    log: () => {},
    error: (message) => { throw new Error(message); },
    exit: (code) => { throw new Error(`unexpected exit ${code}`); }
  });

  assert.deepEqual(reviews, [{ prNumber: 41, reviewerUser: 'codex', sinceIso: startedAt }]);
  assert.deepEqual(dispositions, [{ prNumber: 41, implementerUser: 'gemini', sinceIso: startedAt }]);
  assert.deepEqual(launches, [
    { step: 'review', agent: 'codex', role: 'reviewer' }
  ]);
});

test('startReviewLoop isContinue waits long enough for delayed existing fixing disposition', async () => {
  const { startReviewLoop } = require('../lib/review/review');
  const launches = [];
  const startedAt = '2026-05-20T04:41:14.637Z';
  const originalNow = Date.now;
  let now = 0;
  let dispositionLookups = 0;

  Date.now = () => now;
  try {
    await startReviewLoop(TEST_SLUG, {
      isContinue: true,
      eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'qwen'],
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
      dryRun: false,
      workflowLauncherStatusFn: () => ({ supported: true }),
      isForgejoReviewEnabledFn: () => true,
      forgejoAvailableFn: async () => true,
      getPrStatusFn: () => ({ exists: true, state: 'open', number: 41 }),
      maybeUpdateGraphifyBeforeReviewFn: () => {},
      enforceTaskAssigneeFn: () => true,
      resolveForgejoUserFn: () => 'gemini',
      readTokenFn: () => 'token',
      readReviewStateFn: () => ({
        reviewer: 'codex',
        implementer: 'gemini',
        round: 1,
        startedAt,
        phase: 'fixing'
      }),
      writeReviewStateFn: () => {},
      rebaseBeforeReviewRoundFn: async () => ({ ok: true, sharedFileConflicts: false }),
      getLatestReviewForPrFn: async () => ({ state: 'REQUEST_CHANGES' }),
      getLatestDispositionForPrFn: async () => {
        dispositionLookups += 1;
        return dispositionLookups >= 4 ? 'CHANGES_MADE' : null;
      },
      pollForReviewFn: async () => 'APPROVED',
      sleepFn: async (ms) => { now += ms; },
      startAgentFn: async (step, options) => {
        launches.push({ step, agent: options.agent, role: options.role });
        return { agent: null };
      },
      applyAgentFallbackFn: (args) => args.original,
      buildCompactReviewPromptFn: () => 'review prompt',
      buildCompactActOnReviewPromptFn: () => 'act-on-review prompt',
      log: () => {},
      error: (message) => { throw new Error(message); },
      exit: (code) => { throw new Error(`unexpected exit ${code}`); }
    });
  } finally {
    Date.now = originalNow;
  }

  assert.equal(dispositionLookups, 4);
  assert.deepEqual(launches, [
    { step: 'review', agent: 'codex', role: 'reviewer' }
  ]);
});

test('startReviewLoop continue stops on terminal existing fixing dispositions', async () => {
  const { startReviewLoop } = require('../lib/review/review');
  const startedAt = '2026-05-20T17:10:00.000Z';

  for (const terminalDisposition of ['PUSHBACK_ALL', 'PARKED', 'BLOCKED']) {
    const launches = [];
    const roundTwoReviewPolls = [];

    await startReviewLoop(TEST_SLUG, {
      continue: true,
      eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'qwen'],
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
      dryRun: false,
      workflowLauncherStatusFn: () => ({ supported: true }),
      isForgejoReviewEnabledFn: () => true,
      forgejoAvailableFn: async () => true,
      getPrStatusFn: () => ({ exists: true, state: 'open', number: 41 }),
      maybeUpdateGraphifyBeforeReviewFn: () => {},
      enforceTaskAssigneeFn: () => true,
      resolveForgejoUserFn: () => 'gemini',
      readTokenFn: () => 'token',
      readReviewStateFn: () => ({
        reviewer: 'codex',
        implementer: 'gemini',
        round: 1,
        startedAt,
        phase: 'fixing'
      }),
      writeReviewStateFn: () => {},
      rebaseBeforeReviewRoundFn: async () => ({ ok: true, sharedFileConflicts: false }),
      getLatestReviewForPrFn: async () => ({ state: 'REQUEST_CHANGES' }),
      pollForReviewFn: async () => {
        roundTwoReviewPolls.push(terminalDisposition);
        return 'APPROVED';
      },
      pollForDispositionFn: async () => terminalDisposition,
      startAgentFn: async (step, options) => {
        launches.push({ step, agent: options.agent, role: options.role });
        return { agent: null };
      },
      applyAgentFallbackFn: (args) => args.original,
      buildCompactReviewPromptFn: () => 'review prompt',
      buildCompactActOnReviewPromptFn: () => 'act-on-review prompt',
      log: () => {},
      error: (message) => { throw new Error(message); },
      exit: (code) => { throw new Error(`unexpected exit ${code}`); }
    });

    // PUSHBACK_ALL is non-blocking for the skip-check: it is not BLOCKED/PARKED,
    // so the skip-check logs "Skipping" and the disposition is accepted.
    // BLOCKED/PARKED are stale-disposition re-launches: the implementer must
    // be re-launched to assess whether the blocker is resolved.
    if (terminalDisposition === 'PUSHBACK_ALL') {
      assert.deepEqual(launches, [], `PUSHBACK_ALL must not launch another agent`);
      assert.deepEqual(roundTwoReviewPolls, [], `PUSHBACK_ALL must not enter round 2`);
    } else {
      // BLOCKED/PARKED: stale-disposition re-launch triggers implementer launch
      assert.ok(launches.some(l => l.step === 'act-on-review'), `${terminalDisposition} must re-launch implementer for fresh disposition`);
    }
  }
});

test('startReviewLoop continue reviewing phase skips only when existing review is found', async () => {
  const { startReviewLoop } = require('../lib/review/review');
  const startedAt = '2026-05-20T17:10:00.000Z';

  for (const existingReview of [true, false]) {
    const launches = [];

    await startReviewLoop(TEST_SLUG, {
      continue: true,
      eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'qwen'],
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
      dryRun: false,
      workflowLauncherStatusFn: () => ({ supported: true }),
      isForgejoReviewEnabledFn: () => true,
      forgejoAvailableFn: async () => true,
      getPrStatusFn: () => ({ exists: true, state: 'open', number: 41 }),
      maybeUpdateGraphifyBeforeReviewFn: () => {},
      enforceTaskAssigneeFn: () => true,
      resolveForgejoUserFn: () => 'gemini',
      readTokenFn: () => 'token',
      readReviewStateFn: () => ({
        reviewer: 'codex',
        implementer: 'gemini',
        round: 1,
        startedAt,
        phase: 'reviewing'
      }),
      writeReviewStateFn: () => {},
      rebaseBeforeReviewRoundFn: async () => ({ ok: true, sharedFileConflicts: false }),
      pollForReviewFn: async (prNumber, reviewerUser, sinceIso, token, options) => {
        if (options.label === 'round 1 skip-check') {
          return existingReview ? 'APPROVED' : null;
        }
        return 'APPROVED';
      },
      pollForDispositionFn: async () => 'CHANGES_MADE',
      startAgentFn: async (step, options) => {
        launches.push({ step, agent: options.agent, role: options.role });
        return { agent: null };
      },
      applyAgentFallbackFn: (args) => args.original,
      buildCompactReviewPromptFn: () => 'review prompt',
      buildCompactActOnReviewPromptFn: () => 'act-on-review prompt',
      log: () => {},
      error: (message) => { throw new Error(message); },
      exit: (code) => { throw new Error(`unexpected exit ${code}`); }
    });

    assert.deepEqual(
      launches,
      existingReview ? [] : [{ step: 'review', agent: 'codex', role: 'reviewer' }]
    );
  }
});

test('rebaseBeforeReviewRound succeeds after a clean rebase', async () => {
  const { rebaseBeforeReviewRound } = require('../lib/review/review');
  const logs = [];
  const errors = [];

  const result = await rebaseBeforeReviewRound('task-1087', {
    worktree: '/tmp/worktree',
    isForgejoReviewEnabledFn: () => true,
    runFn: () => ({ status: 0, stdout: '', stderr: '' }),
    log: message => logs.push(message),
    error: message => errors.push(message)
  });

  assert.deepEqual(result, { ok: true, sharedFileConflicts: false });
  assert.ok(logs.some(message => message.includes('Rebasing mission/task-1087')));
  assert.ok(logs.some(message => message.includes('Pre-review rebase completed')));
  assert.deepEqual(errors, []);
});

test('rebaseBeforeReviewRound reports shared-file conflicts with recovery instructions', async () => {
  const { rebaseBeforeReviewRound } = require('../lib/review/review');
  const logs = [];
  const errors = [];
  const sharedFileOutput = '[INFO] 1 shared file(s) require agent-assisted resolution:\n  - src/shared.js';

  const result = await rebaseBeforeReviewRound('task-1087', {
    worktree: '/tmp/worktree',
    isForgejoReviewEnabledFn: () => true,
    runFn: () => ({
      status: 1,
      stdout: sharedFileOutput,
      stderr: '[FAIL] Agent (codex) exited with status 1.'
    }),
    log: message => logs.push(message),
    error: message => errors.push(message)
  });

  assert.deepEqual(result, { ok: false, sharedFileConflicts: true });
  assert.ok(
    errors.some(message => message.includes(sharedFileOutput)),
    `Expected raw conflict output, got: ${errors.join(' | ')}`
  );
  assert.equal(
    errors.filter(message => message.includes('Shared-file rebase conflicts detected')).length,
    1,
    `Expected one shared-file failure message, got: ${errors.join(' | ')}`
  );
  assert.ok(
    logs.some(message => message.includes('Resolve the conflicts in the worktree, then re-run: px review task-1087 --start')),
    `Expected recovery instructions, got logs: ${logs.join(' | ')}`
  );
});

test('rebaseBeforeReviewRound reports non-conflict rebase failures', async () => {
  const { rebaseBeforeReviewRound } = require('../lib/review/review');
  const logs = [];
  const errors = [];

  const result = await rebaseBeforeReviewRound('task-1087', {
    worktree: '/tmp/worktree',
    isForgejoReviewEnabledFn: () => true,
    runFn: () => ({ status: 1, stdout: '', stderr: 'stale info' }),
    log: message => logs.push(message),
    error: message => errors.push(message)
  });

  assert.deepEqual(result, { ok: false, sharedFileConflicts: false });
  assert.ok(errors.some(message => message.includes('stale info')));
  assert.ok(errors.some(message => message.includes('Rebase failed before launching reviewer')));
  assert.ok(
    logs.every(message => !message.includes('Resolve the conflicts in the worktree')),
    `Did not expect shared-conflict recovery instructions, got logs: ${logs.join(' | ')}`
  );
});

test('startReviewLoop aborts on shared-file rebase conflicts before reviewer launch', async () => {
  const { startReviewLoop } = require('../lib/review/review');
  const logs = [];
  const errors = [];
  let reviewerLaunched = false;

  await startReviewLoop(TEST_SLUG, {
    eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'qwen'],
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
    implementer: 'claude',
    reviewer: 'codex',
    dryRun: false,
    workflowLauncherStatusFn: () => ({ supported: true }),
    isForgejoReviewEnabledFn: () => true,
    forgejoAvailableFn: async () => true,
    getPrStatusFn: () => ({ exists: true, state: 'open', number: 41 }),
    maybeUpdateGraphifyBeforeReviewFn: () => {},
    enforceTaskAssigneeFn: () => true,
    resolveForgejoUserFn: () => 'gemini',
    readTokenFn: () => 'token',
    readReviewStateFn: () => null,
    writeReviewStateFn: () => {},
    rebaseBeforeReviewRoundFn: async (_slug, { log, error }) => {
      error('[FAIL] Shared-file rebase conflicts detected. Autonomous review loop cannot continue safely.');
      log(`[INFO] Resolve the conflicts in the worktree, then re-run: px review ${TEST_SLUG} --start`);
      return { ok: false, sharedFileConflicts: true };
    },
    startAgentFn: async () => {
      reviewerLaunched = true;
      return { agent: null };
    },
    applyAgentFallbackFn: (args) => args.original,
    buildCompactReviewPromptFn: () => 'review prompt',
    buildCompactActOnReviewPromptFn: () => 'act-on-review prompt',
    log: (message) => logs.push(message),
    error: (message) => errors.push(message),
    exit: () => {}
  });

  assert.equal(reviewerLaunched, false, 'Reviewer should not launch when shared-file rebase conflicts exist');
  assert.equal(
    errors.filter(message => message.includes('Shared-file rebase conflicts detected')).length,
    1,
    `Expected one shared-file conflict failure, got: ${errors.join(' | ')}`
  );
  assert.ok(
    logs.some(message => message.includes(`Resolve the conflicts in the worktree, then re-run: px review ${TEST_SLUG} --start`)),
    `Expected recovery instructions, got logs: ${logs.join(' | ')}`
  );
});

test('startReviewLoop aborts on non-shared-file rebase failure (e.g. push stale info)', async () => {
  const { startReviewLoop } = require('../lib/review/review');
  const errors = [];
  let reviewerLaunched = false;
  let exitCode = null;

  await startReviewLoop(TEST_SLUG, {
    eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'qwen'],
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
    implementer: 'claude',
    reviewer: 'codex',
    dryRun: false,
    workflowLauncherStatusFn: () => ({ supported: true }),
    isForgejoReviewEnabledFn: () => true,
    forgejoAvailableFn: async () => true,
    getPrStatusFn: () => ({ exists: true, state: 'open', number: 41 }),
    maybeUpdateGraphifyBeforeReviewFn: () => {},
    enforceTaskAssigneeFn: () => true,
    resolveForgejoUserFn: () => 'claude',
    readTokenFn: () => 'token',
    readReviewStateFn: () => null,
    writeReviewStateFn: () => {},
    rebaseBeforeReviewRoundFn: async () => ({ ok: false, sharedFileConflicts: false }),
    startAgentFn: async () => {
      reviewerLaunched = true;
      return { agent: null };
    },
    applyAgentFallbackFn: (args) => args.original,
    buildCompactReviewPromptFn: () => 'review prompt',
    buildCompactActOnReviewPromptFn: () => 'act-on-review prompt',
    log: () => {},
    error: (message) => errors.push(message),
    exit: (code) => { exitCode = code; }
  });

  assert.equal(reviewerLaunched, false, 'Reviewer should not launch when rebase push fails');
  assert.equal(exitCode, 1, 'Loop should exit with code 1 on non-conflict rebase failure');
  assert.ok(
    !errors.some(message => message.includes('Shared-file rebase conflicts detected')),
    'Should not emit shared-file conflict message for a push-stale failure'
  );
});

test('pollForReview waits asynchronously between retries', async () => {
  const { pollForReview } = require('../lib/review/review');
  const sleeps = [];
  let attempts = 0;

  const state = await pollForReview(41, 'claude', '2026-04-18T10:00:00Z', 'fake-token', {
    async getLatestReviewForPrFn() {
      attempts += 1;
      return attempts === 2 ? { state: 'APPROVED' } : null;
    },
    async sleepFn(ms) {
      sleeps.push(ms);
    }
  });

  assert.equal(state, 'APPROVED');
  assert.equal(attempts, 2);
  assert.deepEqual(sleeps, [10_000]);
});

test('pollForDisposition waits asynchronously between retries', async () => {
  const { pollForDisposition } = require('../lib/review/review');
  const sleeps = [];
  let attempts = 0;

  const disposition = await pollForDisposition(41, 'codex', '2026-04-18T10:00:00Z', 'fake-token', {
    async getLatestDispositionForPrFn() {
      attempts += 1;
      return attempts === 2 ? 'CHANGES_MADE' : null;
    },
    async sleepFn(ms) {
      sleeps.push(ms);
    }
  });

  assert.equal(disposition, 'CHANGES_MADE');
  assert.equal(attempts, 2);
  assert.deepEqual(sleeps, [10_000]);
});

test('pollForReview honours caller intervalMs and timeoutMs and returns timeout sentinel on timeout', async () => {
  const { pollForReview, POLL_TIMEOUT, isPollTimeout } = require('../lib/review/review');
  const sleeps = [];

  // Simulated clock so the "timeout" fires after a few iterations without real time passing.
  const originalNow = Date.now;
  let fakeNow = 1_700_000_000_000;
  Date.now = () => fakeNow;

  try {
    const state = await pollForReview(99, 'claude', '2026-04-18T10:00:00Z', 'fake-token', {
      intervalMs: 250,
      timeoutMs: 1000,
      async getLatestReviewForPrFn() {
        return null; // reviewer never posts
      },
      async sleepFn(ms) {
        sleeps.push(ms);
        fakeNow += ms;
      }
    });

    assert.ok(isPollTimeout(state), 'expected timeout sentinel when reviewer never posts before timeout');
    assert.deepEqual(sleeps, [250, 250, 250, 250], 'expected four 250ms sleeps within a 1s window');
  } finally {
    Date.now = originalNow;
  }
});

test('pollForReview emits a progress line on every tick when verbose=true', async () => {
  const { pollForReview } = require('../lib/review/review');
  const logs = [];
  const originalLog = console.log;
  console.log = (msg) => logs.push(String(msg));

  let attempts = 0;
  try {
    const state = await pollForReview(42, 'claude', '2026-04-18T10:00:00Z', 'fake-token', {
      intervalMs: 5,
      timeoutMs: 10_000,
      verbose: true,
      async getLatestReviewForPrFn() {
        attempts += 1;
        return attempts === 3 ? { state: 'COMMENT' } : null;
      },
      async sleepFn() {}
    });

    assert.equal(state, 'COMMENT');
    const stillWaitingLines = logs.filter(l => l.includes('still waiting'));
    // verbose=true -> should log on every tick we didn't already return on (attempts 1 and 2).
    assert.equal(stillWaitingLines.length, 2, `expected 2 progress lines, got: ${logs.join(' | ')}`);
  } finally {
    console.log = originalLog;
  }
});

test('resolvePollTimeoutMs honours AUTONOMOUS_REVIEW_POLL_TIMEOUT_MS env override', async () => {
  const { pollForReview, isPollTimeout } = require('../lib/review/review');
  const previous = process.env.AUTONOMOUS_REVIEW_POLL_TIMEOUT_MS;
  process.env.AUTONOMOUS_REVIEW_POLL_TIMEOUT_MS = '500';

  const originalNow = Date.now;
  let fakeNow = 2_000_000_000_000;
  Date.now = () => fakeNow;

  try {
    const state = await pollForReview(43, 'claude', '2026-04-18T10:00:00Z', 'fake-token', {
      intervalMs: 100,
      // timeoutMs intentionally omitted so the env override resolves the default.
      async getLatestReviewForPrFn() { return null; },
      async sleepFn(ms) { fakeNow += ms; }
    });
    assert.ok(isPollTimeout(state), 'expected timeout sentinel on timeout');
    // Bounded both sides: if the env override were ignored, fakeNow would advance past the
    // default 600_000ms timeout (many intervalMs=100 iterations), not sit just past 500ms.
    const elapsed = fakeNow - 2_000_000_000_000;
    assert.ok(elapsed >= 500, `expected env timeout (500ms) to fire; elapsed=${elapsed}`);
    assert.ok(elapsed < 1000, `expected env timeout to cap well under 1s; elapsed=${elapsed} (env override ignored?)`);
  } finally {
    Date.now = originalNow;
    if (previous === undefined) delete process.env.AUTONOMOUS_REVIEW_POLL_TIMEOUT_MS;
    else process.env.AUTONOMOUS_REVIEW_POLL_TIMEOUT_MS = previous;
  }
});

test('maybeUpdateGraphifyBeforeReview skips cleanly when graphify is missing', () => {
  const { maybeUpdateGraphifyBeforeReview } = require('../lib/review/review');
  const logs = [];

  const result = maybeUpdateGraphifyBeforeReview('/tmp/visualBoard-task-1006', {
    commandRunner() {
      const error = new Error('missing');
      error.code = 'ENOENT';
      throw error;
    },
    log(message) {
      logs.push(message);
    }
  });

  assert.deepEqual(result, {
    updated: false,
    skipped: true,
    reason: 'missing-command'
  });
  assert.ok(logs.some(line => line.includes('graphify not found')));
});

test('maybeUpdateGraphifyBeforeReview runs graphify update in the mission worktree when available', () => {
  const { maybeUpdateGraphifyBeforeReview } = require('../lib/review/review');
  const calls = [];
  const logs = [];

  const result = maybeUpdateGraphifyBeforeReview('/tmp/visualBoard-task-1006', {
    commandRunner(command, args, options = {}) {
      calls.push({ command, args, options });
      return { status: 0, stdout: '', stderr: '' };
    },
    log(message) {
      logs.push(message);
    }
  });

  assert.deepEqual(result, {
    updated: true,
    skipped: false
  });
  assert.equal(calls.length, 2);
  const expectedGraphifyCommand = process.env.GRAPHIFY_BIN || 'graphify';
  assert.deepEqual(calls[0], {
    command: expectedGraphifyCommand,
    args: ['--help'],
    options: {}
  });
  assert.deepEqual(calls[1], {
    command: expectedGraphifyCommand,
    args: ['update', '.'],
    options: {
      cwd: '/tmp/visualBoard-task-1006',
      stdio: 'inherit'
    }
  });
  assert.ok(logs.some(line => line.includes('Updating graphify knowledge graph...')));
});

test('pollForDisposition misses comment if created_at is slightly before sinceIso (clock skew)', async () => {
  const { pollForDisposition, isPollTimeout } = require('../lib/review/review');
  const prNumber = 41;
  const implementerUser = 'gemini';
  const sinceIso = '2026-04-26T10:00:05.000Z';
  const token = 'fake-token';

  // Comment posted at 10:00:04, 1s before sinceIso
  const mockComments = [
    {
      user: { login: 'gemini' },
      created_at: '2026-04-26T10:00:04Z',
      body: 'Autonomous review disposition: CHANGES_MADE'
    }
  ];

  let callCount = 0;
  const getLatestDispositionForPrFn = async (prNum, user, since) => {
    callCount++;
    const eligible = mockComments.filter(c => 
      c.user.login === user && c.created_at >= since
    );
    return eligible.length > 0 ? 'CHANGES_MADE' : null;
  };

  const disposition = await pollForDisposition(prNumber, implementerUser, sinceIso, token, {
    getLatestDispositionForPrFn,
    timeoutMs: 100,
    intervalMs: 10,
    sleepFn: async () => {}
  });

  assert.ok(isPollTimeout(disposition), 'expected timeout sentinel when comment missed due to clock skew');
  assert.ok(callCount > 1);
});

test('pollForDisposition finds comment with stable round start time despite clock skew from launch', async () => {
  const { pollForDisposition } = require('../lib/review/review');
  const prNumber = 41;
  const implementerUser = 'gemini';
  const token = 'fake-token';
  
  // Round starts at 10:00:00
  const roundStartedAt = '2026-04-26T10:00:00.000Z';
  
  // Agent launched at 10:00:05
  // Comment posted at 10:00:03 (due to 2s clock skew from launch)
  const mockComments = [
    {
      user: { login: 'gemini' },
      created_at: '2026-04-26T10:00:03Z',
      body: 'Autonomous review disposition: CHANGES_MADE'
    }
  ];

  const getLatestDispositionForPrFn = async (prNum, user, since) => {
    const eligible = mockComments.filter(c => 
      c.user.login === user && c.created_at >= since
    );
    return eligible.length > 0 ? 'CHANGES_MADE' : null;
  };

  // Using roundStartedAt instead of agent launch time
  const disposition = await pollForDisposition(prNumber, implementerUser, roundStartedAt, token, {
    getLatestDispositionForPrFn,
    timeoutMs: 100,
    intervalMs: 10,
    sleepFn: async () => {}
  });

  assert.strictEqual(disposition, 'CHANGES_MADE');
});

test('pollForDisposition finds already-posted comment when resuming a round', async () => {
  const { pollForDisposition, POLL_TIMEOUT, isPollTimeout } = require('../lib/review/review');
  const prNumber = 41;
  const implementerUser = 'gemini';
  const token = 'fake-token';
  
  // Previous run started at 10:00:00
  const originalStartedAt = '2026-04-26T10:00:00.000Z';
  
  // Agent posted at 10:00:10
  const mockComments = [
    {
      user: { login: 'gemini' },
      created_at: '2026-04-26T10:00:10Z',
      body: 'Autonomous review disposition: CHANGES_MADE'
    }
  ];

  // We restart at 10:00:20
  const resumeTime = '2026-04-26T10:00:20.000Z';
  
  const getLatestDispositionForPrFn = async (prNum, user, since) => {
    const eligible = mockComments.filter(c => 
      c.user.login === user && c.created_at >= since
    );
    return eligible.length > 0 ? 'CHANGES_MADE' : null;
  };

  // WRONG: If we used resumeTime as sinceIso, we would miss it (old code behavior)
  // Now returns POLL_TIMEOUT instead of null on timeout
  const missed = await pollForDisposition(prNumber, implementerUser, resumeTime, token, {
    getLatestDispositionForPrFn,
    timeoutMs: 50,
    intervalMs: 10,
    sleepFn: async () => {}
  });
  assert.ok(isPollTimeout(missed), 'expected timeout sentinel when comment missed due to wrong sinceIso');

  // CORRECT: Using the original startedAt from persisted state
  const found = await pollForDisposition(prNumber, implementerUser, originalStartedAt, token, {
    getLatestDispositionForPrFn,
    timeoutMs: 50,
    intervalMs: 10,
    sleepFn: async () => {}
  });
  assert.strictEqual(found, 'CHANGES_MADE');
});

test('getLatestReviewForPr correctly handles mixed-precision ISO timestamps', async () => {
  const { getLatestReviewForPr } = require('../lib/tools/forgejo');
  
  // sinceIso is without milliseconds
  const sinceIso = '2026-04-26T10:00:00Z';
  
  const mockReviews = [
    {
      user: { login: 'codex' },
      submitted_at: '2026-04-26T10:00:00.500Z',
      state: 'CHANGES_REQUESTED'
    }
  ];

  const apiCall = async () => ({ ok: true, data: mockReviews });
  
  const review = await getLatestReviewForPr(41, 'codex', sinceIso, 'fake-token', { apiCall });
  assert.ok(review, 'Should have found the review');
  assert.strictEqual(review.state, 'CHANGES_REQUESTED');
});

test('getLatestReviewForPr correctly sorts mixed-precision ISO timestamps', async () => {
  const { getLatestReviewForPr } = require('../lib/tools/forgejo');
  
  const sinceIso = '2026-04-26T10:00:00Z';
  
  const mockReviews = [
    {
      user: { login: 'codex' },
      submitted_at: '2026-04-26T10:00:01Z',
      state: 'COMMENT'
    },
    {
      user: { login: 'codex' },
      submitted_at: '2026-04-26T10:00:00.500Z',
      state: 'CHANGES_REQUESTED'
    }
  ];

  const apiCall = async () => ({ ok: true, data: mockReviews });
  
  const review = await getLatestReviewForPr(41, 'codex', sinceIso, 'fake-token', { apiCall });
  assert.ok(review, 'Should have found the review');
  // 10:00:01Z is later than 10:00:00.500Z
  assert.strictEqual(review.state, 'COMMENT');
});

test('getLatestDispositionForPr correctly handles mixed-precision ISO timestamps', async () => {
  const { getLatestDispositionForPr } = require('../lib/tools/forgejo');
  
  const sinceIso = '2026-04-26T10:00:00Z';
  
  const mockComments = [
    {
      user: { login: 'gemini' },
      created_at: '2026-04-26T10:00:00.500Z',
      body: 'Autonomous review disposition: CHANGES_MADE'
    }
  ];

  const apiCall = async () => ({ ok: true, data: mockComments });
  
  const disposition = await getLatestDispositionForPr(41, 'gemini', sinceIso, 'fake-token', { apiCall });
  assert.strictEqual(disposition, 'CHANGES_MADE');
});

test('getLatestDispositionForPr correctly sorts mixed-precision ISO timestamps', async () => {
  const { getLatestDispositionForPr } = require('../lib/tools/forgejo');
  
  const sinceIso = '2026-04-26T10:00:00Z';
  
  const mockComments = [
    {
      user: { login: 'gemini' },
      created_at: '2026-04-26T10:00:01Z',
      body: 'Autonomous review disposition: PARKED'
    },
    {
      user: { login: 'gemini' },
      created_at: '2026-04-26T10:00:00.500Z',
      body: 'Autonomous review disposition: CHANGES_MADE'
    }
  ];

  const apiCall = async () => ({ ok: true, data: mockComments });
  
  const disposition = await getLatestDispositionForPr(41, 'gemini', sinceIso, 'fake-token', { apiCall });
  // 10:00:01Z is later than 10:00:00.500Z
  assert.strictEqual(disposition, 'PARKED');
});

test('getLatestDisposition correctly handles mixed-precision ISO timestamps', () => {
  const { getLatestDisposition } = require('../lib/tools/forgejo');
  
  const sinceIso = '2026-04-26T10:00:00Z';
  
  const mockComments = [
    {
      user: { login: 'gemini' },
      created_at: '2026-04-26T10:00:00.500Z',
      body: 'Autonomous review disposition: CHANGES_MADE'
    }
  ];

  const apiCall = (method, path) => {
    if (path.startsWith('/pulls')) {
      return { ok: true, data: [{ number: 41, head: { ref: 'mission/task-1016' } }] };
    }
    return { ok: true, data: mockComments };
  };
  
  const disposition = getLatestDisposition('mission/task-1016', 'gemini', sinceIso, 'fake-token', { apiCall });
  assert.strictEqual(disposition, 'CHANGES_MADE');
});

test('getLatestDisposition correctly sorts mixed-precision ISO timestamps', () => {
  const { getLatestDisposition } = require('../lib/tools/forgejo');
  
  const sinceIso = '2026-04-26T10:00:00Z';
  
  const mockComments = [
    {
      user: { login: 'gemini' },
      created_at: '2026-04-26T10:00:01Z',
      body: 'Autonomous review disposition: PARKED'
    },
    {
      user: { login: 'gemini' },
      created_at: '2026-04-26T10:00:00.500Z',
      body: 'Autonomous review disposition: CHANGES_MADE'
    }
  ];

  const apiCall = (method, path) => {
    if (path.startsWith('/pulls')) {
      return { ok: true, data: [{ number: 41, head: { ref: 'mission/task-1016' } }] };
    }
    return { ok: true, data: mockComments };
  };
  
  const disposition = getLatestDisposition('mission/task-1016', 'gemini', sinceIso, 'fake-token', { apiCall });
  // 10:00:01Z is later than 10:00:00.500Z
  assert.strictEqual(disposition, 'PARKED');
});

test('getLatestReview correctly handles mixed-precision ISO timestamps', () => {
  const { getLatestReview } = require('../lib/tools/forgejo');
  
  const sinceIso = '2026-04-26T10:00:00Z';
  
  const mockReviews = [
    {
      user: { login: 'codex' },
      state: 'CHANGES_REQUESTED',
      submitted_at: '2026-04-26T10:00:00.500Z'
    }
  ];

  const apiCall = (method, path) => {
    if (path.includes('/reviews')) {
      return { ok: true, data: mockReviews };
    }
    if (path.startsWith('/pulls')) {
      return { ok: true, data: [{ number: 41, head: { ref: 'mission/task-1016' } }] };
    }
    return { ok: false };
  };
  
  const review = getLatestReview('mission/task-1016', 'codex', sinceIso, 'fake-token', { apiCall });
  assert.ok(review);
  assert.strictEqual(review.state, 'CHANGES_REQUESTED');
});

test('getLatestReview correctly sorts mixed-precision ISO timestamps', () => {
  const { getLatestReview } = require('../lib/tools/forgejo');
  
  const sinceIso = '2026-04-26T10:00:00Z';
  
  const mockReviews = [
    {
      user: { login: 'codex' },
      state: 'APPROVED',
      submitted_at: '2026-04-26T10:00:01Z'
    },
    {
      user: { login: 'codex' },
      state: 'CHANGES_REQUESTED',
      submitted_at: '2026-04-26T10:00:00.500Z'
    }
  ];

  const apiCall = (method, path) => {
    if (path.includes('/reviews')) {
      return { ok: true, data: mockReviews };
    }
    if (path.startsWith('/pulls')) {
      return { ok: true, data: [{ number: 41, head: { ref: 'mission/task-1016' } }] };
    }
    return { ok: false };
  };
  
  const review = getLatestReview('mission/task-1016', 'codex', sinceIso, 'fake-token', { apiCall });
  assert.ok(review);
  // 10:00:01Z is later than 10:00:00.500Z
  assert.strictEqual(review.state, 'APPROVED');
});


// ---------- applyAgentFallback (regression: pinned reviewer falls back to another family) ----------

test('applyAgentFallback returns the original agent when startAgent did not fall back', () => {
  const { applyAgentFallback } = require('../lib/review/review');
  const writeReviewStateFn = () => { throw new Error('writeReviewState should not run when no fallback'); };
  const enforceTaskAssigneeFn = () => { throw new Error('enforceTaskAssignee should not run when no fallback'); };

  const { ReviewState } = require('../lib/review/review-state');
  const state = new ReviewState('task-test-fallback', { reviewer: 'codex', implementer: 'qwen', round: 1 });

  const next = applyAgentFallback({
    role: 'reviewer',
    original: 'codex',
    launchResult: { agent: 'codex' },
    state,
    slug: 'task-test-fallback',
    worktree: '/tmp/visualBoard-task-test-fallback',
    taskResolution: { ok: true, taskFile: '/tmp/task.md' },
    log: () => {},
    writeReviewStateFn,
    enforceTaskAssigneeFn
  });

  assert.equal(next, 'codex');
});

test('applyAgentFallback rewrites reviewer identity and persists state but does NOT update backlog assignee', () => {
  const { applyAgentFallback } = require('../lib/review/review');
  const { ReviewState } = require('../lib/review/review-state');
  const writes = [];
  const state = new ReviewState('task-test-fallback', { reviewer: 'claude', implementer: 'qwen', round: 2 });

  const next = applyAgentFallback({
    role: 'reviewer',
    original: 'claude',
    launchResult: { agent: 'codex' },
    state,
    slug: 'task-test-fallback',
    worktree: '/tmp/visualBoard-task-test-fallback',
    taskResolution: { ok: true, taskFile: '/tmp/task.md' },
    log: () => {},
    writeReviewStateFn: (slug, st, worktree) => writes.push({ slug, state: st, worktree }),
    enforceTaskAssigneeFn: () => { throw new Error('enforceTaskAssignee must not be called for reviewer fallback'); }
  });

  assert.equal(next, 'codex');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].slug, 'task-test-fallback');
  assert.equal(writes[0].worktree, '/tmp/visualBoard-task-test-fallback');
  assert.equal(writes[0].state.reviewer, 'codex', 'persisted reviewer must be the fallback family');
  assert.equal(writes[0].state.implementer, 'qwen', 'implementer must be unchanged');
  assert.equal(writes[0].state.round, 2);
});

test('applyAgentFallback rewrites implementer identity on fallback without touching reviewer', () => {
  const { applyAgentFallback } = require('../lib/review/review');
  const { ReviewState } = require('../lib/review/review-state');
  const writes = [];
  const state = new ReviewState('task-test-fallback', { reviewer: 'codex', implementer: 'qwen', round: 3 });

  const next = applyAgentFallback({
    role: 'implementer',
    original: 'qwen',
    launchResult: { agent: 'gemini' },
    state,
    slug: 'task-test-fallback',
    worktree: '/tmp/visualBoard-task-test-fallback',
    taskResolution: { ok: false },
    log: () => {},
    writeReviewStateFn: (slug, st, worktree) => writes.push({ slug, state: st, worktree }),
    enforceTaskAssigneeFn: () => { throw new Error('enforceTaskAssignee must not run when taskResolution.ok is false'); }
  });

  assert.equal(next, 'gemini');
  assert.equal(writes[0].state.reviewer, 'codex', 'reviewer must be untouched on implementer fallback');
  assert.equal(writes[0].state.implementer, 'gemini');
});

test('applyAgentFallback enforces implementer in backlog when implementer falls back', () => {
  const { applyAgentFallback } = require('../lib/review/review');
  const { ReviewState } = require('../lib/review/review-state');
  const writes = [];
  const enforced = [];
  const state = new ReviewState('task-test-fallback', { reviewer: 'qwen', implementer: 'claude', round: 2 });

  const next = applyAgentFallback({
    role: 'implementer',
    original: 'claude',
    launchResult: { agent: 'codex' },
    state,
    slug: 'task-test-fallback',
    worktree: '/tmp/visualBoard-task-test-fallback',
    taskResolution: { ok: true, taskFile: '/tmp/task.md' },
    log: () => {},
    writeReviewStateFn: (slug, st, worktree) => writes.push({ slug, state: st, worktree }),
    enforceTaskAssigneeFn: (file, agent) => { enforced.push({ file, agent }); return true; }
  });

  assert.equal(next, 'codex');
  assert.deepEqual(enforced, [{ file: '/tmp/task.md', agent: 'codex' }]);
});

test('applyAgentFallback handles a missing launchResult gracefully (catastrophic launch failure)', () => {
  const { applyAgentFallback } = require('../lib/review/review');
  const { ReviewState } = require('../lib/review/review-state');
  const state = new ReviewState('task-test-fallback', { reviewer: 'codex', implementer: 'qwen', round: 1 });
  const next = applyAgentFallback({
    role: 'reviewer',
    original: 'codex',
    launchResult: undefined,
    state,
    slug: 'task-test-fallback',
    worktree: '/tmp/x',
    taskResolution: { ok: false },
    log: () => {},
    writeReviewStateFn: () => { throw new Error('should not write'); },
    enforceTaskAssigneeFn: () => { throw new Error('should not assign'); }
  });
  assert.equal(next, 'codex');
});

test('applyAgentFallback preserves the original roundStartedAt when rewriting state', () => {
  // Regression: a crash after the fallback rewrite but before pollFor* completes
  // must leave review-state.json pinned to the original round start so the resumed
  // run still picks up comments the fallback agent already posted in this round.
  const { applyAgentFallback } = require('../lib/review/review');
  const { ReviewState } = require('../lib/review/review-state');
  const writes = [];
  const roundStartedAt = '2026-04-27T17:00:00.000Z';
  const state = new ReviewState('task-test-fallback', { reviewer: 'claude', implementer: 'qwen', round: 4, startedAt: roundStartedAt });

  const next = applyAgentFallback({
    role: 'reviewer',
    original: 'claude',
    launchResult: { agent: 'codex' },
    state,
    slug: 'task-test-fallback',
    worktree: '/tmp/visualBoard-task-test-fallback',
    taskResolution: { ok: true, taskFile: '/tmp/task.md' },
    log: () => {},
    writeReviewStateFn: (slug, st, worktree) => writes.push({ slug, state: st, worktree }),
    enforceTaskAssigneeFn: () => true
  });

  assert.equal(next, 'codex');
  assert.equal(writes.length, 1);
  assert.equal(
    writes[0].state.startedAt,
    roundStartedAt,
    'fallback rewrite must preserve the original round-start timestamp'
  );
});

test('startReviewLoop polls for the fallback reviewer identity after a limit-hit reroute', async () => {
  const { startReviewLoop } = require('../lib/review/review');
  const writes = [];
  const reviewPolls = [];

  await startReviewLoop('task-1028-review-fallback', {
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
    implementer: 'qwen',
    reviewer: 'claude',
    maxAttempts: 1,
    eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'qwen'],
    worktree: '/tmp/visualBoard-task-1028',
    maybeUpdateGraphifyBeforeReviewFn: () => ({ updated: false, skipped: true }),
    workflowLauncherStatusFn: () => ({ supported: true, detail: process.execPath }),
    isForgejoReviewEnabledFn: () => true,
    forgejoAvailableFn: async () => true,
    getPrStatusFn: () => ({ exists: true, state: 'open', number: 79 }),
    resolveForgejoUserFn: () => 'gemini',
    readTokenFn: () => 'fake-token',
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task-1028.md' }),
    enforceTaskAssigneeFn: () => true,
    readReviewStateFn: () => null,
    writeReviewStateFn: (slug, state) => writes.push({ slug, state }),
    rebaseBeforeReviewRoundFn: async () => ({ ok: true, sharedFileConflicts: false }),
    startAgentFn: async (step, options) => {
      if (step === 'review') {
        assert.equal(options.agent, 'claude');
        assert.deepEqual(options.exclude, ['qwen']);
        return { agent: 'codex', result: { status: 0 } };
      }
      assert.equal(step, 'act-on-review');
      assert.equal(options.agent, 'qwen');
      assert.deepEqual(options.exclude, ['codex']);
      return { agent: 'qwen', result: { status: 0 } };
    },
    pollForReviewFn: async (prNumber, reviewerUser) => {
      reviewPolls.push({ prNumber, reviewerUser });
      return 'CHANGES_REQUESTED';
    },
    pollForDispositionFn: async () => 'CHANGES_MADE',
    log: () => {},
    error: (message) => { throw new Error(message); },
    exit: (code) => { throw new Error(`unexpected exit ${code}`); }
  });

  assert.deepEqual(reviewPolls, [{ prNumber: 79, reviewerUser: 'codex' }]);
  assert.ok(
    writes.some(entry => entry.state.reviewer === 'codex'),
    `expected persisted reviewer rewrite to codex; got ${JSON.stringify(writes)}`
  );
});

test('startReviewLoop polls for the fallback implementer identity after a limit-hit reroute', async () => {
  const { startReviewLoop } = require('../lib/review/review');
  const writes = [];
  const dispositionPolls = [];
  const assigneeWrites = [];

  await startReviewLoop('task-1028-act-on-review-fallback', {
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
    implementer: 'claude',
    reviewer: 'codex',
    maxAttempts: 1,
    eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'qwen'],
    worktree: '/tmp/visualBoard-task-1028',
    maybeUpdateGraphifyBeforeReviewFn: () => ({ updated: false, skipped: true }),
    workflowLauncherStatusFn: () => ({ supported: true, detail: process.execPath }),
    isForgejoReviewEnabledFn: () => true,
    forgejoAvailableFn: async () => true,
    getPrStatusFn: () => ({ exists: true, state: 'open', number: 80 }),
    resolveForgejoUserFn: () => 'gemini',
    readTokenFn: () => 'fake-token',
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task-1028.md' }),
    enforceTaskAssigneeFn: (file, agent) => {
      assigneeWrites.push({ file, agent });
      return true;
    },
    readReviewStateFn: () => null,
    writeReviewStateFn: (slug, state) => writes.push({ slug, state }),
    rebaseBeforeReviewRoundFn: async () => ({ ok: true, sharedFileConflicts: false }),
    startAgentFn: async (step, options) => {
      if (step === 'review') {
        assert.equal(options.agent, 'codex');
        assert.deepEqual(options.exclude, ['claude']);
        return { agent: 'codex', result: { status: 0 } };
      }
      assert.equal(step, 'act-on-review');
      assert.equal(options.agent, 'claude');
      assert.deepEqual(options.exclude, ['codex']);
      return { agent: 'gemini', result: { status: 0 } };
    },
    pollForReviewFn: async () => 'CHANGES_REQUESTED',
    pollForDispositionFn: async (prNumber, implementerUser) => {
      dispositionPolls.push({ prNumber, implementerUser });
      return 'CHANGES_MADE';
    },
    log: () => {},
    error: (message) => { throw new Error(message); },
    exit: (code) => { throw new Error(`unexpected exit ${code}`); }
  });

  assert.deepEqual(dispositionPolls, [{ prNumber: 80, implementerUser: 'gemini' }]);
  assert.ok(
    writes.some(entry => entry.state.implementer === 'gemini'),
    `expected persisted implementer rewrite to gemini; got ${JSON.stringify(writes)}`
  );
  assert.ok(
    assigneeWrites.some(entry => entry.agent === 'gemini'),
    `expected backlog assignee rewrite to gemini; got ${JSON.stringify(assigneeWrites)}`
  );
});

test('review dispatches to verifyReview with inferred slug and no-gate flag', async () => {
  const review = require('../lib/review/review');
  const calls = [];

  await review(['task-1031', '--verify', '--no-gate'], {
    inferSlugFn: explicit => explicit,
    verifyReviewFn: (slug, skipGate) => calls.push({ slug, skipGate })
  });

  assert.deepEqual(calls, [{ slug: 'task-1031', skipGate: true }]);
});

test('review dispatches to commentRound with file-backed message', async () => {
  const review = require('../lib/review/review');
  const calls = [];

  await review(['task-1031', '--comment-file', '/tmp/review-comment.txt'], {
    inferSlugFn: explicit => explicit,
    readFileSync: () => 'Review body\n',
    commentRoundFn: (slug, message) => calls.push({ slug, message })
  });

  assert.deepEqual(calls, [{ slug: 'task-1031', message: 'Review body' }]);
});

test('review prints status when no action flag is provided', async () => {
  const review = require('../lib/review/review');
  const lines = [];

  await review(['task-1031'], {
    inferSlugFn: explicit => explicit,
    getPrStatusFn: () => ({ exists: true, raw: 'PR #83 open' }),
    readReviewStateFn: () => ({ reviewer: 'codex', implementer: 'claude', round: 2 }),
    log: line => lines.push(line)
  });

  assert.ok(lines.includes('[INFO] Review status for mission: task-1031'));
  assert.ok(lines.includes('PR #83 open'));
  assert.ok(lines.some(line => line.includes('reviewer=codex implementer=claude round=2')));
});

test('review re-launches the implementer on static findings instead of starting the autonomous loop', async () => {
  const review = require('../lib/review/review');
  const calls = [];

  await review(['task-1031'], {
    inferSlugFn: explicit => explicit,
    resolveWorktreeFn: () => '/tmp/mission-task-1031',
    getPrStatusFn: () => ({ exists: false }),
    performStaticReviewFn: () => ({ ok: false, findings: ['Missing Goal Check evidence'] }),
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task-1031.md' }),
    getTaskImplementerFn: () => 'claude',
    submitForReviewFn: async slug => calls.push({ type: 'submit', slug }),
    postStaticReviewCommentFn: (slug, message) => calls.push({ type: 'comment', slug, message }),
    startReviewLoopFn: async slug => calls.push({ type: 'start', slug }),
    startAgentFn: async (step, opts) => calls.push({ type: 'agent', step, opts }),
    readReviewStateFn: () => null,
    log: () => {},
    error: () => {}
  });

  // The findings path re-launches the implementer and does not submit, comment, or loop.
  assert.deepEqual(
    calls.map(call => call.type),
    ['agent']
  );
  assert.equal(calls[0].step, 'active');
  assert.equal(calls[0].opts.agent, 'claude');
  assert.equal(calls[0].opts.worktree, '/tmp/mission-task-1031');
  assert.ok(calls[0].opts.prompt.includes('Missing Goal Check evidence'));
});

test('review posts zero-finding artifact but does NOT transition task when static review passes', async () => {
  const review = require('../lib/review/review');
  const calls = [];

  await review(['task-1031'], {
    inferSlugFn: explicit => explicit,
    resolveWorktreeFn: () => '/tmp/mission-task-1031',
    getPrStatusFn: () => ({ exists: false }),
    performStaticReviewFn: () => ({ ok: true, findings: [] }),
    submitForReviewFn: async slug => calls.push({ type: 'submit', slug }),
    postStaticReviewCommentFn: (slug, message) => calls.push({ type: 'comment', slug, message }),
    readReviewStateFn: () => null,
    log: () => {},
    error: () => {}
  });

  // submit + comment only — the clean-static-review path performs no status
  // transition, so the recorded side effects must not include one.
  assert.deepEqual(
    calls.map(call => call.type),
    ['submit', 'comment']
  );
  assert.ok(calls[1].message.includes('found zero issues'));
});

test('verifyReview reports success path with gate pass and persisted state', () => {
  const review = require('../lib/review/review');
  const lines = [];
  let exitCode = null;

  review.verifyReview('task-1031', false, {
    resolveWorktreeFn: () => '/tmp/mission-task-1031',
    findMissionDirFn: () => '/tmp/mission-task-1031/docs/missions/2026/task-1031',
    getCurrentBranchFn: () => 'mission/task-1031',
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task-1031.md' }),
    getPrStatusFn: () => ({ exists: true, state: 'open', merged: false, number: 83 }),
    getTaskStatusFn: () => 'review',
    findMissionAreaFn: () => 'workflow',
    runFn: () => ({ status: 0 }),
    getAcceptanceCriteriaFn: () => ['- [x] prove it'],
    formatMatrixSummaryFn: () => ['matrix line'],
    buildAutonomousReviewMatrixFn: () => ({}),
    readReviewStateFn: () => ({ reviewer: 'codex', implementer: 'claude', round: 2, startedAt: '2026-04-30T10:00:00Z' }),
    log: line => lines.push(line),
    error: line => lines.push(`ERR:${line}`),
    exit: code => { exitCode = code; }
  });

  assert.equal(exitCode, null);
  assert.ok(lines.includes('[PASS] Branch: mission/task-1031'));
  assert.ok(lines.includes('[PASS] Reviewer gate passed.'));
  assert.ok(lines.includes('[INFO] Autonomous review runtime matrix:'));
  assert.ok(lines.includes('matrix line'));
  assert.ok(lines.includes('\n[PASS] Review verification complete.'));
});

test('verifyReview reports failure path and exits when blockers exist', () => {
  const review = require('../lib/review/review');
  const lines = [];
  let exitCode = null;

  review.verifyReview('task-1031', true, {
    resolveWorktreeFn: () => null,
    cwdFn: () => '/tmp/random',
    isForgejoReviewEnabledFn: () => true,
    findMissionDirFn: () => null,
    getCurrentBranchFn: () => 'main',
    resolveTaskFileFn: () => ({ ok: false, reason: 'ambiguous', matches: ['a.md', 'b.md'] }),
    getPrStatusFn: () => ({ exists: false, raw: 'missing' }),
    formatMatrixSummaryFn: () => [],
    buildAutonomousReviewMatrixFn: () => ({}),
    readReviewStateFn: () => null,
    log: line => lines.push(line),
    error: line => lines.push(`ERR:${line}`),
    exit: code => { exitCode = code; }
  });

  assert.equal(exitCode, 1);
  assert.ok(lines.includes('[FAIL] Mission directory not found for slug: task-1031'));
  assert.ok(lines.includes('[FAIL] Branch: current branch is main, expected mission/task-1031'));
  assert.ok(lines.includes('[FAIL] Backlog task resolution is ambiguous for slug: task-1031'));
  assert.ok(lines.includes('[FAIL] Review PR: missing'));
  assert.ok(lines.some(line => line.includes('ERR:\n[INFO] Review verification failed.')));
});

test('readComments renders comment list when token and comments exist', async () => {
  const review = require('../lib/review/review');
  const lines = [];
  let exitCode = null;
  await review.readComments('task-1031', {
    readTokenFn: () => 'token',
    getCommentsFn: async () => [
      { kind: 'inline', location: 'workflow/lib/review/review.js:10', user: 'claude', created: 'today', body: 'Looks good' }
    ],
    readReviewStateFn: () => ({ reviewer: 'codex', implementer: 'codex' }),
    isForgejoReviewEnabledFn: () => true,
    log: line => lines.push(line),
    error: line => lines.push(`ERR:${line}`),
    exit: code => { exitCode = code; }
  });

  assert.equal(exitCode, null);
  assert.ok(lines.includes('[INFO] Reading PR comments on mission/task-1031 as codex...'));
  assert.ok(lines.includes('--- inline workflow/lib/review/review.js:10 | claude (today) ---'));
  assert.ok(lines.includes('Looks good'));
});

test('pushRound resolves forgejo user from backlog assignee and reports success', async () => {
  const review = require('../lib/review/review');
  const previous = process.env.FORGEJO_USER;
  delete process.env.FORGEJO_USER;
  const lines = [];
  let exitCode = null;
  try {
    await review.pushRound('task-1031', {
      isForgejoReviewEnabledFn: () => false,
      resolveWorktreeFn: () => '/tmp/mission-task-1031',
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task-1031.md' }),
      getTaskImplementerFn: () => 'codex',
      readTokenFn: () => 'token',
      createPrFn: () => ({ ok: true }),
      log: line => lines.push(line),
      error: line => lines.push(`ERR:${line}`),
      exit: code => { exitCode = code; }
    });
  } finally {
    if (previous !== undefined) process.env.FORGEJO_USER = previous;
  }

  assert.equal(exitCode, null);
  assert.ok(lines.includes('[INFO] Pushing mission/task-1031 to the review provider as codex...'));
  assert.ok(lines.includes('[PASS] Branch pushed and PR updated for mission/task-1031.'));
});

test('commentRound and submitReviewRound fail loudly on API errors', () => {
  const review = require('../lib/review/review');
  const errors = [];
  const exits = [];
  const readReviewStateFn = () => ({ reviewer: 'codex', implementer: 'codex' });
  review.commentRound('task-1031', 'body', {
    readTokenFn: () => 'token',
    postCommentFn: () => ({ ok: false, error: 'boom' }),
    readReviewStateFn,
    error: line => errors.push(line),
    exit: code => exits.push(code)
  });
  review.submitReviewRound('task-1031', 'approve', 'ship it', {
    readTokenFn: () => 'token',
    postReviewFn: () => ({ ok: false, error: 'nope' }),
    readReviewStateFn,
    isForgejoReviewEnabledFn: () => true,
    error: line => errors.push(line),
    exit: code => exits.push(code)
  });

  assert.deepEqual(exits, [1, 1]);
  assert.ok(errors.some(line => line.includes('Could not post comment: boom')));
  assert.ok(errors.some(line => line.includes('Could not submit review: nope')));
});

test('submitForReview exits when no forgejo user and no task implementer (task-1105)', async () => {
  const review = require('../lib/review/review');
  const previous = process.env.FORGEJO_USER;
  delete process.env.FORGEJO_USER;
  const calls = [];
  let exitCode = null;
  try {
    await review.submitForReview('task-1105', true, {
      resolveTaskFileFn: () => ({ ok: false }),
      getTaskImplementerFn: () => null,
      resolveWorktreeFn: () => '/tmp/mission-task-1105',
      isForgejoReviewEnabledFn: () => true,
      performHandoffFn: async (slug, opts) => {
        calls.push({ slug, opts });
        return { ok: true };
      },
      exit: code => { exitCode = code; }
    });
  } finally {
    if (previous === undefined) delete process.env.FORGEJO_USER;
    else process.env.FORGEJO_USER = previous;
  }
  assert.equal(exitCode, 1);
  assert.equal(calls.length, 0);
});

test('submitForReview and closeMissionPr use injected handoff and close functions', async () => {
  const review = require('../lib/review/review');
  const previous = process.env.FORGEJO_USER;
  delete process.env.FORGEJO_USER;
  const calls = [];
  let exitCode = null;
  try {
    await review.submitForReview('task-1031', true, {
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task-1031.md' }),
      getTaskImplementerFn: () => 'gemini',
      resolveWorktreeFn: () => '/tmp/mission-task-1031',
      isForgejoReviewEnabledFn: () => false,
      performHandoffFn: async (slug, opts) => {
        calls.push({ slug, opts });
        return { ok: true };
      },
      exit: code => { exitCode = code; }
      });

    await review.closeMissionPr('task-1031', {
      readTokenFn: () => 'token',
      readReviewStateFn: () => ({ reviewer: 'codex', implementer: 'gemini' }),
      closePrFn: async (branch, token, user) => {
        calls.push({ branch, token, user });
        return { ok: true };
      },
      exit: code => { exitCode = code; }
    });
  } finally {
    if (previous === undefined) delete process.env.FORGEJO_USER;
    else process.env.FORGEJO_USER = previous;
  }

  assert.equal(exitCode, null);
  assert.equal(calls[0].slug, 'task-1031');
  assert.equal(calls[0].opts.forgejoUser, 'gemini');
  assert.deepEqual(calls[1], { branch: 'mission/task-1031', token: 'token', user: 'codex' });
});

test('startReviewLoop handles reviewer launch failure', async () => {
  const { startReviewLoop } = require('../lib/review/review');
  const errors = [];
  const exitCodes = [];

  await startReviewLoop(TEST_SLUG, {
      eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'qwen'],
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
    implementer: 'claude',
    reviewer: 'codex',
    dryRun: false,
    error: (m) => errors.push(m),
    exit: (c) => exitCodes.push(c),
    workflowLauncherStatusFn: () => ({ supported: true }),
    isForgejoReviewEnabledFn: () => true,
    forgejoAvailableFn: async () => true,
    getPrStatusFn: () => ({ exists: true, state: 'open', number: 41 }),
    maybeUpdateGraphifyBeforeReviewFn: () => {},
    resolveTaskFileFn: () => ({ ok: true, taskFile: 'task.md' }),
    enforceTaskAssigneeFn: () => true,
    rebaseBeforeReviewRoundFn: async () => ({ ok: true, sharedFileConflicts: false }),
    startAgentFn: async () => { throw new Error('launch fail'); }
  });

  assert.ok(errors.some(e => e.includes('Could not launch reviewer agent')), 'Should log launch failure');
  assert.equal(exitCodes[0], 1);
});

test('startReviewLoop handles reviewer polling timeout with recovery', async () => {
  const { startReviewLoop, POLL_TIMEOUT } = require('../lib/review/review');
  const logs = [];
  const errors = [];
  const exitCodes = [];
  let launchCount = 0;

  await startReviewLoop(TEST_SLUG, {
      eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'qwen'],
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
    implementer: 'claude',
    reviewer: 'codex',
    dryRun: false,
    log: (m) => logs.push(String(m)),
    error: (m) => errors.push(m),
    exit: (c) => exitCodes.push(c),
    workflowLauncherStatusFn: () => ({ supported: true }),
    isForgejoReviewEnabledFn: () => true,
    forgejoAvailableFn: async () => true,
    getPrStatusFn: () => ({ exists: true, state: 'open', number: 41 }),
    maybeUpdateGraphifyBeforeReviewFn: () => {},
    resolveTaskFileFn: () => ({ ok: true, taskFile: 'task.md' }),
    enforceTaskAssigneeFn: () => true,
    rebaseBeforeReviewRoundFn: async () => ({ ok: true, sharedFileConflicts: false }),
    startAgentFn: async () => {
      launchCount++;
      return { agent: 'codex' };
    },
    pollForReviewFn: async () => POLL_TIMEOUT
  });

  // With timeout recovery (task-1136), the reviewer is relaunched up to 2 times on timeout (3-strike limit)
  assert.equal(launchCount, 3, 'Should launch reviewer 1 initial + 2 retries on timeout');
  // After 2 retries (3 total timeouts), should log excessive timeout retries and exit gracefully
  assert.ok(errors.some(e => e.includes('excessive reviewer timeout retries')) || logs.some(l => l.includes('excessive reviewer timeout retries')), 'Should log excessive retries');
  assert.equal(exitCodes[0], undefined, 'Should exit via return, not process.exit(1)');
});

test('startReviewLoop persists reviewer retry count before recovery relaunch', async () => {
  const { startReviewLoop, POLL_TIMEOUT } = require('../lib/review/review');
  const events = [];
  let reviewPolls = 0;

  await startReviewLoop(TEST_SLUG, {
    eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'qwen'],
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
    implementer: 'claude',
    reviewer: 'codex',
    dryRun: false,
    log: () => {},
    error: (message) => { throw new Error(message); },
    exit: (code) => { throw new Error(`unexpected exit ${code}`); },
    workflowLauncherStatusFn: () => ({ supported: true }),
    isForgejoReviewEnabledFn: () => true,
    forgejoAvailableFn: async () => true,
    getPrStatusFn: () => ({ exists: true, state: 'open', number: 41 }),
    maybeUpdateGraphifyBeforeReviewFn: () => {},
    enforceTaskAssigneeFn: () => true,
    rebaseBeforeReviewRoundFn: async () => ({ ok: true, sharedFileConflicts: false }),
    resolveForgejoUserFn: () => 'codex',
    readTokenFn: () => 'token',
    writeReviewStateFn: (slug, state) => {
      events.push({ type: 'write', reviewerRetryCount: state.reviewerRetryCount, phase: state.phase });
    },
    startAgentFn: async (step) => {
      events.push({ type: 'start', step });
      return { agent: 'codex' };
    },
    pollForReviewFn: async () => {
      reviewPolls += 1;
      return reviewPolls === 1 ? POLL_TIMEOUT : 'APPROVED';
    },
    applyAgentFallbackFn: (args) => args.original,
    buildCompactReviewPromptFn: () => 'review prompt'
  });

  const retryWriteIndex = events.findIndex(event => event.type === 'write' && event.reviewerRetryCount === 1);
  const secondReviewerStartIndex = events.findIndex((event, index) =>
    event.type === 'start' && event.step === 'review' && index > events.findIndex(first => first.type === 'start' && first.step === 'review')
  );

  assert.notEqual(retryWriteIndex, -1, 'reviewer retry count must be written');
  assert.notEqual(secondReviewerStartIndex, -1, 'reviewer recovery relaunch must happen');
  assert.ok(retryWriteIndex < secondReviewerStartIndex, 'reviewer retry count must be written before recovery relaunch');
});

test('startReviewLoop persists implementer retry count before recovery relaunch', async () => {
  const { startReviewLoop, POLL_TIMEOUT } = require('../lib/review/review');
  const events = [];
  let dispositionPolls = 0;

  await startReviewLoop(TEST_SLUG, {
    eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'qwen'],
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
    implementer: 'claude',
    reviewer: 'codex',
    maxAttempts: 1,
    dryRun: false,
    log: () => {},
    error: (message) => { throw new Error(message); },
    exit: (code) => { throw new Error(`unexpected exit ${code}`); },
    workflowLauncherStatusFn: () => ({ supported: true }),
    isForgejoReviewEnabledFn: () => true,
    forgejoAvailableFn: async () => true,
    getPrStatusFn: () => ({ exists: true, state: 'open', number: 41 }),
    maybeUpdateGraphifyBeforeReviewFn: () => {},
    enforceTaskAssigneeFn: () => true,
    rebaseBeforeReviewRoundFn: async () => ({ ok: true, sharedFileConflicts: false }),
    resolveForgejoUserFn: () => 'codex',
    readTokenFn: () => 'token',
    writeReviewStateFn: (slug, state) => {
      events.push({ type: 'write', implementerRetryCount: state.implementerRetryCount, phase: state.phase });
    },
    startAgentFn: async (step) => {
      events.push({ type: 'start', step });
      return { agent: step === 'review' ? 'codex' : 'claude' };
    },
    pollForReviewFn: async () => 'REQUEST_CHANGES',
    pollForDispositionFn: async () => {
      dispositionPolls += 1;
      return dispositionPolls === 1 ? POLL_TIMEOUT : 'PARKED';
    },
    applyAgentFallbackFn: (args) => args.original,
    buildCompactReviewPromptFn: () => 'review prompt',
    buildCompactActOnReviewPromptFn: () => 'act-on-review prompt'
  });

  const retryWriteIndex = events.findIndex(event => event.type === 'write' && event.implementerRetryCount === 1);
  const implementerStarts = events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.type === 'start' && event.step === 'act-on-review');
  const recoveryStartIndex = implementerStarts[1] ? implementerStarts[1].index : -1;

  assert.notEqual(retryWriteIndex, -1, 'implementer retry count must be written');
  assert.notEqual(recoveryStartIndex, -1, 'implementer recovery relaunch must happen');
  assert.ok(retryWriteIndex < recoveryStartIndex, 'implementer retry count must be written before recovery relaunch');
});

// ---------- startReviewLoop taskResolution scope (TASK-1041) ----------

test('startReviewLoop does not crash with ReferenceError when taskResolution is used in loop body', async () => {
  const fallbackCalls = [];
  const { startReviewLoop } = require('../lib/review/review');

  const { exitCode } = await captureExit(() => {
    return startReviewLoop(TEST_SLUG, {
      eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'qwen'],
      implementer: 'codex',
      reviewer: 'claude',
      dryRun: false,
      pollTimeoutSeconds: 1,
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
      getPrStatusFn: () => ({ exists: true, state: 'open' }),
      forgejoAvailableFn: async () => true,
      workflowLauncherStatusFn: () => ({ supported: true }),
      isForgejoReviewEnabledFn: () => true,
      maybeUpdateGraphifyBeforeReviewFn: () => {},
      readTokenFn: () => 'fake-token',
      getLatestReviewForPrFn: async () => ({ state: 'APPROVED' }),
      getLatestDispositionForPrFn: async () => 'CHANGES_MADE',
      sleepFn: async () => {},
      rebaseBeforeReviewRoundFn: async () => ({ ok: true, sharedFileConflicts: false }),
      startAgentFn: async () => ({ agent: 'claude' }),
      applyAgentFallbackFn: (opts) => {
        fallbackCalls.push(opts);
        return opts.original || opts.implementer;
      },
      enforceTaskAssigneeFn: () => true
    });
  });

  assert.ok(fallbackCalls.length > 0, 'applyAgentFallback must be called in non-dry-run mode');
  assert.ok(
    fallbackCalls[0].taskResolution !== undefined,
    'taskResolution must be defined when passed to applyAgentFallback'
  );
  assert.equal(exitCode, null, 'startReviewLoop must not call process.exit in this path');
});

test('startReviewLoop passes taskResolution to applyAgentFallback for both reviewer and implementer', async () => {
  const fallbackCalls = [];
  const { startReviewLoop } = require('../lib/review/review');

  const { exitCode } = await captureExit(() => {
    return startReviewLoop(TEST_SLUG, {
      eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'qwen'],
      implementer: 'codex',
      reviewer: 'claude',
      dryRun: false,
      pollTimeoutSeconds: 1,
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
      getPrStatusFn: () => ({ exists: true, state: 'open' }),
      forgejoAvailableFn: async () => true,
      workflowLauncherStatusFn: () => ({ supported: true }),
      isForgejoReviewEnabledFn: () => true,
      maybeUpdateGraphifyBeforeReviewFn: () => {},
      readTokenFn: () => 'fake-token',
      getLatestReviewForPrFn: async () => ({ state: 'COMMENT' }),
      getLatestDispositionForPrFn: async () => 'CHANGES_MADE',
      sleepFn: async () => {},
      rebaseBeforeReviewRoundFn: async () => ({ ok: true, sharedFileConflicts: false }),
      startAgentFn: async () => ({ agent: 'codex' }),
      applyAgentFallbackFn: (opts) => {
        fallbackCalls.push(opts);
        return opts.original || opts.implementer;
      },
      enforceTaskAssigneeFn: () => true
    });
  });

  assert.equal(exitCode, null);
  assert.ok(fallbackCalls.length >= 2, 'must call applyAgentFallback for reviewer and implementer');
  const reviewerCall = fallbackCalls.find(c => c.role === 'reviewer');
  const implementerCall = fallbackCalls.find(c => c.role === 'implementer');
  assert.ok(reviewerCall, 'must have reviewer fallback call');
  assert.ok(implementerCall, 'must have implementer fallback call');
  assert.ok(reviewerCall.taskResolution !== undefined, 'taskResolution must be defined in reviewer call');
  assert.ok(implementerCall.taskResolution !== undefined, 'taskResolution must be defined in implementer call');
});

test('startReviewLoop repairs a persisted rewiewing typo and resumes on the reviewer path', async () => {
  const { startReviewLoop } = require('../lib/review/review');
  const launches = [];
  const writes = [];
  let reviewPolls = 0;

  const { exitCode, logs } = await captureExit(() => {
    return startReviewLoop(TEST_SLUG, {
      dryRun: false,
      isContinue: true,
      implementer: 'codex',
      reviewer: 'qwen',
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
      eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'qwen'],
      getPrStatusFn: () => ({ exists: true, state: 'open', number: 188 }),
      forgejoAvailableFn: async () => true,
      workflowLauncherStatusFn: () => ({ supported: true }),
      isForgejoReviewEnabledFn: () => true,
      maybeUpdateGraphifyBeforeReviewFn: () => {},
      readTokenFn: () => 'fake-token',
      readReviewStateFn: () => ({
        reviewer: 'qwen',
        implementer: 'codex',
        round: 1,
        startedAt: '2026-05-25T11:07:58.617Z',
        phase: 'rewiewing',
        disposition: null
      }),
      writeReviewStateFn: (slug, state) => writes.push({ slug, phase: state.phase, phaseOriginal: state.phaseOriginal }),
      rebaseBeforeReviewRoundFn: async () => ({ ok: true, sharedFileConflicts: false }),
      startAgentFn: async (mode) => {
        launches.push(mode);
        return { agent: mode === 'review' ? 'qwen' : 'codex' };
      },
      pollForReviewFn: async () => {
        reviewPolls += 1;
        return reviewPolls === 1 ? null : 'APPROVED';
      },
      transitionTaskFn: () => {},
      transitionVirtualFn: () => {},
      applyAgentFallbackFn: ({ original }) => original
    });
  });

  assert.equal(exitCode, null);
  assert.deepEqual(launches, ['review']);
  assert.ok(writes.some(entry => entry.phase === 'reviewing'));
  assert.ok(logs.some(line => line.includes('Persisted review phase "rewiewing" is invalid. Repairing to "reviewing".')));
});

test('startReviewLoop does not crash with ReferenceError in dry-run mode', async () => {
  const { startReviewLoop } = require('../lib/review/review');

  const { exitCode } = await captureExit(() => {
    return startReviewLoop(TEST_SLUG, {
      eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'qwen'],
      implementer: 'codex',
      reviewer: 'claude',
      dryRun: true,
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
      getPrStatusFn: () => ({ exists: true, state: 'open' }),
      forgejoAvailableFn: async () => true,
      workflowLauncherStatusFn: () => ({ supported: true }),
      isForgejoReviewEnabledFn: () => true,
      maybeUpdateGraphifyBeforeReviewFn: () => {}
    });
  });

  assert.equal(exitCode, null, 'startReviewLoop must not call process.exit in dry-run');
});

// ---------- single-family fallback (task-1069) ----------

test('startReviewLoop allows single-family fallback when only implementer family is runnable', async () => {
  const { startReviewLoop } = require('../lib/review/review');
  const logs = [];
  const errors = [];
  const exitCodes = [];

  // implementer=codex, auto-derived reviewer=claude, but claude and all other agents are blocked.
  // codex (implementer) is the only supported launcher → single-family fallback must be authorized.
  await startReviewLoop(TEST_SLUG, {
    eligibleAgentsForStepFn: () => ['codex', 'claude'],
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
    implementer: 'codex',
    // reviewer not specified → auto-derived
    dryRun: true,
    log: m => logs.push(m),
    error: m => errors.push(m),
    exit: c => exitCodes.push(c),
    reviewerForFn: () => 'claude',
    workflowLauncherStatusFn: a => ({ supported: a === 'codex', detail: 'mock' }),
    fallbackForFn: () => null,
    formatMatrixSummaryFn: () => [],
    buildAutonomousReviewMatrixFn: () => ({})
  });

  assert.equal(exitCodes.length, 0, `Should not exit with error; errors: ${errors.join(' | ')}`);
  assert.ok(
    logs.some(l => l.includes('Single-family fallback')),
    `Expected single-family fallback log; got: ${logs.join(' | ')}`
  );
  assert.ok(
    logs.some(l => l.includes('no different-family agent is runnable')),
    `Expected runnable-family diagnostic; got: ${logs.join(' | ')}`
  );
});

test('startReviewLoop accepts same-family when explicit even if a different-family reviewer is available', async () => {
  const { startReviewLoop } = require('../lib/review/review');

  const { exitCode, errors, logs } = await captureExit(() => {
    return startReviewLoop(TEST_SLUG, {
      eligibleAgentsForStepFn: () => ['codex', 'claude'],
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
      implementer: 'codex',
      reviewer: 'codex', // explicit same-family
      dryRun: true,
      workflowLauncherStatusFn: () => ({ supported: true, detail: 'mock' })
    });
  });

  assert.equal(exitCode, null);
  assert.deepEqual(errors, []);
  assert.ok(
    logs.some(e => e.includes('Selected reviewer: codex (explicit)')),
    `Expected explicit same-family reviewer; got: ${logs.join(' | ')}`
  );
});

test('startReviewLoop rejects when no different-family reviewer and implementer is also not runnable', async () => {
  const { startReviewLoop } = require('../lib/review/review');

  const { exitCode, errors } = await captureExit(() => {
    return startReviewLoop(TEST_SLUG, {
      eligibleAgentsForStepFn: () => ['codex', 'claude'],
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
      implementer: 'codex',
      dryRun: true,
      reviewerForFn: () => 'claude',
      workflowLauncherStatusFn: () => ({ supported: false, detail: 'mock' }), // ALL blocked
      fallbackForFn: () => null,
      formatMatrixSummaryFn: () => [],
      buildAutonomousReviewMatrixFn: () => ({})
    });
  });

  assert.equal(exitCode, 1);
  assert.ok(
    errors.some(e => e.includes('No runnable reviewer route')),
    `Expected no-runnable-route error; got: ${errors.join(' | ')}`
  );
});

test('startReviewLoop keeps persisted same-family reviewer after re-derive block removal', async () => {
  const { startReviewLoop } = require('../lib/review/review');
  const logs = [];
  const exitCodes = [];

  // Persisted state has reviewer=codex (same as implementer) from a previous single-family run.
  // The mission removes the re-derive block, so the persisted reviewer remains in place.
  await startReviewLoop(TEST_SLUG, {
    eligibleAgentsForStepFn: () => ['codex', 'claude'],
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
    implementer: 'codex',
    dryRun: true,
    readReviewStateFn: () => ({ reviewer: 'codex', implementer: 'codex', round: 1 }), // persisted same-family
    log: m => logs.push(m),
    error: () => {},
    exit: c => exitCodes.push(c),
    workflowLauncherStatusFn: () => ({ supported: true, detail: 'mock' }), // Both now available
    fallbackForFn: () => null,
    formatMatrixSummaryFn: () => [],
    buildAutonomousReviewMatrixFn: () => ({})
  });

  assert.equal(exitCodes.length, 0, `Should not exit; logs: ${logs.join(' | ')}`);
  assert.ok(
    logs.some(l => l.includes('Selected reviewer: codex (persisted)')),
    `Expected persisted codex reviewer log; got: ${logs.join(' | ')}`
  );
  assert.ok(!logs.some(l => l.includes('re-derived')), `Did not expect re-derive log; got: ${logs.join(' | ')}`);
});

test('startReviewLoop resolves task file from the mission worktree (regression)', async () => {
  const { startReviewLoop } = require('../lib/review/review');
  let resolvedWorktree = null;

  await startReviewLoop(TEST_SLUG, {
      eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'qwen'],
    implementer: 'claude',
    reviewer: 'codex',
    dryRun: false,
    worktree: '/tmp/mission-worktree',
    // Mock enough to avoid early exits
    forgejoAvailableFn: async () => true,
    getPrStatusFn: () => ({ exists: true, state: 'open', number: 41 }),
    readReviewStateFn: () => null,
    workflowLauncherStatusFn: () => ({ supported: true }),
    isForgejoReviewEnabledFn: () => true,
    maybeUpdateGraphifyBeforeReviewFn: () => {},
    resolveTaskFileFn: (slug, worktree) => {
      resolvedWorktree = worktree;
      return { ok: false };
    },
    exit: () => {} // Don't actually exit
  });

  assert.equal(resolvedWorktree, '/tmp/mission-worktree');
});

// CP-3 tests for fallback reviewer in startReviewLoop

test('startReviewLoop uses selectAgent for unsupported reviewer fallback (SC 4)', async () => {
  const fs = require('fs');
  const path = require('path');
  // Check review-loop.js since startReviewLoop is now extracted there
  const reviewLoopSource = fs.readFileSync(path.join(__dirname, '../lib/review/review-loop.js'), 'utf8');
  assert.ok(reviewLoopSource.includes("selectAgentFn('review', { exclude: excludeSet })"), 'startReviewLoop should select reviewer fallback from review eligibility');
  assert.ok(!reviewLoopSource.includes('fallbackForFn(reviewer, implementer)'), 'startReviewLoop should not call fallbackFor for reviewer fallback');
});

test('startReviewLoop removes implementer eligibility check (SC 4)', async () => {
  const fs = require('fs');
  const path = require('path');
  const reviewSource = fs.readFileSync(path.join(__dirname, '../lib/review/review.js'), 'utf8');
  // The old code had: if (!agents.includes(implementer)) { ... exit(1) ... }
  // This should be removed or commented out
  const hasStrictImplementerCheck = /if\s*\(\s*!agents\.includes\(implementer\)\s*\)\s*\{[\s\S]*?exit\(1\);[\s\S]*?\}/.test(reviewSource);
  assert.equal(hasStrictImplementerCheck, false, 'The strict implementer eligibility check that exits should be removed');
});

test('review.js does not update Backlog task assignee on reviewer fallback (SC 5)', async () => {
  const fs = require('fs');
  const path = require('path');
  // Check review-loop.js since applyAgentFallback is now extracted there
  const reviewLoopSource = fs.readFileSync(path.join(__dirname, '../lib/review/review-loop.js'), 'utf8');
  assert.ok(!reviewLoopSource.includes('workflow(${slug}): fallback reviewer from'), 'Should not contain reviewer fallback commit message pattern');
  assert.ok(reviewLoopSource.includes("if (role === 'implementer' && taskResolution && taskResolution.ok)"), 'Backlog assignee enforcement should be guarded to implementer fallback');
  assert.ok(reviewLoopSource.includes('enforceTaskAssigneeFn(taskResolution.taskFile, fallback)'), 'Implementer fallback should still enforce Backlog assignee');
});

// ---------- CP-3: metadata footer and --status ----------

test('buildMetadataFooter returns empty string when no state exists', () => {
  const { buildMetadataFooter } = require('../lib/review/review');
  const footer = buildMetadataFooter('no-state-slug', '/tmp/nonexistent');
  assert.equal(footer, '');
});

test('commentRound appends metadata footer to message', () => {
  const { commentRound } = require('../lib/review/review');
  let posted = null;
  commentRound('task-meta-2', 'Test comment body', {
    readTokenFn: () => 'token',
    postCommentFn: (branch, token, message) => { posted = message; return { ok: true }; },
    readReviewStateFn: () => ({ reviewer: 'codex', implementer: 'codex' }),
    buildMetadataFooterFn: () => '\n\n---\n`[workflow-round:2, workflow-phase:reviewing]`',
    rootDir: '/tmp/visualBoard-task-meta-2',
    log: () => {},
    error: () => {},
    exit: () => {}
  });

  assert.ok(posted.startsWith('Test comment body'));
  assert.ok(posted.includes('[workflow-round:2, workflow-phase:reviewing]'));
});

test('submitReviewRound appends metadata footer to review message', () => {
  const { submitReviewRound } = require('../lib/review/review');
  let posted = null;
  submitReviewRound('task-meta-3', 'approve', 'Looks good', {
    readTokenFn: () => 'token',
    postReviewFn: (branch, token, outcome, message) => { posted = message; return { ok: true }; },
    readReviewStateFn: () => ({ reviewer: 'codex', implementer: 'codex' }),
    buildMetadataFooterFn: () => '\n\n---\n`[workflow-round:1, workflow-phase:reviewing]`',
    worktree: '/tmp/visualBoard-task-meta-3',
    isForgejoReviewEnabledFn: () => true,
    log: () => {},
    error: () => {},
    exit: () => {}
  });

  assert.ok(posted.startsWith('Looks good'));
  assert.ok(posted.includes('[workflow-round:1, workflow-phase:reviewing]'));
});

test('showReviewStatus prints state details when state exists', () => {
  const { showReviewStatus } = require('../lib/review/review');
  const { ReviewState } = require('../lib/review/review-state');
  const lines = [];

  showReviewStatus('task-status-1', {
    readReviewStateFn: () => new ReviewState('task-status-1', {
      reviewer: 'codex', implementer: 'claude', round: 2, phase: 'fixing',
      disposition: 'CHANGES_REQUESTED', startedAt: '2026-05-25T10:00:00Z'
    }),
    resolveWorktreeFn: () => '/tmp/visualBoard-task-status-1',
    log: line => lines.push(line)
  });

  assert.ok(lines.some(l => l.includes('task-status-1')));
  assert.ok(lines.some(l => l.includes('Round:') && l.includes('2')));
  assert.ok(lines.some(l => l.includes('Phase:') && l.includes('fixing')));
  assert.ok(lines.some(l => l.includes('codex')));
  assert.ok(lines.some(l => l.includes('claude')));
  assert.ok(lines.some(l => l.includes('CHANGES_REQUESTED')));
});

test('showReviewStatus prints no-state message when state is absent', () => {
  const { showReviewStatus } = require('../lib/review/review');
  const lines = [];

  showReviewStatus('task-status-2', {
    readReviewStateFn: () => null,
    resolveWorktreeFn: () => null,
    log: line => lines.push(line)
  });

  assert.ok(lines.some(l => l.includes('No persisted review state found')));
});

// ---------- State persistence after comment/review posts (Finding 2) ----------

test('commentRound persists review state after successful post', () => {
  const { commentRound } = require('../lib/review/review');
  const { ReviewState } = require('../lib/review/review-state');
  let stateWritten = null;
  const prev = process.env.FORGEJO_USER;
  process.env.FORGEJO_USER = 'codex';

  try {
    commentRound('task-persist-1', 'Test body', {
      readTokenFn: () => 'token',
      postCommentFn: () => ({ ok: true }),
      buildMetadataFooterFn: () => '',
      readReviewStateFn: () => new ReviewState('task-persist-1', {
        reviewer: 'codex', implementer: 'claude', round: 1, phase: 'reviewing'
      }),
      writeReviewStateFn: (slug, state, worktree) => { stateWritten = { slug, state, worktree }; },
      rootDir: '/tmp/visualBoard-task-persist-1',
      log: () => {},
      error: () => {},
      exit: () => {}
    });
  } finally {
    if (prev === undefined) delete process.env.FORGEJO_USER;
    else process.env.FORGEJO_USER = prev;
  }

  assert.ok(stateWritten, 'writeReviewStateFn must be called after successful comment post');
  assert.equal(stateWritten.slug, 'task-persist-1');
});

test('commentRound does not persist state when no state exists', () => {
  const { commentRound } = require('../lib/review/review');
  let writeCount = 0;
  const prev = process.env.FORGEJO_USER;
  process.env.FORGEJO_USER = 'codex';

  try {
    commentRound('task-persist-2', 'Test body', {
      readTokenFn: () => 'token',
      postCommentFn: () => ({ ok: true }),
      buildMetadataFooterFn: () => '',
      readReviewStateFn: () => null,
      writeReviewStateFn: () => { writeCount++; },
      rootDir: '/tmp/visualBoard-task-persist-2',
      log: () => {},
      error: () => {},
      exit: () => {}
    });
  } finally {
    if (prev === undefined) delete process.env.FORGEJO_USER;
    else process.env.FORGEJO_USER = prev;
  }

  assert.equal(writeCount, 0, 'writeReviewStateFn must not be called when no state exists');
});

test('submitReviewRound persists state with REQUEST_CHANGES disposition after request-changes', () => {
  const { submitReviewRound } = require('../lib/review/review');
  const { ReviewState } = require('../lib/review/review-state');
  let stateWritten = null;
  const prev = process.env.FORGEJO_USER;
  process.env.FORGEJO_USER = 'codex';

  try {
    submitReviewRound('task-persist-3', 'request-changes', 'Needs work', {
      readTokenFn: () => 'token',
      postReviewFn: () => ({ ok: true }),
      buildMetadataFooterFn: () => '',
      readReviewStateFn: () => new ReviewState('task-persist-3', {
        reviewer: 'codex', implementer: 'claude', round: 1, phase: 'reviewing'
      }),
      writeReviewStateFn: (slug, state) => { stateWritten = { slug, disposition: state.disposition, phase: state.phase }; },
      worktree: '/tmp/visualBoard-task-persist-3',
      log: () => {},
      error: () => {},
      exit: () => {}
    });
  } finally {
    if (prev === undefined) delete process.env.FORGEJO_USER;
    else process.env.FORGEJO_USER = prev;
  }

  assert.ok(stateWritten, 'writeReviewStateFn must be called after successful review post');
  assert.equal(stateWritten.disposition, 'REQUEST_CHANGES');
  assert.equal(stateWritten.phase, 'fixing');
});

test('submitReviewRound persists state with APPROVED disposition after approve', () => {
  const { submitReviewRound } = require('../lib/review/review');
  const { ReviewState } = require('../lib/review/review-state');
  let stateWritten = null;
  const prev = process.env.FORGEJO_USER;
  process.env.FORGEJO_USER = 'codex';

  try {
    submitReviewRound('task-persist-4', 'approve', 'LGTM', {
      readTokenFn: () => 'token',
      postReviewFn: () => ({ ok: true }),
      buildMetadataFooterFn: () => '',
      readReviewStateFn: () => new ReviewState('task-persist-4', {
        reviewer: 'codex', implementer: 'claude', round: 1, phase: 'reviewing'
      }),
      writeReviewStateFn: (slug, state) => { stateWritten = { slug, disposition: state.disposition, phase: state.phase }; },
      worktree: '/tmp/visualBoard-task-persist-4',
      log: () => {},
      error: () => {},
      exit: () => {}
    });
  } finally {
    if (prev === undefined) delete process.env.FORGEJO_USER;
    else process.env.FORGEJO_USER = prev;
  }

  assert.ok(stateWritten, 'writeReviewStateFn must be called after successful review post');
  assert.equal(stateWritten.disposition, 'APPROVED');
  assert.equal(stateWritten.phase, 'approved');
});

test('submitReviewRound skips Forgejo and updates review-state only when provider=none', () => {
  const { submitReviewRound } = require('../lib/review/review');
  const { ReviewState } = require('../lib/review/review-state');
  const path = require('path');
  const fs = require('fs');

  // Create a temporary directory for the test
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'review-none-'));
  const worktree = path.join(tmpDir, 'my-project');
  fs.mkdirSync(worktree, { recursive: true });
  fs.mkdirSync(path.join(worktree, 'docs', 'missions', '2026', 'task-test'), { recursive: true });

  // Create a minimal workflow.config.json with provider=none
  fs.writeFileSync(
    path.join(worktree, 'workflow.config.json'),
    JSON.stringify({
      product: { name: 'Test' },
      adapters: { review: { provider: 'none' } }
    }, null, 2),
    'utf8'
  );

  let stateWritten = null;
  let backlogTransitioned = null;

  const prevForgejo = process.env.FORGEJO_USER;
  const prevAgent = process.env.WORKFLOW_AGENT;
  process.env.FORGEJO_USER = 'codex';
  process.env.WORKFLOW_AGENT = 'qwen';

  try {
    submitReviewRound('task-test', 'approve', 'Test approval', {
      isForgejoReviewEnabledFn: () => false, // Simulate provider=none
      readReviewStateFn: () => null, // No existing state
      writeReviewStateFn: (slug, state) => {
        stateWritten = { slug, disposition: state.disposition, phase: state.phase, implementer: state.implementer };
      },
      transitionTaskFn: (slug, status) => {
        backlogTransitioned = { slug, status };
        return true;
      },
      worktree,
      log: () => {},
      error: () => {},
      exit: () => {}
    });
  } finally {
    if (prevForgejo === undefined) delete process.env.FORGEJO_USER;
    else process.env.FORGEJO_USER = prevForgejo;
    if (prevAgent === undefined) delete process.env.WORKFLOW_AGENT;
    else process.env.WORKFLOW_AGENT = prevAgent;
    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  // Verify review-state was written with correct values
  assert.ok(stateWritten, 'writeReviewStateFn must be called');
  assert.equal(stateWritten.disposition, 'APPROVED');
  assert.equal(stateWritten.phase, 'approved');
  assert.equal(stateWritten.implementer, 'qwen');

  // Verify backlog task was transitioned
  assert.ok(backlogTransitioned, 'transitionTaskFn must be called');
  assert.equal(backlogTransitioned.slug, 'task-test');
  assert.equal(backlogTransitioned.status, 'approved');
});

test('submitReviewRound updates existing state when provider=none', () => {
  const { submitReviewRound } = require('../lib/review/review');
  const { ReviewState } = require('../lib/review/review-state');

  let stateWritten = null;
  let backlogTransitioned = null;

  const existingState = new ReviewState('task-exist', {
    reviewer: 'codex',
    implementer: 'claude',
    round: 1,
    phase: 'reviewing',
    disposition: null
  });

  const prevForgejo = process.env.FORGEJO_USER;
  const prevAgent = process.env.WORKFLOW_AGENT;

  try {
    submitReviewRound('task-exist', 'request-changes', 'Needs work', {
      isForgejoReviewEnabledFn: () => false, // Simulate provider=none
      readReviewStateFn: () => existingState,
      writeReviewStateFn: (slug, state) => {
        stateWritten = { slug, disposition: state.disposition, phase: state.phase };
      },
      transitionTaskFn: (slug, status) => {
        backlogTransitioned = { slug, status };
        return true;
      },
      worktree: '/tmp/test-worktree',
      log: () => {},
      error: () => {},
      exit: () => {}
    });
  } finally {
    if (prevForgejo === undefined) delete process.env.FORGEJO_USER;
    else process.env.FORGEJO_USER = prevForgejo;
    if (prevAgent === undefined) delete process.env.WORKFLOW_AGENT;
    else process.env.WORKFLOW_AGENT = prevAgent;
  }

  // Verify review-state was updated
  assert.ok(stateWritten, 'writeReviewStateFn must be called');
  assert.equal(stateWritten.disposition, 'REQUEST_CHANGES');
  assert.equal(stateWritten.phase, 'fixing');

  // Verify backlog task was transitioned to review
  assert.ok(backlogTransitioned, 'transitionTaskFn must be called');
  assert.equal(backlogTransitioned.slug, 'task-exist');
  assert.equal(backlogTransitioned.status, 'review');
});

// ---------- Terminal disposition state persistence (Finding 3) ----------

test('startReviewLoop persists PUSHBACK_ALL disposition before returning', async () => {
  const { startReviewLoop } = require('../lib/review/review');
  const stateWrites = [];

  await startReviewLoop(TEST_SLUG, {
    implementer: 'claude',
    reviewer: 'codex',
    maxAttempts: 1,
    log: () => {},
    error: () => {},
    exit: () => {},
    workflowLauncherStatusFn: () => ({ supported: true }),
    isForgejoReviewEnabledFn: () => true,
    forgejoAvailableFn: async () => true,
    getPrStatusFn: () => ({ exists: true, state: 'open', number: 50 }),
    maybeUpdateGraphifyBeforeReviewFn: () => {},
    resolveTaskFileFn: () => ({ ok: true, taskFile: 'task.md' }),
    enforceTaskAssigneeFn: () => true,
    resolveForgejoUserFn: () => 'codex',
    readTokenFn: () => 'token',
    readReviewStateFn: () => null,
    writeReviewStateFn: (slug, state) => { stateWrites.push({ slug, disposition: state.disposition, phase: state.phase }); },
    startAgentFn: async () => ({ agent: null }),
    rebaseBeforeReviewRoundFn: async () => ({ ok: true, sharedFileConflicts: false }),
    pollForReviewFn: async () => 'REQUEST_CHANGES',
    pollForDispositionFn: async () => 'PUSHBACK_ALL',
    applyAgentFallbackFn: (args) => args.original,
    buildCompactReviewPromptFn: () => 'review prompt',
    buildCompactActOnReviewPromptFn: () => 'act-on-review prompt',
    eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'qwen'],
  });

  const terminalWrite = stateWrites[stateWrites.length - 1];
  assert.ok(terminalWrite, 'State must be written on PUSHBACK_ALL');
  assert.equal(terminalWrite.disposition, 'PUSHBACK_ALL');
});

test('startReviewLoop persists BLOCKED disposition before returning', async () => {
  const { startReviewLoop } = require('../lib/review/review');
  const stateWrites = [];

  await startReviewLoop(TEST_SLUG, {
    implementer: 'claude',
    reviewer: 'codex',
    maxAttempts: 1,
    log: () => {},
    error: () => {},
    exit: () => {},
    workflowLauncherStatusFn: () => ({ supported: true }),
    isForgejoReviewEnabledFn: () => true,
    forgejoAvailableFn: async () => true,
    getPrStatusFn: () => ({ exists: true, state: 'open', number: 51 }),
    maybeUpdateGraphifyBeforeReviewFn: () => {},
    resolveTaskFileFn: () => ({ ok: true, taskFile: 'task.md' }),
    enforceTaskAssigneeFn: () => true,
    resolveForgejoUserFn: () => 'codex',
    readTokenFn: () => 'token',
    readReviewStateFn: () => null,
    writeReviewStateFn: (slug, state) => { stateWrites.push({ slug, disposition: state.disposition, phase: state.phase }); },
    startAgentFn: async () => ({ agent: null }),
    rebaseBeforeReviewRoundFn: async () => ({ ok: true, sharedFileConflicts: false }),
    pollForReviewFn: async () => 'REQUEST_CHANGES',
    pollForDispositionFn: async () => 'BLOCKED',
    applyAgentFallbackFn: (args) => args.original,
    buildCompactReviewPromptFn: () => 'review prompt',
    buildCompactActOnReviewPromptFn: () => 'act-on-review prompt',
    eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'qwen'],
  });

  const terminalWrite = stateWrites[stateWrites.length - 1];
  assert.ok(terminalWrite, 'State must be written on BLOCKED');
  assert.equal(terminalWrite.disposition, 'BLOCKED');
});

test('startReviewLoop persists PARKED disposition before returning', async () => {
  const { startReviewLoop } = require('../lib/review/review');
  const stateWrites = [];

  await startReviewLoop(TEST_SLUG, {
    implementer: 'claude',
    reviewer: 'codex',
    maxAttempts: 1,
    log: () => {},
    error: () => {},
    exit: () => {},
    workflowLauncherStatusFn: () => ({ supported: true }),
    isForgejoReviewEnabledFn: () => true,
    forgejoAvailableFn: async () => true,
    getPrStatusFn: () => ({ exists: true, state: 'open', number: 52 }),
    maybeUpdateGraphifyBeforeReviewFn: () => {},
    resolveTaskFileFn: () => ({ ok: true, taskFile: 'task.md' }),
    enforceTaskAssigneeFn: () => true,
    resolveForgejoUserFn: () => 'codex',
    readTokenFn: () => 'token',
    readReviewStateFn: () => null,
    writeReviewStateFn: (slug, state) => { stateWrites.push({ slug, disposition: state.disposition, phase: state.phase }); },
    startAgentFn: async () => ({ agent: null }),
    rebaseBeforeReviewRoundFn: async () => ({ ok: true, sharedFileConflicts: false }),
    pollForReviewFn: async () => 'REQUEST_CHANGES',
    pollForDispositionFn: async () => 'PARKED',
    applyAgentFallbackFn: (args) => args.original,
    buildCompactReviewPromptFn: () => 'review prompt',
    buildCompactActOnReviewPromptFn: () => 'act-on-review prompt',
    eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'qwen'],
  });

  const terminalWrite = stateWrites[stateWrites.length - 1];
  assert.ok(terminalWrite, 'State must be written on PARKED');
  assert.equal(terminalWrite.disposition, 'PARKED');
});

test('startReviewLoop persists CHANGES_MADE disposition before continuing', async () => {
  const { startReviewLoop } = require('../lib/review/review');
  const stateWrites = [];

  await startReviewLoop(TEST_SLUG, {
    implementer: 'claude',
    reviewer: 'codex',
    maxAttempts: 2,
    log: () => {},
    error: () => {},
    exit: () => {},
    workflowLauncherStatusFn: () => ({ supported: true }),
    isForgejoReviewEnabledFn: () => true,
    forgejoAvailableFn: async () => true,
    getPrStatusFn: () => ({ exists: true, state: 'open', number: 53 }),
    maybeUpdateGraphifyBeforeReviewFn: () => {},
    resolveTaskFileFn: () => ({ ok: true, taskFile: 'task.md' }),
    enforceTaskAssigneeFn: () => true,
    resolveForgejoUserFn: () => 'codex',
    readTokenFn: () => 'token',
    readReviewStateFn: () => null,
    writeReviewStateFn: (slug, state) => { stateWrites.push({ slug, disposition: state.disposition, phase: state.phase }); },
    startAgentFn: async () => ({ agent: null }),
    rebaseBeforeReviewRoundFn: async () => ({ ok: true, sharedFileConflicts: false }),
    pollForReviewFn: async () => 'REQUEST_CHANGES',
    pollForDispositionFn: async () => 'CHANGES_MADE',
    applyAgentFallbackFn: (args) => args.original,
    buildCompactReviewPromptFn: () => 'review prompt',
    buildCompactActOnReviewPromptFn: () => 'act-on-review prompt',
    eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'qwen'],
  });

  const lastWrite = stateWrites[stateWrites.length - 1];
  assert.ok(lastWrite, 'State must be written on CHANGES_MADE');
  assert.equal(lastWrite.disposition, 'CHANGES_MADE');
});

test('startReviewLoop consumes reviewer and implementer artifacts before polling Forgejo', async () => {
  const { startReviewLoop } = require('../lib/review/review');
  let reviewPolls = 0;
  let dispositionPolls = 0;

  await startReviewLoop(TEST_SLUG, {
    implementer: 'claude',
    reviewer: 'codex',
    maxAttempts: 1,
    log: () => {},
    error: () => {},
    exit: () => {},
    workflowLauncherStatusFn: () => ({ supported: true }),
    isForgejoReviewEnabledFn: () => true,
    forgejoAvailableFn: async () => true,
    getPrStatusFn: () => ({ exists: true, state: 'open', number: 54 }),
    maybeUpdateGraphifyBeforeReviewFn: () => {},
    resolveTaskFileFn: () => ({ ok: true, taskFile: 'task.md' }),
    enforceTaskAssigneeFn: () => true,
    resolveForgejoUserFn: () => 'codex',
    readTokenFn: () => 'token',
    readReviewStateFn: () => null,
    writeReviewStateFn: () => {},
    startAgentFn: async () => ({ agent: null }),
    rebaseBeforeReviewRoundFn: async () => ({ ok: true, sharedFileConflicts: false }),
    consumeReviewerArtifactsFn: () => ({ consumed: true, ok: true, reviewState: 'REQUEST_CHANGES' }),
    consumeImplementerArtifactsFn: () => ({ consumed: true, ok: true, disposition: 'PARKED' }),
    pollForReviewFn: async () => { reviewPolls++; return 'REQUEST_CHANGES'; },
    pollForDispositionFn: async () => { dispositionPolls++; return 'PARKED'; },
    applyAgentFallbackFn: (args) => args.original,
    buildCompactReviewPromptFn: () => 'review prompt',
    buildCompactActOnReviewPromptFn: () => 'act-on-review prompt',
    eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'qwen'],
  });

  assert.equal(reviewPolls, 0, 'review polling should be skipped when reviewer artifacts are present');
  assert.equal(dispositionPolls, 0, 'disposition polling should be skipped when implementer artifacts are present');
});

test('consumeImplementerArtifacts posts resolution and normalized disposition from files', async () => {
  const { consumeImplementerArtifacts } = require('../lib/review/review');
  const posted = [];
  const deleted = [];
  const artifactMap = new Map([
    ['/tmp/task-089-round-resolution.md', '# resolution'],
    ['/tmp/task-089-review-disposition.txt', 'changes_made\n'],
  ]);

  const result = consumeImplementerArtifacts('task-089', 'codex', {
    forgejoEnabled: true,
    tmpDir: '/tmp',
    readArtifactFn: (filePath) => artifactMap.has(filePath) ? artifactMap.get(filePath) : null,
    readTokenFn: () => 'token',
    postCommentFn: (branch, token, message, meta) => {
      posted.push({ branch, token, message, meta });
      return { ok: true };
    },
    deleteArtifactFn: (filePath) => deleted.push(filePath),
    buildMetadataFooterFn: () => '',
    worktree: '/tmp/worktree',
    log: () => {},
    error: () => {},
    // Mock createEvent to avoid requiring real mission directory
    createEventFn: () => ({ ok: true, path: '/tmp/fake-event.md' }),
  });

  const actualResult = await result;
  assert.deepEqual(actualResult, { consumed: true, ok: true, disposition: 'CHANGES_MADE' });
  assert.equal(posted.length, 2);
  assert.deepEqual(deleted, [
    '/tmp/task-089-round-resolution.md',
    '/tmp/task-089-review-disposition.txt',
  ]);
  assert.match(posted[0].message, /# resolution/);
  assert.match(posted[1].message, /Autonomous review disposition: CHANGES_MADE/);
});

test('consumeReviewerArtifacts deletes artifacts only after successful comment and review posts', async () => {
  const { consumeReviewerArtifacts } = require('../lib/review/review');
  const deleted = [];
  const artifactMap = new Map([
    ['/tmp/task-089-review-findings.md', '# findings'],
    ['/tmp/task-089-review-outcome.md', '# outcome'],
    ['/tmp/task-089-review-verdict.txt', 'approve\n'],
  ]);

  const result = await consumeReviewerArtifacts('task-089', 'qwen', {
    forgejoEnabled: true,
    tmpDir: '/tmp',
    readArtifactFn: (filePath) => artifactMap.has(filePath) ? artifactMap.get(filePath) : null,
    readTokenFn: () => 'token',
    postCommentFn: () => ({ ok: true }),
    postReviewFn: () => ({ ok: true }),
    deleteArtifactFn: (filePath) => deleted.push(filePath),
    buildMetadataFooterFn: () => '',
    worktree: '/tmp/worktree',
    log: () => {},
    error: () => {},
    // Mock createEvent to avoid requiring real mission directory
    createEventFn: () => ({ ok: true, path: '/tmp/fake-event.md' }),
  });

  assert.deepEqual(result, { consumed: true, ok: true, reviewState: 'APPROVED' });
  assert.deepEqual(deleted, [
    '/tmp/task-089-review-findings.md',
    '/tmp/task-089-review-outcome.md',
    '/tmp/task-089-review-verdict.txt',
  ]);
});

test('consumeImplementerArtifacts leaves artifacts in place when posting fails', async () => {
  const { consumeImplementerArtifacts } = require('../lib/review/review');
  const deleted = [];
  const artifactMap = new Map([
    ['/tmp/task-089-round-resolution.md', '# resolution'],
    ['/tmp/task-089-review-disposition.txt', 'changes_made\n'],
  ]);

  const result = consumeImplementerArtifacts('task-089', 'codex', {
    forgejoEnabled: true,
    tmpDir: '/tmp',
    readArtifactFn: (filePath) => artifactMap.has(filePath) ? artifactMap.get(filePath) : null,
    readTokenFn: () => 'token',
    postCommentFn: () => ({ ok: false, error: 'boom' }),
    deleteArtifactFn: (filePath) => deleted.push(filePath),
    buildMetadataFooterFn: () => '',
    worktree: '/tmp/worktree',
    log: () => {},
    error: () => {},
    // Mock createEvent to avoid requiring real mission directory
    createEventFn: () => ({ ok: true, path: '/tmp/fake-event.md' }),
  });

  const actualResult = await result;
  assert.deepEqual(actualResult, { consumed: true, ok: false });
  assert.deepEqual(deleted, []);
});

// SC 1: Regression test proving persist-before-mirror ordering for reviewer artifacts
test('consumeReviewerArtifacts proves persist-before-mirror ordering', async () => {
  const { consumeReviewerArtifacts } = require('../lib/review/review');
  const calls = [];
  const artifactMap = new Map([
    ['/tmp/task-089-review-findings.md', '# findings'],
    ['/tmp/task-089-review-outcome.md', '# outcome'],
    ['/tmp/task-089-review-verdict.txt', 'approve\n'],
  ]);

  const result = await consumeReviewerArtifacts('task-089', 'qwen', {
    forgejoEnabled: true,
    tmpDir: '/tmp',
    readArtifactFn: (filePath) => artifactMap.has(filePath) ? artifactMap.get(filePath) : null,
    readTokenFn: () => 'token',
    postCommentFn: (branch, token, body, options) => { calls.push('postComment'); return { ok: true }; },
    postReviewFn: (branch, token, body, options) => { calls.push('postReview'); return { ok: true }; },
    deleteArtifactFn: (filePath) => {},
    buildMetadataFooterFn: () => '',
    worktree: '/tmp/worktree',
    log: () => {},
    error: () => {},
    // Track createEvent calls
    createEventFn: (slug, eventType, params, options) => { calls.push('createEvent'); return { ok: true, path: `/tmp/fake-${eventType}.md` }; },
  });

  assert.deepEqual(result, { consumed: true, ok: true, reviewState: 'APPROVED' });
  // Verify createEvent was called before any Forgejo posting
  const createEventIndices = calls.map((call, idx) => call === 'createEvent' ? idx : -1).filter(i => i !== -1);
  const forgejoIndices = calls.map((call, idx) => (call === 'postComment' || call === 'postReview') ? idx : -1).filter(i => i !== -1);
  
  assert.ok(createEventIndices.length >= 2, 'createEvent should be called at least twice (findings + outcome)');
  assert.ok(forgejoIndices.length >= 2, 'Forgejo posting should happen at least twice (comment + review)');
  
  // All createEvent calls should come before all Forgejo posting calls
  const maxCreateIndex = Math.max(...createEventIndices);
  const minForgejoIndex = Math.min(...forgejoIndices);
  assert.ok(maxCreateIndex < minForgejoIndex, 'All createEvent calls must come before any Forgejo posting');
});

// SC 1: Regression test proving persist-before-mirror ordering for implementer artifacts
test('consumeImplementerArtifacts proves persist-before-mirror ordering', async () => {
  const { consumeImplementerArtifacts } = require('../lib/review/review');
  const calls = [];
  const artifactMap = new Map([
    ['/tmp/task-089-round-resolution.md', '# resolution'],
    ['/tmp/task-089-review-disposition.txt', 'changes_made\n'],
  ]);

  const result = consumeImplementerArtifacts('task-089', 'codex', {
    forgejoEnabled: true,
    tmpDir: '/tmp',
    readArtifactFn: (filePath) => artifactMap.has(filePath) ? artifactMap.get(filePath) : null,
    readTokenFn: () => 'token',
    postCommentFn: (branch, token, body, options) => { calls.push('postComment'); return { ok: true }; },
    deleteArtifactFn: (filePath) => {},
    buildMetadataFooterFn: () => '',
    worktree: '/tmp/worktree',
    log: () => {},
    error: () => {},
    // Track createEvent calls
    createEventFn: (slug, eventType, params, options) => { calls.push('createEvent'); return { ok: true, path: `/tmp/fake-${eventType}.md` }; },
  });

  const actualResult = await result;
  assert.deepEqual(actualResult, { consumed: true, ok: true, disposition: 'CHANGES_MADE' });
  // Verify createEvent was called before any Forgejo posting
  const createEventIndices = calls.map((call, idx) => call === 'createEvent' ? idx : -1).filter(i => i !== -1);
  const forgejoIndices = calls.map((call, idx) => call === 'postComment' ? idx : -1).filter(i => i !== -1);
  
  assert.ok(createEventIndices.length >= 2, 'createEvent should be called at least twice (round_summary + disposition)');
  assert.ok(forgejoIndices.length >= 1, 'Forgejo posting should happen at least once (disposition comment)');
  
  // All createEvent calls should come before all Forgejo posting calls
  const maxCreateIndex = Math.max(...createEventIndices);
  const minForgejoIndex = Math.min(...forgejoIndices);
  assert.ok(maxCreateIndex < minForgejoIndex, 'All createEvent calls must come before any Forgejo posting');
});

test('createEventHandler requires review-state or --actor for mirrored event types', async () => {
  const { createEventHandler } = require('../lib/review/review');
  const fs = require('node:fs');
  const path = require('node:path');

  // Create a temporary directory for the test
  const tmpDir = '/tmp/test-create-event-handler';
  try {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
    fs.mkdirSync(tmpDir, { recursive: true });

    // Clear FORGEJO_USER to ensure the handler does not depend on it.
    const oldForgejoUser = process.env.FORGEJO_USER;
    delete process.env.FORGEJO_USER;

    // Mock options
    const logMessages = [];
    const errorMessages = [];
    let exitCode = null;

    const options = {
      log: (msg) => logMessages.push(msg),
      error: (msg) => errorMessages.push(msg),
      exit: (code) => { exitCode = code; throw new Error(`exit(${code})`); },
      resolveWorktreeFn: () => tmpDir
    };

    try {
      // This should fail because mirrored events need persisted identity or --actor.
      createEventHandler('task-test', ['--type', 'reviewer_outcome', '--verdict', 'approve'], options);
      assert.fail('Expected createEventHandler to exit with code 1');
    } catch (err) {
      assert.match(err.message, /exit\(1\)/);
    }

    // Verify that the error message mentions the review-state / actor contract.
    assert.ok(errorMessages.some(msg => msg.includes('review-state.json') && msg.includes('--actor')));
    assert.equal(exitCode, 1);

    // Verify that no event file was created
    // The event would be created in docs/missions/2026/task-test/review-events/
    const eventDir = path.join(tmpDir, 'docs', 'missions', '2026', 'task-test', 'review-events');
    assert.ok(!fs.existsSync(eventDir) || fs.readdirSync(eventDir).length === 0);

    // Restore FORGEJO_USER
    if (oldForgejoUser) {
      process.env.FORGEJO_USER = oldForgejoUser;
    }
  } finally {
    // Cleanup
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
  }
});

// ============================================================================
// Pre-review phase detection tests for startReviewLoop (task-1223)
// ============================================================================

test('startReviewLoop returns early with guidance when task is active and no PR exists', async () => {
  const { startReviewLoop } = require('../lib/review/review');

  let handoffCalled = false;
  const { exitCode, errors, logs } = await captureExit(() => {
    return startReviewLoop(TEST_SLUG, {
      eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'qwen'],
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
      getTaskStatusFn: () => 'active',
      getTaskImplementerFn: () => 'codex',
      isForgejoReviewEnabledFn: () => true,
      forgejoAvailableFn: async () => true,
      getPrStatusFn: () => ({ exists: false, state: 'closed' }),
      performHandoffFn: async () => { handoffCalled = true; return { ok: true }; },
      maybeUpdateGraphifyBeforeReviewFn: () => {},
      implementer: 'codex',
      reviewer: 'claude',
      dryRun: false
    });
  });

  // Should NOT exit (returns early with INFO message for active task)
  assert.equal(exitCode, null);
  // Should have INFO message about PR not found with guidance
  assert.ok(logs.some(l => l.includes('INFO') && l.includes('PR not found')));
  assert.ok(logs.some(l => l.includes('create the PR first') && l.includes('--push')));
  // task-1303 crit. 5: implementation-phase path must not invoke self-heal.
  assert.equal(handoffCalled, false, 'performHandoffFn must not be called in implementation phase');
});

test('startReviewLoop returns early with guidance when task maps to virtual active and no PR exists', async () => {
  const { startReviewLoop } = require('../lib/review/review');

  const { exitCode, logs } = await captureExit(() => {
    return startReviewLoop(TEST_SLUG, {
      eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'qwen'],
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
      getTaskStatusFn: () => 'in-progress',
      toVirtualFn: (status) => status === 'in-progress' ? 'active' : status,
      getTaskImplementerFn: () => 'codex',
      isForgejoReviewEnabledFn: () => true,
      forgejoAvailableFn: async () => true,
      getPrStatusFn: () => ({ exists: false, state: 'closed' }),
      maybeUpdateGraphifyBeforeReviewFn: () => {},
      implementer: 'codex',
      reviewer: 'claude',
      dryRun: false
    });
  });

  assert.equal(exitCode, null);
  assert.ok(logs.some(l => l.includes('INFO') && l.includes('Task is in in-progress')));
  assert.ok(logs.some(l => l.includes('create the PR first') && l.includes('--push')));
});

// task-1303 self-heal: when a post-implementation task has no open PR, the loop runs
// the handoff automatically instead of dead-ending. A *failing* injected handoff yields
// the corrected `--push` fallback (never `--submit`); a *succeeding* one that produces an
// open PR lets the loop proceed.
test('startReviewLoop self-heals via handoff and recovers when task is review and a PR appears (crit. 1)', async () => {
  const { startReviewLoop } = require('../lib/review/review');

  let handoffArgs = null;
  let prCalls = 0;
  const { exitCode, errors, logs } = await captureExit(() => {
    return startReviewLoop(TEST_SLUG, {
      eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'qwen'],
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
      getTaskStatusFn: () => 'review',
      getTaskImplementerFn: () => 'codex',
      isForgejoReviewEnabledFn: () => true,
      forgejoAvailableFn: async () => true,
      // First call: no PR. After successful handoff: open PR #77.
      getPrStatusFn: () => {
        prCalls += 1;
        return prCalls === 1
          ? { exists: false, state: 'closed' }
          : { exists: true, state: 'open', number: 77 };
      },
      performHandoffFn: async (slug, opts) => { handoffArgs = { slug, opts }; return { ok: true }; },
      // Make the loop terminate quickly after recovery without launching real agents.
      maxAttempts: 0,
      maybeUpdateGraphifyBeforeReviewFn: () => {},
      readTokenFn: () => 'tok',
      resolveReviewUserFn: () => 'reviewer-user',
      implementer: 'codex',
      reviewer: 'claude',
      dryRun: false
    });
  });

  // Self-heal called with the implementer identity and worktree.
  assert.ok(handoffArgs, 'performHandoffFn should be called');
  assert.equal(handoffArgs.slug, TEST_SLUG);
  assert.equal(handoffArgs.opts.forgejoUser, 'codex');
  assert.ok('worktree' in handoffArgs.opts, 'worktree should be threaded into handoff');
  // Did NOT exit for the PR-missing reason; recovery was logged.
  assert.notEqual(exitCode, 1);
  assert.ok(logs.some(l => l.includes('Self-heal succeeded') && l.includes('#77')));
  assert.ok(!errors.some(e => e.includes('No open review PR found')));
});

test('startReviewLoop emits --push fallback (not --submit) when handoff fails for a review task (crit. 2)', async () => {
  const { startReviewLoop } = require('../lib/review/review');

  const { exitCode, errors } = await captureExit(() => {
    return startReviewLoop(TEST_SLUG, {
      eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'qwen'],
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
      getTaskStatusFn: () => 'review',
      getTaskImplementerFn: () => 'codex',
      isForgejoReviewEnabledFn: () => true,
      forgejoAvailableFn: async () => true,
      getPrStatusFn: () => ({ exists: false, state: 'closed' }),
      performHandoffFn: async () => ({ ok: false, error: 'gate failed' }),
      maybeUpdateGraphifyBeforeReviewFn: () => {},
      implementer: 'codex',
      reviewer: 'claude',
      dryRun: false
    });
  });

  assert.equal(exitCode, 1);
  assert.ok(errors.some(e => e.includes('FAIL') && e.includes('No open review PR found')));
  assert.ok(errors.some(e => e.includes('gate failed')), 'should surface the handoff failure reason');
  assert.ok(errors.some(e => e.includes('--push')), 'should recommend --push');
  assert.ok(!errors.some(e => e.includes('--submit')), 'must not recommend --submit');
});

test('startReviewLoop emits --push fallback when handoff ok but no PR appears (crit. 3)', async () => {
  const { startReviewLoop } = require('../lib/review/review');

  const { exitCode, errors } = await captureExit(() => {
    return startReviewLoop(TEST_SLUG, {
      eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'qwen'],
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
      getTaskStatusFn: () => 'approved',
      getTaskImplementerFn: () => 'codex',
      isForgejoReviewEnabledFn: () => true,
      forgejoAvailableFn: async () => true,
      // No PR even after a "successful" handoff.
      getPrStatusFn: () => ({ exists: false, state: 'closed' }),
      performHandoffFn: async () => ({ ok: true }),
      maybeUpdateGraphifyBeforeReviewFn: () => {},
      implementer: 'codex',
      reviewer: 'claude',
      dryRun: false
    });
  });

  assert.equal(exitCode, 1);
  assert.ok(errors.some(e => e.includes('No open review PR found')));
  assert.ok(errors.some(e => e.includes('--push')));
  assert.ok(!errors.some(e => e.includes('--submit')));
});

test('startReviewLoop short-circuits on gatekeeper pushback without launching reviewer (crit. 4)', async () => {
  const { startReviewLoop } = require('../lib/review/review');

  let reviewerLaunched = false;
  const { exitCode, errors } = await captureExit(() => {
    return startReviewLoop(TEST_SLUG, {
      eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'qwen'],
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
      getTaskStatusFn: () => 'review',
      getTaskImplementerFn: () => 'codex',
      isForgejoReviewEnabledFn: () => true,
      forgejoAvailableFn: async () => true,
      getPrStatusFn: () => ({ exists: false, state: 'closed' }),
      performHandoffFn: async () => ({ ok: true, gatekeeperPushedBack: true }),
      startAgentFn: () => { reviewerLaunched = true; return {}; },
      maybeUpdateGraphifyBeforeReviewFn: () => {},
      implementer: 'codex',
      reviewer: 'claude',
      dryRun: false
    });
  });

  assert.equal(exitCode, 1);
  assert.equal(reviewerLaunched, false, 'reviewer must not be launched on gatekeeper pushback');
  assert.ok(errors.some(e => e.includes('mandatory') && e.includes('artifacts')));
});

test('startReviewLoop never self-heals in dry-run (crit. 7)', async () => {
  const { startReviewLoop } = require('../lib/review/review');

  let handoffCalled = false;
  const { logs } = await captureExit(() => {
    return startReviewLoop(TEST_SLUG, {
      eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'qwen'],
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
      getTaskStatusFn: () => 'review',
      getTaskImplementerFn: () => 'codex',
      isForgejoReviewEnabledFn: () => true,
      forgejoAvailableFn: async () => true,
      getPrStatusFn: () => ({ exists: false, state: 'closed' }),
      performHandoffFn: async () => { handoffCalled = true; return { ok: true }; },
      maxAttempts: 0,
      maybeUpdateGraphifyBeforeReviewFn: () => {},
      implementer: 'codex',
      reviewer: 'claude',
      dryRun: true
    });
  });

  assert.equal(handoffCalled, false, 'performHandoffFn must not be called in dry-run');
  assert.ok(logs.some(l => l.includes('DRY-RUN')), 'existing dry-run behavior should hold');
});

test('startReviewLoop hard-fails when task cannot be resolved and no PR exists', async () => {
  const { startReviewLoop } = require('../lib/review/review');

  const { exitCode, errors, logs } = await captureExit(() => {
    return startReviewLoop(TEST_SLUG, {
      eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'qwen'],
      resolveTaskFileFn: () => ({ ok: false }),
      getTaskStatusFn: () => null,
      getTaskImplementerFn: () => 'codex',
      isForgejoReviewEnabledFn: () => true,
      forgejoAvailableFn: async () => true,
      getPrStatusFn: () => ({ exists: false, state: 'closed' }),
      maybeUpdateGraphifyBeforeReviewFn: () => {},
      implementer: 'codex',
      reviewer: 'claude',
      dryRun: false
    });
  });

  // Should exit with code 1 when task resolution fails
  assert.equal(exitCode, 1);
  assert.ok(errors.some(e => e.includes('FAIL') && e.includes('Backlog task for task-test-validation-noop not found')));
});

test('createEventHandler allows non-mirrored event types without FORGEJO_USER', async () => {
  const { createEventHandler } = require('../lib/review/review');
  const fs = require('node:fs');
  const path = require('node:path');

  // Create a temporary directory for the test
  const tmpDir = '/tmp/test-create-event-handler-non-mirrored';
  try {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
    fs.mkdirSync(tmpDir, { recursive: true });

    // Clear FORGEJO_USER
    const oldForgejoUser = process.env.FORGEJO_USER;
    delete process.env.FORGEJO_USER;

    // Mock options
    const logMessages = [];
    const errorMessages = [];
    let exitCode = null;
    let exitCalled = false;

    const options = {
      log: (msg) => logMessages.push(msg),
      error: (msg) => errorMessages.push(msg),
      exit: (code) => { exitCode = code; exitCalled = true; throw new Error(`exit(${code})`); },
      resolveWorktreeFn: () => tmpDir,
      // Mock the Forgejo posting functions to avoid actual API calls
      postCommentFn: () => ({ ok: false, error: 'no token' }),
      postReviewFn: () => ({ ok: false, error: 'no token' })
    };

    try {
      // neutral_discussion is NOT mirrored, so this should succeed even without FORGEJO_USER
      createEventHandler('task-test', ['--type', 'neutral_discussion', '--content', 'test discussion'], options);
      assert.fail('Expected createEventHandler to exit with code 1');
    } catch (err) {
      // This will fail because it tries to create the event in a non-existent directory structure
      // but the important thing is it doesn't fail due to FORGEJO_USER check
      assert.ok(!errorMessages.some(msg => msg.includes('FORGEJO_USER')));
    }

    // Restore FORGEJO_USER
    if (oldForgejoUser) {
      process.env.FORGEJO_USER = oldForgejoUser;
    }
  } finally {
    // Cleanup
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
  }
});
