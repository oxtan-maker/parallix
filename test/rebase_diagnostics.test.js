const test = require('node:test');
const assert = require('node:assert/strict');
const status = require('../lib/commands/status');
const rebase = require('../lib/commands/rebase');
const { printIntegrationPreflight } = require('../lib/commands/integrate');

const TASK_1322_UNMERGED = [
  'backlog/tasks/task-1322 - prevent-backlog-task-id-recycling-collision.md',
  'missions/task-1322/review-state.json',
  'missions/task-1322/CP-4.md'
];

function task1322RebaseState() {
  return {
    inProgress: true,
    detached: true,
    rebaseHead: 'abc123def456',
    rebaseDir: '.git/rebase-merge',
    unmergedFiles: [...TASK_1322_UNMERGED]
  };
}

test('rebase reports git output and hook hints on non-conflict failure', async () => {
  let stderrLines = [];
  const capturedStderr = [];
  const originalError = console.error;
  console.error = (...args) => { capturedStderr.push(args.join(' ')); };

  await rebase(['task-1077'], {
    isForgejoReviewEnabledFn: () => false,
    inferSlugFn: () => 'task-1077',
    findMissionDirFn: () => '/tmp/task-1077',
    findMissionAreaFn: () => 'workflow',
    getCurrentBranchFn: () => 'mission/task-1077',
    gitFn: (args, opts) => {
      if (args.includes('branch') && args.includes('--list')) return { status: 0, stdout: 'main\n' };
      if (args[0] === 'fetch') return { status: 0 };
      if (args.includes('rebase') && args.includes('main')) {
        return { status: 1, stdout: '', stderr: 'error: pre-commit hook failed\nAborting rebase' };
      }
      return { status: 0, stdout: '' };
    },
    exitFn: () => {},
  });

  console.error = originalError;
  stderrLines = capturedStderr;
  const combined = stderrLines.join('\n');

  assert.match(combined, /Rebase failed with a non-conflict error/i);
  assert.match(combined, /--- Git Output ---/);
  assert.match(combined, /pre-commit hook failed/);
  assert.match(combined, /Hint: A git hook failed/);
  assert.match(combined, /Recovery: git rebase --abort/);
});

test('rebase reports git output on failed continue attempt', async () => {
  let stderrLines = [];
  const capturedStderr = [];
  const originalError = console.error;
  console.error = (...args) => { capturedStderr.push(args.join(' ')); };

  await rebase(['task-1077'], {
    isForgejoReviewEnabledFn: () => false,
    inferSlugFn: () => 'task-1077',
    findMissionDirFn: () => '/tmp/task-1077',
    findMissionAreaFn: () => 'workflow',
    getCurrentBranchFn: () => 'mission/task-1077',
    resolveConflictsFn: () => ({
      ok: true,
      conflictFiles: ['file.js'],
      missionSpecificFiles: ['file.js'],
      sharedFiles: [],
    }),
    gitFn: (args, opts) => {
      if (args.includes('branch') && args.includes('--list')) return { status: 0, stdout: 'main\n' };
      if (args[0] === 'fetch') return { status: 0 };
      if (args.includes('rebase') && args.includes('main')) return { status: 1, stderr: 'CONFLICT' };
      if (args[0] === 'checkout') return { status: 0 };
      if (args[0] === 'add') return { status: 0 };
      if (args.includes('rebase') && args.includes('--continue')) {
        return { status: 1, stdout: '', stderr: 'error: another hook failed' };
      }
      if (args[0] === 'status' && args[1] === '--porcelain') return { status: 0, stdout: 'M  file.js' };
      if (args[0] === 'rebase' && args[1] === '--show-current') return { status: 0, stdout: 'mission/task-1077' };
      return { status: 0, stdout: '' };
    },
    exitFn: () => {},
  });

  console.error = originalError;
  stderrLines = capturedStderr;
  const combined = stderrLines.join('\n');

  assert.match(combined, /git rebase --continue failed/i);
  assert.match(combined, /--- Git Output ---/);
  assert.match(combined, /another hook failed/);
});

