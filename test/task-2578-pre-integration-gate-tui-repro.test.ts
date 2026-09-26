// TASK-2578 — a non-dashboard terminal must still receive live gate progress.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mockModule, installModuleMocks } from './lib/module-mock.js';
import { runPhaseGates } from '../src/adapters/config/repository-gates.js';

const git = mockModule<typeof import('../src/adapters/git/git.js')>('../src/adapters/git/git.js', import.meta.url);
const missionUtils = mockModule<typeof import('../src/adapters/filesystem/mission-utils.js')>('../src/adapters/filesystem/mission-utils.js', import.meta.url);
const backlog = mockModule<typeof import('../src/adapters/backlog/backlog.js')>('../src/adapters/backlog/backlog.js', import.meta.url);
const forgejo = mockModule<typeof import('../src/adapters/forgejo/forgejo.js')>('../src/adapters/forgejo/forgejo.js', import.meta.url);
const stats = mockModule<typeof import('../src/adapters/cli/commands/stats.js')>('../src/adapters/cli/commands/stats.js', import.meta.url);
const verification = mockModule<typeof import('../src/adapters/verification/verification.js')>('../src/adapters/verification/verification.js', import.meta.url);
const composition = mockModule<typeof import('../src/composition/application-services.js')>('../src/composition/application-services.js', import.meta.url);
const post = mockModule<typeof import('../src/adapters/cli/commands/integrate-post.js')>('../src/adapters/cli/commands/integrate-post.js', import.meta.url);
const integrateModule = mockModule<typeof import('../src/adapters/cli/commands/integrate.js')>('../src/adapters/cli/commands/integrate.js', import.meta.url);
await installModuleMocks();
const integrate = integrateModule.default;

test('TASK-2578: parallel pre-integration fallback renders live start and completion progress', async () => {
  const checkout = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2578-'));
  const output: string[] = [];
  const started: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = line => { output.push(String(line)); };
  console.error = line => { output.push(String(line)); };
  try {
    const result = await runPhaseGates('integration', {
      slug: 'task-2578',
      checkoutPath: checkout,
      maxParallel: 2,
      gates: [
        { key: 'rebase-visible', command: 'rebase-visible', order: 1 },
        { key: 'pre-commit-visible', command: 'pre-commit-visible', order: 2 },
      ],
      commandRunner: command => new Promise(resolve => {
        started.push(command);
        setTimeout(() => resolve({ status: command === 'pre-commit-visible' ? 1 : 0, stdout: '', stderr: '' }), 5);
      }),
    });

    assert.deepEqual(started.sort(), ['pre-commit-visible', 'rebase-visible']);
    assert.equal(result.failedGate?.key, 'pre-commit-visible');
    const rendered = output.join('\n');
    assert.match(rendered, /rebase-visible started/);
    assert.match(rendered, /pre-commit-visible started/);
    assert.match(rendered, /rebase-visible passed/);
    assert.match(rendered, /pre-commit-visible failed/);
  } finally {
    console.log = originalLog;
    console.error = originalError;
    fs.rmSync(checkout, { recursive: true, force: true });
  }
});

