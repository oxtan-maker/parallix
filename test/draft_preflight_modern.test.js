const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { runDraftCommand } = require('../lib/commands/draft');

test('runDraftCommand bails early if backlog task resolution is not ok', async () => {
  const logs = [];
  const errors = [];
  let exitCode = null;
  let ensureMissionBranchCalled = false;

  await runDraftCommand(['task-999'], {
    inferSlugFn: (s) => s,
    resolveMainRepoFn: () => '/tmp/main-repo',
    ensureRepoExistsFn: () => true,
    detectLaunchBaseBranchFn: () => null,
    resolveTaskFileFn: () => ({ ok: false, reason: 'missing' }),
    reportTaskResolutionFn: (res, slug, log) => {
      errors.push(`Reported: ${res.reason} for ${slug}`);
    },
    ensureMissionBranchFn: () => {
      ensureMissionBranchCalled = true;
    },
    exitFn: (code) => {
      exitCode = code;
    },
    logFn: (msg) => logs.push(msg),
    errorFn: (msg) => errors.push(msg)
  });

  assert.equal(exitCode, 1);
  assert.equal(ensureMissionBranchCalled, false);
  assert.ok(errors.some(e => e.includes('Reported: missing for task-999')));
});

test('runDraftCommand bails early if backlog integrity issues detected for the slug', async () => {
  const errors = [];
  let exitCode = null;
  let ensureMissionBranchCalled = false;

  await runDraftCommand(['task-093'], {
    inferSlugFn: (s) => s,
    resolveMainRepoFn: () => '/tmp/main-repo',
    ensureRepoExistsFn: () => true,
    detectLaunchBaseBranchFn: () => null,
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task-093.md' }),
    checkBacklogIntegrityFn: () => [
      { file: 'backlog/tasks/task-093.md', type: 'id-mismatch', filenameId: 'TASK-093', frontmatterId: 'TASK-099' }
    ],
    ensureMissionBranchFn: () => {
      ensureMissionBranchCalled = true;
    },
    exitFn: (code) => {
      exitCode = code;
    },
    logFn: () => {},
    errorFn: (msg) => errors.push(msg)
  });

  assert.equal(exitCode, 1);
  assert.equal(ensureMissionBranchCalled, false);
  assert.ok(errors.some(e => e.includes('Backlog integrity issues detected for task-093')));
});
