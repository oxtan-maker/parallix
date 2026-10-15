

import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { mockModule, installModuleMocks } from '../../lib/module-mock.js';
const pushRoundModule = mockModule<typeof import('../../../src/adapters/review/review-commands.js')>('../../../src/adapters/review/review-commands.js', import.meta.url);
await installModuleMocks();
test.afterEach(() => mock.restoreAll());
const { pushRound, commentRound, submitReviewRound } = pushRoundModule;
const mockRootDir = '/mock';

test('pushRound exits when no forgejoUser', async () => {
  let exited = false;
  await pushRound('test-slug', {
    resolveWorktreeFn: () => mockRootDir,
    readReviewStateFn: () => null,
    resolveTaskFileFn: () => ({ matches: [], reason: 'missing' as const,  ok: false as const }),
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
