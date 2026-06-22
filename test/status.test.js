const test = require('node:test');
const assert = require('node:assert/strict');
process.env.NO_COLOR = '1';

const { parseWorktreeList, findStaleMissionWorktrees } = require('../lib/commands/status');
const status = require('../lib/commands/status');

// ---------- parseWorktreeList edge cases ----------

test('parseWorktreeList handles empty input', () => {
  assert.deepEqual(parseWorktreeList(''), []);
});

test('parseWorktreeList handles input with no worktree entries', () => {
  const entries = parseWorktreeList('HEAD deadbeef\nbranch refs/heads/main');
  assert.deepEqual(entries, []);
});

test('parseWorktreeList handles single entry without trailing newline', () => {
  const entries = parseWorktreeList('worktree /tmp/wt\nHEAD 1111111\nbranch refs/heads/main');
  assert.deepEqual(entries, [{ path: '/tmp/wt', branch: 'refs/heads/main' }]);
});

test('parseWorktreeList handles entry without branch line', () => {
  const entries = parseWorktreeList('worktree /tmp/wt\nHEAD 1111111');
  assert.deepEqual(entries, [{ path: '/tmp/wt', branch: null }]);
});

// ---------- findStaleMissionWorktrees ----------

test('findStaleMissionWorktrees returns empty array when git fails', () => {
  const stale = findStaleMissionWorktrees({
    gitRun() {
      return { status: 1, stdout: '', stderr: 'error' };
    }
  });
  assert.deepEqual(stale, []);
});

test('findStaleMissionWorktrees skips entries without mission branch refs', () => {
  const stale = findStaleMissionWorktrees({
    primaryWorktree: '/home/magnus/code/repo',
    gitRun() {
      return {
        status: 0,
        stdout: [
          'worktree /home/magnus/code/repo',
          'HEAD 1111111',
          'branch refs/heads/main',
          '',
          'worktree /home/magnus/code/repo-other',
          'HEAD 2222222',
          'branch refs/heads/other-branch',
          ''
        ].join('\n'),
        stderr: ''
      };
    }
  });
  assert.deepEqual(stale, []);
});

test('findStaleMissionWorktrees skips entries with non-done task status', () => {
  const stale = findStaleMissionWorktrees({
    primaryWorktree: '/home/magnus/code/repo',
    gitRun() {
      return {
        status: 0,
        stdout: [
          'worktree /home/magnus/code/repo',
          'HEAD 1111111',
          'branch refs/heads/main',
          '',
          'worktree /home/magnus/code/repo-task-001',
          'HEAD 2222222',
          'branch refs/heads/mission/task-001',
          ''
        ].join('\n'),
        stderr: ''
      };
    },
    findTaskFileFn() { return '/tmp/task-001.md'; },
    getTaskStatusFn() { return 'active'; }
  });
  assert.deepEqual(stale, []);
});

test('findStaleMissionWorktrees returns cleanup command for done task', () => {
  const stale = findStaleMissionWorktrees({
    primaryWorktree: '/home/magnus/code/repo',
    gitRun() {
      return {
        status: 0,
        stdout: [
          'worktree /home/magnus/code/repo',
          'HEAD 1111111',
          'branch refs/heads/main',
          '',
          'worktree /home/magnus/code/repo-task-done',
          'HEAD 2222222',
          'branch refs/heads/mission/task-done',
          ''
        ].join('\n'),
        stderr: ''
      };
    },
    findTaskFileFn() { return '/tmp/task-done.md'; },
    getTaskStatusFn() { return 'done'; }
  });
  assert.equal(stale.length, 1);
  assert.equal(stale[0].slug, 'task-done');
  assert.equal(stale[0].cleanupCommand, 'scripts/cleanup-mission-worktree.sh task-done');
});

test('findStaleMissionWorktrees returns git remove command for missing task file', () => {
  const stale = findStaleMissionWorktrees({
    primaryWorktree: '/home/magnus/code/repo',
    gitRun() {
      return {
        status: 0,
        stdout: [
          'worktree /home/magnus/code/repo',
          'HEAD 1111111',
          'branch refs/heads/main',
          '',
          'worktree /home/magnus/code/repo-task-orphan',
          'HEAD 2222222',
          'branch refs/heads/mission/task-orphan',
          ''
        ].join('\n'),
        stderr: ''
      };
    },
    findTaskFileFn() { return null; }
  });
  assert.equal(stale.length, 1);
  assert.equal(stale[0].slug, 'task-orphan');
  assert.equal(stale[0].taskStatus, 'missing');
  assert.ok(stale[0].cleanupCommand.includes('git worktree remove'));
  assert.ok(stale[0].cleanupCommand.includes('git branch -D'));
});

