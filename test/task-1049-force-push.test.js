const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createPr, pushReviewRef } = require('../lib/tools/forgejo.js');
const git = require('../lib/core/git.js');
const { mock } = test;
const serialTest = (name, fn) => test(name, { concurrency: false }, fn);

// task-1335 added a tree-verification proof to the createPr publish path. These
// tests exercise push-arg/force-with-lease behaviour against a synthetic rootDir
// that does not exist on disk, so the real proof capture would hit
// fs.realpathSync(rootDir) and throw ENOENT. Inject per-call stubs instead of
// mocking the shared verification module globally — module-level mocks plus the
// restoreAll() below churn global state that leaks into other test files during
// the bulk `node --test test/*.test.js` run. These stubs keep the createPr
// publish-guard regression coverage where it belongs (forgejo.test.js,
// integrate.test.js) untouched.
const stubVerifiedTreeProof = {
  captureVerifiedTreeProofFn: (area, rootDir) => ({
    ok: true,
    proof: {
      rootDir: path.resolve(rootDir),
      area,
      command: 'mock-verification',
      commit: 'abc123',
      tree: 'tree123',
      verifiedAt: '2026-01-01T00:00:00.000Z'
    }
  }),
  assertVerifiedTreeProofFn: (proof, rootDir) => {
    const resolvedRoot = path.resolve(rootDir);
    if (!proof || proof.rootDir !== resolvedRoot) {
      return { ok: false, error: 'verification proof does not match the tree being published' };
    }
    return { ok: true, proof };
  }
};

test.afterEach(() => {
  mock.restoreAll();
});

// Set env var before requiring modules that might use it at top level or during execution
process.env.PRIMARY_WORKTREE = '/tmp/fake-root';

serialTest('createPr includes explicit force-with-lease sha when forceWithLease is true', (t) => {
  const branch = 'mission/task-1049';
  const user = 'gemini';
  const token = 'fake-token';
  const rootDir = '/tmp/fake-root';

  let pushArgs = [];
  mock.method(git, 'git', (args) => {
    if (args.includes('branch') && args.includes('--list')) return { status: 0, stdout: 'main\n' };
    if (args.includes('rev-parse') && args.includes(`refs/remotes/review/${branch}^{commit}`)) {
      return { status: 0, stdout: 'lease-sha\n', stderr: '' };
    }
    if (args.includes('push') && args.includes(branch)) {
      pushArgs = args;
    }
    return { status: 0, stdout: '', stderr: '' };
  });

  const apiCall = mock.fn((method, apiPath) => {
    if (method === 'GET' && apiPath.includes('/pulls?state=open')) {
      return { ok: true, data: [] };
    }
    if (method === 'GET' && apiPath.includes('/pulls?state=all')) {
      return { ok: true, data: [] };
    }
    if (method === 'POST' && apiPath === '/pulls') {
      return { ok: true, data: { html_url: 'http://pr/1049', number: 1049 } };
    }
    return { ok: false };
  });

  const result = createPr(branch, user, token, { rootDir, apiCall, log: () => {}, forceWithLease: true, ...stubVerifiedTreeProof });
  assert.strictEqual(result.ok, true);
  assert.ok(
    pushArgs.includes(`--force-with-lease=refs/heads/${branch}:lease-sha`),
    'git push should include an explicit force-with-lease sha'
  );
});

serialTest('createPr does NOT include --force-with-lease when forceWithLease is false', (t) => {
  const branch = 'mission/task-1049';
  const user = 'gemini';
  const token = 'fake-token';
  const rootDir = '/tmp/fake-root';

  let pushArgs = [];
  mock.method(git, 'git', (args) => {
    if (args.includes('branch') && args.includes('--list')) return { status: 0, stdout: 'main\n' };
    if (args.includes('push') && args.includes(branch)) {
      pushArgs = args;
    }
    return { status: 0, stdout: '' };
  });

  const apiCall = mock.fn((method, apiPath) => {
    if (method === 'GET' && apiPath.includes('/pulls?state=open')) {
      return { ok: true, data: [] };
    }
    if (method === 'GET' && apiPath.includes('/pulls?state=all')) {
      return { ok: true, data: [] };
    }
    if (method === 'POST' && apiPath === '/pulls') {
      return { ok: true, data: { html_url: 'http://pr/1049', number: 1049 } };
    }
    return { ok: false };
  });

  const result = createPr(branch, user, token, { rootDir, apiCall, log: () => {}, forceWithLease: false, ...stubVerifiedTreeProof });
  assert.strictEqual(result.ok, true);
  assert.ok(!pushArgs.includes('--force-with-lease'), 'git push should NOT include --force-with-lease');
});

