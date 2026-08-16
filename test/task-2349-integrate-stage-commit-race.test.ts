import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mockModule, installModuleMocks } from './lib/module-mock.js';

const gitModule = mockModule<typeof import('../src/adapters/git/git.js')>('../src/adapters/git/git.js', import.meta.url);
const missionUtils = mockModule<typeof import('../src/adapters/filesystem/mission-utils.js')>('../src/adapters/filesystem/mission-utils.js', import.meta.url);
const backlog = mockModule<typeof import('../src/adapters/backlog/backlog.js')>('../src/adapters/backlog/backlog.js', import.meta.url);
const forgejo = mockModule<typeof import('../src/adapters/forgejo/forgejo.js')>('../src/adapters/forgejo/forgejo.js', import.meta.url);
const stats = mockModule<typeof import('../src/adapters/cli/commands/stats.js')>('../src/adapters/cli/commands/stats.js', import.meta.url);
const composition = mockModule<typeof import('../src/composition/application-services.js')>('../src/composition/application-services.js', import.meta.url);
const integrateModule = mockModule<typeof import('../src/adapters/cli/commands/integrate.js')>('../src/adapters/cli/commands/integrate.js', import.meta.url);
await installModuleMocks();

const TEST_SLUG = 'task-2349-race';
const FAKE_ROOT = path.join(os.tmpdir(), `task-2349-race-${process.pid}`);
const MISSION_PAYLOAD = 'src/mission-payload.ts';
const UNRELATED_DIRTY_FILE = 'notes/unrelated-dirty.md';

function setup() {
  process.env.PARALLIX_TEST_ALLOW_INTEGRATION_GATE_BYPASS = '1';
  fs.mkdirSync(FAKE_ROOT, { recursive: true });
  fs.writeFileSync(path.join(FAKE_ROOT, 'workflow.config.json'), JSON.stringify({ adapters: { review: { provider: 'forgejo' }, verification: { command: 'true' } } }));
  mock.method(missionUtils, 'inferSlug', () => TEST_SLUG);
  mock.method(missionUtils, 'getPrimaryBranch', () => 'main');
  mock.method(missionUtils, 'getPrimaryWorktree', () => FAKE_ROOT);
  mock.method(missionUtils, 'findMissionDir', () => path.join(FAKE_ROOT, 'missions', TEST_SLUG));
  mock.method(missionUtils, 'findMissionArea', () => 'all');
  mock.method(missionUtils, 'conventionalWorktreePath', () => path.join(FAKE_ROOT, '..', TEST_SLUG));
  mock.method(missionUtils, 'resolveMainRepo', () => FAKE_ROOT);
  mock.method(missionUtils, 'missionTitle', () => 'Race test');
  mock.method(missionUtils, 'updateGraphifyKnowledgeGraph', () => false);
  mock.method(gitModule, 'getCurrentBranch', () => `mission/${TEST_SLUG}`);
  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true, taskFile: path.join(FAKE_ROOT, 'backlog/tasks/task.md') }));
  mock.method(backlog, 'getTaskClassification', () => 'ai_sdlc');
  mock.method(backlog, 'getTaskStatus', () => 'approved');
  mock.method(backlog, 'getTaskAssignee', () => 'codex');
  mock.method(backlog, 'completeTask', () => true);
  mock.method(forgejo, 'getPrStatus', () => ({ exists: true, state: 'open', merged: false, number: 1 }));
  mock.method(forgejo, 'getLatestReviewDecision', () => ({ ok: true, reviewState: 'APPROVED' }));
  mock.method(forgejo, 'listOpenPrsForSlug', () => []);
  mock.method(forgejo, 'readToken', () => 'token');
  mock.method(forgejo, 'resolveTokenFile', () => 'token-file');
  mock.method(forgejo, 'syncMerged', () => ({ ok: true }));
  mock.method(forgejo, 'resolveTrackingBranchSha', () => ({ ok: true, sha: 'deadbeef' }));
  mock.method(stats, 'recordIntegrationStats', async () => ({ changed: false, row: { mission: TEST_SLUG }, data: { rows: [] }, report: 'none' }));
  mock.method(stats, 'resolveMissionClassification', () => ({ classification: 'ai_sdlc' }));
  mock.method(composition, 'createMissionApplicationServices', async () => ({
    // TASK-2376: the domain integrate command requires status=integration;
    // a review-status mission with no Review aggregate must stop, not integrate.
    store: { _repoId: 'default', load: async () => ({ kind: 'found', mission: { status: 'integration', review: null }, version: 1 }) },
    lifecycle: { transition: async () => ({ status: 'completed', value: { to: 'review', version: 2 } }) },
    handoff: { recordNel: async () => ({}) },
  }));
  mock.method(process, 'cwd', () => FAKE_ROOT);
  mock.method(process, 'exit', () => {});
}