test('status prints mission details and agent matrix for inferred slug', () => {
  const lines = [];
  let exitCode = null;

  status([], {
    inferSlugFn: () => 'task-1031',
    getCurrentBranchFn: () => 'mission/task-1031',
    findTaskFileFn: () => '/tmp/task-1031.md',
    getTaskStatusFn: () => 'active',
    findMissionDirFn: () => '/tmp/docs/missions/2026/task-1031',
    findCheckpointsFn: () => ['/tmp/docs/missions/2026/task-1031/CP-2.md'],
    getFirstLineFn: () => 'Checkpoint 2',
    getPrStatusFn: () => ({ exists: true, number: 83, state: 'open' }),
    readAgentConfigOrExitFn: () => ({ reviewers: true }),
    eligibleAgentsForStepFn: step => step === 'draft' ? ['codex', 'claude'] : ['codex', 'gemini'],
    workflowLauncherStatusFn: agent => ({ supported: agent !== 'gemini' }),
    getLastThreeCommitsFn: () => ['c1', 'c2', 'c3'],
    getUncommittedCountFn: () => 2,
    log: line => lines.push(line),
    exit: code => { exitCode = code; }
  });

  assert.equal(exitCode, 0);
  assert.ok(lines.includes('Backlog status: active'));
  assert.ok(lines.includes('Last checkpoint: CP-2.md - Checkpoint 2'));
  assert.ok(lines.includes('Forgejo PR: #83 (open)'));
  assert.ok(lines.includes('Agent launcher matrix:'));
  assert.ok(lines.includes('  codex: supported | eligible: draft,active'));
  assert.ok(lines.includes('  gemini: blocked | eligible: -,active'));
  assert.ok(lines.includes('Last 3 commits:'));
  assert.ok(lines.includes('Uncommitted files: 2'));
});

test('status agent matrix includes every workflow launcher even when not step-eligible', () => {
  const lines = [];

  status(['task-1031'], {
    inferSlugFn: () => 'task-1031',
    getCurrentBranchFn: () => 'mission/task-1031',
    findTaskFileFn: () => '/tmp/task-1031.md',
    getTaskStatusFn: () => 'active',
    findMissionDirFn: () => null,
    getPrStatusFn: () => ({ exists: false }),
    readAgentConfigOrExitFn: () => ({}),
    eligibleAgentsForStepFn: step => step === 'draft' ? ['codex'] : ['claude'],
    allWorkflowAgentNamesFn: () => ['codex', 'future-agent'],
    workflowLauncherStatusFn: agent => ({ supported: agent === 'future-agent' }),
    getLastThreeCommitsFn: () => [],
    getUncommittedCountFn: () => 0,
    log: line => lines.push(line),
    exit: () => {}
  });

  assert.ok(lines.includes('  future-agent: supported | eligible: -,-'));
});

test('status prints stale worktrees only when no explicit slug is provided', () => {
  const lines = [];
  let exitCode = null;

  status(['task-1031'], {
    inferSlugFn: () => 'task-1031',
    getCurrentBranchFn: () => 'mission/task-1031',
    findTaskFileFn: () => null,
    getTaskStatusFn: () => null,
    findMissionDirFn: () => null,
    getPrStatusFn: () => ({ exists: false }),
    findStaleMissionWorktreesFn: () => [{ path: '/tmp/stale', taskStatus: 'done', cleanupCommand: 'cleanup it' }],
    readAgentConfigOrExitFn: () => ({}),
    eligibleAgentsForStepFn: () => [],
    workflowLauncherStatusFn: () => ({ supported: false }),
    getLastThreeCommitsFn: () => [],
    getUncommittedCountFn: () => 0,
    log: line => lines.push(line),
    exit: code => { exitCode = code; }
  });

  assert.equal(exitCode, 0);
  assert.equal(lines.some(line => line.includes('Stale worktree')), false);
  assert.ok(lines.includes('Last checkpoint: unknown'));
  assert.ok(lines.includes('Forgejo PR: none'));
});
