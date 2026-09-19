// task-2489: `px lead` is started from any worktree, not only the primary
// checkout. Everything it acts through — the mission worktree it presses a
// command in or launches a recovery agent in, and the repository its operator
// database rows belong to — must resolve the same from a sibling worktree.
//
// Real git in a temporary repository: the property under test is what
// `git worktree list` reports from a linked worktree, which a fake cannot pin.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolveWorktree } from '../src/adapters/git/worktree.js';
import { resolveCanonicalRepositoryId } from '../src/adapters/git/repository-identity.js';

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

test('lead started in one mission worktree resolves a sibling mission worktree and the shared repository', (t) => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-lead-worktree-')));
  const primary = path.join(base, 'repo');
  const started = path.join(base, 'repo-task-lead');
  const stuck = path.join(base, 'repo-task-stuck');
  const previous = process.cwd();
  t.after(() => {
    process.chdir(previous);
    fs.rmSync(base, { recursive: true, force: true });
  });

  fs.mkdirSync(primary);
  git(primary, 'init', '-q', '-b', 'main');
  git(primary, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init');
  git(primary, 'worktree', 'add', '-q', '-b', 'mission/task-lead', started);
  git(primary, 'worktree', 'add', '-q', '-b', 'mission/task-stuck', stuck);

  process.chdir(started);

  assert.equal(resolveWorktree('task-stuck', { cwd: started }), stuck, 'the stuck mission worktree is found from a sibling');
  assert.equal(resolveCanonicalRepositoryId(started), resolveCanonicalRepositoryId(primary), 'one repository, whichever checkout started lead');
});
