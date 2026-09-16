// TASK-2517 F1 (round 2): the SC4 landed-payload predicate must detect a squash
// that landed on the *base branch*, because a landed mission's squash is created
// with `git merge --squash` onto the base branch and is never reachable from the
// mission worktree's HEAD. The HEAD-scoped `findExistingSquashCommit` returns
// null in exactly the incident scenario (the operator runs `px review`/`px
// active` from the retained mission worktree); the base-branch-scoped
// `findLandedSquashOnBaseBranch` must find it.
//
// This crosses the Git process boundary with a real temporary repository and a
// real retained worktree, so it runs in the integration layer.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const { findExistingSquashCommit, findLandedSquashOnBaseBranch } = await import('../src/adapters/cli/commands/integrate-conflict.js');

const slug = 'task-2517-f1';

/**
 * A repo whose `mission/<slug>` payload is squash-landed onto `main`, with a
 * retained worktree checked out on `mission/<slug>`. The operator stands in that
 * worktree, so `process.cwd()` is the mission worktree, not the base branch.
 */
function landedFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2517-f1-'));
  const git = (args: string[]) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
    return String(result.stdout).trim();
  };
  git(['init', '-b', 'main']);
  git(['config', 'user.email', 'test@parallix.test']);
  git(['config', 'user.name', 'Test']);
  fs.mkdirSync(path.join(root, 'missions', slug), { recursive: true });
  // The recorded base branch is `main`, exactly as a real mission carries it.
  fs.writeFileSync(path.join(root, 'missions', slug, 'MISSION.md'), `# Fixture\n\nBase-Branch: main\n`);
  git(['add', '.']);
  git(['commit', '-m', 'mission dir']);
  git(['checkout', '-b', `mission/${slug}`]);
  fs.writeFileSync(path.join(root, 'payload.txt'), 'landed payload\n');
  git(['add', '.']);
  git(['commit', '-m', 'payload']);
  git(['checkout', 'main']);
  // The landed squash: created on `main`, subject carries the mission-branch
  // prefix so the base-branch scan recognises it.
  git(['merge', '--squash', `mission/${slug}`]);
  git(['commit', '-m', `mission/${slug}: land stranded payload`]);
  const worktree = `${root}-${slug}`;
  git(['worktree', 'add', worktree, `mission/${slug}`]);
  return { root, worktree };
}

test('TASK-2517 F1: HEAD-scoped scan misses a base-branch squash; base-branch scan finds it from the mission worktree', () => {
  const { root, worktree } = landedFixture();
  try {
    // The operator stands in the retained mission worktree; that is the cwd the
    // SC4 predicate receives as `rootDir`.
    const cwd = worktree;
    assert.equal(spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, encoding: 'utf8' }).stdout.trim(), `mission/${slug}`);

    // The defect F1 diagnoses: the squash is unreachable from the mission
    // worktree HEAD, so the HEAD-scoped detector returns null.
    assert.equal(
      findExistingSquashCommit(cwd, slug),
      null,
      'the HEAD-scoped scan cannot see a squash that lives on the base branch',
    );

    // The fix: the base-branch-scoped scan finds the landed squash from the
    // mission worktree, regardless of the current HEAD.
    const landed = findLandedSquashOnBaseBranch(cwd, slug);
    assert.ok(landed, 'the base-branch scan locates the landed squash from the mission worktree');
    const subject = spawnSync('git', ['log', '-1', '--format=%s', landed], { cwd: root, encoding: 'utf8' }).stdout.trim();
    assert.ok(subject.startsWith(`mission/${slug}:`), `the landed commit carries the mission-branch subject, was ${subject}`);
  } finally {
    spawnSync('git', ['worktree', 'remove', '--force', worktree], { cwd: root });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('TASK-2517 F1: base-branch scan misses a payload that never landed on the base branch', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2517-f1-unlanded-'));
  const git = (args: string[]) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
    return String(result.stdout).trim();
  };
  try {
    git(['init', '-b', 'main']);
    git(['config', 'user.email', 'test@parallix.test']);
    git(['config', 'user.name', 'Test']);
    fs.mkdirSync(path.join(root, 'missions', slug), { recursive: true });
    fs.writeFileSync(path.join(root, 'missions', slug, 'MISSION.md'), `# Fixture\n\nBase-Branch: main\n`);
    git(['add', '.']);
    git(['commit', '-m', 'mission dir']);
    git(['checkout', '-b', `mission/${slug}`]);
    fs.writeFileSync(path.join(root, 'payload.txt'), 'unlanded payload\n');
    git(['add', '.']);
    git(['commit', '-m', 'payload']);
    // No squash merge onto main: the payload never lands on the recorded base.

    assert.equal(findLandedSquashOnBaseBranch(root, slug), null, 'an unlanded payload is never reported as landed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