serialTest('pushReviewRef prioritizes forceWithLease over force', (t) => {
  let pushArgs = [];
  mock.method(git, 'git', (args) => {
    if (args.includes('push')) {
      pushArgs = args;
    }
    return { status: 0 };
  });

  // forceWithLease: true, force: true -> --force-with-lease
  pushReviewRef('src', 'dest', '/tmp', { force: true, forceWithLease: true });
  assert.ok(pushArgs.includes('--force-with-lease'));
  assert.ok(!pushArgs.includes('--force'));

  // forceWithLease: false, force: true -> --force
  pushReviewRef('src', 'dest', '/tmp', { force: true, forceWithLease: false });
  assert.ok(!pushArgs.includes('--force-with-lease'));
  assert.ok(pushArgs.includes('--force'));

  // forceWithLease: true, force: false -> --force-with-lease
  pushReviewRef('src', 'dest', '/tmp', { force: false, forceWithLease: true });
  assert.ok(pushArgs.includes('--force-with-lease'));
  assert.ok(!pushArgs.includes('--force'));
});

serialTest('review --push --force passes force:true to pushRound', async (t) => {
  const review = require('../lib/review/review.js');
  let pushRoundArgs = null;
  const options = {
    inferSlugFn: (s) => s || 'task-1049',
    pushRoundFn: (slug, opts) => { pushRoundArgs = opts; },
    exit: () => {},
    log: () => {},
    error: () => {}
  };

  await review(['task-1049', '--push', '--force'], options);
  assert.strictEqual(pushRoundArgs.force, true);

  await review(['task-1049', '--push'], options);
  assert.strictEqual(pushRoundArgs.force, false);
});

serialTest('handoff --force passes force:true to performHandoff', async (t) => {
  const handoffCommand = require('../lib/commands/handoff.js');
  let performHandoffArgs = null;
  
  // Mock performHandoff on the module exports
  const originalPerformHandoff = handoffCommand.performHandoff;
  handoffCommand.performHandoff = (slug, opts) => {
    performHandoffArgs = opts;
    return { ok: true };
  };

  try {
    await handoffCommand(['task-1049', '--force']);
    assert.strictEqual(performHandoffArgs.force, true);

    await handoffCommand(['task-1049']);
    assert.strictEqual(performHandoffArgs.force, false);
  } finally {
    handoffCommand.performHandoff = originalPerformHandoff;
  }
});

