
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { mock } = test;

const git = require('../.test-runtime/lib/core/git');
const missionUtils = require('../.test-runtime/lib/core/mission-utils');
const backlog = require('../.test-runtime/lib/tools/backlog');
const forgejo = require('../.test-runtime/lib/tools/forgejo');
const stats = require('../.test-runtime/lib/commands/stats');

const TEST_SLUG = 'task-2204';
const FAKE_ROOT = '/tmp/task-2204-integrate-root';

function loadIntegrate() {
  delete require.cache[require.resolve('../.test-runtime/lib/commands/integrate')];
  return require('../.test-runtime/lib/commands/integrate');
}

function setupMocks() {
  let statsCalled = false;
  let syncMergedCalled = false;

  mock.method(backlog, 'getTaskClassification', () => 'ai_sdlc');
  mock.method(missionUtils, 'getPrimaryBranch', () => 'main');
  mock.method(missionUtils, 'inferSlug', (slug) => slug || TEST_SLUG);
  mock.method(missionUtils, 'findMissionDir', () => path.join(FAKE_ROOT, 'missions', TEST_SLUG));
  mock.method(missionUtils, 'findMissionArea', () => 'docs');
  mock.method(missionUtils, 'getPrimaryWorktree', () => FAKE_ROOT);
  mock.method(missionUtils, 'conventionalWorktreePath', () => path.join('/tmp', TEST_SLUG));
  mock.method(missionUtils, 'resolveMainRepo', () => FAKE_ROOT);
  mock.method(missionUtils, 'missionTitle', () => 'Remove Variant A');
  mock.method(missionUtils, 'updateGraphifyKnowledgeGraph', () => false);

  mock.method(git, 'getCurrentBranch', () => `mission/${TEST_SLUG}`);
  mock.method(git, 'git', (args) => {
    if (args.includes('branch') && args.includes('--show-current')) {
      return { status: 0, stdout: 'main', stderr: '' };
    }
    if (args.includes('status') && args.includes('--short')) {
      return { status: 0, stdout: '', stderr: '' };
    }
    if (args.includes('branch') && args.includes('--list')) {
      return { status: 0, stdout: 'main\n', stderr: '' };
    }
    return { status: 0, stdout: '', stderr: '' };
  });

  mock.method(backlog, 'resolveTaskFile', () => ({
    ok: true,
    taskFile: path.join(FAKE_ROOT, 'backlog/tasks/task-2204 - remove-variant-a.md')
  }));
  mock.method(backlog, 'getTaskStatus', () => 'review');
  mock.method(backlog, 'getTaskAssignee', () => 'claude');
  mock.method(backlog, 'setTaskStatus', () => true);
  mock.method(backlog, 'completeTask', () => true);

  mock.method(forgejo, 'getPrStatus', () => ({
    exists: true,
    state: 'closed',
    merged: true,
    number: 2204,
    raw: 'merged'
  }));
  mock.method(forgejo, 'listOpenPrsForSlug', () => []);
  mock.method(forgejo, 'getLatestReviewDecision', () => ({
    ok: false,
    error: 'pr-already-merged',
    reviewState: null
  }));
  mock.method(forgejo, 'readToken', () => 'token');
  mock.method(forgejo, 'resolveTokenFile', () => '/tmp/forgejo-token');
  mock.method(forgejo, 'syncMerged', () => {
    syncMergedCalled = true;
    return { ok: true };
  });

  mock.method(stats, 'recordIntegrationStats', () => {
    statsCalled = true;
    return {
      changed: false,
      row: { mission: TEST_SLUG },
      data: { rows: [] },
      report: 'Current week\nnone',
    };
  });
  mock.method(stats, 'resolveMissionClassification', () => ({ classification: 'ai_sdlc' }));
  mock.method(forgejo, 'resolveTrackingBranchSha', () => ({
    ok: true,
    ref: 'refs/remotes/origin/main',
    sha: 'deadbeef'
  }));
  mock.method(process, 'cwd', () => FAKE_ROOT);

  if (!fs.existsSync(FAKE_ROOT)) {
    fs.mkdirSync(FAKE_ROOT, { recursive: true });
  }
  fs.writeFileSync(
    path.join(FAKE_ROOT, 'workflow.config.json'),
    JSON.stringify({
      adapters: {
        review: {
          provider: 'forgejo',
          baseUrl: 'http://localhost:3300',
          remote: 'review',
          repo: 'magnus/visualboard'
        },
        verification: { command: 'true' }
      }
    }),
    'utf8'
  );

  return {
    wasStatsCalled: () => statsCalled,
    wasSyncMergedCalled: () => syncMergedCalled
  };
}

function cleanup() {
  mock.reset();
  if (fs.existsSync(FAKE_ROOT)) {
    fs.rmSync(FAKE_ROOT, { recursive: true, force: true });
  }
}

test('integrate rejects merged Forgejo PRs during preflight with recovery guidance', () => {
  const state = setupMocks();
  const integrate = loadIntegrate();
  const logs = [];
  const errors = [];
  const exitCodes = [];
  const originalLog = console.log;
  const originalError = console.error;

  console.log = (msg) => logs.push(String(msg));
  console.error = (msg) => errors.push(String(msg));
  mock.method(process, 'exit', (code) => exitCodes.push(code));

  try {
    integrate([TEST_SLUG, '--no-integration-gates']);

    const output = [...logs, ...errors].join('\n');
    assert.deepEqual(exitCodes, [1]);
    assert.match(output, /Forgejo PR: PR #2204 is already marked merged/i);
    assert.match(output, /Integration preflight failed/i);
    assert.match(output, /re-sync the local base branch/i);
    assert.match(output, /px integrate task-2204 --dry-run/i);
    assert.equal(state.wasStatsCalled(), false);
    assert.equal(state.wasSyncMergedCalled(), false);
  } finally {
    console.log = originalLog;
    console.error = originalError;
    cleanup();
  }
});
