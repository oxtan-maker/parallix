// @ts-nocheck -- TASK-2328: partial test doubles from ESM seam migration; resolve in follow-up

import { reviewOperation, reviewOperationPhase, reviewPushIdentity } from '../../../../src/domain/review-command-policy.js';

import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { mockModule, installModuleMocks } from '../../../lib/module-mock.js';
import { createRequire } from 'node:module';
import { ReviewCommandUseCase } from '../../../../src/application/review-command-use-case.js';
import { createReviewCommand } from '../../../../src/interfaces/cli/review.js';
import { mkdtemp as registeredMkdtemp } from '../../../helpers/temp-dir.js';
import { bindReviewPersistence } from '../../../../src/composition/review-persistence.js';
import { fixtureMission, inMemoryTransitionStore } from '../../../fixtures/mission-builders.js';
import { fakeReviewLoopPorts } from '../../../helpers/review-loop-ports.js';

/** Bound loop mechanisms whose held controller fence declines the run. */
const declinedLoop = () => fakeReviewLoopPorts({ lock: { tryAcquire: () => false, release: () => {} } }).ports;
const _require = createRequire(import.meta.url);
const missionUtils = mockModule<typeof import('../../../../src/adapters/filesystem/mission-utils.js')>('../../../../src/adapters/filesystem/mission-utils.js', import.meta.url);
const reviewModule = mockModule<typeof import('../../../../src/adapters/review/review-commands.js')>('../../../../src/adapters/review/review-commands.js', import.meta.url);
const reviewCliFlags = await import('../../../../src/adapters/review/review-cli-flags.js');
const reviewWorkflowAdapter = await import('../../../../src/adapters/review/review-workflow-adapter.js');
await installModuleMocks();
test.afterEach(() => mock.restoreAll());
const {
  formatStaticReviewFindings,
  formatStaticReviewSuccess,
  performStaticReview
} = reviewModule;
const { flagValue, readTextFlag, unknownReviewFlags } = reviewCliFlags;
const { ReviewWorkflowAdapter, createReviewWorkflowAdapter } = reviewWorkflowAdapter;
const review = (args, options = {}) =>
  createReviewCommand(new ReviewCommandUseCase(createReviewWorkflowAdapter(options)))(args, options);

test('createReviewWorkflowAdapter returns a ReviewWorkflowAdapter', () => {
  assert.ok(createReviewWorkflowAdapter() instanceof ReviewWorkflowAdapter);
});

// ============================================================================
// flagValue tests
// ============================================================================

test('flagValue returns null when flag not found', () => {
  const result = flagValue(['--other', 'value'], '--target');
  assert.equal(result, null);
});

test('flagValue returns value after flag', () => {
  const result = flagValue(['--flag', 'my-value'], '--flag');
  assert.equal(result, 'my-value');
});

test('flagValue returns null when value starts with --', () => {
  const result = flagValue(['--flag', '--other'], '--flag');
  assert.equal(result, null);
});

test('flagValue returns null when no value after flag', () => {
  const result = flagValue(['--flag'], '--flag');
  assert.equal(result, null);
});

test('flagValue finds flag in middle of array', () => {
  const result = flagValue(['a', 'b', '--flag', 'value', 'c'], '--flag');
  assert.equal(result, 'value');
});

// ============================================================================
// readTextFlag tests
// ============================================================================

