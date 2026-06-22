const test = require('node:test');
const assert = require('node:assert/strict');
const { syncMerged } = require('../lib/tools/forgejo.js');

test('syncMerged retries twice on stale info rejection with strong assertions', (t) => {
  const branch = 'mission/task-1080';
  const mergedCommit = 'abc1234';
  const logMessages = [];
  const pushCalls = [];
  const fetchCalls = [];

  const options = {
    log: (msg) => logMessages.push(msg),
    gitPush: (src, dest, dir, opts) => {
      pushCalls.push({ src, dest, opts });
      if (pushCalls.length === 1) {
        // First push: primary branch (SUCCESS)
        return { status: 0, stdout: '', stderr: '' };
      }
      if (pushCalls.length === 2) {
        // Second push: mission branch (FAIL - stale)
        return { 
          status: 1, 
          stdout: '', 
          stderr: 'error: failed to push some refs to ... stale info' 
        };
      }
      if (pushCalls.length === 3) {
        // Third push: mission branch retry after fetch (FAIL - still stale)
        return { 
          status: 1, 
          stdout: '', 
          stderr: 'error: failed to push some refs to ... fetch first' 
        };
      }
      // Fourth push: mission branch retry with force (SUCCESS)
      return { status: 0, stdout: '', stderr: '' };
    },
    gitFetch: (b, dir) => {
      fetchCalls.push({ b, dir });
      return { status: 0 };
    },
    verifyCommit: () => ({ status: 0 }),
    resolvePrNumber: () => 123,
    apiCall: () => ({ ok: true }),
    gitDelete: () => ({ status: 0 }),
    forgejoUser: 'test-user',
    token: 'test-token'
  };

  const result = syncMerged(branch, mergedCommit, options);

  assert.strictEqual(result.ok, true, 'syncMerged should succeed after retries');
  
  // Verify push sequence
  assert.strictEqual(pushCalls.length, 4, 'Should have 4 push calls (primary, mission, retry1, retry2)');
  
  // Call 1: Primary branch push
  assert.ok(pushCalls[0].dest.endsWith('main') || pushCalls[0].dest.endsWith('master'), `First push should be to primary branch (actual: ${pushCalls[0].dest})`);
  
  // Call 2: Mission branch push (initial)
  assert.strictEqual(pushCalls[1].dest, 'refs/heads/mission/task-1080');
  assert.strictEqual(pushCalls[1].opts.forceWithLease, true);

  // Call 3: Mission branch retry 1 (force-with-lease again)
  assert.strictEqual(pushCalls[2].dest, 'refs/heads/mission/task-1080');
  assert.strictEqual(pushCalls[2].opts.forceWithLease, true);
  
  // Call 4: Mission branch retry 2 (force)
  assert.strictEqual(pushCalls[3].dest, 'refs/heads/mission/task-1080');
  assert.strictEqual(pushCalls[3].opts.force, true);

  // Verify fetch happened between retries
  assert.strictEqual(fetchCalls.length, 2, 'Should have fetched twice (once before push, once after stale rejection)');
  assert.strictEqual(fetchCalls[0].b, 'mission/task-1080');

  // Verify log messages (qualitative assertion)
  assert.ok(logMessages.some(m => m.includes('branch sync rejected as stale')), 'Should log first rejection');
  assert.ok(logMessages.some(m => m.includes('force-with-lease still stale')), 'Should log second rejection');
});

test('syncMerged fails to retry if output is not captured (REPRODUCTION)', (t) => {
  const branch = 'mission/task-1080';
  const mergedCommit = 'abc1234';
  const pushCalls = [];

  const options = {
    log: () => {},
    gitPush: (src, dest, dir, opts) => {
      pushCalls.push({ src, dest, opts });
      if (pushCalls.length === 1) return { status: 0 };
      // Simulate stdio: inherit behavior (status 1, but no captured output)
      return { status: 1, stdout: '', stderr: '' };
    },
    gitFetch: () => ({ status: 0 }),
    verifyCommit: () => ({ status: 0 }),
    resolvePrNumber: () => 123,
    apiCall: () => ({ ok: true }),
    gitDelete: () => ({ status: 0 }),
    forgejoUser: 'test-user',
    token: 'test-token'
  };

  const result = syncMerged(branch, mergedCommit, options);

  assert.strictEqual(result.ok, false, 'Should fail because it cannot detect stale state');
  assert.strictEqual(result.error, 'push-branch-failed');
  assert.strictEqual(pushCalls.length, 2, 'Should NOT have retried');
});
