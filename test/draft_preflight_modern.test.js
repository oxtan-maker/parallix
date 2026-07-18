// @ts-nocheck -- dist declaration inference is narrower than this legacy mock suite.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { runDraftCommand } = require('../dist/lib/commands/draft');

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
    // @ts-expect-error TS2322 Type '{ ok: false; reason: string; }' is not assignable to type '{ ok: boolean;
    resolveTaskFileFn: () => ({ ok: false, reason: 'missing' }),
    reportTaskResolutionFn: (res, slug, log) => {
      errors.push(`Reported: ${res.reason} for ${slug}`);
    },
    ensureMissionBranchFn: () => {
      ensureMissionBranchCalled = true;
    },
    // @ts-expect-error TS2322 Type '(code: string | number) => void' is not assignable to type '(code?: string
    exitFn: (code) => {
      exitCode = code;
    },
    // @ts-expect-error TS2322 Type 'number' is not assignable to type 'string'.
    logFn: (msg) => logs.push(msg),
    // @ts-expect-error TS2322 Type 'number' is not assignable to type 'string'.
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
    // @ts-expect-error TS2322 Type '{ ok: true; taskFile: string; }' is not assignable to type '{ ok: boolean;
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task-093.md' }),
    checkBacklogIntegrityFn: () => [
      { file: 'backlog/tasks/task-093.md', type: 'id-mismatch', filenameId: 'TASK-093', frontmatterId: 'TASK-099' }
    ],
    ensureMissionBranchFn: () => {
      ensureMissionBranchCalled = true;
    },
    // @ts-expect-error TS2322 Type '(code: string | number) => void' is not assignable to type '(code?: string
    exitFn: (code) => {
      exitCode = code;
    },
    // @ts-expect-error TS2322 Type '() => void' is not assignable to type 'LogFunc'.
    logFn: () => {},
    // @ts-expect-error TS2322 Type 'number' is not assignable to type 'string'.
    errorFn: (msg) => errors.push(msg)
  });

  assert.equal(exitCode, 1);
  assert.equal(ensureMissionBranchCalled, false);
  assert.ok(errors.some(e => e.includes('Backlog integrity issues detected for task-093')));
});
