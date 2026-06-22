const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readComments, commentRound, submitReviewRound, closeMissionPr, readTextFlag } = require('../lib/review/review');

const TEST_SLUG = 'task-test-identity-fail';

function reviewStateStub(reviewer = 'claude', implementer = 'mistral') {
  return {
    reviewer,
    implementer,
    round: 1,
    phase: 'reviewing',
    startedAt: '2026-05-25T19:35:13Z'
  };
}

async function captureExit(fn) {
  const originalExit = process.exit;
  const originalError = console.error;
  const originalLog = console.log;
  const errors = [];
  let exitCode = null;

  process.exit = (code) => {
    exitCode = code;
    throw new Error(`process.exit(${code})`);
  };
  console.error = (...args) => errors.push(args.join(' '));
  console.log = () => {}; 

  try {
    await fn();
  } catch (err) {
    if (!err.message.startsWith('process.exit(')) throw err;
  } finally {
    process.exit = originalExit;
    console.error = originalError;
    console.log = originalLog;
  }

  return { exitCode, errors };
}

test('readComments falls back to review-state identity when FORGEJO_USER is missing', async () => {
  const originalUser = process.env.FORGEJO_USER;
  delete process.env.FORGEJO_USER;

  try {
    const logs = [];
    const { exitCode, errors } = await captureExit(async () => {
      await readComments(TEST_SLUG, {
        readReviewStateFn: () => reviewStateStub('claude', 'mistral'),
        readTokenFn: () => 'token-123',
        getCommentsFn: async () => [],
        isForgejoReviewEnabledFn: () => true,
        log: (line) => logs.push(line)
      });
    });
    assert.equal(exitCode, null);
    assert.equal(errors.length, 0);
    assert.ok(logs.some(line => line.includes('Reading PR comments on mission/task-test-identity-fail as claude')));
  } finally {
    process.env.FORGEJO_USER = originalUser;
  }
});

test('commentRound falls back to review-state identity when FORGEJO_USER is missing', async () => {
  const originalUser = process.env.FORGEJO_USER;
  delete process.env.FORGEJO_USER;

  try {
    const writes = [];
    const { exitCode, errors } = await captureExit(() => commentRound(TEST_SLUG, 'test message', {
      readReviewStateFn: () => reviewStateStub('claude', 'mistral'),
      writeReviewStateFn: (slug, state) => writes.push({ slug, reviewer: state.reviewer }),
      postCommentFn: () => ({ ok: true }),
      readTokenFn: () => 'token-123'
    }));
    assert.equal(exitCode, null);
    assert.equal(errors.length, 0);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].reviewer, 'claude');
  } finally {
    process.env.FORGEJO_USER = originalUser;
  }
});

test('readTextFlag prefers file content for multiline markdown bodies', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-text-flag-'));
  const commentPath = path.join(tempDir, 'comment.md');
  fs.writeFileSync(commentPath, '## Header\n\n`code`\n', 'utf8');

  try {
    const value = readTextFlag(
      ['--comment-file', commentPath, '--comment', 'inline fallback'],
      '--comment',
      '--comment-file',
      'comment'
    );
    assert.equal(value, '## Header\n\n`code`');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('submitReviewRound falls back to review-state identity when FORGEJO_USER is missing', async () => {
  const originalUser = process.env.FORGEJO_USER;
  delete process.env.FORGEJO_USER;

  try {
    const writes = [];
    const { exitCode, errors } = await captureExit(() => submitReviewRound(TEST_SLUG, 'approve', 'test summary', {
      readReviewStateFn: () => reviewStateStub('claude', 'mistral'),
      writeReviewStateFn: (slug, state) => writes.push({ slug, disposition: state.disposition, phase: state.phase }),
      postReviewFn: () => ({ ok: true }),
      readTokenFn: () => 'token-123',
      isForgejoReviewEnabledFn: () => true
    }));
    assert.equal(exitCode, null);
    assert.equal(errors.length, 0);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].disposition, 'APPROVED');
  } finally {
    process.env.FORGEJO_USER = originalUser;
  }
});

test('submitReviewRound ignores FORGEJO_USER and uses review-state identity', async () => {
  const originalUser = process.env.FORGEJO_USER;
  process.env.FORGEJO_USER = 'override-reviewer';

  try {
    let capturedUser = null;
    const { exitCode, errors } = await captureExit(() => submitReviewRound(TEST_SLUG, 'approve', 'test summary', {
      readReviewStateFn: () => reviewStateStub('state-reviewer', 'state-implementer'),
      writeReviewStateFn: () => {},
      postReviewFn: () => ({ ok: true }),
      readTokenFn: (user) => {
        capturedUser = user;
        return 'token-123';
      },
      isForgejoReviewEnabledFn: () => true,
      getPrAuthorFn: () => 'different-author'
    }));
    assert.equal(exitCode, null);
    assert.equal(errors.length, 0);
    assert.equal(capturedUser, 'state-reviewer');
  } finally {
    if (originalUser === undefined) delete process.env.FORGEJO_USER;
    else process.env.FORGEJO_USER = originalUser;
  }
});

test('closeMissionPr falls back to review-state identity when FORGEJO_USER is missing', async () => {
  const originalUser = process.env.FORGEJO_USER;
  delete process.env.FORGEJO_USER;

  try {
    const logs = [];
    const { exitCode, errors } = await captureExit(() => closeMissionPr(TEST_SLUG, {
      readReviewStateFn: () => reviewStateStub('claude', 'mistral'),
      readTokenFn: () => 'token-123',
      closePrFn: async () => ({ ok: true }),
      log: (line) => logs.push(line)
    }));
    assert.equal(exitCode, null);
    assert.equal(errors.length, 0);
    assert.ok(logs.some(line => line.includes('Closing PR')));
  } finally {
    process.env.FORGEJO_USER = originalUser;
  }
});
