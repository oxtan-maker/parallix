
const test = require('node:test');
const assert = require('node:assert/strict');
const { pushRound, commentRound, submitReviewRound } = require('../.test-runtime/adapters/review/review-commands.js');
const mockRootDir = '/mock';

test('pushRound exits when no forgejoUser', async () => {
  let exited = false;
  await pushRound('test-slug', {
    resolveWorktreeFn: () => mockRootDir,
    readReviewStateFn: () => null,
    resolveTaskFileFn: () => ({ ok: false }),
    exit: (code) => { exited = true; },
    log: () => {},
    error: () => {}
  });
  assert.equal(exited, true);
});

test('commentRound exits when no forgejoUser', async () => {
  let exited = false;
  await commentRound('test-slug', 'msg', {
    readReviewStateFn: () => null,
    exit: (code) => { exited = true; },
    log: () => {},
    error: () => {},
    rootDir: mockRootDir
  });
  assert.equal(exited, true);
});

test('submitReviewRound exits when no forgejoUser', async () => {
  let exited = false;
  await submitReviewRound('test-slug', 'approve', 'msg', {
    readReviewStateFn: () => null,
    exit: (code) => { exited = true; },
    log: () => {},
    error: () => {},
    isForgejoReviewEnabledFn: () => true
  });
  assert.equal(exited, true);
});
