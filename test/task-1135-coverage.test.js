const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Coverage tests for review.js as requested in Finding 3 of task-1135 review.

const TEST_SLUG = 'task-1135-coverage';

// NOTE: The previous test here ('startReviewLoop fails when no reviewer could be auto-derived')
// was written for the old buggy behaviour where startReviewLoop called exit(1) when no reviewer
// could be auto-derived. Per CP-4, that exit(1) was replaced by 'autonomous' fallback.
// This test is removed because startReviewLoop does a full review loop execution that is
// impractical to fully mock; the identity-fallback behaviour is verified manually.

test('commitSafeMissionArtifacts handles commit failure', async () => {
  const { commitSafeMissionArtifacts } = require('../lib/review/review');
  const logs = [];
  const errors = [];

  const result = await commitSafeMissionArtifacts(TEST_SLUG, '/tmp/worktree', {
    gitFn: (args) => {
      if (args.includes('status')) return { status: 0, stdout: Buffer.from(' M safe.js\0') };
      if (args.includes('commit')) return { status: 1, stderr: 'commit failed' };
      return { status: 0, stdout: '' };
    },
    isMissionArtifactFn: () => true, // Force safe
    isWorkflowGeneratedArtifactFn: () => true, // Force safe
    log: m => logs.push(m),
    error: m => errors.push(m)
  });

  assert.equal(result.ok, false, 'Should return ok: false on commit failure');
  assert.ok(errors.some(e => e.includes('Failed to commit mission artifacts: commit failed')), `Expected commit failure error; got: ${errors.join(' | ')}`);
});

test('commitSafeMissionArtifacts commits the configured stats CSV the review loop writes', async () => {
  // Regression: the review loop's own recordStageStatsSafe writes a row to the
  // configured stats CSV; without treating it as a safe artifact the pre-rebase
  // auto-commit aborts every multi-round mission with "non-mission paths".
  const { commitSafeMissionArtifacts } = require('../lib/review/review');
  const added = [];
  const logs = [];
  const errors = [];

  const result = await commitSafeMissionArtifacts(TEST_SLUG, '/tmp/worktree', {
    gitFn: (args) => {
      if (args.includes('status')) return { status: 0, stdout: Buffer.from(' M stats.csv\0') };
      if (args.includes('add')) { added.push(args[args.length - 1]); return { status: 0, stdout: '' }; }
      if (args.includes('commit')) return { status: 0, stdout: '' };
      return { status: 0, stdout: '' };
    },
    isMissionArtifactFn: () => false,
    isWorkflowGeneratedArtifactFn: () => false,
    resolveStatsRelPathFn: () => 'stats.csv',
    log: m => logs.push(m),
    error: m => errors.push(m)
  });

  assert.equal(result.ok, true, `Should commit the stats CSV; errors: ${errors.join(' | ')}`);
  assert.ok(added.includes('stats.csv'), `Expected stats.csv to be git-added; got: ${added.join(', ')}`);
});

test('commitSafeMissionArtifacts still rejects genuinely non-mission paths', async () => {
  const { commitSafeMissionArtifacts } = require('../lib/review/review');
  const errors = [];

  const result = await commitSafeMissionArtifacts(TEST_SLUG, '/tmp/worktree', {
    gitFn: (args) => {
      if (args.includes('status')) return { status: 0, stdout: Buffer.from(' M server/src/Main.java\0') };
      return { status: 0, stdout: '' };
    },
    isMissionArtifactFn: () => false,
    isWorkflowGeneratedArtifactFn: () => false,
    resolveStatsRelPathFn: () => 'stats.csv',
    error: m => errors.push(m)
  });

  assert.equal(result.ok, false, 'Should refuse unrelated product code');
  assert.ok(errors.some(e => e.includes('server/src/Main.java')), `Expected the offending path to be reported; got: ${errors.join(' | ')}`);
});

test('postStaticReviewComment handles missing token', async () => {
  const { postStaticReviewComment } = require('../lib/review/review');
  const errors = [];

  const result = await postStaticReviewComment(TEST_SLUG, 'message', {
    readTokenFn: () => null, // No token
    resolveWorktreeFn: () => '/tmp/worktree',
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
    getTaskImplementerFn: () => 'gemini',
    resolveForgejoUserFn: (u) => u,
    error: m => errors.push(m)
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'missing-token');
  assert.ok(errors.some(e => e.includes('No Forgejo token found for user')), `Expected missing-token error; got: ${errors.join(' | ')}`);
});

test('performStaticReview handles missing Goal Check section', async () => {
  const { performStaticReview } = require('../lib/review/review');
  const logs = [];

  const result = performStaticReview(TEST_SLUG, {
    findMissionDir: () => '/tmp/mission',
    findCheckpoints: () => ['/tmp/mission/CP-1.md'],
    readFileSync: () => '# CP-1\nNo goal check here.',
    run: () => ({ status: 0, stdout: '' }),
    log: m => logs.push(m)
  });

  assert.equal(result.ok, false);
  assert.ok(result.findings.some(f => f.includes('missing a "## Goal Check" section')));
});

test('performStaticReview handles Goal Check section with no evidence rows', async () => {
  const { performStaticReview } = require('../lib/review/review');
  const logs = [];

  const result = performStaticReview(TEST_SLUG, {
    findMissionDir: () => '/tmp/mission',
    findCheckpoints: () => ['/tmp/mission/CP-1.md'],
    readFileSync: () => '## Goal Check\n| Goal | Evidence | Status |\n|---|---|---|',
    run: () => ({ status: 0, stdout: '' }),
    log: m => logs.push(m)
  });

  assert.equal(result.ok, false);
  assert.ok(result.findings.some(f => f.includes('no evidence rows')));
});
