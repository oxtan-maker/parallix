const test = require('node:test');
const assert = require('node:assert/strict');
const { pushReviewRef, isStaleInfoPushRejection } = require('../lib/tools/forgejo.js');
const git = require('../lib/core/git.js');
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
