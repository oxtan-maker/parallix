const test = require('node:test');
const { mock } = test;
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

require('../lib/commands/stats');
const backlog = require('../lib/tools/backlog');
mock.method(backlog, 'getTaskClassification', () => 'ai_sdlc');
const missionUtils = require('../lib/core/mission-utils');

process.env.PRIMARY_WORKTREE = '/tmp/mission';
const FAKE_ROOT = '/tmp/mission';
mock.method(missionUtils, 'getPrimaryBranch', () => 'main');

const { evaluateTaskStatusForIntegration, printIntegrationPreflight, buildIntegrationContext } = require('../lib/commands/integrate');

// SC 1a: evaluateTaskStatusForIntegration accepts locally-derived reviewState: 'APPROVED' for tasks in status 'review'
test('evaluateTaskStatusForIntegration accepts local-review-state approval for review status', () => {
  const result = evaluateTaskStatusForIntegration({
    taskStatus: 'review',
    pr: { merged: false },
    approval: { ok: true, reviewState: 'APPROVED', source: 'local-review-state' }
  });

  assert.equal(result.ok, true);
  assert.equal(result.level, 'warn');
  assert.match(result.message, /review accepted for integration/i);
  assert.match(result.message, /local review-state: approved/i);
});

// SC 1b: evaluateTaskStatusForIntegration rejects when only Forgejo is unavailable and local state is missing
test('evaluateTaskStatusForIntegration rejects when token and review-state both missing', () => {
  const result = evaluateTaskStatusForIntegration({
    taskStatus: 'review',
    pr: { merged: false },
    approval: { ok: false, error: 'forgejo-off', reviewState: null, source: undefined }
  });

  assert.equal(result.ok, false);
  assert.equal(result.level, 'fail');
  assert.match(result.message, /expected approved, or review with an approved\/merged Forgejo PR/i);
});

// SC 1c: evaluateTaskStatusForIntegration does not confuse local source with Forgejo APPROVED for default user override
test('evaluateTaskStatusForIntegration: local-review-state does not trigger default user override path', () => {
  const context = {
    taskStatus: 'review',
    pr: { merged: false },
    approval: { ok: true, reviewState: 'REQUEST_CHANGES', defaultUserApproved: true }
  };

  const result = evaluateTaskStatusForIntegration(context);
  assert.ok(result.ok);
  assert.match(result.message, /default user approved for integration/i);
});

