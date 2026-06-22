const test = require('node:test');
const assert = require('node:assert/strict');
const rebase = require('../lib/commands/rebase');

test('rebase applies core.editor=true to initial rebase call', async () => {
  let capturedArgs = null;
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
        capturedArgs = args;
        return { status: 0 };
      }
      if (args.includes('rebase') && args.includes('--show-current')) return { status: 0, stdout: '' };
      return { status: 0, stdout: '' };
    },
    exitFn: () => {},
  });

  assert.ok(capturedArgs, 'Args should be captured');
  assert.ok(capturedArgs.indexOf('core.editor=true') < capturedArgs.indexOf('rebase'), 'core.editor=true should be before rebase');
  assert.ok(capturedArgs.indexOf('merge.autoedit=no') < capturedArgs.indexOf('rebase'), 'merge.autoedit=no should be before rebase');
});

test('rebase applies core.editor=true to continueRebase calls', async () => {
  let capturedArgsList = [];
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
        capturedArgsList.push(args);
        return { status: 0 };
      }
      if (args.includes('rebase') && args.includes('--show-current')) return { status: 0, stdout: '' };
      return { status: 0, stdout: '' };
    },
    exitFn: () => {},
  });

  assert.ok(capturedArgsList.length > 0, 'continueRebase should be called');
  capturedArgsList.forEach(args => {
    assert.ok(args.indexOf('core.editor=true') < args.indexOf('rebase'), 'core.editor=true should be before rebase');
    assert.ok(args.indexOf('merge.autoedit=no') < args.indexOf('rebase'), 'merge.autoedit=no should be before rebase');
  });
});