serialTest('rebase --push calls createPrFn with forceWithLease:true on success', async (t) => {
  const rebase = require('../lib/commands/rebase.js');

  let createPrOptions = null;
  const options = {
    inferSlugFn: (s) => s || 'task-1049',
    getCurrentBranchFn: () => 'mission/task-1049',
    findMissionDirFn: () => '/tmp/fake-root/docs/missions/2026/task-1049',
    findMissionAreaFn: () => 'workflow',
    gitFn: (args) => {
      if (args.includes('branch') && args.includes('--list')) return { status: 0, stdout: 'main\n', stderr: '' };
      if (args.includes('rebase')) {
        if (args.includes('main')) return { status: 0, stdout: '', stderr: '' };
        if (args.includes('--show-current')) return { status: 0, stdout: '', stderr: '' };
        return { status: 0, stdout: '', stderr: '' };
      }
      if (args.includes('fetch')) return { status: 0, stdout: '', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    },
    createPrFn: (branch, user, token, opts) => {
      createPrOptions = opts;
      return { ok: true, url: 'http://pr/1049' };
    },
    fetchReviewBranchFn: () => ({ status: 0, stdout: '', stderr: '' }),
    isForgejoReviewEnabledFn: () => true,
    readTokenFn: () => 'fake-token',
    resolveForgejoUserFn: () => 'gemini',
    exitFn: () => {},
    log: () => {},
    error: () => {}
  };

  await rebase(['task-1049', '--push'], options);
  assert.strictEqual(createPrOptions.forceWithLease, true);
});

serialTest('rebase without --push does NOT call createPrFn', async (t) => {
  const rebase = require('../lib/commands/rebase.js');

  let createPrCalled = false;
  const options = {
    inferSlugFn: (s) => s || 'task-1049',
    getCurrentBranchFn: () => 'mission/task-1049',
    findMissionDirFn: () => '/tmp/fake-root/docs/missions/2026/task-1049',
    findMissionAreaFn: () => 'workflow',
    gitFn: (args) => {
      if (args.includes('branch') && args.includes('--list')) return { status: 0, stdout: 'main\n', stderr: '' };
      if (args.includes('rebase')) {
        if (args.includes('main')) return { status: 0, stdout: '', stderr: '' };
        if (args.includes('--show-current')) return { status: 0, stdout: '', stderr: '' };
        return { status: 0, stdout: '', stderr: '' };
      }
      if (args.includes('fetch')) return { status: 0, stdout: '', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    },
    createPrFn: () => {
      createPrCalled = true;
      return { ok: true };
    },
    isForgejoReviewEnabledFn: () => true,
    exitFn: () => {},
    log: () => {},
    error: () => {}
  };

  await rebase(['task-1049'], options);
  assert.strictEqual(createPrCalled, false);
});

serialTest('rebase --push preserves push and dependencies in recursive calls (chained conflicts)', async (t) => {
  const rebase = require('../lib/commands/rebase.js');
  let createPrOptions = null;
  let rebaseAttempts = 0;
  let firstRebaseStarted = false;

  const options = {
    inferSlugFn: (s) => s || 'task-1049',
    getCurrentBranchFn: () => 'mission/task-1049',
    findMissionDirFn: () => '/tmp/fake-root/docs/missions/2026/task-1049',
    findMissionAreaFn: () => 'workflow',
    gitFn: (args) => {
      if (args.includes('branch') && args.includes('--list')) return { status: 0, stdout: 'main\n', stderr: '' };
      if (args.includes('rebase')) {
        if (args.includes('main')) {
          if (!firstRebaseStarted) {
            firstRebaseStarted = true;
            // First call starts rebase and hits conflict
            return { status: 1, stdout: 'CONFLICT (content): Merge conflict in file.md', stderr: '' };
          }
          // Recursive call: git rebase main reports "already in progress"
          return { status: 1, stdout: 'CONFLICT', stderr: '' };
        }
        if (args.includes('--show-current')) {
           // If we are in conflict resolution, rebase is in progress
           return { status: 0, stdout: rebaseAttempts < 2 ? 'mission/task-1049' : '', stderr: '' };
        }
        if (args.includes('--continue')) {
           rebaseAttempts++;
           if (rebaseAttempts === 1) {
             // First continue: report another conflict to trigger recursion
             return { status: 1, stdout: 'CONFLICT (content): Merge conflict in some-file.js', stderr: '' };
           }
           // Second continue: success
           return { status: 0, stdout: '', stderr: '' };
        }
        return { status: 0, stdout: '', stderr: '' };
      }
      if (args.includes('fetch')) return { status: 0, stdout: '', stderr: '' };
      if (args.includes('checkout')) return { status: 0, stdout: '', stderr: '' };
      if (args.includes('add')) return { status: 0, stdout: '', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    },
    resolveConflictsFn: () => ({ ok: true, conflictFiles: ['file.md'], missionSpecificFiles: ['file.md'], sharedFiles: [] }),
    createPrFn: (branch, user, token, opts) => {
      createPrOptions = opts;
      return { ok: true, url: 'http://pr/1049' };
    },
    fetchReviewBranchFn: () => ({ status: 0, stdout: '', stderr: '' }),
    isForgejoReviewEnabledFn: () => true,
    readTokenFn: () => 'fake-token',
    resolveForgejoUserFn: () => 'gemini',
    exitFn: () => {},
    log: () => {},
    error: () => {}
  };

  // Run with --push
  await rebase(['task-1049', '--push'], options);
  
  assert.strictEqual(rebaseAttempts, 2, 'Should have attempted rebase continue twice');
  assert.ok(createPrOptions, 'createPrFn should have been called');
  assert.strictEqual(createPrOptions.forceWithLease, true, 'Should have preserved forceWithLease');
});

serialTest('rebase --push does NOT push if agent returns success but rebase is still in progress', async (t) => {
  const rebase = require('../lib/commands/rebase.js');
  let createPrCalled = false;

  const options = {
    inferSlugFn: (s) => s || 'task-1049',
    getCurrentBranchFn: () => 'mission/task-1049',
    findMissionDirFn: () => '/tmp/fake-root/docs/missions/2026/task-1049',
    findMissionAreaFn: () => 'workflow',
    gitFn: (args) => {
      if (args.includes('branch') && args.includes('--list')) return { status: 0, stdout: 'main\n', stderr: '' };
      if (args.includes('rebase')) {
        if (args.includes('main')) return { status: 1, stdout: 'CONFLICT', stderr: '' };
        if (args.includes('--show-current')) {
           // Rebase is still in progress even after agent "success"
           return { status: 0, stdout: 'mission/task-1049', stderr: '' };
        }
      }
      return { status: 0, stdout: '', stderr: '' };
    },
    resolveConflictsFn: () => ({ ok: true, conflictFiles: ['shared.js'], missionSpecificFiles: [], sharedFiles: ['shared.js'] }),
    startAgentFn: () => ({ agent: 'test-agent', result: { status: 0 } }),
    createPrFn: () => {
      createPrCalled = true;
      return { ok: true };
    },
    isForgejoReviewEnabledFn: () => true,
    exitFn: () => {},
    log: () => {},
    error: () => {}
  };

  await rebase(['task-1049', '--push'], options);
  assert.strictEqual(createPrCalled, false, 'Should not have pushed because rebase was still in progress');
});

serialTest('rebase --push does NOT push if git rebase returns 0 but --show-current is non-empty', async (t) => {
  const rebase = require('../lib/commands/rebase.js');
  let createPrCalled = false;

  const options = {
    inferSlugFn: (s) => s || 'task-1049',
    getCurrentBranchFn: () => 'mission/task-1049',
    findMissionDirFn: () => '/tmp/fake-root/docs/missions/2026/task-1049',
    findMissionAreaFn: () => 'workflow',
    gitFn: (args) => {
      if (args.includes('branch') && args.includes('--list')) return { status: 0, stdout: 'main\n', stderr: '' };
      if (args.includes('rebase')) {
        if (args.includes('main')) return { status: 0, stdout: 'Already up to date', stderr: '' };
        if (args.includes('--show-current')) return { status: 0, stdout: 'mission/task-1049', stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    },
    createPrFn: () => {
      createPrCalled = true;
      return { ok: true };
    },
    isForgejoReviewEnabledFn: () => true,
    exitFn: () => {},
    log: () => {},
    error: () => {}
  };

  await rebase(['task-1049', '--push'], options);
  assert.strictEqual(createPrCalled, false, 'Should not have pushed because rebase --show-current was non-empty');
});

serialTest('createPr fails cleanly (no --force fallback) when stale push persists after fetch+retry', (t) => {
  const branch = 'mission/task-1089';
  const user = 'magnus';
  const token = 'fake-token';
  const rootDir = '/tmp/fake-root';

  let pushCallCount = 0;
  let sawForcePush = false;
  mock.method(git, 'git', (args) => {
    if (args.includes('branch') && args.includes('--list')) return { status: 0, stdout: 'main\n' };
    if (args.includes('rev-parse') && args.includes(`refs/remotes/review/${branch}^{commit}`)) {
      return { status: 0, stdout: 'lease-sha\n', stderr: '' };
    }
    if (args.includes('push') && args.includes(branch)) {
      pushCallCount++;
      if (args.includes('--force') && !args.includes('--force-with-lease')) sawForcePush = true;
      return { status: 1, stdout: '', stderr: 'error: failed to push some refs stale info' };
    }
    if (args.includes('fetch')) return { status: 0, stdout: '' };
    return { status: 0, stdout: '' };
  });

  mock.method(process.stderr, 'write', () => {});
  mock.method(process.stdout, 'write', () => {});

  const result = createPr(branch, user, token, { rootDir, apiCall: () => ({ ok: false }), log: () => {}, forceWithLease: true, ...stubVerifiedTreeProof });
  assert.strictEqual(result.ok, false, 'Should fail cleanly after two stale rejections');
  assert.strictEqual(pushCallCount, 2, 'Should attempt push exactly twice (no --force fallback)');
  assert.strictEqual(sawForcePush, false, 'Should never attempt a bare --force push');
});

serialTest('rebase --push ignores FORGEJO_USER and falls back to task identity', async (t) => {
  const rebase = require('../lib/commands/rebase.js');
  const previousUser = process.env.FORGEJO_USER;
  process.env.FORGEJO_USER = 'rebase-override';

  try {
    let resolvedUser = null;
    const options = {
      inferSlugFn: (s) => s || 'task-1049',
      getCurrentBranchFn: () => 'mission/task-1049',
      findMissionDirFn: () => '/tmp/fake-root/docs/missions/2026/task-1049',
      findMissionAreaFn: () => 'workflow',
      gitFn: (args) => {
        if (args.includes('branch') && args.includes('--list')) return { status: 0, stdout: 'main\n', stderr: '' };
        if (args.includes('--show-current')) return { status: 0, stdout: '', stderr: '' };
        return { status: 0, stdout: '', stderr: '' };
      },
      resolveTaskFileFn: (slug) => ({ ok: true, taskFile: '/tmp/task.md' }),
      getTaskImplementerFn: (file) => 'backlog-agent',
      resolveForgejoUserFn: (user) => user || 'fallback-magnus',
      fetchReviewBranchFn: () => ({ status: 0, stdout: '', stderr: '' }),
      isForgejoReviewEnabledFn: () => true,
      createPrFn: (branch, user) => {
        resolvedUser = user;
        return { ok: true, url: 'http://pr/1049' };
      },
      readTokenFn: () => 'fake-token',
      exitFn: () => {},
      log: () => {},
      error: () => {}
    };

    await rebase(['task-1049', '--push'], options);
    assert.strictEqual(resolvedUser, 'backlog-agent', 'Should have resolved user from backlog identity');
  } finally {
    if (previousUser) process.env.FORGEJO_USER = previousUser;
    else delete process.env.FORGEJO_USER;
  }
});
