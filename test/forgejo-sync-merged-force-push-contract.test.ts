// Historical regression provenance: TASK-1049, TASK-1080.
// Behavior-owned suite (TASK-2622.09, integration-ci): force-push safety and syncMerged hardening —
// review-ref force push (task-1049) and stale-info retry capture (task-1080). Legacy case names unchanged.
import test, { mock, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mockModule, installModuleMocks } from './lib/module-mock.js';

// Declaration order is load-bearing: installModuleMocks relinks modules in this order, so a
// module must be declared after the modules it depends on (merged from every section below).
mockModule('../src/adapters/git/git.js', import.meta.url);
mockModule('../src/adapters/forgejo/forgejo-git.js', import.meta.url);
mockModule('../src/adapters/forgejo/forgejo-pr.js', import.meta.url);
mockModule('../src/adapters/forgejo/forgejo.js', import.meta.url);
mockModule('../src/adapters/cli/commands/rebase.js', import.meta.url);
mockModule('../src/adapters/review/review-commands.js', import.meta.url);
await installModuleMocks();
const { ReviewCommandUseCase } = await import('../src/application/review-command-use-case.js');
const { createReviewCommand } = await import('../src/interfaces/cli/review.js');

// ---- task-1049 review ref force push (consolidated from test/task-1049-force-push.test.ts, TASK-2622.09) ----
describe("review ref force push", () => {
  const git = mockModule<typeof import('../src/adapters/git/git.js')>('../src/adapters/git/git.js', import.meta.url);
  // Sub-modules must be declared so they re-link with the facaded git binding
  // (forgejo.ts is a barrel that re-exports from these; without re-linking them,
  // their internal git imports stay bound to the original module).
  const forgejoGit = mockModule<typeof import('../src/adapters/forgejo/forgejo-git.js')>('../src/adapters/forgejo/forgejo-git.js', import.meta.url);
  const forgejoPr = mockModule<typeof import('../src/adapters/forgejo/forgejo-pr.js')>('../src/adapters/forgejo/forgejo-pr.js', import.meta.url);
  const createPrModule = mockModule<typeof import('../src/adapters/forgejo/forgejo.js')>('../src/adapters/forgejo/forgejo.js', import.meta.url);
  const rebaseModule = mockModule<typeof import('../src/adapters/cli/commands/rebase.js')>('../src/adapters/cli/commands/rebase.js', import.meta.url);
  const reviewModule = mockModule<typeof import('../src/adapters/review/review-commands.js')>('../src/adapters/review/review-commands.js', import.meta.url);

  const { createPr, pushReviewRef } = createPrModule;
  const rebase = rebaseModule.default;
  const review = (args, options = {}) =>
    createReviewCommand(new ReviewCommandUseCase(reviewModule.createReviewWorkflowAdapter(options)))(args, options);
  const { mock } = test;
  const serialTest = (name, fn) => test(name, { concurrency: false }, fn);

  const FAKE_ROOT = `/tmp/fake-root-${process.pid}`;

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
  const previousPrimaryWorktree = process.env.PRIMARY_WORKTREE;
  process.env.PRIMARY_WORKTREE = FAKE_ROOT;
  test.after(() => {
    if (previousPrimaryWorktree === undefined) delete process.env.PRIMARY_WORKTREE;
    else process.env.PRIMARY_WORKTREE = previousPrimaryWorktree;
  });

  serialTest('createPr includes explicit force-with-lease sha when forceWithLease is true', (t) => {
    const branch = 'mission/task-1049';
    const user = 'gemini';
    const token = 'fake-token';
    const rootDir = FAKE_ROOT;

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
    const rootDir = FAKE_ROOT;

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

  serialTest('rebase --push calls createPrFn with forceWithLease:true on success', async (t) => {

    let createPrOptions = null;
    const options = {
      inferSlugFn: (s) => s || 'task-1049',
      getCurrentBranchFn: () => 'mission/task-1049',
      findMissionDirFn: () => `${FAKE_ROOT}/docs/missions/2026/task-1049`,
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

    let createPrCalled = false;
    const options = {
      inferSlugFn: (s) => s || 'task-1049',
      getCurrentBranchFn: () => 'mission/task-1049',
      findMissionDirFn: () => `${FAKE_ROOT}/docs/missions/2026/task-1049`,
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
    let createPrOptions = null;
    let rebaseAttempts = 0;
    let firstRebaseStarted = false;

    const options = {
      inferSlugFn: (s) => s || 'task-1049',
      getCurrentBranchFn: () => 'mission/task-1049',
      findMissionDirFn: () => `${FAKE_ROOT}/docs/missions/2026/task-1049`,
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
    let createPrCalled = false;

    const options = {
      inferSlugFn: (s) => s || 'task-1049',
      getCurrentBranchFn: () => 'mission/task-1049',
      findMissionDirFn: () => `${FAKE_ROOT}/docs/missions/2026/task-1049`,
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
    let createPrCalled = false;

    const options = {
      inferSlugFn: (s) => s || 'task-1049',
      getCurrentBranchFn: () => 'mission/task-1049',
      findMissionDirFn: () => `${FAKE_ROOT}/docs/missions/2026/task-1049`,
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
    const rootDir = FAKE_ROOT;

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
    const previousUser = process.env.FORGEJO_USER;
    process.env.FORGEJO_USER = 'rebase-override';

    try {
      let resolvedUser = null;
      const options = {
        inferSlugFn: (s) => s || 'task-1049',
        getCurrentBranchFn: () => 'mission/task-1049',
        findMissionDirFn: () => `${FAKE_ROOT}/docs/missions/2026/task-1049`,
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
});

// ---- task-1080 syncMerged hardening (consolidated from test/task-1080-sync-merged-hardening.test.ts, TASK-2622.09) ----
describe("syncMerged hardening", () => {
  const syncMergedModule = mockModule<typeof import('../src/adapters/forgejo/forgejo.js')>('../src/adapters/forgejo/forgejo.js', import.meta.url);

  test.afterEach(() => mock.restoreAll());
  const { syncMerged } = syncMergedModule;
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
      // task-2520: reconcile reads the local/Forgejo base SHAs; a stable value for
      // both refs keeps the base in sync so reconciliation is a no-op.
      gitRunner: () => ({ status: 0, stdout: 'same-base-sha', stderr: '' }),
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

    // A base reconciliation fetch of the Forgejo primary precedes the branch
    // sync fetches that happen between the stale-retry pushes.
    assert.strictEqual(fetchCalls.length, 3, 'base reconciliation fetches the Forgejo primary, then the branch is fetched between stale retries');
    assert.strictEqual(fetchCalls[0].b, 'main');
    assert.strictEqual(fetchCalls[1].b, 'mission/task-1080');

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
      // task-2520: reconcile reads the local/Forgejo base SHAs; a stable value for
      // both refs keeps the base in sync so reconciliation is a no-op.
      gitRunner: () => ({ status: 0, stdout: 'same-base-sha', stderr: '' }),
      forgejoUser: 'test-user',
      token: 'test-token'
    };

    const result = syncMerged(branch, mergedCommit, options);

    assert.strictEqual(result.ok, false, 'Should fail because it cannot detect stale state');
    assert.strictEqual(result.error, 'push-branch-failed');
    assert.strictEqual(pushCalls.length, 2, 'Should NOT have retried');
  });
});