test('task-1322 recovery diagnostics report an in-progress rebase across status, rebase, and integrate preflight', async () => {
  const statusLines = [];
  let statusExitCode = null;

  status(['task-1322'], {
    inferSlugFn: () => 'task-1322',
    getCurrentBranchFn: () => '',
    findTaskFileFn: () => '/tmp/task-1322.md',
    getTaskStatusFn: () => 'active',
    findMissionDirFn: () => null,
    getPrStatusFn: () => ({ exists: false }),
    readAgentConfigOrExitFn: () => ({}),
    eligibleAgentsForStepFn: () => [],
    workflowLauncherStatusFn: () => ({ supported: false }),
    getLastThreeCommitsFn: () => [],
    getUncommittedCountFn: () => TASK_1322_UNMERGED.length,
    detectRebaseStateFn: () => task1322RebaseState(),
    log: line => statusLines.push(line),
    exit: code => { statusExitCode = code; }
  });

  assert.equal(statusExitCode, 0);
  const statusOutput = statusLines.join('\n');
  assert.match(statusOutput, /Detached HEAD: rebase in progress: detached HEAD, 3 unmerged file\(s\)/);
  TASK_1322_UNMERGED.forEach(file => assert.match(statusOutput, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))));

  const rebaseStdout = [];
  const rebaseStderr = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args) => { rebaseStdout.push(args.join(' ')); };
  console.error = (...args) => { rebaseStderr.push(args.join(' ')); };

  let rebaseExitCode = null;
  let attemptedFreshRebase = false;

  try {
    await rebase(['task-1322'], {
      isForgejoReviewEnabledFn: () => false,
      inferSlugFn: () => 'task-1322',
      findMissionDirFn: () => '/tmp/docs/missions/2026/task-1322',
      findMissionAreaFn: () => 'docs',
      getCurrentBranchFn: () => 'mission/task-1322',
      detectRebaseStateFn: () => task1322RebaseState(),
      gitFn: args => {
        if (args.includes('rebase') && args.includes('main')) {
          attemptedFreshRebase = true;
        }
        return { status: 0, stdout: '', stderr: '' };
      },
      exitFn: code => { rebaseExitCode = code; }
    });
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }

  assert.equal(rebaseExitCode, 1);
  assert.equal(attemptedFreshRebase, false);
  const rebaseOutput = [...rebaseStderr, ...rebaseStdout].join('\n');
  assert.match(rebaseOutput, /Rebase already in progress for mission\/task-1322/);
  assert.match(rebaseOutput, /Current rebase head: abc123def456/);
  TASK_1322_UNMERGED.forEach(file => assert.match(rebaseOutput, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))));
  assert.match(rebaseOutput, /git rebase --continue/);
  assert.match(rebaseOutput, /git rebase --abort/);
  assert.match(rebaseOutput, /git rebase --skip/);

  const integrateLines = [];
  const integrateOriginalLog = console.log;
  console.log = line => integrateLines.push(line);

  try {
    const result = printIntegrationPreflight({
      slug: 'task-1322',
      branch: 'mission/task-1322',
      currentBranch: 'mission/task-1322',
      missionDir: '/tmp/docs/missions/2026/task-1322',
      task: { ok: true, taskFile: '/tmp/task-1322.md' },
      taskStatus: 'ready-for-integration',
      taskAssignee: 'codex',
      forgejoUser: 'codex',
      taskAssigneeWarning: null,
      pr: { exists: true, state: 'open', merged: false, number: 1322 },
      approval: { ok: true, reviewState: 'APPROVED' },
      mainBranch: 'main',
      mainAheadCount: 0,
      mainDirty: false,
      mainDirtyEntries: []
    }, {
      readTokenFn: () => 'secret-token',
      resolveTokenFileFn: () => '/tmp/tokens/codex',
      isForgejoReviewEnabledFn: () => true,
      detectRebaseStateFn: () => task1322RebaseState(),
      getUnresolvedIndexConflictsFn: () => ({ ok: true, files: [] }),
      getPrimaryBranchFn: () => 'main',
      getPrimaryWorktreeFn: () => '/tmp'
    });

    assert.ok(result.failures.includes('rebase-in-progress'));
  } finally {
    console.log = integrateOriginalLog;
  }

  const integrateOutput = integrateLines.join('\n');
  assert.match(integrateOutput, /Integration checkout rebase: rebase in progress/i);
  assert.match(integrateOutput, /Current rebase head: abc123def456/);
  TASK_1322_UNMERGED.forEach(file => assert.match(integrateOutput, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))));
  assert.match(integrateOutput, /git -C .* rebase --continue/);
  assert.match(integrateOutput, /git -C .* rebase --abort/);
  assert.match(integrateOutput, /git -C .* rebase --skip/);
});
