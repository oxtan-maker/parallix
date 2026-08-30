
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { mockModule, installModuleMocks } from './lib/module-mock.js';
import { createRequire } from 'node:module';
const printIntegrationPreflightModule = mockModule<typeof import('../src/adapters/cli/commands/integrate.js')>('../src/adapters/cli/commands/integrate.js', import.meta.url);
const getUnresolvedIndexConflictsModule = mockModule<typeof import('../src/adapters/cli/commands/integrate.js')>('../src/adapters/cli/commands/integrate.js', import.meta.url);
const promoteTaskForIntegrationIfNeededModule = mockModule<typeof import('../src/adapters/cli/commands/integrate.js')>('../src/adapters/cli/commands/integrate.js', import.meta.url);
const backlog = mockModule<typeof import('../src/adapters/backlog/backlog.js')>('../src/adapters/backlog/backlog.js', import.meta.url);
const __mm1 = mockModule<typeof import('../src/composition/application-services.js')>('../src/composition/application-services.js', import.meta.url);
await installModuleMocks();
test.afterEach(() => mock.restoreAll());
const { printIntegrationPreflight } = printIntegrationPreflightModule;
const { getUnresolvedIndexConflicts } = getUnresolvedIndexConflictsModule;
const { promoteTaskForIntegrationIfNeeded } = promoteTaskForIntegrationIfNeededModule;
const { mock } = test;

const TEST_SLUG = 'task-preflight-test';

// Hermetic doubles: the un-overridden defaults spawn the shimmed git CLI
// against the operator's real repository (a subprocess per call).
const cleanRebaseState = () => ({ inProgress: false, rebaseHead: '', detached: false, unmergedFiles: [], rebaseDir: null });
const noMissionDocBranches = () => [];

test('printIntegrationPreflight branch failure', (t) => {
  const context = {
    slug: TEST_SLUG,
    branch: 'mission/' + TEST_SLUG,
    currentBranch: 'main', // Fails
    missionDir: '/tmp/dir',
    task: { ok: true, taskFile: '/tmp/task.md' },
    taskStatus: 'ready-for-integration',
    pr: { exists: true, state: 'open', merged: false, number: 41 },
    approval: { ok: true, reviewState: 'APPROVED' },
    mainBranch: 'main',
    mainDirty: false,
    mainDirtyEntries: []
  };

  const result = printIntegrationPreflight(context, {
    readTokenFn: () => 'token',
    resolveTokenFileFn: () => 'file',
    getUnresolvedIndexConflictsFn: () => ({ ok: true, files: [] }),
    detectRebaseStateFn: cleanRebaseState,
    findMissionDocInBranchesFn: noMissionDocBranches
  });

  assert.ok(result.failures.includes('branch'));
});

test('printIntegrationPreflight mission-doc failure', (t) => {
  const context = {
    slug: TEST_SLUG,
    branch: 'mission/' + TEST_SLUG,
    currentBranch: 'mission/' + TEST_SLUG,
    missionDir: null, // Fails
    task: { ok: true, taskFile: '/tmp/task.md' },
    taskStatus: 'ready-for-integration',
    pr: { exists: true, state: 'open', merged: false, number: 41 },
    approval: { ok: true, reviewState: 'APPROVED' },
    mainBranch: 'main',
    mainDirty: false,
    mainDirtyEntries: []
  };

  const result = printIntegrationPreflight(context, {
    readTokenFn: () => 'token',
    resolveTokenFileFn: () => 'file',
    getUnresolvedIndexConflictsFn: () => ({ ok: true, files: [] }),
    detectRebaseStateFn: cleanRebaseState,
    findMissionDocInBranchesFn: noMissionDocBranches
  });

  assert.ok(result.failures.includes('mission-doc'));
});

test('printIntegrationPreflight task failures', (t) => {
  // Case 1: Ambiguous task
  const context1 = {
    slug: TEST_SLUG,
    branch: 'mission/' + TEST_SLUG,
    currentBranch: 'mission/' + TEST_SLUG,
    missionDir: '/tmp/dir',
    task: { ok: false, reason: 'ambiguous', matches: ['a.md', 'b.md'] },
    pr: { exists: true, state: 'open', merged: false, number: 41 },
    approval: { ok: true, reviewState: 'APPROVED' },
    mainBranch: 'main',
    mainDirty: false,
    mainDirtyEntries: []
  };

  const res1 = printIntegrationPreflight(context1, {
    readTokenFn: () => 'token',
    resolveTokenFileFn: () => 'file',
    getUnresolvedIndexConflictsFn: () => ({ ok: true, files: [] }),
    detectRebaseStateFn: cleanRebaseState,
    findMissionDocInBranchesFn: noMissionDocBranches
  });
  assert.ok(res1.failures.includes('task-ambiguity'));

  // Case 2: Missing task warns and falls back to unknown classification
  const context2 = { ...context1, task: { ok: false, reason: 'missing' } };
  const res2 = printIntegrationPreflight(context2, {
    readTokenFn: () => 'token',
    resolveTokenFileFn: () => 'file',
    getUnresolvedIndexConflictsFn: () => ({ ok: true, files: [] }),
    detectRebaseStateFn: cleanRebaseState,
    findMissionDocInBranchesFn: noMissionDocBranches
  });
  assert.ok(!res2.failures.includes('task-missing'));
});

