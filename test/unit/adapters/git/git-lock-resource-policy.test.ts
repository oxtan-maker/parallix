import { spawnAdmittedGit, runAdmittedGitAsync } from '../../../../src/adapters/git/git-mutation-admission.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp } from '../../../helpers/temp-dir.js';
import path from 'node:path';
import { gitLockPolicyFor, gitSubcommand, lockFamiliesFor, lockPathsFor } from '../../../../src/adapters/git/git-lock-resources.js';
import { heldGitLocks, inspectGitContention, createGitContentionPort } from '../../../../src/adapters/git/git-contention.js';

const DIRS = { worktreeGitDir: '/repo/.git/worktrees/mission', commonDir: '/repo/.git' };

test('observations avoid mutating admission while mutation families retain actual Git scope (TASK-2830)', () => {
  for (const args of [['status'], ['rev-parse', 'HEAD'], ['worktree', 'list'], ['config', '--get', 'user.email'], ['stash', 'list'], ['branch', '--show-current'], ['remote', 'get-url', 'review']]) {
    assert.equal(lockFamiliesFor(args), null, args.join(' '));
  }
  assert.deepEqual(lockFamiliesFor(['add', '.']), [{ family: 'index', scope: 'worktree' }]);
  assert.ok(lockFamiliesFor(['rebase', 'main'])?.some(f => f.family === 'head' && f.scope === 'worktree'));
  assert.ok(lockFamiliesFor(['fetch', 'review'])?.some(f => f.family === 'fetch-metadata' && f.scope === 'repository'));
  assert.deepEqual(lockFamiliesFor(['config', '--worktree', 'core.hooksPath', '/hooks']), [{ family: 'config', scope: 'worktree' }]);
  assert.ok(lockFamiliesFor(['worktree', 'add', '/other'])?.some(f => f.family === 'worktree-admin'));
  assert.deepEqual(gitSubcommand(['-C', '/repo', '-c', 'a=b', '--no-optional-locks', 'status']), { command: 'status', rest: [], prefix: ['-C', '/repo', '-c', 'a=b', '--no-optional-locks'] });
});

test('worktree index and HEAD stay local, shared metadata and worktree config use their true paths (TASK-2830)', () => {
  assert.deepEqual(lockPathsFor(DIRS, 'index').files, ['/repo/.git/worktrees/mission/index.lock']);
  assert.deepEqual(lockPathsFor(DIRS, 'head').files, ['/repo/.git/worktrees/mission/HEAD.lock']);
  assert.deepEqual(lockPathsFor(DIRS, 'config').files, ['/repo/.git/config.lock', '/repo/.git/worktrees/mission/config.worktree.lock']);
  assert.deepEqual(lockPathsFor(DIRS, 'fetch-metadata').files, ['/repo/.git/shallow.lock', '/repo/.git/worktrees/mission/FETCH_HEAD.lock']);
  assert.ok(!lockPathsFor(DIRS, 'worktree-admin').files.some(file => file.endsWith('/locked')));
  assert.equal(gitLockPolicyFor('worktree').maxWaitMs, null, 'unknown/external hook duration cannot justify abandonment');
  assert.equal(gitLockPolicyFor('repository', 500).maxWaitMs, 500, 'an explicit caller wall bound is supported');
});

