
// Module dependencies are replaced with mock.method() through the ESM-native
// seam in test/lib/module-mock.ts: an ESM namespace object is read-only, so the
// helper registers a mutable delegating facade per module URL instead.
import { test, mock } from 'node:test';
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
const composition = mockModule<typeof import('../src/composition/application-services.js')>('../src/composition/application-services.js', import.meta.url);
const integrateModule = mockModule<typeof import('../src/adapters/cli/commands/integrate.js')>('../src/adapters/cli/commands/integrate.js', import.meta.url);
await installModuleMocks();



const TEST_SLUG = 'task-2243-probe-abort';

// The mock facade re-links integrate against the mocked dependencies once, so
// there is no per-call reload; the command entry point is the default export.
function loadIntegrate() {
  return integrateModule.default;
}

test('Variant B rejects a failed probe abort without promoting the review-approved task fixture (task-2243)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2243-probe-abort-'));
  const taskFile = path.join(root, 'backlog', 'tasks', 'task-2243 fixture.md');
  const fixture = [
    '---',
    'id: TASK-2243-FIXTURE',
    'status: review',
    'assignee: [codex]',
    'labels: [ai_sdlc]',
    '---',
    '',
    '# Probe abort fixture',
    '',
  ].join('\n');
  fs.mkdirSync(path.dirname(taskFile), { recursive: true });
  fs.writeFileSync(taskFile, fixture, 'utf8');
  fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
    adapters: { review: { provider: 'forgejo', baseUrl: 'http://localhost:3300', remote: 'review', repo: 'magnus/parallix' } },
  }), 'utf8');

  const errors: string[] = [];
  const exitCodes: number[] = [];
  const originalError = console.error;
  console.error = (message: unknown) => errors.push(String(message));

  try {
    mock.method(missionUtils, 'getPrimaryBranch', () => 'main');
    mock.method(missionUtils, 'inferSlug', (slug: string) => slug || TEST_SLUG);
    mock.method(missionUtils, 'findMissionDir', () => path.join(root, 'missions', TEST_SLUG));
    mock.method(missionUtils, 'findMissionArea', () => 'runtime');
    mock.method(missionUtils, 'getPrimaryWorktree', () => root);
    mock.method(missionUtils, 'conventionalWorktreePath', () => path.join(root, '..', TEST_SLUG));
    mock.method(missionUtils, 'resolveMainRepo', () => root);
    mock.method(missionUtils, 'missionTitle', () => 'Task 2243 probe abort fixture');
    mock.method(missionUtils, 'updateGraphifyKnowledgeGraph', () => false);
    mock.method(git, 'getCurrentBranch', () => `mission/${TEST_SLUG}`);
    mock.method(git, 'git', (args: string[]) => {
      if (args.includes('branch') && args.includes('--list')) return { status: 0, stdout: 'main\n', stderr: '' };
      if (args.includes('branch') && args.includes('--show-current')) return { status: 0, stdout: 'main', stderr: '' };
      if (args.includes('status')) return { status: 0, stdout: '', stderr: '' };
      if (args.includes('merge') && args.includes('--no-commit')) return { status: 0, stdout: '', stderr: '' };
      if (args.includes('merge') && args.includes('--abort')) return { status: 1, stdout: '', stderr: 'fatal: abort failed' };
      if (args.includes('rev-parse')) return { status: 0, stdout: 'deadbeef', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    });
    mock.method(backlog, 'resolveTaskFile', () => ({ ok: true, taskFile }));
    mock.method(backlog, 'getTaskStatus', () => 'review');
    mock.method(backlog, 'getTaskClassification', () => 'ai_sdlc');
    mock.method(backlog, 'getTaskAssignee', () => 'codex');
    mock.method(backlog, 'setTaskStatus', (_taskFile: string, status: string) => {
      fs.writeFileSync(taskFile, fs.readFileSync(taskFile, 'utf8').replace('status: review', `status: ${status}`), 'utf8');
      return true;
    });
    mock.method(backlog, 'completeTask', () => true);
    mock.method(forgejo, 'getPrStatus', () => ({ exists: true, state: 'open', merged: false, number: 2243 }));
    mock.method(forgejo, 'listOpenPrsForSlug', () => []);
    mock.method(forgejo, 'getLatestReviewDecision', () => ({ ok: true, reviewState: 'APPROVED' }));
    mock.method(forgejo, 'readToken', () => 'test-token');
    mock.method(forgejo, 'resolveTokenFile', () => 'test-token-file');
    mock.method(forgejo, 'resolveTrackingBranchSha', () => ({ ok: true, ref: 'refs/remotes/origin/main', sha: 'deadbeef' }));
    mock.method(stats, 'resolveMissionClassification', () => ({ classification: 'ai_sdlc' }));
    mock.method(stats, 'recordIntegrationStats', () => {
      throw new Error('stats must not run after probe-abort failure');
    });
    mock.method(process, 'cwd', () => root);
    mock.method(process, 'exit', (code: number) => exitCodes.push(code));
    // The mission carries an authoritative approved Review so integrate's
    // lifecycle recovery reaches the probe-merge abort this test exercises.
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

    const integrate = loadIntegrate();
    await integrate([TEST_SLUG, '--no-integration-gates'], { missionServicesFn: composition.createMissionApplicationServices });

    assert.deepEqual(exitCodes, [1], 'integration must reject the unsafe checkout with a nonzero result');
    assert.ok(errors.some((message) => message.includes('Dry-run merge could not be aborted cleanly')));
    assert.equal(fs.readFileSync(taskFile, 'utf8'), fixture, 'probe-abort failure must not mutate the review task fixture');
  } finally {
    console.error = originalError;
    mock.reset();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