test('printIntegrationPreflight PR approval failures', (t) => {
  // Case 1: could not verify approval
  const context1 = {
    slug: TEST_SLUG,
    branch: 'mission/' + TEST_SLUG,
    currentBranch: 'mission/' + TEST_SLUG,
    missionDir: '/tmp/dir',
    task: { ok: true, taskFile: '/tmp/task.md' },
    taskStatus: 'ready-for-integration',
    pr: { exists: true, state: 'open', merged: false, number: 41 },
    approval: { ok: false, error: 'api error' },
    mainBranch: 'main',
    mainDirty: false,
    mainDirtyEntries: []
  };

  const res1 = printIntegrationPreflight(context1, {
    isForgejoReviewEnabledFn: () => true,
    readTokenFn: () => 'token',
    resolveTokenFileFn: () => 'file',
// @ts-expect-error -- Legacy fixture deliberately exercises a duplicate or partial object-literal runtime shape.
    isForgejoReviewEnabledFn: () => true,
    getUnresolvedIndexConflictsFn: () => ({ ok: true, files: [] }),
    detectRebaseStateFn: cleanRebaseState,
    findMissionDocInBranchesFn: noMissionDocBranches
  });
  assert.ok(res1.failures.includes('pr-approval'));

  // Case 2: review state not APPROVED
  const context2 = { ...context1, approval: { ok: true, reviewState: 'COMMENT' } };
  const res2 = printIntegrationPreflight(context2, {
    isForgejoReviewEnabledFn: () => true,
    readTokenFn: () => 'token',
    resolveTokenFileFn: () => 'file',
// @ts-expect-error -- Legacy fixture deliberately exercises a duplicate or partial object-literal runtime shape.
    isForgejoReviewEnabledFn: () => true,
    getUnresolvedIndexConflictsFn: () => ({ ok: true, files: [] }),
    detectRebaseStateFn: cleanRebaseState,
    findMissionDocInBranchesFn: noMissionDocBranches
  });
  assert.ok(res2.failures.includes('pr-approval'));
});

test('printIntegrationPreflight main-index-conflict-check failure', (t) => {
  const context = {
    slug: TEST_SLUG,
    branch: 'mission/' + TEST_SLUG,
    currentBranch: 'mission/' + TEST_SLUG,
    missionDir: '/tmp/dir',
    task: { ok: true, taskFile: '/tmp/task.md' },
    taskStatus: 'ready-for-integration',
    pr: { exists: true, state: 'open', merged: false, number: 41 },
    approval: { ok: true, reviewState: 'APPROVED' },
    mainBranch: 'main',
    mainDirty: false,
    mainDirtyEntries: []
  };

  const result = printIntegrationPreflight(context, {
    readTokenFn: () => 'token',
    resolveTokenFileFn: () => 'file',
// @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
    getUnresolvedIndexConflictsFn: () => ({ ok: false, error: 'git error' }),
    detectRebaseStateFn: cleanRebaseState,
    findMissionDocInBranchesFn: noMissionDocBranches
  });

  assert.ok(result.failures.includes('main-index-conflict-check'));
});

test('printIntegrationPreflight main-dirty warning', (t) => {
  const context = {
    slug: TEST_SLUG,
    branch: 'mission/' + TEST_SLUG,
    currentBranch: 'mission/' + TEST_SLUG,
    missionDir: '/tmp/dir',
    task: { ok: true, taskFile: '/tmp/task.md' },
    taskStatus: 'ready-for-integration',
    pr: { exists: true, state: 'open', merged: false, number: 41 },
    approval: { ok: true, reviewState: 'APPROVED' },
    mainBranch: 'main',
    mainDirty: true,
    mainDirtyEntries: ['modified.js']
  };

  const result = printIntegrationPreflight(context, {
    readTokenFn: () => 'token',
    resolveTokenFileFn: () => 'file',
    getUnresolvedIndexConflictsFn: () => ({ ok: true, files: [] }),
    detectRebaseStateFn: cleanRebaseState,
    findMissionDocInBranchesFn: noMissionDocBranches
  });

  assert.ok(result.warnings.includes('main-dirty'));
});

test('getUnresolvedIndexConflicts failure path', (t) => {
  const result = getUnresolvedIndexConflicts('/tmp/dir', {
    gitRunner: () => ({ status: 1, stdout: 'git error' })
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error, 'git error');
});

test('promoteTaskForIntegrationIfNeeded failure path', async (t) => {
  const context = {
    task: { ok: true, taskFile: '/tmp/task.md' },
    taskStatus: 'review',
    approval: { ok: true, reviewState: 'APPROVED' },
    baseWorktree: '/tmp',
    missionDir: '/tmp/mission',
    slug: 'test-task',
    forgejoUser: 'custom'
  };

  // Mock backlog.setTaskStatus to fail
  const originalSetTaskStatus = backlog.setTaskStatus;
  backlog.setTaskStatus = () => false;

  // Mock createMissionApplicationServices for SQLite-first transitions
  const composition = __mm1;
  const originalCreate = composition.createMissionApplicationServices;
// @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
  composition.createMissionApplicationServices = async () => ({
    store: {
      _repoId: 'default',
      load: async () => ({ kind: 'found', mission: { status: 'review', review: null }, version: 1 }),
    },
    lifecycle: {
      transition: async () => ({ status: 'completed', value: { to: 'integration', version: 2 } }),
    },
  });

  const originalError = console.error;
  console.error = () => {};

  try {
    let threw = false;
    try {
      await promoteTaskForIntegrationIfNeeded(context, {
        missionServicesFn: composition.createMissionApplicationServices,
      });
    } catch (err) {
      threw = true;
      assert.equal(err.constructor.name, 'IntegrationAbort', 'should throw IntegrationAbort');
    }
    assert.ok(threw, 'should have thrown');
  } finally {
    backlog.setTaskStatus = originalSetTaskStatus;
    composition.createMissionApplicationServices = originalCreate;
    console.error = originalError;
  }
});