test('readTextFlag reads from file when fileFlag is provided', () => {
  const tmpDir = registeredMkdtemp('test-readTextFlag-');
  const filePath = path.join(tmpDir, 'test-file.txt');
  fs.writeFileSync(filePath, 'file content\n', 'utf8');

  try {
    const result = readTextFlag(
      ['--message-file', filePath],
      '--message',
      '--message-file',
      'message',
      { readFileSync: fs.readFileSync, exit: () => {}, error: () => {} }
    );
    assert.equal(result, 'file content');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('readTextFlag reads from inline flag when fileFlag not found', () => {
  const result = readTextFlag(
    ['--message', 'inline content'],
    '--message',
    '--message-file',
    'message',
    { readFileSync: fs.readFileSync, exit: () => {}, error: () => {} }
  );
  assert.equal(result, 'inline content');
});

test('readTextFlag returns null when neither flag is present', () => {
  const result = readTextFlag(
    ['--other', 'value'],
    '--message',
    '--message-file',
    'message',
    { readFileSync: fs.readFileSync, exit: () => {}, error: () => {} }
  );
  assert.equal(result, null);
});

test('readTextFlag handles file read error gracefully', () => {
  let exited = false;
  const result = readTextFlag(
    ['--message-file', '/nonexistent/file.txt'],
    '--message',
    '--message-file',
    'message',
    {
      readFileSync: () => { throw new Error('ENOENT'); },
      exit: (code) => { exited = true; },
      error: () => {}
    }
  );
  assert.equal(result, null);
  assert.equal(exited, true);
});

// ============================================================================
// formatStaticReviewFindings tests
// ============================================================================

test('formatStaticReviewFindings formats single finding', () => {
  const result = formatStaticReviewFindings(['Finding 1']);
  assert.match(result, /Static review found the following issue\(s\)/);
  assert.match(result, /1\. Finding 1/);
  assert.match(result, /Auto-launching the act-on-review loop/);
});

test('formatStaticReviewFindings formats multiple findings', () => {
  const result = formatStaticReviewFindings(['Finding 1', 'Finding 2', 'Finding 3']);
  assert.match(result, /1\. Finding 1/);
  assert.match(result, /2\. Finding 2/);
  assert.match(result, /3\. Finding 3/);
});

test('formatStaticReviewFindings handles empty findings array', () => {
  const result = formatStaticReviewFindings([]);
  assert.match(result, /Static review found the following issue\(s\)/);
  assert.match(result, /Auto-launching the act-on-review loop/);
});

// ============================================================================
// formatStaticReviewSuccess tests
// ============================================================================

test('formatStaticReviewSuccess formats success message', () => {
  const result = formatStaticReviewSuccess('test-slug');
  assert.match(result, /Static review for test-slug found zero issues/);
  assert.match(result, /Checked:/);
  assert.match(result, /mission diff against the primary branch/);
  assert.match(result, /checkpoint presence/);
  assert.match(result, /final checkpoint Goal Check evidence/);
  assert.match(result, /Mission remains in `review` status awaiting an actual autonomous or peer review verdict/);
});

test('performStaticReview rejects placeholder-only Goal Check evidence rows', (t) => {
  const { mock } = t;
  const rootDir = registeredMkdtemp('static-review-placeholder-');
  const missionDir = path.join(rootDir, 'missions', 'task-placeholder');
  const checkpointPath = path.join(missionDir, 'CP-1.md');

  fs.mkdirSync(missionDir, { recursive: true });
  fs.writeFileSync(checkpointPath, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| Works | Tested manually | Looks good |\n');
  try {
    const result = performStaticReview('task-placeholder', {
      resolveWorktree: () => rootDir,
      findMissionDir: () => missionDir,
      findCheckpoints: () => [checkpointPath],
      readFileSync: fs.readFileSync,
      run: () => ({ status: 0, stdout: '' }),
      getPrimaryBranch: () => 'main',
      log: () => {}
    });

    assert.equal(result.ok, false);
    assert.ok(result.findings.some(f => /no evidence rows that cite a verifiable reference such as a recognized repo command\/path, exact test name, test-file path, or ADR reference \(or, when necessary, file:line\)/.test(f)));
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('performStaticReview accepts a shell command that references an existing repository file', (t) => {
  const { mock } = t;
  const rootDir = registeredMkdtemp('static-review-shell-command-');
  const missionDir = path.join(rootDir, 'missions', 'task-shell-command');
  const checkpointPath = path.join(missionDir, 'CP-1.md');
  fs.mkdirSync(missionDir, { recursive: true });
  fs.writeFileSync(path.join(rootDir, 'hello.sh'), '#!/usr/bin/env bash\necho hello\n');
  fs.writeFileSync(checkpointPath, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| Script works | `bash hello.sh` prints hello | PASS |\n');
  try {
    const result = performStaticReview('task-shell-command', {
      resolveWorktree: () => rootDir,
      findMissionDir: () => missionDir,
      findCheckpoints: () => [checkpointPath],
      readFileSync: fs.readFileSync,
      run: () => ({ status: 0, stdout: '' }),
      getPrimaryBranch: () => 'main',
      log: () => {}
    });

    assert.equal(result.ok, true, result.findings.join('\n'));
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('performStaticReview rejects separator-only Goal Check tables', (t) => {
  const { mock } = t;
  const rootDir = registeredMkdtemp('static-review-separator-');
  const missionDir = path.join(rootDir, 'missions', 'task-separator');
  const checkpointPath = path.join(missionDir, 'CP-1.md');

  fs.mkdirSync(missionDir, { recursive: true });
  fs.writeFileSync(checkpointPath, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n|---|---|---|\n');
  try {
    const result = performStaticReview('task-separator', {
      resolveWorktree: () => rootDir,
      findMissionDir: () => missionDir,
      findCheckpoints: () => [checkpointPath],
      readFileSync: fs.readFileSync,
      run: () => ({ status: 0, stdout: '' }),
      getPrimaryBranch: () => 'main',
      log: () => {}
    });

    assert.equal(result.ok, false);
    assert.ok(result.findings.some(f => /no evidence rows/.test(f)));
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('performStaticReview accepts Goal Check evidence that cites a real test name', (t) => {
  const { mock } = t;
  const rootDir = registeredMkdtemp('static-review-test-name-');
  const missionDir = path.join(rootDir, 'missions', 'task-test-name');
  const checkpointPath = path.join(missionDir, 'CP-1.md');
  const testFilePath = path.join(rootDir, 'test', 'sample.test.js');

  fs.mkdirSync(path.dirname(testFilePath), { recursive: true });
  fs.writeFileSync(testFilePath, "const test = _require('node:test');\ntest('real evidence title', () => {});\n");
  fs.mkdirSync(missionDir, { recursive: true });
  fs.writeFileSync(checkpointPath, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| Test title cited | test `real evidence title` | PASS |\n');
  try {
    const result = performStaticReview('task-test-name', {
      resolveWorktree: () => rootDir,
      findMissionDir: () => missionDir,
      findCheckpoints: () => [checkpointPath],
      readFileSync: fs.readFileSync,
      run: () => ({ status: 0, stdout: '' }),
      getPrimaryBranch: () => 'main',
      log: () => {}
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.findings, []);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

// ============================================================================
// Regression test: no-PR + clean static review must NOT auto-transition to approved
// ============================================================================

test('no-PR + clean static review does NOT auto-transition task to approved/ready-for-integration', async () => {
  let submitForReviewCalled = false;
  let postStaticReviewCalled = false;
  const logs = [];
  const errors = [];

  await review(['task-1259-regression'], {
    inferSlugFn: (s) => s || 'task-1259-regression',
    log: (m) => logs.push(m),
    error: (m) => errors.push(m),
    exit: (c) => { /* swallow exit */ },
    getPrStatusFn: () => ({ exists: false }),
    performStaticReviewFn: () => ({ ok: true, findings: [] }),
    submitForReviewFn: async () => { submitForReviewCalled = true; },
    postStaticReviewCommentFn: () => { postStaticReviewCalled = true; },
    resolveWorktreeFn: () => null,
    readReviewStateFn: () => null,
    run: () => ({ status: 0 })
  });

  // The key assertion: the clean-static-review path must not promote the task.
  // The handler no longer wires any status-transition function on this branch,
  // so guard the outcome via the only observable it emits — no log announcing a
  // move to approved/ready-for-integration.
  assert.ok(
    !logs.some(l => /approved|ready-for-integration/i.test(l)),
    `Bug: clean static review announced a promotion — task should remain in 'review' status; logs: ${logs.join(' | ')}`
  );

  // submitForReviewFn should still be called to create the PR
  assert.equal(submitForReviewCalled, true,
    'submitForReviewFn should be called to create the PR when none exists'
  );

  // postStaticReviewCommentFn should still be called to post the success message
  assert.equal(postStaticReviewCalled, true,
    'postStaticReviewCommentFn should be called after clean static review'
  );

  // Logs should contain the static review pass message
  assert.ok(
    logs.some(l => l.includes('Static review passed') || l.includes('no findings')),
    `Expected static review pass log; got: ${logs.join(' | ')}`
  );
});

test('no-PR + static review findings re-launches the implementer (not the review loop)', async () => {
  let startReviewLoopCalled = 0;
  let startAgentCalls = [];
  let submitForReviewCalled = false;
  let postStaticReviewCalled = false;
  const findings = ['Missing Goal Check section', 'No evidence rows'];
  const logs = [];
  const errors = [];

  await review(['task-1259-regression-findings'], {
    inferSlugFn: (s) => s || 'task-1259-regression-findings',
    log: (m) => logs.push(m),
    error: (m) => errors.push(m),
    exit: (c) => { /* swallow exit */ },
    getPrStatusFn: () => ({ exists: false }),
    performStaticReviewFn: () => ({ ok: false, findings }),
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task-1259.md' }),
    getTaskImplementerFn: () => 'claude',
    reviewLoopMechanisms: () => { startReviewLoopCalled += 1; return declinedLoop(); },
    startAgentFn: async (step, opts) => { startAgentCalls.push({ step, opts }); },
    submitForReviewFn: async () => { submitForReviewCalled = true; },
    postStaticReviewCommentFn: () => { postStaticReviewCalled = true; },
    resolveWorktreeFn: () => '/tmp/wt-1259',
    readReviewStateFn: () => null,
    run: () => ({ status: 0 })
  });

  // SC1: the review loop must NOT start on the findings path.
  assert.equal(startReviewLoopCalled, 0,
    'the review loop must NOT be bound when static review finds trivial issues');

  // SC1: the implementer is re-launched exactly once via the 'active' step.
  assert.equal(startAgentCalls.length, 1,
    'startAgentFn should be called exactly once');
  assert.equal(startAgentCalls[0].step, 'active',
    "startAgentFn should be invoked with step === 'active'");

  // SC3: the agent equals the implementer read from the task file.
  assert.equal(startAgentCalls[0].opts.agent, 'claude',
    'startAgentFn should receive the implementer as the agent option');
  assert.equal(startAgentCalls[0].opts.worktree, '/tmp/wt-1259');
  assert.equal(startAgentCalls[0].opts.slug, 'task-1259-regression-findings');

  // SC2: every finding appears as its own line item in the prompt.
  for (const f of findings) {
    assert.ok(startAgentCalls[0].opts.prompt.includes(`- ${f}`),
      `prompt should contain finding "${f}" as a line item; got: ${startAgentCalls[0].opts.prompt}`);
  }

  // The re-launch path must not submit for review or post a Forgejo comment.
  assert.equal(submitForReviewCalled, false,
    'findings path should not submit for review');
  assert.equal(postStaticReviewCalled, false,
    'findings path should not post a static review comment');

  // It must not announce a promotion.
  assert.ok(
    !logs.some(l => /approved|ready-for-integration/i.test(l)),
    `findings path should not announce a promotion; logs: ${logs.join(' | ')}`
  );
});

test('no-PR + static review findings with unresolvable implementer logs WARN and does nothing', async () => {
  let startReviewLoopCalled = 0;
  let startAgentCalled = 0;
  const logs = [];

  await review(['task-1311-no-implementer'], {
    inferSlugFn: (s) => s || 'task-1311-no-implementer',
    log: (m) => logs.push(m),
    error: () => {},
    exit: () => {},
    getPrStatusFn: () => ({ exists: false }),
    performStaticReviewFn: () => ({ ok: false, findings: ['Missing Goal Check section'] }),
    resolveTaskFileFn: () => ({ ok: false, taskFile: null }),
    getTaskImplementerFn: () => null,
    reviewLoopMechanisms: () => { startReviewLoopCalled += 1; return declinedLoop(); },
    startAgentFn: async () => { startAgentCalled += 1; },
    resolveWorktreeFn: () => null,
    readReviewStateFn: () => null,
    run: () => ({ status: 0 })
  });

  // SC3: implementer unresolved ⇒ no agent launch, no review loop, WARN emitted.
  assert.equal(startAgentCalled, 0,
    'startAgentFn must not be called when the implementer cannot be resolved');
  assert.equal(startReviewLoopCalled, 0,
    'the review loop must not be bound when the implementer cannot be resolved');
  assert.ok(
    logs.some(l => /WARN/.test(l) && /implementer could not be resolved/i.test(l)),
    `expected a WARN log about unresolved implementer; got: ${logs.join(' | ')}`
  );
});

// ============================================================================
// Unknown-flag guard (--max-attempt typo silently ignored the override)
// ============================================================================

test('flagValue supports --flag=value form', () => {
  assert.equal(flagValue(['--max-attempts=7'], '--max-attempts'), '7');
  assert.equal(flagValue(['a', '--focus=tests', 'b'], '--focus'), 'tests');
  assert.equal(flagValue(['--max-attempts='], '--max-attempts'), null);
});

test('unknownReviewFlags flags typos but not values of value-taking flags', () => {
  assert.deepEqual(
    unknownReviewFlags(['--continue', '--implementer', 'claude', '--reviewer', 'codex', '--max-attempt', '7']),
    ['--max-attempt']
  );
  assert.deepEqual(unknownReviewFlags(['--comment', '--not-a-flag but a message body']), []);
  assert.deepEqual(unknownReviewFlags(['task-1', '--start', '--max-attempts=7']), []);
});

test('review rejects an unknown flag with a suggestion instead of ignoring it', async () => {
  const errors = [];
  let exitCode = null;
  let startReviewLoopCalled = 0;

  await review(['task-2322', '--continue', '--max-attempt', '7'], {
    inferSlugFn: (s) => s || 'task-2322',
    log: () => {},
    error: (m) => errors.push(m),
    exit: (c) => { exitCode = c; },
    reviewLoopMechanisms: () => { startReviewLoopCalled += 1; return declinedLoop(); }
  });

  assert.equal(startReviewLoopCalled, 0, 'the loop must not start when a flag is misspelled');
  assert.equal(exitCode, 1);
  assert.ok(
    errors.some(e => e.includes('--max-attempt') && e.includes('--max-attempts')),
    `expected a suggestion for --max-attempts; got: ${errors.join(' | ')}`
  );
});

test('review passes an explicit --max-attempts through to the review loop', async () => {
  let received = null;
  const exits = [];
  const exit = (code) => { exits.push(code); };

  await review(['task-2322', '--continue', '--max-attempts', '7'], {
    continueReviewClearsInterventionFn: async () => false,
    readReviewStateFn: async () => ({ round: 1 }),
    inferSlugFn: (s) => s || 'task-2322',
    log: () => {},
    error: () => {},
    exit,
    reviewLoopMechanisms: (request, observers) => { received = { ...request, ...observers }; return declinedLoop(); }
  });

  assert.equal(received && received.maxAttempts, 7);
  assert.notEqual(received && received.exit, process.exit, 'nested review loops must not retain process.exit from the parent command');
  // The use case observes the injected exit (TASK-2620) and still forwards to it.
  received.exit(3);
  assert.equal(exits.at(-1), 3);
});

test('a manual review continuation renews the five-round budget at the current round', async () => {
  let received = null;

  await review(['task-2436', '--continue'], {
    continueReviewClearsInterventionFn: async () => false,
    inferSlugFn: (s) => s || 'task-2436',
    log: () => {}, error: () => {}, exit: () => {},
    readReviewStateFn: async () => ({ round: 5 }),
    reviewLoopMechanisms: (request, observers) => { received = { ...request, ...observers }; return declinedLoop(); },
  });

  assert.equal(received && received.maxAttempts, 9);
});

test('review automation retains its five-round limit', async () => {
  let received = null;

  await review(['task-2436', '--start'], {
    inferSlugFn: (s) => s || 'task-2436',
    log: () => {}, error: () => {}, exit: () => {},
    readReviewStateFn: async () => ({ round: 5 }),
    reviewLoopMechanisms: (request, observers) => { received = { ...request, ...observers }; return declinedLoop(); },
  });

  assert.equal(received && received.maxAttempts, 5);
});

// An unknown identity may not begin a review; known missions reach handoff
// readiness even when their first Review has not been created yet.
test('a --start rejects an unknown mission without the DB-native Review aggregate', async () => {
  let startReviewLoopCalled = 0;
  const errors = [];
  const exits = [];

  await review(['task-2490', '--start'], {
    inferSlugFn: (s) => s || 'task-2490',
    log: () => {},
    error: message => errors.push(message),
    exit: code => { exits.push(code); },
    requireReviewAggregate: true,
    readReviewStateFn: async () => null,
    reviewLoopMechanisms: () => { startReviewLoopCalled += 1; return declinedLoop(); },
  });

  assert.equal(startReviewLoopCalled, 0, '--start must not reintroduce retired file-backed review state when the DB-native aggregate is absent');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /--reconcile-review/);
  assert.deepEqual(exits, [1]);
});

// The aggregate guard is retained for every non-start operation: a `--continue`
// on a mission with no persisted Review stops with --start guidance.
test('a --continue with no persisted Review aggregate exits with start guidance', async () => {
  const errors = [];
  let startReviewLoopCalled = 0;

  await review(['task-2490', '--continue'], {
    inferSlugFn: (s) => s || 'task-2490',
    log: () => {},
    error: (m) => errors.push(m),
    exit: () => {},
    requireReviewAggregate: true,
    readReviewStateFn: async () => null,
    reviewLoopMechanisms: () => { startReviewLoopCalled += 1; return declinedLoop(); },
  });

  assert.equal(startReviewLoopCalled, 0, `--continue must not reach the review loop without a persisted Review`);
  assert.ok(
    errors.some(e => /no valid Review aggregate/.test(e)),
    `expected the missing-Review diagnostic; got: ${errors.join(' | ')}`
  );
});

test('review forwards current-work agent publication into the review loop', async () => {
  let received = null;

  await review(['task-2322', '--continue'], {
    continueReviewClearsInterventionFn: async () => false,
    readReviewStateFn: async () => ({ round: 1 }),
    inferSlugFn: (s) => s || 'task-2322',
    log: () => {},
    error: () => {},
    exit: () => {},
    reviewLoopMechanisms: (request, observers) => { received = { ...request, ...observers }; return declinedLoop(); },
  });

  assert.equal(typeof received?.onAgentLaunched, 'function');
});

test('review rejects a non-numeric --max-attempts', async () => {
  const errors = [];
  let exitCode = null;
  let startReviewLoopCalled = 0;

  await review(['task-2322', '--continue', '--max-attempts', 'lots'], {
    continueReviewClearsInterventionFn: async () => false,
    readReviewStateFn: async () => ({ round: 1 }),
    inferSlugFn: (s) => s || 'task-2322',
    log: () => {},
    error: (m) => errors.push(m),
    exit: (c) => { exitCode = c; },
    reviewLoopMechanisms: () => { startReviewLoopCalled += 1; return declinedLoop(); }
  });

  assert.equal(startReviewLoopCalled, 0);
  assert.equal(exitCode, 1);
  assert.ok(
    errors.some(e => /--max-attempts requires a positive integer/.test(e)),
    `expected a positive-integer error; got: ${errors.join(' | ')}`
  );
});

test('review operation precedence and push identity are pure policies (TASK-2668.07)', () => {
  assert.equal(reviewOperation(['--continue', '--status=true']), 'status');
  assert.equal(reviewOperation(['--comment-file=x']), 'comment');
  assert.equal(reviewOperation(['task-x', '--unknown']), 'status');
  assert.equal(reviewOperationPhase('continue'), 'review');
  assert.equal(reviewOperationPhase('status'), undefined);
  assert.deepEqual(reviewPushIdentity(null, null, false), { identity: 'autonomous', defaulted: true });
  assert.deepEqual(reviewPushIdentity(null, null, true), { identity: null, defaulted: false });
  assert.equal(reviewPushIdentity('autonomous', 'codex', true).identity, null);
  assert.equal(reviewPushIdentity('claude', 'codex', true).identity, 'claude');
  assert.equal(reviewPushIdentity(null, 'codex', true).identity, 'codex');
});

test('composed review continuation rejects a known mission without Review once and stops all downstream work (TASK-2696)', async () => {
  const slug = 'task-2696-repro';
  const store = inMemoryTransitionStore(fixtureMission(slug));
  const persistence = bindReviewPersistence(store, null);
  const errors = [];
  const exits = [];
  const effects = [];
  mock.method(store, 'save', async () => { effects.push('persist'); });
  const fake = fakeReviewLoopPorts({
    provider: { ensureReachable: async () => { effects.push('provider'); return true; } },
    routing: { nominate: () => { effects.push('reviewer'); return 'claude'; } },
    agents: { launch: async () => { effects.push('launch'); return {}; } },
    stateport: { persist: async () => { effects.push('round persistence'); } },
  });
  await review([slug, '--continue'], {
    inferSlugFn: () => slug,
    resolveWorktreeFn: () => null,
    log: () => {}, error: message => errors.push(message), exit: code => { exits.push(code); },
    requireReviewAggregate: true, missionStore: store,
    readReviewStateFn: persistence.readReviewState,
    continueReviewClearsInterventionFn: async () => { effects.push('clear intervention'); return false; },
    reviewLoopMechanisms: () => { effects.push('mechanisms'); return fake.ports; },
  });
  assert.deepEqual(effects, []);
  assert.deepEqual(exits, [1]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /no (?:valid )?Review (?:aggregate|persisted)/i);
  assert.ok(errors[0].includes(`px review ${slug} --start`));
});

for (const prerequisite of ['intervention', 'blocker']) {
  test(`continuation stops after a ${prerequisite} prerequisite failure when exit returns (TASK-2696)`, async () => {
    const errors = [];
    const exits = [];
    const effects = [];
    const store = inMemoryTransitionStore(fixtureMission('task-2696-failure'));
    mock.method(store, 'load', async () => { throw new Error('isolated store read failure'); });
    await review(['task-2696-failure', '--continue'], {
      inferSlugFn: () => 'task-2696-failure', resolveWorktreeFn: () => null,
      log: () => {}, error: message => errors.push(message), exit: code => { exits.push(code); },
      missionStore: store, readReviewStateFn: async () => ({ round: 2 }),
      ...(prerequisite === 'blocker' ? { continueReviewClearsInterventionFn: async () => false } : {}),
      reviewLoopMechanisms: () => { effects.push('dispatch'); return declinedLoop(); },
    });
    assert.deepEqual(exits, [1]);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /isolated store read failure/);
    assert.deepEqual(effects, []);
  });
}

test('resume without a persisted Review returns after one rejection without writes (TASK-2696)', async () => {
  const errors = [];
  const exits = [];
  const store = inMemoryTransitionStore(fixtureMission('task-2696-resume'));
  mock.method(store, 'save', async () => { assert.fail('resume must not persist a missing review'); });
  await review(['task-2696-resume', '--resume', '--actor', 'operator'], {
    inferSlugFn: () => 'task-2696-resume', resolveWorktreeFn: () => null,
    missionStore: store, log: () => {}, error: message => errors.push(message),
    exit: code => { exits.push(code); },
    reviewLoopMechanisms: () => { assert.fail('resume must not dispatch the loop'); },
  });
  assert.deepEqual(exits, [1]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /--start begins a review/);
});

test('continuation preserves unexpected helper errors (TASK-2696)', async () => {
  const failure = new Error('unexpected prerequisite failure');
  await assert.rejects(() => review(['task-2696-failure', '--continue'], {
    inferSlugFn: () => 'task-2696-failure', resolveWorktreeFn: () => null,
    readReviewStateFn: async () => ({ round: 2 }),
    continueReviewClearsInterventionFn: async () => { throw failure; },
    log: () => {}, error: () => {}, exit: () => {},
    reviewLoopMechanisms: () => { assert.fail('unexpected errors must stop dispatch'); },
  }), error => error === failure);
});
