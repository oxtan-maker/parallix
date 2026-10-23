import { repositoryId } from '../../../../../src/domain/repository.js';
import { fixtureMission } from '../../../../fixtures/mission-builders.js';
import { missionVersion } from '../../../../../src/application/domain-ports.js';
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { mockModule, installModuleMocks } from '../../../../lib/module-mock.js';

const backlog = mockModule<typeof import('../../../../../src/adapters/backlog/backlog.js')>(
  '../../../../../src/adapters/backlog/backlog.js', import.meta.url);
const missionUtils = mockModule<typeof import('../../../../../src/adapters/filesystem/mission-utils.js')>(
  '../../../../../src/adapters/filesystem/mission-utils.js', import.meta.url);
await installModuleMocks();
const { createStatusStaleWorktreesAdapter, createStatusGitAdapter, createStatusPrAdapter } =
  await import('../../../../../src/adapters/cli/commands/status-adapter.js');
test.afterEach(() => mock.restoreAll());

// Migrated from status.test.ts and status-characterization-cp4.test.ts:
// exercise private porcelain parsing through the owning public adapter.
test('stale worktrees parse empty, malformed, detached and multiple porcelain entries', async () => {
  for (const stdout of ['', 'HEAD abc\nbranch refs/heads/main', 'worktree /detached\nHEAD abc']) {
    const port = createStatusStaleWorktreesAdapter({
      primaryWorktree: '/repo',
      gitRun: () => ({ status: 0, signal: null, stdout, stderr: '' }),
      missionStore: { load: async () => { throw new Error('non-mission entries must be ignored'); } },
    });
    assert.deepEqual(await port.findStaleWorktrees(null, '/repo'), []);
  }
  const stdout = [
    'worktree /repo', 'branch refs/heads/mission/task-primary', '',
    'worktree /other', 'branch refs/heads/feature', '',
    'worktree /active', 'branch refs/heads/mission/task-active', '',
    'worktree /done', 'branch refs/heads/mission/task-done', '',
    'worktree /missing', 'branch refs/heads/mission/task-missing',
  ].join('\n');
  const port = createStatusStaleWorktreesAdapter({
    primaryWorktree: '/repo',
    gitRun: () => ({ status: 0, signal: null, stdout, stderr: '' }),
    missionStore: { load: async id => ({ kind: 'found',
      mission: fixtureMission(id, { status: id === 'task-active' ? 'active' : 'done' }), version: missionVersion(1) }) },
  });
  assert.deepEqual(await port.findStaleWorktrees(null, '/repo'), ['done', 'missing'].map(slug => ({
    slug: `task-${slug}`, path: `/${slug}`, branch: `refs/heads/mission/task-${slug}`,
    taskStatus: 'done', cleanupCommand: `px integrate task-${slug} --recover-landed`,
  })));
});

