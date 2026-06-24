const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { printIntegrationPreflight } = require('../lib/commands/integrate');
const { mock } = test;

const TEST_SLUG = 'task-preflight-test';

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
    getUnresolvedIndexConflictsFn: () => ({ ok: true, files: [] })
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
    getUnresolvedIndexConflictsFn: () => ({ ok: true, files: [] })
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
    getUnresolvedIndexConflictsFn: () => ({ ok: true, files: [] })
  });
  assert.ok(res1.failures.includes('task-ambiguity'));

  // Case 2: Missing task warns and falls back to unknown classification
  const context2 = { ...context1, task: { ok: false, reason: 'missing' } };
  const res2 = printIntegrationPreflight(context2, {
    readTokenFn: () => 'token',
    resolveTokenFileFn: () => 'file',
    getUnresolvedIndexConflictsFn: () => ({ ok: true, files: [] })
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
    readTokenFn: () => 'token',
    resolveTokenFileFn: () => 'file',
    getUnresolvedIndexConflictsFn: () => ({ ok: true, files: [] })
  });
  assert.ok(res1.failures.includes('pr-approval'));

  // Case 2: review state not APPROVED
  const context2 = { ...context1, approval: { ok: true, reviewState: 'COMMENT' } };
  const res2 = printIntegrationPreflight(context2, {
    readTokenFn: () => 'token',
    resolveTokenFileFn: () => 'file',
    getUnresolvedIndexConflictsFn: () => ({ ok: true, files: [] })
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
    getUnresolvedIndexConflictsFn: () => ({ ok: false, error: 'git error' })
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
    getUnresolvedIndexConflictsFn: () => ({ ok: true, files: [] })
  });
  
  assert.ok(result.warnings.includes('main-dirty'));
});

test('getUnresolvedIndexConflicts failure path', (t) => {
  const { getUnresolvedIndexConflicts } = require('../lib/commands/integrate');
  const result = getUnresolvedIndexConflicts('/tmp/dir', {
    gitRunner: () => ({ status: 1, stdout: 'git error' })
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error, 'git error');
});

test('promoteTaskForIntegrationIfNeeded failure path', (t) => {
  const { promoteTaskForIntegrationIfNeeded } = require('../lib/commands/integrate');
  const context = {
    task: { ok: true, taskFile: '/tmp/task.md' },
    taskStatus: 'review',
    approval: { ok: true, reviewState: 'APPROVED' }
  };
  
  // Mock backlog.setTaskStatus to fail
  const backlog = require('../lib/tools/backlog');
  const originalSetTaskStatus = backlog.setTaskStatus;
  backlog.setTaskStatus = () => false;

  const originalError = console.error;
  console.error = () => {};

  try {
    assert.throws(() => promoteTaskForIntegrationIfNeeded(context), (err) => err.constructor.name === 'IntegrationAbort');
  } finally {
    backlog.setTaskStatus = originalSetTaskStatus;
    console.error = originalError;
  }
});
