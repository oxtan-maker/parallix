import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBubblewrapArgs,
  resolveSandboxProfile,
  setBubblewrapProbeForTest
} from '../src/adapters/process/bubblewrap.js';

test.afterEach(() => {
  setBubblewrapProbeForTest(null);
});

/**
 * Regression for TASK-2391: a Bubblewrap-confined implementer inside a *linked*
 * Git worktree cannot `git add`/`commit` because the guard only binds the
 * worktree, while the per-worktree metadata (`index.lock`, refs, rebase-*)
 * lives under the parent repo's `.git/worktrees/<name>`. The writable grant
 * must include the Git-resolved common dir and per-worktree git dir.
 */

interface LinkedWorktree {
  parent: string;
  worktree: string;
  cleanup: () => void;
}

/**
 * Build a real temporary Git repository with one commit and one *linked*
 * worktree checked out on a second branch. The worktree's `.git` is a file
 * pointing at `<parent>/.git/worktrees/<name>` — exactly the layout the guard
 * must handle without assuming `.git` is a directory inside the checkout.
 */
function makeLinkedWorktree(): LinkedWorktree {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bwrap-wt-'));
  const parent = path.join(root, 'parent');
  fs.mkdirSync(parent);
  const git = (args: string[], cwd: string) => {
    const res = childProcess.spawnSync('git', args, {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'reg',
        GIT_AUTHOR_EMAIL: 'reg@test',
        GIT_COMMITTER_NAME: 'reg',
        GIT_COMMITTER_EMAIL: 'reg@test'
      }
    });
    if (res.status !== 0) {
      fs.rmSync(root, { recursive: true, force: true });
      throw new Error(`git ${args.join(' ')} failed: ${res.stderr?.toString() ?? res.error}`);
    }
    return res.stdout;
  };

  git(['init', '-q', '-b', 'main'], parent);
  git(['config', 'user.email', 'reg@test'], parent);
  git(['config', 'user.name', 'reg'], parent);
  fs.writeFileSync(path.join(parent, 'f.txt'), 'base\n');
  git(['add', 'f.txt'], parent);
  git(['commit', '-qm', 'base'], parent);
  git(['branch', 'topic'], parent);
  git(['checkout', '-q', 'topic'], parent);
  fs.writeFileSync(path.join(parent, 'f.txt'), 'topic\n');
  git(['add', 'f.txt'], parent);
  git(['commit', '-qm', 'topic'], parent);
  git(['checkout', '-q', 'main'], parent);

  const worktree = path.join(root, 'wtree');
  git(['worktree', 'add', '-q', '--detach', worktree], parent);

  return {
    parent,
    worktree,
    cleanup: () => {
      try { git(['worktree', 'prune'], parent); } catch { /* ignore */ }
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

/**
 * Run a `git` command inside the Bubblewrap-confined worktree for the given
 * workflow step. Returns the bwrap exit status (null on signal).
 */
function runConfinedGit(
  worktree: string,
  step: string,
  gitArgs: string[],
  artifactDir?: string
): number | null {
  setBubblewrapProbeForTest(() => true);
  const profile = resolveSandboxProfile(step, worktree, artifactDir ?? worktree, step === 'review' ? 'codex' : null);
  // The fixture lives under /tmp, but the production profile grants /tmp as a
  // convenience. Remove that unrelated permission so it cannot mask missing
  // Git metadata mounts in this regression.
  profile.optionalWritable = [];
  const args = [...buildBubblewrapArgs(profile, worktree), 'git', ...gitArgs];
  const res = childProcess.spawnSync('bwrap', args, { stdio: ['ignore', 'pipe', 'ignore'] });
  if (res.error) { throw res.error; }
  return res.status;
}

test('every implementer step can git add + commit in a linked worktree under bubblewrap', () => {
  for (const step of ['draft', 'execute', 'act-on-review', 'active']) {
    const wt = makeLinkedWorktree();
    try {
      // A real untracked file forces `git add` to write index.lock (not a no-op).
      fs.writeFileSync(path.join(wt.worktree, 'confined.txt'), `${step} change\n`);
      // Red before the fix: the worktree-only bind leaves the per-worktree
      // index.lock on a read-only filesystem, so `git add` exits non-zero.
      assert.equal(runConfinedGit(wt.worktree, step, ['add', 'confined.txt']), 0, `${step} can add`);
      assert.equal(runConfinedGit(wt.worktree, step, ['commit', '-qm', `${step} change`]), 0, `${step} can commit`);
    } finally { wt.cleanup(); }
  }
});

test('every implementer step continues a real rebase in a linked worktree under bubblewrap', () => {
  for (const step of ['draft', 'execute', 'act-on-review', 'active']) {
    const wt = makeLinkedWorktree();
    try {
      // Diverge `main` in the worktree, then rebase onto `topic` to force a
      // conflict that needs `git rebase --continue` to finish.
      fs.writeFileSync(path.join(wt.worktree, 'f.txt'), 'main-change\n');
      childProcess.spawnSync('git', ['commit', '-am', 'main-change'], { cwd: wt.worktree, stdio: 'ignore' });
      const rebase = childProcess.spawnSync('git', ['rebase', 'topic'], { cwd: wt.worktree, stdio: 'pipe' });
      assert.notEqual(rebase.status, 0, 'rebase must conflict so --continue is required');

      fs.writeFileSync(path.join(wt.worktree, 'f.txt'), 'resolved\n');
      assert.equal(runConfinedGit(wt.worktree, step, ['add', 'f.txt']), 0, `${step} can add during rebase`);
      // Red before the fix: rebase-merge lives under the parent common dir,
      // which the worktree-only bind keeps read-only.
      assert.equal(
        runConfinedGit(wt.worktree, step, ['-c', 'core.editor=true', 'rebase', '--continue']),
        0,
        `${step} can continue rebase`
      );
    } finally { wt.cleanup(); }
  }
});

test('resolveSandboxProfile grants the Git-resolved common dir and per-worktree git dir for an implementer step', () => {
  const wt = makeLinkedWorktree();
  try {
    const profiles = ['draft', 'execute', 'act-on-review', 'active']
      .map(step => [step, resolveSandboxProfile(step, wt.worktree)] as const);
    const commonDir = childProcess
      .spawnSync('git', ['-C', wt.worktree, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' })
      .stdout.trim();
    const gitDir = childProcess
      .spawnSync('git', ['-C', wt.worktree, 'rev-parse', '--absolute-git-dir'], { encoding: 'utf8' })
      .stdout.trim();
    assert.ok(commonDir, 'git resolves a common dir');
    assert.ok(gitDir, 'git resolves a per-worktree git dir');
    for (const [step, profile] of profiles) {
      assert.ok(profile.writable.includes(commonDir), `${step} writable set must include common dir ${commonDir}`);
      assert.ok(profile.writable.includes(gitDir), `${step} writable set must include git dir ${gitDir}`);
      assert.deepEqual(profile.gitMetadata, [commonDir, gitDir], `${step} retains the Git-resolved nested mount order`);
      const args = buildBubblewrapArgs(profile, wt.worktree);
      const commonBind = args.indexOf(commonDir);
      const gitBind = args.lastIndexOf(gitDir);
      assert.ok(commonBind >= 0 && gitBind > commonBind, `${step} binds common dir before per-worktree git dir`);
      assert.ok(!args.includes(wt.parent), `${step} must not bind the checkout parent writable`);
    }
    // The per-worktree git dir is nested under the common dir, so it is covered
    // by the common-dir bind; the guard must still derive it from git, not assume
    // a `.git` directory inside the checkout.
    assert.ok(gitDir.startsWith(commonDir), `git dir ${gitDir} must resolve under common dir ${commonDir}`);
  } finally { wt.cleanup(); }
});

test('reuses cached Git metadata without spawning Git again for the same worktree', () => {
  const wt = makeLinkedWorktree();
  try {
    const first = resolveSandboxProfile('active', wt.worktree);
    const mocked = test.mock.method(childProcess, 'spawnSync', () => {
      throw new Error('cached profile resolution must not spawn Git');
    });
    try {
      const second = resolveSandboxProfile('active', wt.worktree);
      assert.deepEqual(second.writable, first.writable);
      assert.notEqual(second.writable, first.writable, 'profiles must not share a mutable mount array');
    } finally { mocked.mock.restore(); }
  } finally { wt.cleanup(); }
});

test('reviewer args do not grant the git common dir writable and reviewer git add fails', () => {
  const wt = makeLinkedWorktree();
  const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bwrap-art-'));
  try {
    fs.writeFileSync(path.join(wt.worktree, 'reviewed.txt'), 'change\n');
    const profile = resolveSandboxProfile('review', wt.worktree, artifactDir, 'codex');
    const args = buildBubblewrapArgs(profile, wt.worktree).join(' ');
    const commonDir = childProcess
      .spawnSync('git', ['-C', wt.worktree, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' })
      .stdout.trim();
    const gitDir = childProcess
      .spawnSync('git', ['-C', wt.worktree, 'rev-parse', '--absolute-git-dir'], { encoding: 'utf8' })
      .stdout.trim();
    assert.equal(profile.worktreeWritable, false);
    assert.ok(!profile.writable.includes(commonDir), 'reviewer must not bind the git common dir writable');
    assert.ok(!profile.writable.includes(gitDir), 'reviewer must not bind the per-worktree git dir writable');
    assert.ok(!args.includes(`--bind ${commonDir} ${commonDir}`), 'reviewer args must not bind the common dir writable');
    assert.ok(!args.includes(`--bind ${gitDir} ${gitDir}`), 'reviewer args must not bind the per-worktree git dir writable');
    // A reviewer cannot stage: the worktree is read-only and no common dir grant exists.
    assert.notEqual(runConfinedGit(wt.worktree, 'review', ['add', 'reviewed.txt'], artifactDir), 0);
    // A host-staged change isolates commit verification from staging: the
    // reviewer still cannot write refs or other shared Git state.
    childProcess.spawnSync('git', ['add', 'reviewed.txt'], { cwd: wt.worktree, stdio: 'ignore' });
    assert.notEqual(runConfinedGit(wt.worktree, 'review', ['commit', '-qm', 'review must not commit'], artifactDir), 0);
  } finally { wt.cleanup(); fs.rmSync(artifactDir, { recursive: true, force: true }); }
});
