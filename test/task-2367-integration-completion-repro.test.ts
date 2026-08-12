import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mockModule, installModuleMocks } from './lib/module-mock.js';

const git = mockModule<typeof import('../src/adapters/git/git.js')>('../src/adapters/git/git.js', import.meta.url);
const missionUtils = mockModule<typeof import('../src/adapters/filesystem/mission-utils.js')>('../src/adapters/filesystem/mission-utils.js', import.meta.url);
const backlog = mockModule<typeof import('../src/adapters/backlog/backlog.js')>('../src/adapters/backlog/backlog.js', import.meta.url);
const forgejo = mockModule<typeof import('../src/adapters/forgejo/forgejo.js')>('../src/adapters/forgejo/forgejo.js', import.meta.url);
const stats = mockModule<typeof import('../src/adapters/cli/commands/stats.js')>('../src/adapters/cli/commands/stats.js', import.meta.url);
const verification = mockModule<typeof import('../src/adapters/verification/verification.js')>('../src/adapters/verification/verification.js', import.meta.url);
const composition = mockModule<typeof import('../src/composition/application-services.js')>('../src/composition/application-services.js', import.meta.url);
const integrate = mockModule<typeof import('../src/adapters/cli/commands/integrate.js')>('../src/adapters/cli/commands/integrate.js', import.meta.url);
await installModuleMocks();

const SLUG = 'task-2367-fixture';
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-task-2367-'));

test('TASK-2367: a landed approved integration persists done once before statistics', async () => {
  process.env.PARALLIX_TEST_ALLOW_INTEGRATION_GATE_BYPASS = '1';
  fs.mkdirSync(path.join(ROOT, 'backlog', 'tasks'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'workflow.config.json'), JSON.stringify({ adapters: { verification: { command: 'true' } } }));
  fs.writeFileSync(path.join(ROOT, 'backlog', 'tasks', 'task.md'), 'status: approved\n');
  const calls: string[] = [];
  let status = 'integration';
  let doneEvents = 0;
  mock.method(missionUtils, 'inferSlug', () => SLUG);
  mock.method(missionUtils, 'getPrimaryBranch', () => 'main');
  mock.method(missionUtils, 'getPrimaryWorktree', () => ROOT);
  mock.method(missionUtils, 'findMissionDir', () => path.join(ROOT, 'missions', SLUG));
  mock.method(missionUtils, 'findMissionArea', () => 'all');
  mock.method(missionUtils, 'conventionalWorktreePath', () => path.join(ROOT, '..', SLUG));
  mock.method(missionUtils, 'resolveMainRepo', () => ROOT);
  mock.method(missionUtils, 'missionTitle', () => 'fixture');
  mock.method(missionUtils, 'updateGraphifyKnowledgeGraph', () => false);
  mock.method(git, 'getCurrentBranch', () => `mission/${SLUG}`);
  mock.method(git, 'git', (args: string[]) => {
    if (args.includes('branch') && args.includes('--show-current')) return { status: 0, stdout: 'main\n', stderr: '' };
    if (args.includes('diff') && args.includes('--cached')) return { status: 0, stdout: 'fixture.ts\n', stderr: '' };
    if (args.includes('commit')) calls.push('landed');
    if (args.includes('rev-parse')) return { status: 0, stdout: 'landed-sha\n', stderr: '' };
    return { status: 0, stdout: '', stderr: '' };
  });
  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true, taskFile: path.join(ROOT, 'backlog', 'tasks', 'task.md') }));
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
  mock.method(stats, 'recordIntegrationStats', async () => {
    calls.push('stats');
    return { changed: false, row: { mission: SLUG }, data: { rows: [] }, report: 'none' };
  });
  mock.method(stats, 'resolveMissionClassification', () => ({ classification: 'ai_sdlc' }));
  mock.method(verification, 'captureVerifiedTreeProof', () => ({ ok: true, proof: { rootDir: ROOT } }));
  mock.method(verification, 'assertVerifiedTreeProof', () => ({ ok: true }));
  mock.method(process, 'cwd', () => ROOT);
  mock.method(process, 'exit', () => {});
  const services = {
    store: { load: async () => ({ kind: 'found', mission: { status, review: null }, version: 1 }) },
    integration: { decideIntegration: async () => { calls.push('done'); status = 'done'; doneEvents += 1; return { status: 'completed', value: { mission: { status }, version: 2 } }; } },
    lifecycle: { transition: async () => ({ status: 'completed', value: { to: 'review', version: 2 } }) },
    handoff: { recordNel: async () => ({}) },
  };
  try {
    await integrate.default([SLUG, '--no-integration-gates'], { missionServicesFn: async () => services });
    assert.equal(status, 'done');
    assert.equal(doneEvents, 1);
    assert.deepEqual(calls, ['landed', 'done', 'stats']);
  } finally {
    mock.reset();
    fs.rmSync(ROOT, { recursive: true, force: true });
  }
});
