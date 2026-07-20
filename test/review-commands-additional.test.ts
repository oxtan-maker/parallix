// @ts-nocheck -- TASK-2277: preserve legacy CommonJS mock behavior while mock-shape typings are hardened separately.

const test = require('node:test');
const assert = require('node:assert/strict');
const { pushRound, commentRound, submitReviewRound } = require('../dist/lib/review/review-commands');
const mockRootDir = '/mock';

test('pushRound exits when no forgejoUser', () => {
  let exited = false;
  pushRound('test-slug', {
    resolveWorktreeFn: () => mockRootDir,
    readReviewStateFn: () => null,
    // @ts-expect-error TS2322 Type '{ ok: false; }' is not assignable to type '{ ok: boolean; taskFile: string
    resolveTaskFileFn: () => ({ ok: false }),
    // @ts-expect-error TS2322 Type '(code: number) => void' is not assignable to type '(_code: number) => neve
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
    // @ts-expect-error TS2322 Type '(code: number) => void' is not assignable to type '(_code: number) => neve
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
    // @ts-expect-error TS2322 Type '(code: number) => void' is not assignable to type '(_code: number) => neve
    exit: (code) => { exited = true; },
    log: () => {},
    error: () => {},
    isForgejoReviewEnabledFn: () => true
  });
  assert.equal(exited, true);
});
