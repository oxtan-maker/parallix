

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { mockModule, installModuleMocks } from './lib/module-mock.js';
const integrateModule = mockModule<typeof import('../src/adapters/cli/commands/integrate.js')>('../src/adapters/cli/commands/integrate.js', import.meta.url);
mockModule<typeof import('../src/adapters/cli/commands/integrate-command.js')>('../src/adapters/cli/commands/integrate-command.js', import.meta.url);
const git = mockModule<typeof import('../src/adapters/git/git.js')>('../src/adapters/git/git.js', import.meta.url);
const missionUtils = mockModule<typeof import('../src/adapters/filesystem/mission-utils.js')>('../src/adapters/filesystem/mission-utils.js', import.meta.url);
const backlog = mockModule<typeof import('../src/adapters/backlog/backlog.js')>('../src/adapters/backlog/backlog.js', import.meta.url);
const forgejo = mockModule<typeof import('../src/adapters/forgejo/forgejo.js')>('../src/adapters/forgejo/forgejo.js', import.meta.url);
const composition = mockModule<typeof import('../src/composition/application-services.js')>('../src/composition/application-services.js', import.meta.url);
const stats = mockModule<typeof import('../src/adapters/cli/commands/stats.js')>('../src/adapters/cli/commands/stats.js', import.meta.url);
await installModuleMocks();
const integrate = integrateModule.default;
const { mock } = test;

const TEST_SLUG = 'task-2204';
const FAKE_ROOT = '/tmp/task-2204-integrate-root';

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

  // SC3: Mock createMissionApplicationServices for SQLite-first transitions.
  // The mission carries an authoritative approved Review so integrate's
  // lifecycle recovery reaches the merged-PR preflight this test exercises.
  mock.method(composition, 'createMissionApplicationServices', async () => ({
    store: {
      _repoId: 'default',
      load: async () => ({ kind: 'found', mission: { status: 'review', review: { rounds: [{ decision: { kind: 'approved', decidedAt: '2026-01-01T10:30:00Z' } }] } }, version: 1 }),
    },
    lifecycle: {
      transition: async () => ({ status: 'completed', value: { to: 'review', version: 2 } }),
    },
    handoff: {
      recordNel: async () => ({}),
    },
  }));

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

test('integrate rejects merged Forgejo PRs during preflight with recovery guidance', async () => {
  const state = setupMocks();
  const logs = [];
  const errors = [];
  const exitCodes = [];
  const originalLog = console.log;
  const originalError = console.error;

  console.log = (msg) => logs.push(String(msg));
  console.error = (msg) => errors.push(String(msg));
  mock.method(process, 'exit', (code) => exitCodes.push(code));

  try {
    await integrate([TEST_SLUG, '--no-integration-gates'], { missionServicesFn: composition.createMissionApplicationServices });

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
