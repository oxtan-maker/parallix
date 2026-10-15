


import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import childProcess from 'node:child_process';
import { runPreReviewGate } from '../../../src/adapters/review/review-gate-handling.js';
import { mockModule, installModuleMocks } from '../../lib/module-mock.js';
const performHandoffModule = mockModule<typeof import('../../../src/adapters/cli/commands/handoff.js')>('../../../src/adapters/cli/commands/handoff.js', import.meta.url);
const missionUtils = mockModule<typeof import('../../../src/adapters/filesystem/mission-utils.js')>('../../../src/adapters/filesystem/mission-utils.js', import.meta.url);
const git = mockModule<typeof import('../../../src/adapters/git/git.js')>('../../../src/adapters/git/git.js', import.meta.url);
const backlog = mockModule<typeof import('../../../src/adapters/backlog/backlog.js')>('../../../src/adapters/backlog/backlog.js', import.meta.url);
await installModuleMocks();
test.afterEach(() => mock.restoreAll());
const { performHandoff } = performHandoffModule;
const REPO_ROOT = path.join(import.meta.dirname, '..', '..', '..');
const SOURCE_ROOT = path.join(REPO_ROOT, 'src');

import { stubMissionServices } from '../../helpers/stub-mission-services.js';

test('task-2273 baseline: no repository-managed review-remote pre-push verifier exists', () => {
  const trackedFiles = fs.readdirSync(SOURCE_ROOT);
  assert.ok(trackedFiles.length > 0, 'repository fixture is available');
  assert.equal(fs.existsSync(path.join(REPO_ROOT, '.githooks', 'pre-push')), false,
    'the review-remote pre-push hook described by the backlog is local-only, not a tracked gate owner');
});

test('handoff, declared gates and pre-review share candidate verification and invalidate repairs (TASK-2715)', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2273-gate-count-'));
  const proofHome = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2273-proof-home-'));
  const counter = path.join(proofHome, 'counter');
  fs.writeFileSync(counter, '');
  const command = `sh -c "printf '{{area}}\\n' >> ${counter}"`;
  const priorHome = process.env.PARALLIX_HOME;
  const slug = 'task-2273-proof-count';
  const missionDir = path.join(root, 'missions', slug);
  const taskFile = path.join(root, 'backlog', 'tasks', `${slug}.md`);
  const logs: string[] = [];
  try {
    childProcess.execFileSync('git', ['init'], { cwd: root, stdio: 'pipe' });
    childProcess.execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
    childProcess.execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
    fs.writeFileSync(path.join(root, 'README.md'), 'fixture\n');
    childProcess.execFileSync('git', ['add', '.'], { cwd: root });
    childProcess.execFileSync('git', ['commit', '-m', 'fixture'], { cwd: root, stdio: 'pipe' });
    fs.mkdirSync(path.dirname(taskFile), { recursive: true });
    fs.mkdirSync(missionDir, { recursive: true });
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { verification: { command, defaultArea: 'all' } } }));
    fs.writeFileSync(path.join(missionDir, 'MISSION.md'), `# Mission\n\n## Gates\n- [ ] ${command.replaceAll('{{area}}', 'all')}\n`);
    fs.writeFileSync(path.join(missionDir, 'CP-1.md'), '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| fixture | `npm test -- test/review-gate-ownership.test.js` | PASS |\n');
    fs.writeFileSync(taskFile, '---\nstatus: active\nassignee: [codex]\n---\n');
    childProcess.execFileSync('git', ['add', '.'], { cwd: root });
    childProcess.execFileSync('git', ['commit', '-m', 'declare gate'], { cwd: root, stdio: 'pipe' });
    process.env.PARALLIX_HOME = proofHome;
    t.mock.method(missionUtils, 'findMissionDir', () => missionDir);
    t.mock.method(missionUtils, 'findMissionArea', () => null);
    t.mock.method(missionUtils, 'findCheckpoints', () => [path.join(missionDir, 'CP-1.md')]);
    t.mock.method(missionUtils, 'missionBranchName', () => `mission/${slug}`);
    t.mock.method(git, 'getCurrentBranch', () => `mission/${slug}`);
    t.mock.method(git, 'getWorktreeStatus', () => []);
    t.mock.method(backlog, 'resolveTaskFile', () => ({ ok: true as const, taskFile }));
    t.mock.method(backlog, 'getTaskImplementer', () => 'codex');
    t.mock.method(backlog, 'transitionTask', () => true);
    const result = await performHandoff(slug, {
      missionServicesFn: stubMissionServices(),
      worktree: root,
      isForgejoReviewEnabledFn: () => false,
      rebaseFn: async () => ({ ok: true as const }),
      captureNelFn: async () => ({ ok: true as const, nel: 1, bucket: 'tiny' }),
      runGatekeeperFn: () => ({ ok: true as const, missing: [], skipped: true }),
      log: (message: string) => logs.push(message), error: () => {}
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(fs.readFileSync(counter, 'utf8'), 'all\n', 'handoff resolves the configured area rather than injecting docs');
    const review = await runPreReviewGate(slug, root, { log: message => logs.push(message), error: () => {} });
    assert.equal(review.ok, true, JSON.stringify(review));
    assert.equal(fs.readFileSync(counter, 'utf8'), 'all\n', 'the real review boundary reuses handoff verification for the same candidate (TASK-2715)');
    fs.writeFileSync(path.join(root, 'README.md'), 'changed candidate\n');
    childProcess.execFileSync('git', ['add', '.'], { cwd: root });
    childProcess.execFileSync('git', ['commit', '-m', 'repair'], { cwd: root, stdio: 'pipe' });
    assert.equal((await runPreReviewGate(slug, root, { log: () => {}, error: () => {} })).ok, true);
    assert.equal(fs.readFileSync(counter, 'utf8'), 'all\nall\n', 'changed candidates must run the gate again');
  } finally {
    if (priorHome === undefined) delete process.env.PARALLIX_HOME;
    else process.env.PARALLIX_HOME = priorHome;
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(proofHome, { recursive: true, force: true });
  }
});
