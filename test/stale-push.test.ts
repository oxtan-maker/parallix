

import test from 'node:test';
import assert from 'node:assert/strict';
import { mockModule, installModuleMocks } from './lib/module-mock.js';
const git = mockModule<typeof import('../src/adapters/git/git.js')>('../src/adapters/git/git.js', import.meta.url);
// Sub-modules must be declared so they re-link with the facaded git binding
const forgejoGit = mockModule<typeof import('../src/adapters/forgejo/forgejo-git.js')>('../src/adapters/forgejo/forgejo-git.js', import.meta.url);
const forgejoPr = mockModule<typeof import('../src/adapters/forgejo/forgejo-pr.js')>('../src/adapters/forgejo/forgejo-pr.js', import.meta.url);
const pushReviewRefModule = mockModule<typeof import('../src/adapters/forgejo/forgejo.js')>('../src/adapters/forgejo/forgejo.js', import.meta.url);
await installModuleMocks();
test.afterEach(() => mock.restoreAll());
const { pushReviewRef, isStaleInfoPushRejection } = pushReviewRefModule;
const { mock } = test;

test('pushReviewRef captures output allowing stale info detection (FIXED)', (t) => {
  mock.method(git, 'git', (args, options) => {
    assert.deepEqual(options.stdio, ['ignore', 'pipe', 'pipe'], 'Implementation should now use pipes');
    return {
      status: 1,
      stdout: '',
      stderr: 'error: failed to push some refs to ... stale info'
    };
  });

  // Mock process.stderr.write to avoid cluttering test output
  mock.method(process.stderr, 'write', () => {});

  const result = pushReviewRef('src', 'dest');

  const isStale = isStaleInfoPushRejection(result);
  assert.strictEqual(isStale, true, 'FIXED: Should now be detectable as stale');
});

test('isStaleInfoPushRejection detects various git stale messages when captured', (t) => {
  const cases = [
    { stderr: 'error: failed to push some refs to ... stale info', expected: true },
    { stderr: 'error: failed to push some refs to ... stale ref', expected: true },
    { stderr: 'error: failed to push some refs to ... fetch first', expected: true },
    { stderr: 'error: some other error', expected: false },
    { stderr: null, stdout: 'stale info', expected: true }, // just in case it's in stdout
  ];

  for (const { stderr, stdout, expected } of cases) {
    const result = { status: 1, stderr, stdout };
    assert.strictEqual(isStaleInfoPushRejection(result), expected, `Failed for stderr: ${stderr}`);
  }
});
