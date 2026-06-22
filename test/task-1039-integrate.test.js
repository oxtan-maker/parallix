const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { mock } = test;

const git = require('../lib/core/git');
const missionUtils = require('../lib/core/mission-utils');
const backlog = require('../lib/tools/backlog');
const forgejo = require('../lib/tools/forgejo');
const stats = require('../lib/commands/stats');

const TEST_SLUG = 'task-integrate-test';
const FAKE_ROOT = '/tmp/integrate-test-root';
const WORKTREE = path.join(FAKE_ROOT, '..', TEST_SLUG);

function loadIntegrate() {
  delete require.cache[require.resolve('../lib/commands/integrate')];
  return require('../lib/commands/integrate');
}

function setupMocks() {
  mock.method(backlog, 'getTaskClassification', () => 'ai_sdlc');
  mock.method(missionUtils, 'getPrimaryBranch', () => 'main');
  mock.method(missionUtils, 'inferSlug', (s) => s || TEST_SLUG);
  mock.method(missionUtils, 'findMissionDir', (_slug, rootDir = FAKE_ROOT) => path.join(rootDir, 'docs/missions/2026', TEST_SLUG));
  mock.method(missionUtils, 'findMissionArea', () => 'docs');
  mock.method(missionUtils, 'getPrimaryWorktree', () => FAKE_ROOT);
  mock.method(missionUtils, 'conventionalWorktreePath', () => path.join(FAKE_ROOT, '..', TEST_SLUG));
  mock.method(git, 'getCurrentBranch', () => 'mission/' + TEST_SLUG);
  mock.method(git, 'git', () => ({ status: 0, stdout: 'main', stderr: '' }));
  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true, taskFile: path.join(FAKE_ROOT, 'backlog/tasks/task.md') }));
  mock.method(backlog, 'getTaskStatus', () => 'ready-for-integration');
  mock.method(backlog, 'getTaskAssignee', () => 'claude');
  mock.method(backlog, 'setTaskStatus', () => true);
  mock.method(forgejo, 'getPrStatus', () => ({ exists: true, state: 'open', merged: false, number: 41 }));
  mock.method(forgejo, 'getLatestReviewDecision', () => ({ ok: true, reviewState: 'APPROVED' }));
  mock.method(forgejo, 'readToken', () => 'token');
  mock.method(forgejo, 'resolveTokenFile', () => 'token-file');
  mock.method(forgejo, 'syncMerged', () => ({ ok: true }));
  mock.method(stats, 'resolveMissionClassification', () => ({ classification: 'ai_sdlc' }));
  mock.method(process, 'cwd', () => FAKE_ROOT);
  mock.method(process, 'exit', () => {});
  
  if (!fs.existsSync(FAKE_ROOT)) fs.mkdirSync(FAKE_ROOT, { recursive: true });
  fs.writeFileSync(path.join(FAKE_ROOT, 'workflow.config.json'), JSON.stringify({
    adapters: { verification: { command: 'true' } },
  }), 'utf8');
}

function cleanup() {
  mock.reset();
  if (fs.existsSync(FAKE_ROOT)) fs.rmSync(FAKE_ROOT, { recursive: true, force: true });
}

test('integrate fails when slug is missing', (t) => {
  setupMocks();
  mock.method(missionUtils, 'inferSlug', () => null);
  const integrate = loadIntegrate();
  const originalError = console.error;
  let errorLogged = false;
  console.error = () => { errorLogged = true; };
  
  integrate([]);
  assert.ok(errorLogged);
  
  console.error = originalError;
  cleanup();
});

test('integrate preflight failure stops execution', (t) => {
  setupMocks();
  mock.method(git, 'getCurrentBranch', () => 'wrong-branch');
  const integrate = loadIntegrate();
  const originalError = console.error;
  let errorLogged = false;
  console.error = (msg) => { if (msg && msg.includes('Integration preflight failed')) errorLogged = true; };
  
  integrate([TEST_SLUG]);
  assert.ok(errorLogged);
  
  console.error = originalError;
  cleanup();
});

test('integrate dry-run mode', (t) => {
  setupMocks();
  const integrate = loadIntegrate();
  const originalLog = console.log;
  let logLogged = false;
  console.log = (msg) => { if (msg && msg.includes('Dry run complete')) logLogged = true; };
  
  integrate([TEST_SLUG, '--dry-run']);
  assert.ok(logLogged);
  
  console.log = originalLog;
  cleanup();
});

test('resolveConflictsForMission - worktree missing', (t) => {
  setupMocks();
  const integrate = loadIntegrate();
  if (fs.existsSync(WORKTREE)) fs.rmSync(WORKTREE, { recursive: true, force: true });
  const originalError = console.error;
  let errorLogged = false;
  console.error = (msg) => { if (msg && msg.includes('Mission worktree not found')) errorLogged = true; };
  
  const result = integrate.resolveConflictsForMission(TEST_SLUG, 'docs', {
    resolveWorktreeFn: () => null,
    rootDir: FAKE_ROOT
  });
  
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error, 'worktree-missing');
  assert.ok(errorLogged);
  
  console.error = originalError;
  cleanup();
});

test('resolveConflictsForMission - merge check failed', (t) => {
  setupMocks();
  const integrate = loadIntegrate();
  const wt = WORKTREE;
  if (!fs.existsSync(wt)) fs.mkdirSync(wt, { recursive: true });
  
  const result = integrate.resolveConflictsForMission(TEST_SLUG, 'docs', {
    resolveWorktreeFn: () => wt,
    getConflictFilesFn: () => { throw new Error('git error'); },
    rootDir: FAKE_ROOT
  });
  
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error, 'merge-failed');
  
  fs.rmSync(wt, { recursive: true, force: true });
  cleanup();
});

test('resolveConflictsForMission - shared vs mission-specific classification', (t) => {
  setupMocks();
  const integrate = loadIntegrate();
  const wt = WORKTREE;
  if (!fs.existsSync(wt)) fs.mkdirSync(wt, { recursive: true });
  
  // Case 1: Shared file conflict
  const res1 = integrate.resolveConflictsForMission(TEST_SLUG, 'docs', {
    resolveWorktreeFn: () => wt,
    getConflictFilesFn: () => ['workflow/lib/commands/integrate.js'],
    rootDir: FAKE_ROOT
  });
  assert.strictEqual(res1.ok, false);
  assert.strictEqual(res1.error, 'shared-file-conflicts');

  // Case 2: Mission-specific conflict
  const res2 = integrate.resolveConflictsForMission(TEST_SLUG, 'docs', {
    resolveWorktreeFn: () => wt,
    getConflictFilesFn: () => [`docs/missions/2026/${TEST_SLUG}/CP-1.md`],
    rootDir: FAKE_ROOT
  });
  assert.strictEqual(res2.ok, true);
  assert.strictEqual(res2.missionSpecificFiles.length, 1);

  fs.rmSync(wt, { recursive: true, force: true });
  cleanup();
});

test('buildConflictResolutionPrompt returns formatted array', (t) => {
  setupMocks();
  const integrate = loadIntegrate();
  const prompt = integrate.buildConflictResolutionPrompt(TEST_SLUG, 'docs', {
    rootDir: FAKE_ROOT,
    worktreePath: WORKTREE
  });
  assert.ok(Array.isArray(prompt));
  assert.ok(prompt.some(line => line.includes('Conflict resolution options')));
  cleanup();
});