test('stale worktrees skip Git for explicit slugs and tolerate failed Git', async () => {
  let calls = 0;
  const port = createStatusStaleWorktreesAdapter({ primaryWorktree: '/repo',
    gitRun: () => { calls++; return { status: 1, signal: null, stdout: '', stderr: 'unavailable' }; },
  });
  assert.deepEqual(await port.findStaleWorktrees('task-explicit', '/repo'), []);
  assert.equal(calls, 0);
  assert.deepEqual(await port.findStaleWorktrees(null, '/repo'), []);
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

for (const status of ['active', 'review', 'integration'] as const) {
  for (const mirror of ['missing', 'done'] as const) {
    test(`authoritative ${status} Mission suppresses stale worktree with ${mirror} mirror (TASK-2801)`, async () => {
      mock.method(backlog, 'findTaskFile', () => mirror === 'missing' ? null : '/tasks/live.md');
      mock.method(backlog, 'getTaskStatus', () => 'done');
      const port = createStatusStaleWorktreesAdapter({
        primaryWorktree: '/repo',
        gitRun: () => ({ status: 0, signal: null,
          stdout: 'worktree /live\nbranch refs/heads/mission/task-live', stderr: '' }),
        missionStore: { load: async () => ({ kind: 'found', mission: fixtureMission('task-live', { status }), version: missionVersion(1) }) },
      });
      assert.deepEqual(await port.findStaleWorktrees(null, '/repo'), []);
    });
  }
}

test('authority uncertainty never offers cleanup for missing or done mirrors (TASK-2801)', async () => {
  for (const mirror of [null, '/tasks/unknown.md']) {
    mock.method(backlog, 'findTaskFile', () => mirror);
    mock.method(backlog, 'getTaskStatus', () => 'done');
    for (const missionStore of [undefined,
      { load: async () => ({ kind: 'missing' as const }) },
      { load: async () => ({ kind: 'unavailable' as const, reason: 'offline' }) },
      { load: async () => { throw new Error('offline'); } },
    ]) {
      const port = createStatusStaleWorktreesAdapter({ primaryWorktree: '/repo', missionStore,
        gitRun: () => ({ status: 0, signal: null, stdout: 'worktree /unknown\nbranch refs/heads/mission/task-unknown', stderr: '' }),
      });
      const entries = await port.findStaleWorktrees(null, '/repo');
      assert.equal(entries.length, 1);
      assert.equal(entries[0].taskStatus, 'unknown');
      assert.ok(entries[0].uncertainty);
      assert.equal(entries[0].cleanupCommand, undefined);
    }
  }
});

test('done and closed authority retain guarded recovery even with active mirrors (TASK-2801)', async () => {
  mock.method(backlog, 'getTaskStatus', () => 'active');
  for (const closedAt of [null, '2026-10-01T00:00:00Z']) {
    const port = createStatusStaleWorktreesAdapter({ primaryWorktree: '/repo',
      missionStore: { load: async () => ({ kind: 'found', mission: fixtureMission('task-terminal', { status: 'done', closedAt }), version: missionVersion(1) }) },
      gitRun: () => ({ status: 0, signal: null, stdout: 'worktree /terminal\nbranch refs/heads/mission/task-terminal', stderr: '' }),
    });
    assert.deepEqual(await port.findStaleWorktrees(null, '/repo'), [{ slug: 'task-terminal', path: '/terminal',
      branch: 'refs/heads/mission/task-terminal', taskStatus: closedAt ? 'closed' : 'done',
      cleanupCommand: 'px integrate task-terminal --recover-landed' }]);
  }
});

test('another repository cannot authorize worktree cleanup (TASK-2801)', async () => {
  const port = createStatusStaleWorktreesAdapter({ primaryWorktree: '/repo', repositoryId: repositoryId('selected'),
    missionStore: { load: async () => ({ kind: 'found', mission: fixtureMission('task-other', { status: 'done' }), version: missionVersion(1) }) },
    gitRun: () => ({ status: 0, signal: null, stdout: 'worktree /other\nbranch refs/heads/mission/task-other', stderr: '' }),
  });
  const [entry] = await port.findStaleWorktrees(null, '/repo');
  assert.match(entry.uncertainty!, /this repository/);
  assert.equal(entry.cleanupCommand, undefined);
});

test('stale scan scopes Git and branch parsing to the requested repository (TASK-2801)', async () => {
  const parsed: string[][] = [];
  mock.method(missionUtils, 'extractSlugFromBranch', (branch: string, root: string) => {
    parsed.push([branch, root]);
    assert.equal(root, '/requested');
    return branch === 'custom/TASK-LIVE' ? 'task-live' : null;
  });
  const loaded: string[] = [];
  const port = createStatusStaleWorktreesAdapter({
    gitRun: (command, args) => {
      assert.equal(command, 'git');
      assert.deepEqual(args, ['-C', '/requested', 'worktree', 'list', '--porcelain']);
      return { status: 0, signal: null, stderr: '', stdout: [
        'worktree /requested', 'branch refs/heads/custom/task-primary', '',
        'worktree /live', 'branch refs/heads/custom/TASK-LIVE',
      ].join('\n') };
    },
    missionStore: { load: async id => {
      loaded.push(id);
      return { kind: 'found', mission: fixtureMission(id, { status: 'active' }), version: missionVersion(1) };
    } },
  });
  assert.deepEqual(await port.findStaleWorktrees(null, '/requested'), []);
  assert.deepEqual(parsed, [['custom/TASK-LIVE', '/requested']]);
  assert.deepEqual(loaded, ['task-live']);
});

test('stale scan resolves mixed-case branch slugs through the shared parser (TASK-2801)', async () => {
  const port = createStatusStaleWorktreesAdapter({ primaryWorktree: '/repo',
    gitRun: () => ({ status: 0, signal: null, stderr: '', stdout: 'worktree /live\nbranch refs/heads/mission/TASK-LIVE' }),
    missionStore: { load: async id => {
      assert.equal(id, 'task-live');
      return { kind: 'found', mission: fixtureMission(id, { status: 'review' }), version: missionVersion(1) };
    } },
  });
  assert.deepEqual(await port.findStaleWorktrees(null, '/repo'), []);
});

test('authority diagnostics retain unavailable and thrown lookup causes (TASK-2801)', async () => {
  for (const load of [
    async () => ({ kind: 'unavailable' as const, reason: 'database migration 17 failed' }),
    async () => { throw new Error('database migration 17 failed'); },
  ]) {
    const port = createStatusStaleWorktreesAdapter({ primaryWorktree: '/repo', missionStore: { load },
      gitRun: () => ({ status: 0, signal: null, stderr: '', stdout: 'worktree /unknown\nbranch refs/heads/mission/task-unknown' }),
    });
    const [entry] = await port.findStaleWorktrees(null, '/repo');
    assert.match(entry.uncertainty!, /database migration 17 failed/);
    assert.equal(entry.cleanupCommand, undefined);
  }
});
