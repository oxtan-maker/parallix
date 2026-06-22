const test = require('node:test');
const assert = require('node:assert/strict');
const { syncMerged, isStaleInfoPushRejection } = require('../lib/tools/forgejo.js');
const git = require('../lib/core/git.js');
const { mock } = test;

test('syncMerged retries push on stale info rejection with strong assertions', async (t) => {
  const branch = 'mission/task-1065';
  const mergedCommit = 'abcd123';
  const rootDir = '/tmp/fake-root';
  
  let pushCalls = [];
  let fetchCalls = [];

  const options = {
    branch,
    mergedCommit,
    rootDir,
    forgejoUser: 'gemini',
    token: 'fake-token',
    log: () => {},
    resolvePrNumber: () => 1065,
    verifyCommit: () => ({ status: 0 }),
    // Mocking the inner functions passed via options
    gitPush: (commit, ref, dir, opts = {}) => {
      pushCalls.push({ commit, ref, opts });
      if (ref.includes('master') || ref.includes('main')) return { status: 0 };
      
      // First call for branch sync: return stale info
      if (pushCalls.length === 2) {
        return {
          status: 1,
          stderr: 'error: failed to push some refs to ... stale info',
          stdout: ''
        };
      }
      // Second call after fetch: success
      return { status: 0 };
    },
    gitFetch: (b, dir) => {
      fetchCalls.push(b);
      return { status: 0 };
    },
    apiCall: (method, path) => {
      if (path.includes('/merge')) return { ok: true };
      return { ok: true, data: {} };
    }
  };

  const result = await syncMerged(branch, mergedCommit, options);
  
  if (!result.ok) {
    console.error('syncMerged failed:', result);
  }
  assert.strictEqual(result.ok, true, 'syncMerged should succeed after retry');
  
  // Verify sequence
  // 1. Push to master (primary)
  // 2. Fetch branch
  // 3. Push to branch (fails with stale info)
  // 4. Fetch branch (retry)
  // 5. Push to branch again
  
  assert.strictEqual(pushCalls.length, 3, 'Should have called push 3 times (master, branch, branch-retry)');
  assert.strictEqual(fetchCalls.length, 2, 'Should have called fetch 2 times (before push, and after stale rejection)');
  
  assert.ok(pushCalls[0].ref === 'refs/heads/master' || pushCalls[0].ref === 'refs/heads/main', `Should push to primary branch, got ${pushCalls[0].ref}`);
  assert.strictEqual(pushCalls[1].ref, 'refs/heads/mission/task-1065');
  assert.strictEqual(pushCalls[1].opts.forceWithLease, true);
  
  assert.strictEqual(fetchCalls[1], 'mission/task-1065', 'Should have fetched the branch again after stale rejection');
  
  assert.strictEqual(pushCalls[2].ref, 'refs/heads/mission/task-1065');
  assert.strictEqual(pushCalls[2].opts.forceWithLease, true);
});

test('syncMerged retries push and falls back to force push if still stale', async (t) => {
  const branch = 'mission/task-1065';
  const mergedCommit = 'abcd123';
  
  let pushCalls = [];

  const options = {
    branch,
    mergedCommit,
    forgejoUser: 'gemini',
    token: 'fake-token',
    log: () => {},
    resolvePrNumber: () => 1065,
    verifyCommit: () => ({ status: 0 }),
    gitPush: (commit, ref, dir, opts = {}) => {
      pushCalls.push({ commit, ref, opts });
      if (ref.includes('master') || ref.includes('main')) return { status: 0 };
      
      // Always return stale info for force-with-lease
      if (opts.forceWithLease) {
        return {
          status: 1,
          stderr: 'error: failed to push some refs to ... stale info',
          stdout: ''
        };
      }
      // Success for plain force
      return { status: 0 };
    },
    gitFetch: () => ({ status: 0 }),
    apiCall: (method, path) => ({ ok: true })
  };

  const result = await syncMerged(branch, mergedCommit, options);
  
  assert.strictEqual(result.ok, true);
  
  // Sequence:
  // 1. push master
  // 2. push branch (fwl) -> stale
  // 3. fetch
  // 4. push branch (fwl) -> stale
  // 5. push branch (force) -> success
  
  assert.strictEqual(pushCalls.length, 4);
  assert.strictEqual(pushCalls[1].opts.forceWithLease, true);
  assert.strictEqual(pushCalls[2].opts.forceWithLease, true);
  assert.strictEqual(pushCalls[3].opts.force, true, 'Should have fallen back to force push');
  assert.strictEqual(pushCalls[3].opts.forceWithLease, undefined);
});
