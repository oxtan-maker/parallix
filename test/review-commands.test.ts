// @ts-nocheck -- TASK-2328: partial test doubles from ESM seam migration; resolve in follow-up

import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { mockModule, installModuleMocks } from './lib/module-mock.js';
import { createRequire } from 'node:module';
import { ReviewCommandUseCase } from '../src/application/review-command-use-case.js';
import { createReviewCommand } from '../src/interfaces/cli/review.js';
const _require = createRequire(import.meta.url);
const missionUtils = mockModule<typeof import('../src/adapters/filesystem/mission-utils.js')>('../src/adapters/filesystem/mission-utils.js', import.meta.url);
const reviewModule = mockModule<typeof import('../src/adapters/review/review-commands.js')>('../src/adapters/review/review-commands.js', import.meta.url);
await installModuleMocks();
test.afterEach(() => mock.restoreAll());
const {
  flagValue,
  readTextFlag,
  formatStaticReviewFindings,
  formatStaticReviewSuccess,
  performStaticReview
} = reviewModule;
const review = (args, options = {}) =>
  createReviewCommand(new ReviewCommandUseCase(reviewModule.createReviewWorkflowAdapter(options)))(args, options);

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
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-readTextFlag-'));
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
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'static-review-placeholder-'));
  const missionDir = path.join(rootDir, 'missions', 'task-placeholder');
  const checkpointPath = path.join(missionDir, 'CP-1.md');

  fs.mkdirSync(missionDir, { recursive: true });
  fs.writeFileSync(checkpointPath, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| Works | Tested manually | Looks good |\n');
  mock.method(missionUtils, 'getPrimaryBranch', () => 'main');

  try {
    const result = performStaticReview('task-placeholder', {
      resolveWorktree: () => rootDir,
      findMissionDir: () => missionDir,
      findCheckpoints: () => [checkpointPath],
      readFileSync: fs.readFileSync,
      run: () => ({ status: 0, stdout: '' }),
      log: () => {}
    });

    assert.equal(result.ok, false);
    assert.ok(result.findings.some(f => /no evidence rows that cite a verifiable reference such as a file:line, ADR, test reference, or recognized repo command\/path/.test(f)));
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('performStaticReview accepts a shell command that references an existing repository file', (t) => {
  const { mock } = t;
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'static-review-shell-command-'));
  const missionDir = path.join(rootDir, 'missions', 'task-shell-command');
  const checkpointPath = path.join(missionDir, 'CP-1.md');
  fs.mkdirSync(missionDir, { recursive: true });
  fs.writeFileSync(path.join(rootDir, 'hello.sh'), '#!/usr/bin/env bash\necho hello\n');
  fs.writeFileSync(checkpointPath, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| Script works | `bash hello.sh` prints hello | PASS |\n');
  mock.method(missionUtils, 'getPrimaryBranch', () => 'main');

  try {
    const result = performStaticReview('task-shell-command', {
      resolveWorktree: () => rootDir,
      findMissionDir: () => missionDir,
      findCheckpoints: () => [checkpointPath],
      readFileSync: fs.readFileSync,
      run: () => ({ status: 0, stdout: '' }),
      log: () => {}
    });

    assert.equal(result.ok, true, result.findings.join('\n'));
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('performStaticReview rejects separator-only Goal Check tables', (t) => {
  const { mock } = t;
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'static-review-separator-'));
  const missionDir = path.join(rootDir, 'missions', 'task-separator');
  const checkpointPath = path.join(missionDir, 'CP-1.md');

  fs.mkdirSync(missionDir, { recursive: true });
  fs.writeFileSync(checkpointPath, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n|---|---|---|\n');
  mock.method(missionUtils, 'getPrimaryBranch', () => 'main');

  try {
    const result = performStaticReview('task-separator', {
      resolveWorktree: () => rootDir,
      findMissionDir: () => missionDir,
      findCheckpoints: () => [checkpointPath],
      readFileSync: fs.readFileSync,
      run: () => ({ status: 0, stdout: '' }),
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
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'static-review-test-name-'));
  const missionDir = path.join(rootDir, 'missions', 'task-test-name');
  const checkpointPath = path.join(missionDir, 'CP-1.md');
  const testFilePath = path.join(rootDir, 'test', 'sample.test.js');

  fs.mkdirSync(path.dirname(testFilePath), { recursive: true });
  fs.writeFileSync(testFilePath, "const test = _require('node:test');\ntest('real evidence title', () => {});\n");
  fs.mkdirSync(missionDir, { recursive: true });
  fs.writeFileSync(checkpointPath, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| Test title cited | test `real evidence title` | PASS |\n');
  mock.method(missionUtils, 'getPrimaryBranch', () => 'main');

  try {
    const result = performStaticReview('task-test-name', {
      resolveWorktree: () => rootDir,
      findMissionDir: () => missionDir,
      findCheckpoints: () => [checkpointPath],
      readFileSync: fs.readFileSync,
      run: () => ({ status: 0, stdout: '' }),
      log: () => {}
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.findings, []);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('performStaticReview accepts an existing repository checkpoint sample', (t) => {
  const { mock } = t;
  const repoRoot = path.resolve(import.meta.dirname, '..');
  const sampleMissionDir = path.join(repoRoot, 'missions', 'task-1398');
  const sampleCheckpoint = path.join(sampleMissionDir, 'CP-4.md');
  mock.method(missionUtils, 'getPrimaryBranch', () => 'main');

  const result = performStaticReview('task-1398', {
    resolveWorktree: () => repoRoot,
    findMissionDir: () => sampleMissionDir,
    findCheckpoints: () => [sampleCheckpoint],
    readFileSync: fs.readFileSync,
    run: () => ({ status: 0, stdout: '' }),
    log: () => {}
  });

  assert.deepEqual(result.findings, []);
  assert.equal(result.ok, true);
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
    startReviewLoopFn: async () => { startReviewLoopCalled += 1; },
    startAgentFn: async (step, opts) => { startAgentCalls.push({ step, opts }); },
    submitForReviewFn: async () => { submitForReviewCalled = true; },
    postStaticReviewCommentFn: () => { postStaticReviewCalled = true; },
    resolveWorktreeFn: () => '/tmp/wt-1259',
    readReviewStateFn: () => null,
    run: () => ({ status: 0 })
  });

  // SC1: the review loop must NOT start on the findings path.
  assert.equal(startReviewLoopCalled, 0,
    'startReviewLoopFn must NOT be called when static review finds trivial issues');

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
    startReviewLoopFn: async () => { startReviewLoopCalled += 1; },
    startAgentFn: async () => { startAgentCalled += 1; },
    resolveWorktreeFn: () => null,
    readReviewStateFn: () => null,
    run: () => ({ status: 0 })
  });

  // SC3: implementer unresolved ⇒ no agent launch, no review loop, WARN emitted.
  assert.equal(startAgentCalled, 0,
    'startAgentFn must not be called when the implementer cannot be resolved');
  assert.equal(startReviewLoopCalled, 0,
    'startReviewLoopFn must not be called when the implementer cannot be resolved');
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
  const { unknownReviewFlags } = reviewModule;
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
    startReviewLoopFn: async () => { startReviewLoopCalled += 1; }
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

  await review(['task-2322', '--continue', '--max-attempts', '7'], {
    inferSlugFn: (s) => s || 'task-2322',
    log: () => {},
    error: () => {},
    exit: () => {},
    startReviewLoopFn: async (_slug, opts) => { received = opts; }
  });

  assert.equal(received && received.maxAttempts, 7);
});

test('review rejects a non-numeric --max-attempts', async () => {
  const errors = [];
  let exitCode = null;
  let startReviewLoopCalled = 0;

  await review(['task-2322', '--continue', '--max-attempts', 'lots'], {
    inferSlugFn: (s) => s || 'task-2322',
    log: () => {},
    error: (m) => errors.push(m),
    exit: (c) => { exitCode = c; },
    startReviewLoopFn: async () => { startReviewLoopCalled += 1; }
  });

  assert.equal(startReviewLoopCalled, 0);
  assert.equal(exitCode, 1);
  assert.ok(
    errors.some(e => /--max-attempts requires a positive integer/.test(e)),
    `expected a positive-integer error; got: ${errors.join(' | ')}`
  );
});