// SC 3a: printIntegrationPreflight passes preflight when approval is local-only (token missing + review-state approved)
test('printIntegrationPreflight logs INFO instead of FAIL for token + approval when local review-state is approved', () => {
  const lines = [];
  const logs = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = line => logs.push(line);
  console.error = line => logs.push(line);

  try {
    const result = printIntegrationPreflight({
      slug: 'task-1219',
      branch: 'mission/task-1219',
      currentBranch: 'mission/task-1219',
      missionDir: '/tmp/docs/missions/2026/task-1219',
      task: { ok: true, taskFile: '/tmp/task-1219.md' },
      taskStatus: 'review',
      taskAssignee: 'autonomous',
      forgejoUser: 'autonomous',
      taskAssigneeWarning: null,
      pr: { exists: true, state: 'open', merged: false, number: 1219 },
      approval: { ok: true, reviewState: 'APPROVED', source: 'local-review-state' },
      mainBranch: 'main',
      mainDirty: false,
      mainDirtyEntries: []
    }, {
      readTokenFn: () => null,
      resolveTokenFileFn: () => null,
      isForgejoReviewEnabledFn: () => true,
      getUnresolvedIndexConflictsFn: () => ({ ok: true, files: [] })
    });

    // The approval should not be a failure — local review-state fallback applies
    assert.ok(!result.failures.includes('pr-approval'));
    // The token should not be a failure either
    assert.ok(!result.failures.includes('forgejo-token'));
    // Check the INFO-level logging text
    const output = logs.join('\n');
    assert.ok(output.includes('local review-state') || output.includes('approved'));
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
});

// SC 3b: printIntegrationPreflight fails preflight when token missing AND no local review-state
test('printIntegrationPreflight still fails when no token AND no local review-state', () => {
  const lines = [];
  const logs = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = line => logs.push(line);
  console.error = line => logs.push(line);

  try {
    const result = printIntegrationPreflight({
      slug: 'task-1219',
      branch: 'mission/task-1219',
      currentBranch: 'mission/task-1219',
      missionDir: '/tmp/docs/missions/2026/task-1219',
      task: { ok: true, taskFile: '/tmp/task-1219.md' },
      taskStatus: 'review',
      taskAssignee: 'autonomous',
      forgejoUser: 'autonomous',
      taskAssigneeWarning: null,
      pr: { exists: true, state: 'open', merged: false, number: 1219 },
      approval: { ok: false, error: 'forgejo-off', reviewState: null, source: undefined },
      mainBranch: 'main',
      mainDirty: false,
      mainDirtyEntries: []
    }, {
      readTokenFn: () => null,
      resolveTokenFileFn: () => null,
      isForgejoReviewEnabledFn: () => true,
      getUnresolvedIndexConflictsFn: () => ({ ok: true, files: [] })
    });

    // Without local fallback, this should have the failures as before
    assert.ok(result.failures.includes('forgejo-token'));
    assert.ok(result.failures.includes('pr-approval'));
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
});

// SC 3c: printIntegrationPreflight passes when local review-state + token available (happy case unchanged)
test('printIntegrationPreflight PASS for approval when token and forgejo report approved', () => {
  const logs = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = line => logs.push(line);
  console.error = line => logs.push(line);

  try {
    const result = printIntegrationPreflight({
      slug: 'task-1219',
      branch: 'mission/task-1219',
      currentBranch: 'mission/task-1219',
      missionDir: '/tmp/docs/missions/2026/task-1219',
      task: { ok: true, taskFile: '/tmp/task-1219.md' },
      taskStatus: 'review',
      taskAssignee: 'codex',
      forgejoUser: 'codex',
      taskAssigneeWarning: null,
      pr: { exists: true, state: 'open', merged: false, number: 1219 },
      approval: { ok: true, reviewState: 'APPROVED' },
      mainBranch: 'main',
      mainDirty: false,
      mainDirtyEntries: []
    }, {
      readTokenFn: () => 'secret-token',
      resolveTokenFileFn: () => '/tmp/tokens/codex',
      isForgejoReviewEnabledFn: () => true,
      getUnresolvedIndexConflictsFn: () => ({ ok: true, files: [] })
    });

    // Forgejo path should PASS
    assert.ok(!result.failures.includes('pr-approval'));
    assert.ok(!result.failures.includes('forgejo-token'));
    const output = logs.join('\n');
    assert.ok(output.includes('Forgejo approval: latest formal review state is APPROVED'));
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
});

// SC 5a: buildIntegrationContext returns local-approved approval when readToken returns null but review-state.json has phase=approved
test('buildIntegrationContext returns local-review-state approval when token missing but review-state is approved', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'task-1219-bic-test-'));
  const missionDir = path.join(tmpRoot, 'docs', 'missions', '2026', 'task-1219');
  fs.mkdirSync(missionDir, { recursive: true });
  fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Mission: task-1219\n');
  const taskFile = path.join(missionDir, 'tasks', 'task-1219.md');
  fs.mkdirSync(path.join(missionDir, 'tasks'), { recursive: true });
  fs.writeFileSync(taskFile, '# task-1219\n');
  const stateFile = path.join(missionDir, 'review-state.json');
  fs.writeFileSync(stateFile, JSON.stringify({
    reviewer: 'claude',
    implementer: 'qwen',
    round: 1,
    startedAt: '2026-06-02T13:00:00.000Z',
    phase: 'approved',
    disposition: 'APPROVED'
  }), 'utf8');
  const previous = process.cwd();
  const originalIsForgejoEnabled = require('../lib/core/product-config').isForgejoReviewEnabled;
  const originalReadToken = require('../lib/tools/forgejo').readToken;
  try {
    process.chdir(tmpRoot);
    mock.method(require('../lib/core/product-config'), 'isForgejoReviewEnabled', () => true);
    mock.method(require('../lib/tools/forgejo'), 'readToken', () => null);
    mock.method(require('../lib/tools/forgejo'), 'getPrStatus', () => ({ exists: true, state: 'open', merged: false, number: 1219 }));
    mock.method(require('../lib/tools/forgejo'), 'getLatestReviewDecision', () => ({ ok: false, error: 'connection-refused', reviewState: null }));
    mock.method(require('../lib/core/git'), 'getCurrentBranch', () => 'mission/task-1219');
    mock.method(require('../lib/core/git'), 'git', () => ({ status: 0, stdout: 'main', stderr: '' }));
    const result = buildIntegrationContext('task-1219', { baseBranch: 'main', baseWorktree: tmpRoot, isForgejoReviewEnabledFn: () => true });

    assert.ok(result.approval, 'approval should be present');
    assert.equal(result.approval.ok, true, 'approval.ok should be true');
    assert.equal(result.approval.reviewState, 'APPROVED', 'reviewState should be APPROVED');
    assert.equal(result.approval.source, 'local-review-state', 'approval should be sourced from local review-state');
  } finally {
    process.chdir(previous);
    if (fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true, force: true });
    mock.reset();
  }
});

