// Behavior-owned suite (TASK-2622.09): Forgejo base synchronisation safety over recorded Git/Forgejo
// doubles — stale-info push detection (task-1080), syncMerged retry/force fallback, and diverged-base
// reconciliation (task-2520). Legacy case names unchanged.
import test, { mock, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mockModule, installModuleMocks } from './lib/module-mock.js';

// Declaration order is load-bearing: installModuleMocks relinks modules in this order, so a
// module must be declared after the modules it depends on (merged from every section below).
mockModule('../src/adapters/git/git.js', import.meta.url);
mockModule('../src/adapters/forgejo/forgejo-git.js', import.meta.url);
mockModule('../src/adapters/forgejo/forgejo-pr.js', import.meta.url);
mockModule('../src/adapters/forgejo/forgejo.js', import.meta.url);
await installModuleMocks();

// ---- stale push rejection detection (consolidated from test/stale-push.test.ts, TASK-2622.09) ----
describe("stale push rejection detection", () => {
  const git = mockModule<typeof import('../src/adapters/git/git.js')>('../src/adapters/git/git.js', import.meta.url);
  // Sub-modules must be declared so they re-link with the facaded git binding
  const forgejoGit = mockModule<typeof import('../src/adapters/forgejo/forgejo-git.js')>('../src/adapters/forgejo/forgejo-git.js', import.meta.url);
  const forgejoPr = mockModule<typeof import('../src/adapters/forgejo/forgejo-pr.js')>('../src/adapters/forgejo/forgejo-pr.js', import.meta.url);
  const pushReviewRefModule = mockModule<typeof import('../src/adapters/forgejo/forgejo.js')>('../src/adapters/forgejo/forgejo.js', import.meta.url);

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
});