test('intervening bare board commit cannot contain the prepared mission payload', async () => {
  setup();
  let stagedPaths: string[] = [];
  let boardCommitPaths: string[] = [];
  let squashCommitArgs: string[] = [];
  fs.mkdirSync(path.join(FAKE_ROOT, 'notes'), { recursive: true });
  fs.writeFileSync(path.join(FAKE_ROOT, UNRELATED_DIRTY_FILE), 'leave me out');
  mock.method(gitModule, 'git', (args) => {
    if (args.includes('branch') && args.includes('--show-current')) return { status: 0, stdout: 'main', stderr: '' };
    if (args.includes('branch') || args.includes('status') || args.includes('merge')) return { status: 0, stdout: '', stderr: '' };
    if (args.includes('diff') && args.includes('--cached') && args.includes('--name-only')) {
      boardCommitPaths = [...stagedPaths]; // `git commit -m "Reorder tasks in review"` interleaves after payload preparation.
      return { status: 0, stdout: `${MISSION_PAYLOAD}\n`, stderr: '' };
    }
    if (args.includes('add') && args.includes('-A')) {
      stagedPaths = [MISSION_PAYLOAD];
      boardCommitPaths = [...stagedPaths]; // `git commit -m "Reorder tasks in review"` interleaves here.
      stagedPaths = [];
      return { status: 0, stdout: '', stderr: '' };
    }
    if (args.includes('commit')) {
      squashCommitArgs = args;
      return { status: boardCommitPaths.length ? 1 : 0, stdout: '', stderr: boardCommitPaths.length ? 'nothing to commit' : '' };
    }
    if (args.includes('rev-parse')) return { status: 0, stdout: 'deadbeef', stderr: '' };
    return { status: 0, stdout: '', stderr: '' };
  });

  try {
    await integrateModule.default([TEST_SLUG, '--no-integration-gates'], { missionServicesFn: composition.createMissionApplicationServices });
    assert.deepEqual(boardCommitPaths, [], 'Reorder tasks in review must not carry mission payload files');
    assert.ok(squashCommitArgs.includes('--only'));
    assert.ok(squashCommitArgs.includes(MISSION_PAYLOAD));
    assert.ok(!squashCommitArgs.includes(UNRELATED_DIRTY_FILE));
  } finally {
    mock.reset();
    fs.rmSync(FAKE_ROOT, { recursive: true, force: true });
  }
});

async function runFailedCommit(payloadAtHead: boolean) {
  setup();
  const logs: string[] = [];
  const errors: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = message => logs.push(String(message));
  console.error = message => errors.push(String(message));
  mock.method(gitModule, 'git', (args) => {
    if (args.includes('branch') && args.includes('--show-current')) return { status: 0, stdout: 'main', stderr: '' };
    if (args.includes('branch') || args.includes('status') || args.includes('merge')) return { status: 0, stdout: '', stderr: '' };
    if (args.includes('diff') && args.includes('--cached')) return { status: 0, stdout: `${MISSION_PAYLOAD}\n`, stderr: '' };
    if (args.includes('diff') && args.includes('--quiet')) return { status: payloadAtHead ? 0 : 1, stdout: '', stderr: '' };
    if (args.includes('commit')) return { status: 1, stdout: '', stderr: 'hook rejected the commit' };
    if (args.includes('rev-parse')) return { status: 0, stdout: 'carrying-commit', stderr: '' };
    return { status: 0, stdout: '', stderr: '' };
  });
  try {
    await integrateModule.default([TEST_SLUG, '--no-integration-gates'], { missionServicesFn: composition.createMissionApplicationServices });
    return [...logs, ...errors].join('\n');
  } finally {
    console.log = originalLog;
    console.error = originalError;
    mock.reset();
    fs.rmSync(FAKE_ROOT, { recursive: true, force: true });
  }
}

test('non-zero squash commit reports the carrying commit when HEAD has the complete payload', async () => {
  const output = await runFailedCommit(true);
  assert.match(output, /Integration payload already landed in commit carrying-commit/);
  assert.doesNotMatch(output, /Could not create the squash commit in the local integration checkout/);
});

test('non-zero squash commit with an absent payload retains hook recovery guidance', async () => {
  const output = await runFailedCommit(false);
  assert.match(output, /Could not create the squash commit in the local integration checkout/);
  assert.match(output, /The squash commit runs the repo git hooks\. Fix the reported hook failure/);
});
