const test = require('node:test');
const assert = require('node:assert/strict');
const rebase = require('../lib/commands/rebase');

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