test('TASK-2578: px integrate renders parallel gate progress after rebase and pre-commit', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2578-integrate-'));
  const slug = 'task-2578';
  const logs: string[] = [];
  const rebased = { value: false };
  let preCommitRuns = 0;
  mock.method(console, 'log', line => { logs.push(String(line)); });
  mock.method(console, 'error', line => { logs.push(String(line)); });
  mock.method(process, 'cwd', () => root);
  mock.method(process, 'exit', () => {});
  mock.method(git, 'getCurrentBranch', () => `mission/${slug}`);
  mock.method(git, 'git', (args: string[]) => {
    const joined = args.join(' ');
    if (args.includes('rebase')) {
      if (args.includes('--show-current') || args.includes('--continue')) return { status: 0, stdout: '', stderr: '' };
      rebased.value = true;
      return { status: 0, stdout: '', stderr: '' };
    }
    if (args.includes('log')) return { status: 0, stdout: '', stderr: '' };
    if (args.includes('symbolic-ref')) return { status: 0, stdout: 'main\n', stderr: '' };
    if (args.includes('branch')) return { status: 0, stdout: 'main\n', stderr: '' };
    if (joined.includes('merge-base') && joined.includes('--is-ancestor')) return { status: 0, stdout: '', stderr: '' };
    if (joined.includes('merge-base') || args.includes('rev-parse') || args.includes('show')) return { status: 0, stdout: 'landed-sha', stderr: '' };
    if (joined.includes('merge') && joined.includes('--no-commit')) return { status: rebased.value ? 0 : 1, stdout: '', stderr: '' };
    if (joined.includes('merge') && (joined.includes('--abort') || joined.includes('--squash'))) return { status: 0, stdout: '', stderr: '' };
    if (joined.includes('commit') || joined.includes('diff') || joined.includes('symbolic-ref') || joined.includes('ls-files') || joined.includes('status') || joined.includes('branch')) return { status: 0, stdout: '', stderr: '' };
    return { status: 0, stdout: '', stderr: '' };
  });
  mock.method(missionUtils, 'inferSlug', () => slug);
  mock.method(missionUtils, 'getPrimaryBranch', () => 'main');
  mock.method(missionUtils, 'getPrimaryWorktree', () => root);
  mock.method(missionUtils, 'findMissionDir', () => path.join(root, 'missions', slug));
  mock.method(missionUtils, 'findMissionArea', () => 'all');
  mock.method(missionUtils, 'conventionalWorktreePath', () => root);
  mock.method(missionUtils, 'resolveMainRepo', () => root);
  mock.method(missionUtils, 'missionTitle', () => 'fixture');
  mock.method(missionUtils, 'updateGraphifyKnowledgeGraph', () => false);
  mock.method(missionUtils, 'resolveMissionBaseBranch', () => 'main');
  mock.method(missionUtils, 'resolveWorktree', () => root);
  mock.method(missionUtils, 'missionBranchName', () => `mission/${slug}`);
  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true, taskFile: path.join(root, 'backlog', 'tasks', 'task.md') }));
  mock.method(backlog, 'getTaskClassification', () => 'ai_sdlc');
  mock.method(backlog, 'getTaskStatus', () => 'integration');
  mock.method(backlog, 'getTaskAssignee', () => 'codex');
  mock.method(backlog, 'getTaskImplementer', () => 'codex');
  mock.method(backlog, 'completeTask', () => true);
  mock.method(forgejo, 'getPrStatus', () => ({ exists: true, state: 'open', merged: false, number: 1 }));
  mock.method(forgejo, 'getLatestReviewDecision', () => ({ ok: true, reviewState: 'APPROVED' }));
  mock.method(forgejo, 'listOpenPrsForSlug', () => []);
  mock.method(forgejo, 'readToken', () => 'token');
  mock.method(forgejo, 'resolveTokenFile', () => 'token-file');
  mock.method(forgejo, 'syncMerged', () => ({ ok: true }));
  mock.method(stats, 'recordIntegrationStats', async () => ({ changed: false, row: { mission: slug }, data: { rows: [] }, report: 'none' }));
  mock.method(stats, 'resolveMissionClassification', () => ({ classification: 'ai_sdlc' }));
  mock.method(verification, 'captureVerifiedTreeProof', () => ({ ok: true, proof: { rootDir: root, area: 'all', command: 'verify', commit: 'landed-sha', tree: 'tree' } }));
  mock.method(verification, 'assertVerifiedTreeProof', () => ({ ok: true }));
  mock.method(post, 'runPreCommitHookOrAbort', () => { preCommitRuns++; });
  let status = 'integration';
  mock.method(composition, 'createMissionApplicationServices', async () => ({
    store: { _repoId: 'default', load: async () => ({ kind: 'found', mission: { status, review: null }, version: 1 }) },
    integration: { decideIntegration: async () => { status = 'done'; return { status: 'completed', value: { mission: { status }, version: 2 } }; } },
    lifecycle: { transition: async () => ({ status: 'completed', value: { to: 'review', version: 2 } }) },
    handoff: { recordNel: async () => ({}) },
  }));
  fs.mkdirSync(path.join(root, 'backlog', 'tasks'), { recursive: true });
  fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: {
    verification: { command: 'true' },
    gates: { parallel: { preIntegration: 2 }, preIntegration: [
      { key: 'rebase-visible', command: 'true', order: 1 },
      { key: 'pre-commit-visible', command: 'true', order: 2 },
    ] },
  } }));
  try {
    await integrate([slug], { missionServicesFn: composition.createMissionApplicationServices });
    const rendered = logs.join('\n');
    assert.ok(rebased.value, `px integrate rebases before running gates:\n${rendered}`);
    assert.equal(preCommitRuns, 1, 'px integrate runs the pre-commit boundary before gates');
    for (const key of ['rebase-visible', 'pre-commit-visible']) {
      assert.match(rendered, new RegExp(`${key} started`));
      assert.match(rendered, new RegExp(`${key} passed`));
    }
    assert.equal(status, 'done');
  } finally {
    mock.reset();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
