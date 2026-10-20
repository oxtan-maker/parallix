import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { mockModule, installModuleMocks } from '../../../../lib/module-mock.js';

const missionUtils = mockModule<typeof import('../../../../../src/adapters/filesystem/mission-utils.js')>(
  '../../../../../src/adapters/filesystem/mission-utils.js', import.meta.url);
await installModuleMocks();
const { createStatusStaleWorktreesAdapter, createStatusGitAdapter, createStatusPrAdapter } =
  await import('../../../../../src/adapters/cli/commands/status-adapter.js');
test.afterEach(() => mock.restoreAll());

// Migrated from status.test.ts and status-characterization-cp4.test.ts:
// exercise private porcelain parsing through the owning public adapter.
test('stale worktrees parse empty, malformed, detached and multiple porcelain entries', () => {
  mock.method(missionUtils, 'missionBranchPrefix', () => 'mission/');
  for (const stdout of ['', 'HEAD abc\nbranch refs/heads/main', 'worktree /detached\nHEAD abc']) {
    const port = createStatusStaleWorktreesAdapter({
      primaryWorktree: '/repo',
      gitRun: () => ({ status: 0, signal: null, stdout, stderr: '' }),
      findTaskFileFn: () => { throw new Error('non-mission entries must be ignored'); },
    });
    assert.deepEqual(port.findStaleWorktrees(null, '/repo'), []);
  }
  const stdout = [
    'worktree /repo', 'branch refs/heads/mission/primary', '',
    'worktree /other', 'branch refs/heads/feature', '',
    'worktree /active', 'branch refs/heads/mission/active', '',
    'worktree /done', 'branch refs/heads/mission/done', '',
    'worktree /missing', 'branch refs/heads/mission/missing',
  ].join('\n');
  const port = createStatusStaleWorktreesAdapter({
    primaryWorktree: '/repo',
    gitRun: () => ({ status: 0, signal: null, stdout, stderr: '' }),
    findTaskFileFn: slug => slug === 'missing' ? null : `/tasks/${slug}.md`,
    getTaskStatusFn: file => file.includes('done') ? 'done' : 'active',
  });
  assert.deepEqual(port.findStaleWorktrees(null, '/repo'), ['done', 'missing'].map(slug => ({
    slug, path: `/${slug}`, branch: `refs/heads/mission/${slug}`,
    taskStatus: slug, cleanupCommand: `px integrate ${slug} --recover-landed`,
  })));
});

test('stale worktrees skip Git for explicit slugs and tolerate failed Git', () => {
  let calls = 0;
  const port = createStatusStaleWorktreesAdapter({ primaryWorktree: '/repo',
    gitRun: () => { calls++; return { status: 1, signal: null, stdout: '', stderr: 'unavailable' }; },
  });
  assert.deepEqual(port.findStaleWorktrees('task-explicit', '/repo'), []);
  assert.equal(calls, 0);
  assert.deepEqual(port.findStaleWorktrees(null, '/repo'), []);
  assert.equal(calls, 1);
});

test('stale worktree rebase reads retain conflicts and tolerate disappearing worktrees', () => {
  const port = createStatusStaleWorktreesAdapter({ detectRebaseStateFn: path => {
    if (path === '/gone') { throw new Error('gone'); }
    return { inProgress: path === '/rebasing', detached: true, unmergedFiles: ['conflict.ts'] };
  } });
  const entries = ['/rebasing', '/clean', '/gone'].map(path => ({
    path, slug: path.slice(1), branch: null, taskStatus: 'done', cleanupCommand: 'cleanup',
  }));
  assert.deepEqual(port.getStaleWorktreeRebase(entries), {
    '/rebasing': { inProgress: true, detached: true, unmergedFiles: ['conflict.ts'] },
  });
});

test('status Git reports only detached rebases and PR failures become unavailable facts', () => {
  for (const inProgress of [false, true]) {
    for (const detached of [false, true]) {
      const state = { inProgress, detached, unmergedFiles: ['a', 'b'] };
      const port = createStatusGitAdapter({ detectRebaseStateFn: path => {
        assert.equal(path, '/repo'); return state;
      } });
      assert.deepEqual(port.getRebaseInfo('/repo'), inProgress && detached ? state : null);
    }
  }
  assert.equal(createStatusGitAdapter({ detectRebaseStateFn: () => { throw new Error('gone'); } }).getRebaseInfo('/repo'), null);
  const pr = createStatusPrAdapter({ rootDir: '/repo', getPrStatusFn: (branch, root) => {
    assert.equal(branch, 'mission/requested'); assert.equal(root, '/repo'); throw new Error('offline');
  } });
  assert.deepEqual(pr.getPrInfo('mission/requested'), { exists: false });
});