test('filesystem lock evidence protects unknown owners and never mistakes an unrelated failure for contention (TASK-2830)', () => {
  const root = mkdtemp('px-lock-policy-');
  try {
    const dirs = { worktreeGitDir: root, commonDir: root };
    const lock = path.join(root, 'index.lock'); fs.writeFileSync(lock, 'external');
    const invocation = { cwd: root, args: ['add', '.'] };
    const result = { status: 128, stdout: '', stderr: `Unable to create '${lock}': File exists` };
    const evidence = inspectGitContention(result, invocation, dirs);
    assert.equal(evidence?.lockPath, lock); assert.equal(evidence?.removable, false);
    assert.equal(evidence?.owner, 'external-or-unknown');
    for (const stderr of ['invalid pathspec', `remote: cannot lock ${lock}`, `Permission denied ${lock}`, `No space left ${lock}`, `cannot lock ref ${lock}: expected abc`]) {
      assert.equal(inspectGitContention({ ...result, stderr }, invocation, dirs), null);
    }
    assert.equal(fs.readFileSync(lock, 'utf8'), 'external');
    fs.unlinkSync(lock);
    assert.equal(inspectGitContention(result, invocation, dirs), null, 'text without filesystem evidence is insufficient');
    fs.writeFileSync(path.join(root, 'locked'), 'intentional worktree marker');
    assert.deepEqual(heldGitLocks({ ...invocation, args: ['worktree', 'prune'] }, dirs), []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('persistent unknown lock waits until an explicit bound and cancellation preserves the lock (TASK-2830)', async () => {
  const root = mkdtemp('px-lock-wait-');
  try {
    const lock = path.join(root, 'index.lock'); fs.writeFileSync(lock, 'live-or-unknown');
    const evidence = heldGitLocks({ cwd: root, args: ['add', '.'] }, { worktreeGitDir: root, commonDir: root })[0];
    let notices = 0;
    const result = await createGitContentionPort(5).waitForRelease(evidence, { onWaiting: () => { notices++; } });
    assert.equal(result.stopReason, 'wait-limit'); assert.ok(notices > 0);
    assert.ok(result.attempts >= 2); assert.equal(fs.readFileSync(lock, 'utf8'), 'live-or-unknown');
    const controller = new AbortController(); controller.abort();
    assert.equal((await createGitContentionPort().waitForRelease(evidence, { signal: controller.signal })).stopReason, 'cancelled');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});


const SEQUENCER_MARKERS = ['rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'sequencer'];
function createSequencerMarker(root: string, name: string): string {
  const marker = path.join(root, name);
  if (name.startsWith('rebase-') || name === 'sequencer') {
    fs.mkdirSync(marker); fs.writeFileSync(path.join(marker, 'sentinel'), 'authoritative operation');
    return path.join(marker, 'sentinel');
  }
  fs.writeFileSync(marker, 'authoritative operation'); return marker;
}

test('sequencer starts return failed Git results without execution or lost state (TASK-2830 F1)', async () => {
  const root = mkdtemp('px-sequencer-refusal-');
  const dirs = { worktreeGitDir: root, commonDir: root };
  let executions = 0;
  const executed = (() => { executions++; return { status: 0, signal: null, stdout: '', stderr: '', pid: 0, output: [] }; }) satisfies NonNullable<Parameters<typeof spawnAdmittedGit>[2]>;
  try {
    for (const marker of SEQUENCER_MARKERS) {
      const sentinel = createSequencerMarker(root, marker);
      for (const command of ['rebase', 'merge', 'cherry-pick', 'revert', 'am', 'pull']) {
        const args = ['-C', root, command, ...(command === 'pull' ? ['--ff-only'] : ['main'])];
        const sync = spawnAdmittedGit(args, { encoding: 'utf8' }, executed, () => dirs);
        const asyncResult = await runAdmittedGitAsync(args, {}, async () => executed(), () => dirs);
        for (const result of [sync, asyncResult]) {
          assert.equal(result.status, 128); assert.equal(result.signal, null);
          assert.equal(result.stdout, ''); assert.ok(String(result.stderr).includes(marker));
          assert.ok(String(result.stderr).includes(root)); assert.match(String(result.stderr), /inspect git status/);
        }
        assert.equal(fs.readFileSync(sentinel, 'utf8'), 'authoritative operation');
      }
      fs.rmSync(path.join(root, marker), { recursive: true, force: true });
    }
    assert.equal(executions, 0, 'refused starts never execute Git or its hooks');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('push preserves its result contract independently of the invoking checkout sequencer (TASK-2830 F1)', async () => {
  const root = mkdtemp('px-sequencer-push-');
  const dirs = { worktreeGitDir: root, commonDir: root };
  let executions = 0;
  const executed = (() => { executions++; return { status: 0, signal: null, stdout: 'published explicit ref', stderr: '', pid: 0, output: [] }; }) satisfies NonNullable<Parameters<typeof spawnAdmittedGit>[2]>;
  try {
    for (const marker of SEQUENCER_MARKERS) {
      const sentinel = createSequencerMarker(root, marker);
      const args = ['-C', root, 'push', 'review', 'refs/heads/feature:refs/heads/feature'];
      const sync = spawnAdmittedGit(args, { encoding: 'utf8' }, executed, () => dirs);
      const asyncResult = await runAdmittedGitAsync(args, {}, async () => executed(), () => dirs);
      assert.equal(sync.status, 0); assert.equal(asyncResult.status, 0);
      assert.equal(sync.stdout, 'published explicit ref'); assert.equal(asyncResult.stdout, sync.stdout);
      assert.equal(fs.readFileSync(sentinel, 'utf8'), 'authoritative operation');
      fs.rmSync(path.join(root, marker), { recursive: true, force: true });
    }
    assert.equal(executions, 12, 'each sync/async push executes exactly once');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