// ---- syncMerged retry on stale info (consolidated from test/sync-merged-retry.test.ts, TASK-2622.09) ----
describe("syncMerged retry on stale info", () => {
  const syncMergedModule = mockModule<typeof import('../src/adapters/forgejo/forgejo.js')>('../src/adapters/forgejo/forgejo.js', import.meta.url);
  const git = mockModule<typeof import('../src/adapters/git/git.js')>('../src/adapters/git/git.js', import.meta.url);

  test.afterEach(() => mock.restoreAll());
  const { syncMerged, isStaleInfoPushRejection } = syncMergedModule;
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
      // task-2520: reconcile reads the local/Forgejo base SHAs; a stable value for
      // both refs keeps the base in sync so reconciliation is a no-op.
      gitRunner: () => ({ status: 0, stdout: 'same-base-sha', stderr: '' }),
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

    assert.strictEqual(pushCalls.length, 3, 'Should have called push 3 times (landed primary, branch, branch-retry)');
    // A base reconciliation fetch of the Forgejo primary precedes the branch fetches.
    assert.strictEqual(fetchCalls.length, 3, 'base reconciliation fetches the Forgejo primary before the branch sync fetches');
    assert.strictEqual(fetchCalls[0], 'main', 'reconcile fetches the Forgejo primary base first');

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
      // task-2520: reconcile reads the local/Forgejo base SHAs; a stable value for
      // both refs keeps the base in sync so reconciliation is a no-op.
      gitRunner: () => ({ status: 0, stdout: 'same-base-sha', stderr: '' }),
      gitPush: (commit, ref, dir, opts = {}) => {
        pushCalls.push({ commit, ref, opts });
        if (ref.includes('master') || ref.includes('main')) return { status: 0 };

        // Always return stale info for force-with-lease
  // @ts-expect-error -- Legacy fixture intentionally accesses runtime-only `forceWithLease` absent from its inferred mock shape.
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
});

// ---- task-2520 diverged base reconcile (consolidated from test/task-2520-diverged-base-reconcile.test.ts, TASK-2622.09) ----
describe("task-2520 diverged base reconcile", () => {
  /**
   * task-2520 — Forgejo base reconciliation before sync-merged.
   *
   * Captures the 2026-09-15 regression: local `main` was rewritten so Forgejo
   * `main` points at a non-ancestor commit whose tree is content-equivalent to
   * the local base. Without reconciliation `syncMerged` pushes the landed commit
   * straight at Forgejo `main` and fails `push-primary-failed` (non-fast-forward).
   * With reconciliation the base is first reconciled (force-with-lease pinned to
   * the fetched SHA) and the landed commit then fast-forwards.
   *
   * All Git/Forgejo boundaries are injected doubles; no live repository is used.
   */
  const syncMergedModule = mockModule<typeof import('../src/adapters/forgejo/forgejo.js')>('../src/adapters/forgejo/forgejo.js', import.meta.url);

  test.afterEach(() => mock.restoreAll());
  const { syncMerged } = syncMergedModule;

  const PRIMARY = 'main';

  /** gitRunner double: resolve base SHAs, divergence ancestry, and tree SHAs. */
  function baseGitRunner({ fetchedSha, localSha, ancestor }: { fetchedSha: string, localSha: string, ancestor: boolean }) {
    return (args: string[]) => {
      const cmd = args.join(' ');
      if (cmd.includes('^{tree}')) {
        // Content-equivalent bases share a tree; content-different bases differ.
        return { status: 0, stdout: (cmd.includes(fetchedSha) ? 'tree-remote' : 'tree-remote'), stderr: '' };
      }
      if (cmd.includes('rev-parse')) {
        if (cmd.includes('review/')) { return { status: 0, stdout: fetchedSha, stderr: '' }; }
        return { status: 0, stdout: localSha, stderr: '' };
      }
      if (cmd.includes('is-ancestor')) { return { status: ancestor ? 0 : 1 }; }
      return { status: 0, stdout: '', stderr: '' };
    };
  }

  test('diverged-but-content-equivalent Forgejo base is reconciled with force-with-lease, then the landed commit fast-forwards', async () => {
    const branch = 'mission/task-2520';
    const mergedCommit = 'landed-xyz';
    const fetchedSha = 'fetchedsha0000';
    const localSha = 'localsha00000000';

    let baseDiverged: boolean = true;
    const pushCalls: { src: string, dest: string, opts: any }[] = [];

    const result = await syncMerged(branch, mergedCommit, {
      branch,
      mergedCommit,
      rootDir: '/tmp/fake-root',
      forgejoUser: 'gemini',
      token: 'fake-token',
      baseBranch: PRIMARY,
      log: () => {},
      resolvePrNumber: () => 2520,
      verifyCommit: () => ({ status: 0 }),
      gitContainsCommit: () => ({ status: 1 }),
      gitRunner: baseGitRunner({ fetchedSha, localSha, ancestor: false }),
      gitFetch: () => ({ status: 0 }),
      gitPush: (src: string, dest: string, _dir: string, opts: any) => {
        pushCalls.push({ src, dest, opts });
        if (dest.includes(`/${PRIMARY}`)) {
          // Forgejo `main` diverged from local `main`. A pinned lease rewrites it;
          // once rewritten the landed commit is a fast-forward.
          if (opts?.forceWithLease) { baseDiverged = false; return { status: 0 }; }
          if (baseDiverged) {
            return { status: 1, stderr: '! [rejected] Updates were rejected ... non-fast-forward', stdout: '' };
          }
          return { status: 0 };
        }
        // Branch sync push.
        return { status: 0 };
      },
      apiCall: () => ({ ok: true }),
      gitDelete: () => ({ status: 0 })
    });

    assert.strictEqual(result.ok, true, 'landed commit reaches Forgejo after base reconciliation');

    // First primary push reconciles the base with a SHA-pinned force-with-lease.
    const reconcilePush = pushCalls.find(c => c.dest === `refs/heads/${PRIMARY}` && !!c.opts.forceWithLease);
    assert.ok(reconcilePush, 'a force-with-lease push reconciles the Forgejo base');
    assert.strictEqual(reconcilePush?.opts.forceWithLeaseRef, `${PRIMARY}:${fetchedSha}`, 'lease pinned to the freshly fetched Forgejo base SHA');
    assert.strictEqual(reconcilePush?.src, fetchedSha, 'pushes the fetched base SHA as the source ref');

    // The landed commit then reaches Forgejo through a fast-forward push.
    const landedPush = pushCalls.find(c => c.dest === `refs/heads/${PRIMARY}` && !c.opts.forceWithLease);
    assert.ok(landedPush, 'the landed commit is pushed to the Forgejo base');
    assert.ok(landedPush?.src === mergedCommit, 'landed commit is the merge result');

    // The base was non-ancestor, so no plain fast-forward reconcile path was taken;
    // the forced update cleared the divergence.
    assert.ok(!baseDiverged, 'forced update cleared the divergence');
  });

  test('ancestor Forgejo base is reconciled by a normal fast-forward push', async () => {
    const branch = 'mission/task-2520';
    const mergedCommit = 'landed-xyz';
    const fetchedSha = 'fetchedshaAnc';
    const localSha = 'localshaAdv';

    const pushCalls: { dest: string, opts: any }[] = [];
    const result = await syncMerged(branch, mergedCommit, {
      branch,
      mergedCommit,
      rootDir: '/tmp/fake-root',
      forgejoUser: 'gemini',
      token: 'fake-token',
      baseBranch: PRIMARY,
      log: () => {},
      resolvePrNumber: () => 2520,
      verifyCommit: () => ({ status: 0 }),
      gitContainsCommit: () => ({ status: 1 }),
      gitRunner: baseGitRunner({ fetchedSha, localSha, ancestor: true }),
      gitFetch: () => ({ status: 0 }),
      gitPush: (_src: string, dest: string, _dir: string, opts: any) => {
        pushCalls.push({ dest, opts });
        if (dest.includes(`/${PRIMARY}`)) { return { status: 0 }; }
        return { status: 0 };
      },
      apiCall: () => ({ ok: true }),
      gitDelete: () => ({ status: 0 })
    });

    assert.strictEqual(result.ok, true);
    const primaryPush = pushCalls.find(c => c.dest === `refs/heads/${PRIMARY}`);
    assert.ok(primaryPush, 'a push reaches the Forgejo base');
    assert.strictEqual(primaryPush?.opts.forceWithLease, undefined, 'ancestor base uses a normal push, not a force');
    assert.strictEqual(primaryPush?.opts.forceWithLeaseRef, undefined, 'and no lease is pinned');
  });

  test('content-different Forgejo base refuses the force push before any force update', async () => {
    const branch = 'mission/task-2520';
    const mergedCommit = 'landed-xyz';
    const fetchedSha = 'fetchedshaRem';
    const localSha = 'localshaNew';

    const pushCalls: { dest: string }[] = [];
    const result = await syncMerged(branch, mergedCommit, {
      branch,
      mergedCommit,
      rootDir: '/tmp/fake-root',
      forgejoUser: 'gemini',
      token: 'fake-token',
      baseBranch: PRIMARY,
      log: () => {},
      resolvePrNumber: () => 2520,
      verifyCommit: () => ({ status: 0 }),
      gitContainsCommit: () => ({ status: 1 }),
      // Diverged (non-ancestor) with a remote tree that differs from the local
      // base: the Forgejo base holds content absent from local `main`.
      gitRunner: ((args: string[]) => {
        const cmd = args.join(' ');
        if (cmd.includes('^{tree}')) {
          return { status: 0, stdout: cmd.includes(fetchedSha) ? 'tree-remote-unique' : 'tree-local-changed', stderr: '' };
        }
        if (cmd.includes('rev-parse')) {
          if (cmd.includes('review/')) { return { status: 0, stdout: fetchedSha, stderr: '' }; }
          return { status: 0, stdout: localSha, stderr: '' };
        }
        if (cmd.includes('is-ancestor')) { return { status: 1 }; }
        return { status: 0, stdout: '', stderr: '' };
      }),
      gitFetch: () => ({ status: 0 }),
      gitPush: (_src: string, dest: string, _dir: string) => {
        pushCalls.push({ dest });
        return { status: 0 };
      },
      apiCall: () => ({ ok: true }),
      gitDelete: () => ({ status: 0 })
    });

    assert.strictEqual(result.ok, false, 'integration aborts before any force push');
    const refused = result as { error: string, remoteSha?: string, localSha?: string };
    assert.strictEqual(refused.error, 'overwrite-refused', 'reports that overwrite was refused');
    assert.strictEqual(refused.remoteSha, fetchedSha, 'diagnostic names the fetched Forgejo base SHA');
    assert.strictEqual(refused.localSha, localSha, 'diagnostic names the local replacement SHA');
    assert.strictEqual(pushCalls.length, 0, 'no push — including the landed commit push — ran');
  });
});
