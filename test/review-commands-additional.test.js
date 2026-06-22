const test = require('node:test');
const assert = require('node:assert/strict');
const { pushRound, commentRound, submitReviewRound } = require('../lib/review/review-commands');
const mockRootDir = '/mock';

test('pushRound exits when no forgejoUser', () => {
  let exited = false;
  pushRound('test-slug', {
    resolveWorktreeFn: () => mockRootDir,
    readReviewStateFn: () => null,
    resolveTaskFileFn: () => ({ ok: false }),
    exit: (code) => { exited = true; },
    log: () => {},
    error: () => {}
  });
  assert.equal(exited, true);
});

test('commentRound exits when no forgejoUser', () => {
  let exited = false;
  commentRound('test-slug', 'msg', {
    readReviewStateFn: () => null,
    exit: (code) => { exited = true; },
    log: () => {},
    error: () => {},
    rootDir: mockRootDir
  });
  assert.equal(exited, true);
});

test('submitReviewRound exits when no forgejoUser', () => {
  let exited = false;
  submitReviewRound('test-slug', 'approve', 'msg', {
    readReviewStateFn: () => null,
    exit: (code) => { exited = true; },
    log: () => {},
    error: () => {},
    isForgejoReviewEnabledFn: () => true
  });
  assert.equal(exited, true);
});
