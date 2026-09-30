// TASK-2520 SC5 / AC6: a retry after a failed sync-merged has the mission squash
// already on the local base. `px integrate` must skip the integration rebase and
// resume the landing closeout (finishLanding / sync-merged) instead of replaying
// mission history. Hermetic: git, backlog, forgejo, stats, verification,
// mission services and the integrate-conflict checkout seam are all injected
// doubles, so no worktree, real Forgejo, or agent is touched.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mockModule, installModuleMocks } from './lib/module-mock.js';
import { mkdtemp as registeredMkdtemp } from './helpers/temp-dir.js';

const git = mockModule<typeof import('../src/adapters/git/git.js')>('../src/adapters/git/git.js', import.meta.url);
const missionUtils = mockModule<typeof import('../src/adapters/filesystem/mission-utils.js')>('../src/adapters/filesystem/mission-utils.js', import.meta.url);
const backlog = mockModule<typeof import('../src/adapters/backlog/backlog.js')>('../src/adapters/backlog/backlog.js', import.meta.url);
const forgejo = mockModule<typeof import('../src/adapters/forgejo/forgejo.js')>('../src/adapters/forgejo/forgejo.js', import.meta.url);
const stats = mockModule<typeof import('../src/adapters/cli/commands/stats.js')>('../src/adapters/cli/commands/stats.js', import.meta.url);
const verification = mockModule<typeof import('../src/adapters/verification/verification.js')>('../src/adapters/verification/verification.js', import.meta.url);
const composition = mockModule<typeof import('../src/composition/application-services.js')>('../src/composition/application-services.js', import.meta.url);
const conflict = mockModule<typeof import('../src/adapters/cli/commands/integrate-conflict.js')>('../src/adapters/cli/commands/integrate-conflict.js', import.meta.url);
const integrateModule = mockModule<typeof import('../src/adapters/cli/commands/integrate.js')>('../src/adapters/cli/commands/integrate.js', import.meta.url);
await installModuleMocks();
const integrate = integrateModule.default;

const SLUG = 'task-2520-resume';
const BRANCH = `mission/${SLUG}`;
const SQUASH_SHA = 'landedsquashsha000';
const ROOT = registeredMkdtemp('parallix-task-2520-');

test('retry after failed sync-merged skips rebase and resumes landing closeout', async () => {
  const logs: string[] = [];
  mock.method(console, 'log', (chunk: unknown) => { logs.push(String(chunk)); return true; });
  mock.method(console, 'error', (chunk: unknown) => { logs.push(String(chunk)); return true; });

  let rebaseStarted = false;
  let syncMergedCalls: { branch: string, commit: string }[] = [];

  // The base already holds the mission squash from a prior partial integration.
  mock.method(conflict, 'findLandedSquashOnBaseBranch', () => SQUASH_SHA);
  mock.method(forgejo, 'syncMerged', (branch: string, commit: string) => {
    syncMergedCalls.push({ branch, commit });
    return { ok: true };
  });

  mock.method(git, 'getCurrentBranch', () => BRANCH);
  mock.method(git, 'git', (args: string[]) => {
    const joined = args.join(' ');
    // A real rebase subcommand must never run on the retry.
    if (args.includes('rebase') && !args.includes('--show-current') && !args.includes('--continue')) {
      rebaseStarted = true;
    }
    if (joined.includes('rev-parse') && joined.includes('main')) { return { status: 0, stdout: 'basesha', stderr: '' }; }
    if (joined.includes('rev-parse')) { return { status: 0, stdout: BRANCH, stderr: '' }; }
    if (joined.includes('merge-base') && joined.includes('--is-ancestor')) { return { status: 0, stdout: '', stderr: '' }; }
    // The resume closeout resolves the landed squash commit timestamp via `show`.
    if (joined.includes('show') && joined.includes('--format')) { return { status: 0, stdout: '2026-09-15T12:00:00+00:00', stderr: '' }; }
    if (joined.includes('branch')) { return { status: 0, stdout: 'main\n', stderr: '' }; }
    return { status: 0, stdout: '', stderr: '' };
  });

  let status = 'integration';
  mock.method(missionUtils, 'inferSlug', () => SLUG);
  mock.method(missionUtils, 'getPrimaryBranch', () => 'main');
  mock.method(missionUtils, 'getPrimaryWorktree', () => ROOT);
  mock.method(missionUtils, 'findMissionDir', () => path.join(ROOT, 'missions', SLUG));
  mock.method(missionUtils, 'findMissionArea', () => 'all');
  mock.method(missionUtils, 'conventionalWorktreePath', () => path.join(ROOT, '..', SLUG));
  mock.method(missionUtils, 'resolveMainRepo', () => ROOT);
  mock.method(missionUtils, 'missionTitle', () => 'fixture');
  mock.method(missionUtils, 'updateGraphifyKnowledgeGraph', () => false);
  mock.method(missionUtils, 'resolveMissionBaseBranch', () => 'main');
  mock.method(missionUtils, 'resolveWorktree', () => ROOT);
  mock.method(missionUtils, 'missionBranchName', (_slug: string) => BRANCH);

  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true, taskFile: path.join(ROOT, 'backlog', 'tasks', 'task.md') }));
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

  mock.method(stats, 'recordIntegrationStats', async () => ({ changed: false, row: { mission: SLUG }, data: { rows: [] }, report: 'none' }));
  mock.method(stats, 'resolveMissionClassification', () => ({ classification: 'ai_sdlc' }));
  mock.method(verification, 'captureVerifiedTreeProof', () => ({ ok: true, proof: { rootDir: ROOT, area: 'all', command: 'verify', commit: SQUASH_SHA, tree: 'tree' } }));
  mock.method(verification, 'assertVerifiedTreeProof', () => ({ ok: true }));
  mock.method(process, 'cwd', () => ROOT);
  mock.method(process, 'exit', () => {});

  mock.method(composition, 'createMissionApplicationServices', async () => ({
    store: { _repoId: 'default', load: async () => ({ kind: 'found', mission: { status, review: null }, version: 1 }) },
    integration: { decideIntegration: async () => { status = 'done'; return { status: 'completed', value: { mission: { status }, version: 2 } }; } },
    lifecycle: { transition: async () => ({ status: 'completed', value: { to: 'review', version: 2 } }) },
    handoff: { recordNel: async () => ({ }) },
  }));

  fs.mkdirSync(path.join(ROOT, 'backlog', 'tasks'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'workflow.config.json'), JSON.stringify({
    adapters: { review: { provider: 'forgejo' }, verification: { command: 'true' }, gates: { preIntegration: [] } },
  }));

  try {
    await integrate([SLUG], { missionServicesFn: composition.createMissionApplicationServices });

    // The integration rebase must be skipped: the squash is already on the base.
    assert.equal(rebaseStarted, false, 'px integrate must not rebase when the mission squash is already on the local base');
    // The landing closeout resumes against the existing squash commit.
    assert.ok(syncMergedCalls.length >= 1, 'sync-merged resume must run against the landed squash');
    assert.equal(syncMergedCalls[0].commit, SQUASH_SHA, 'resumes with the existing squash commit, not a fresh squash');
    assert.match(logs.join('\n'), /already on .*; skipping rebase/, 'reports skipping the rebase');
  } finally {
    mock.reset();
    fs.rmSync(ROOT, { recursive: true, force: true });
  }
});
