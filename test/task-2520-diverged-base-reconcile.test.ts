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
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { mockModule, installModuleMocks } from './lib/module-mock.js';
const syncMergedModule = mockModule<typeof import('../src/adapters/forgejo/forgejo.js')>('../src/adapters/forgejo/forgejo.js', import.meta.url);
await installModuleMocks();
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
