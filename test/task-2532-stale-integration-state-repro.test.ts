// @ts-nocheck -- TASK-2532: reproduction drives a real temporary Git repository,
// so it crosses the git boundary and runs in the integration layer.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import { createBaseWorktreeRepair } from '../src/application/integrate/base-worktree-repair.js';

const { mock } = test;
test.afterEach(() => mock.restoreAll());

/** Run git against a working directory, throwing on a non-zero exit. */
function runGit(cwd, args) {
  const result = childProcess.spawnSync('git', args, { encoding: 'utf8', cwd });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed (exit ${result.status}): ${result.stderr.trim() || result.stdout.trim()}`);
  }
  return result.stdout;
}

/** A git runner that mirrors the application seam: the caller supplies `-C <rootDir>` inside each call. */
function gitRunner() {
  return (args) => childProcess.spawnSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Seed a throwaway Git repository on `main` with one commit and return its root. */
function seedRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2532-stale-'));
  runGit(root, ['init', '-q']);
  runGit(root, ['config', 'user.email', 'task-2532@test.com']);
  runGit(root, ['config', 'user.name', 'Task 2532']);
  fs.writeFileSync(path.join(root, 'file.txt'), 'hello\n', 'utf8');
  runGit(root, ['add', '.']);
  runGit(root, ['commit', '-q', '-m', 'initial commit']);
  runGit(root, ['branch', '-M', 'main']);
  return root;
}

/**
 * Force a live rebase in the repo: advance `main` past the mission branch on a
 * shared file so rebasing the mission onto main dead-ends on a conflict, which
 * leaves a `rebase-merge/` directory and an unmerged index behind.
 */
function seedDeadRebase(root) {
  // Diverge from the initial commit: the mission branch changes shared.txt first.
  runGit(root, ['checkout', '-q', '-b', 'mission/task-2532']);
  fs.writeFileSync(path.join(root, 'shared.txt'), 'mission version\n', 'utf8');
  runGit(root, ['add', '.']);
  runGit(root, ['commit', '-q', '-m', 'mission changes shared.txt']);
  // main advances on the same file, independently.
  runGit(root, ['checkout', '-q', 'main']);
  fs.writeFileSync(path.join(root, 'shared.txt'), 'main version\n', 'utf8');
  runGit(root, ['add', '.']);
  runGit(root, ['commit', '-q', '-m', 'main advances']);
  // Rebase the mission onto main -> conflict on shared.txt -> dead rebase left in progress.
  runGit(root, ['checkout', '-q', 'mission/task-2532']);
  const rebase = childProcess.spawnSync('git', ['rebase', 'main'], { encoding: 'utf8', cwd: root });
  if (rebase.status === 0) {
    throw new Error('expected the seed rebase to conflict; the dead-rebase fixture did not build');
  }
}

function stashList(root) {
  return runGit(root, ['stash', 'list']).trim();
}

function rebaseDirs(root) {
  const gitDir = runGit(root, ['rev-parse', '--git-dir']).trim();
  const abs = path.isAbsolute(gitDir) ? gitDir : path.join(root, gitDir);
  return ['rebase-merge', 'rebase-apply'].filter((d) => fs.existsSync(path.join(abs, d)));
}

function unmergedFiles(root) {
  return runGit(root, ['ls-files', '-u'])
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

function headSha(root) {
  return runGit(root, ['log', '-1', '--format=%H']).trim();
}

// SC1 / SC3: a marker-tagged stash is dropped; a non-marker stash is kept.
test('drops a marker-tagged integration stash and leaves a real stash untouched', async () => {
  const root = seedRepo();
  try {
    // A real, non-marker stash that must survive the sweep.
    runGit(root, ['checkout', '-q', '-b', 'wip']);
    fs.writeFileSync(path.join(root, 'notes.txt'), 'personal\n', 'utf8');
    runGit(root, ['add', '.']);
    runGit(root, ['commit', '-q', '-m', 'personal wip']);
    fs.writeFileSync(path.join(root, 'notes.txt'), 'personal edit\n', 'utf8');
    runGit(root, ['stash', 'push', '-m', 'my personal work in progress']);

    // A stale integration marker stash left by an interrupted integrate.
    runGit(root, ['checkout', '-q', 'main']);
    fs.writeFileSync(path.join(root, 'file.txt'), 'dirty\n', 'utf8');
    runGit(root, ['stash', 'push', '--include-untracked', '-m', 'integrate:task-001: temporary integration checkout stash']);

    const before = stashList(root);
    assert.ok(before.includes('my personal work in progress'), 'personal stash present before sweep');
    assert.ok(before.includes('integrate:task-001: temporary integration checkout stash'), 'marker stash present before sweep');

    const report = await createBaseWorktreeRepair({}).repairBaseWorktree({ baseWorktree: root, git: gitRunner() });

    const after = stashList(root);
    assert.ok(!after.includes('integrate:task-001: temporary integration checkout stash'), 'marker stash dropped by sweep');
    assert.ok(after.includes('my personal work in progress'), 'non-marker personal stash still present after sweep');
    assert.equal(report.markerStashesDropped, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// SC2: a live rebase-merge/ plus an unmerged index is aborted and cleared.
test('aborts a dead rebase and clears the unmerged index', async () => {
  const root = seedRepo();
  try {
    seedDeadRebase(root);

    assert.ok(rebaseDirs(root).length > 0, 'rebase directory present before repair');
    assert.ok(unmergedFiles(root).length > 0, 'unmerged index entries present before repair');

    const report = await createBaseWorktreeRepair({}).repairBaseWorktree({ baseWorktree: root, git: gitRunner() });

    assert.deepEqual(rebaseDirs(root), [], 'no rebase-* directories remain after repair');
    assert.deepEqual(unmergedFiles(root), [], 'unmerged index cleared after repair');
    const showCurrent = childProcess.spawnSync('git', ['rebase', '--show-current'], { encoding: 'utf8', cwd: root });
    assert.equal(showCurrent.stdout.trim(), '', 'no rebase in progress after repair');
    assert.equal(report.rebaseAborted, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// SC1 / SC3 / F1: two marker stashes above a non-marker stash. Dropping in
// ascending index order would renumber the stack and destroy the personal
// stash; descending order drops both markers and leaves the personal stash.
test('drops two marker stashes in descending order and keeps a non-marker stash', async () => {
  const root = seedRepo();
  try {
    // A real, non-marker stash that must survive the sweep.
    runGit(root, ['checkout', '-q', '-b', 'wip']);
    fs.writeFileSync(path.join(root, 'notes.txt'), 'personal\n', 'utf8');
    runGit(root, ['add', '.']);
    runGit(root, ['commit', '-q', '-m', 'personal wip']);
    fs.writeFileSync(path.join(root, 'notes.txt'), 'personal edit\n', 'utf8');
    runGit(root, ['stash', 'push', '-m', 'my personal work in progress']);

    // Two stale integration marker stashes left by two interrupted runs.
    runGit(root, ['checkout', '-q', 'main']);
    fs.writeFileSync(path.join(root, 'file.txt'), 'dirty a\n', 'utf8');
    runGit(root, ['stash', 'push', '--include-untracked', '-m', 'integrate:task-001: temporary integration checkout stash']);
    fs.writeFileSync(path.join(root, 'file.txt'), 'dirty b\n', 'utf8');
    runGit(root, ['stash', 'push', '--include-untracked', '-m', 'integrate:task-002: temporary integration checkout stash']);

    const before = stashList(root);
    assert.equal(before.split('\n').filter(Boolean).length, 3, 'three stashes before sweep');

    const report = await createBaseWorktreeRepair({}).repairBaseWorktree({ baseWorktree: root, git: gitRunner() });

    const after = stashList(root);
    assert.equal(after.split('\n').filter(Boolean).length, 1, 'only the personal stash remains');
    assert.ok(after.includes('my personal work in progress'), 'non-marker personal stash still present');
    assert.ok(!after.includes('integrate:task-001'), 'first marker stash dropped');
    assert.ok(!after.includes('integrate:task-002'), 'second marker stash dropped');
    assert.equal(report.markerStashesDropped, 2, 'both marker stashes dropped');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// F2: a dry run detects poison but mutates nothing (stash list + rebase state).
test('dry-run detects poison without mutating the base worktree', async () => {
  const root = seedRepo();
  try {
    runGit(root, ['checkout', '-q', 'main']);
    fs.writeFileSync(path.join(root, 'file.txt'), 'dirty\n', 'utf8');
    runGit(root, ['stash', 'push', '--include-untracked', '-m', 'integrate:task-001: temporary integration checkout stash']);

    const before = stashList(root);
    const report = await createBaseWorktreeRepair({}).repairBaseWorktree({
      baseWorktree: root,
      git: gitRunner(),
      dryRun: true,
    });

    assert.equal(stashList(root), before, 'stash list unchanged by dry run');
    assert.equal(report.markerStashesDropped, 1, 'dry run reports the poison it would drop');
    assert.equal(report.rebaseAborted, false, 'dry run aborts nothing');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// SC4: an already-clean base worktree is untouched.
test('leaves an already-clean base worktree unchanged', async () => {
  const root = seedRepo();
  try {
    const beforeStash = stashList(root);
    const beforeDirs = rebaseDirs(root);
    const beforeHead = headSha(root);

    const report = await createBaseWorktreeRepair({}).repairBaseWorktree({ baseWorktree: root, git: gitRunner() });

    assert.equal(stashList(root), beforeStash, 'stash list unchanged');
    assert.deepEqual(rebaseDirs(root), beforeDirs, 'rebase-* directory set unchanged');
    assert.equal(headSha(root), beforeHead, 'HEAD unchanged');
    assert.equal(report.markerStashesDropped, 0, 'no stashes dropped on a clean worktree');
    assert.equal(report.rebaseAborted, false, 'no rebase aborted on a clean worktree');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