// SC 5a negation: no local fallback when review-state.json is missing and Forgejo is down
test('buildIntegrationContext does not fallback when review-state.json is absent', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'task-1219-bic-no-rs-'));
  const missionDir = path.join(tmpRoot, 'docs', 'missions', '2026', 'task-1219');
  fs.mkdirSync(missionDir, { recursive: true });
  fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Mission: task-1219\n');
  const taskFile = path.join(missionDir, 'tasks', 'task-1219.md');
  fs.mkdirSync(path.join(missionDir, 'tasks'), { recursive: true });
  fs.writeFileSync(taskFile, '# task-1219\n');
  // Deliberately do NOT write review-state.json
  const previous = process.cwd();
  try {
    process.chdir(tmpRoot);
    const result = buildIntegrationContext('task-1219', { baseBranch: 'main', baseWorktree: tmpRoot, isForgejoReviewEnabledFn: () => true });
    assert.equal(result.approval.source, undefined, 'without review-state.json, fallback source must be absent');
  } finally {
    process.chdir(previous);
    if (fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true, force: true });
    mock.reset();
  }
});

// SC 5a disposition guard: phase=approved but disposition=REQUEST_CHANGES should NOT produce local fallback
test('buildIntegrationContext requires disposition=APPROVED not just phase=approved', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'task-1219-disposition-'));
  const missionDir = path.join(tmpRoot, 'docs', 'missions', '2026', 'task-1219');
  fs.mkdirSync(missionDir, { recursive: true });
  fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Mission: task-1219\n');
  const stateFile = path.join(missionDir, 'review-state.json');
  fs.writeFileSync(stateFile, JSON.stringify({
    reviewer: 'claude', implementer: 'qwen', round: 1,
    phase: 'approved', disposition: 'REQUEST_CHANGES'
  }), 'utf8');
  const taskFile = path.join(missionDir, 'tasks', 'task-1219.md');
  fs.mkdirSync(path.join(missionDir, 'tasks'), { recursive: true });
  fs.writeFileSync(taskFile, '# task-1219\n');
  const previous = process.cwd();
  try {
    process.chdir(tmpRoot);
    const result = buildIntegrationContext('task-1219', { baseBranch: 'main', baseWorktree: tmpRoot, isForgejoReviewEnabledFn: () => true });
    assert.notEqual(result.approval.source, 'local-review-state', 'phase=approved with disposition=REQUEST_CHANGES should not fallback');
    assert.equal(result.approval.ok, false, 'fallback should not apply when disposition is not APPROVED');
  } finally {
    process.chdir(previous);
    if (fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true, force: true });
    mock.reset();
  }
});

// End-to-end: buildIntegrationContext output → printIntegrationPreflight validates local fallback path
test('printIntegrationPreflight accepts buildIntegrationContext local-review-state output without forgejo-token FAIL', () => {
  const logs = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = line => logs.push(line);
  console.error = line => logs.push(line);

  try {
    const ctx = {
      slug: 'task-1219',
      branch: 'mission/task-1219',
      currentBranch: 'mission/task-1219',
      missionDir: '/tmp/docs/missions/2026/task-1219',
      task: { ok: true, taskFile: '/tmp/task-1219.md' },
      taskStatus: 'review',
      taskAssignee: 'qwen',
      forgejoUser: 'qwen',
      taskAssigneeWarning: null,
      pr: { exists: true, state: 'open', merged: false, number: 1219 },
      // This is exactly what buildIntegrationContext sets when local fallback succeeds
      approval: { ok: true, reviewState: 'APPROVED', source: 'local-review-state' },
      baseBranch: 'main',
      baseWorktree: '/tmp',
      mainBranch: 'main',
      mainDirty: false,
      mainDirtyEntries: []
    };

    const result = printIntegrationPreflight(ctx, {
      readTokenFn: () => null,
      resolveTokenFileFn: () => null,
      isForgejoReviewEnabledFn: () => true,
      getUnresolvedIndexConflictsFn: () => ({ ok: true, files: [] })
    });

    // Prevalent success criteria: no pr-approval or forgejo-token failure when local fallback is active
    assert.ok(!result.failures.includes('pr-approval'), 'pr-approval must not be in failures with local-review-state');
    assert.ok(!result.failures.includes('forgejo-token'), 'forgejo-token must not be in failures with local-review-state');
    const output = logs.join('\n');
    assert.ok(output.includes('INFO'), 'should log INFO for local fallback, not FAIL');
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
});
