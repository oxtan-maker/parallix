import test from 'node:test';
import assert from 'node:assert/strict';

import { printIntegrationPreflight } from '../src/adapters/cli/commands/integrate.js';
import { cleanupMissionWorktree, persistLandedIntegrationOrAbort } from '../src/adapters/cli/commands/integrate-post.js';
import { conventionalWorktreePath } from '../src/adapters/filesystem/mission-utils.js';
import status from '../src/adapters/cli/commands/status.js';

function preflight(missionStatus) {
  return printIntegrationPreflight({
    slug: 'task-2508',
    branch: 'mission/task-2508',
    currentBranch: 'mission/task-2508',
    missionDir: '/tmp/missions/task-2508',
    task: { ok: true, taskFile: `${process.cwd()}/backlog/tasks/task-2508 - Make-interrupted-landed-integrations-idempotently-closeable.md` },
    taskStatus: missionStatus,
    missionStatus,
    taskAssignee: 'codex',
    forgejoUser: 'codex',
    taskAssigneeWarning: null,
    pr: { exists: true, state: 'merged', number: 2508 },
    siblingPrs: [],
    approval: { ok: true, reviewState: 'APPROVED' },
    baseBranch: 'main',
    baseWorktree: process.cwd(),
    mainBranch: 'main',
    mainDirty: false,
    mainDirtyEntries: [],
  }, {
    readTokenFn: () => 'token',
    resolveTokenFileFn: () => '/tmp/token',
    detectRebaseStateFn: () => ({ inProgress: false, detached: false, rebaseDir: null, rebaseHead: null, unmergedFiles: [] }),
    getUnresolvedIndexConflictsFn: () => ({ ok: true, files: [] }),
    findMissionDocInBranchesFn: () => [],
    isForgejoReviewEnabledFn: () => true,
    log: () => '',
  });
}

test('printIntegrationPreflight does not fail on a merged PR for a landed integration', () => {
  for (const missionStatus of ['integration', 'done']) {
    assert.ok(!preflight(missionStatus).failures.includes('pr-merged'));
  }

  assert.ok(preflight('review').failures.includes('pr-merged'));
});

test('persistLandedIntegrationOrAbort closes an interrupted landing once', async () => {
  const calls = [];
  let mission = { status: 'integration', closedAt: null, assignee: 'codex' };
  const services = {
    store: { load: async () => ({ kind: 'found', mission, version: 1 }) },
    integration: {
      decideIntegration: async request => {
        calls.push(['decide', request]);
        mission = { ...mission, status: 'done' };
        return { status: 'completed' };
      },
      close: async request => {
        calls.push(['close', request]);
        mission = { ...mission, closedAt: '2026-09-14T12:00:00.000Z' };
        return { status: 'completed' };
      },
    },
  };

  await persistLandedIntegrationOrAbort('task-2508', 'landed-sha', services, { landedAt: '2026-09-14T10:00:00.000Z' });
  await persistLandedIntegrationOrAbort('task-2508', 'landed-sha', services, { landedAt: '2026-09-14T10:00:00.000Z' });

  assert.deepEqual(calls.map(([kind]) => kind), ['decide', 'close']);
  assert.equal(calls[0][1].idempotencyKey, 'integrate:task-2508:landed-sha');
  assert.equal(calls[1][1].idempotencyKey, 'close:task-2508:landed-sha');
  assert.notEqual(mission.closedAt, null);
});

test('cleanupMissionWorktree removes an interrupted landing once', () => {
  const rootDir = '/tmp/task-2508-root';
  const worktree = conventionalWorktreePath('task-2508', rootDir);
  let branchExists = true;
  let worktreeExists = true;
  const gitRunner = args => {
    if (args.slice(-2).join(' ') === 'branch --show-current') return { status: 0, stdout: 'main\n', stderr: '' };
    if (args.includes('show-ref')) return { status: branchExists ? 0 : 1, stdout: '', stderr: '' };
    if (args.slice(-2).join(' ') === 'list --porcelain') return { status: 0, stdout: `worktree ${worktree}\n`, stderr: '' };
    if (args.includes('-D')) branchExists = false;
    return { status: 0, stdout: '', stderr: '' };
  };
  const options = { rootDir, gitRunner, existsSync: target => target === worktree && worktreeExists, removeDir: () => { worktreeExists = false; } };

  assert.equal(cleanupMissionWorktree('task-2508', options), true);
  assert.equal(cleanupMissionWorktree('task-2508', options), false);
});

test('px status reports the authoritative done lifecycle', async () => {
  const lines = [];
  await status(['task-2508'], {
    log: line => lines.push(line),
    exit: () => {},
    inferSlugFn: () => 'task-2508',
    getCurrentBranchFn: () => 'main',
    getPrStatusFn: () => ({ exists: false }),
    readAgentConfigOrExitFn: () => ({}),
    eligibleAgentsForStepFn: () => [],
    allWorkflowAgentNamesFn: () => [],
    workflowLauncherStatusFn: () => ({ supported: true }),
    getLastThreeCommitsFn: () => [],
    getUncommittedCountFn: () => 0,
    detectRebaseStateFn: () => ({ inProgress: false, detached: false, unmergedFiles: [] }),
    buildProjectionFn: async () => ({ build: async () => ({ stages: [{ cards: [{
      id: 'task-2508', status: 'done', rawStatus: 'active', checkpoint: null,
      checkpointDescription: null, reviewPhase: null, reviewHistory: [],
    }] }] }) }),
  });

  assert.ok(lines.includes('Backlog status: done'));
});
