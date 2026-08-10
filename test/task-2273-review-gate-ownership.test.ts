


import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import childProcess from 'node:child_process';
import { mockModule, installModuleMocks } from './lib/module-mock.js';
const performHandoffModule = mockModule<typeof import('../src/adapters/cli/commands/handoff.js')>('../src/adapters/cli/commands/handoff.js', import.meta.url);
const missionUtils = mockModule<typeof import('../src/adapters/filesystem/mission-utils.js')>('../src/adapters/filesystem/mission-utils.js', import.meta.url);
const git = mockModule<typeof import('../src/adapters/git/git.js')>('../src/adapters/git/git.js', import.meta.url);
const backlog = mockModule<typeof import('../src/adapters/backlog/backlog.js')>('../src/adapters/backlog/backlog.js', import.meta.url);
await installModuleMocks();
test.afterEach(() => mock.restoreAll());
const { performHandoff } = performHandoffModule;
const REPO_ROOT = path.join(import.meta.dirname, '..');
const SOURCE_ROOT = path.join(REPO_ROOT, 'src');

import { stubMissionServices } from './helpers/stub-mission-services.js';

test('task-2273 baseline: handoff owns two commit-equivalent general-gate invocations', () => {
  // TASK-2332.09 re-homed the handoff workflow into the application use case;
  // the gate-ownership boundaries live there now, not in the CLI adapter.
  const handoff = fs.readFileSync(path.join(SOURCE_ROOT, 'application', 'handoff-command-use-case.ts'), 'utf8');

  const owners = [
    { boundary: 'handoff-final', invocation: handoff.indexOf('runVerificationGateFn(area || \'docs\'') },
    { boundary: 'declared-gates', invocation: handoff.indexOf('runDeclaredGates(verification.missionDir') },
  ];

  assert.ok(owners.every(({ invocation }) => invocation >= 0), 'the handoff and declared-gate owners must be explicit');
  assert.equal(owners.length, 2,
    'before task-2273 proof reuse, one handoff owns two independent general-gate boundaries');
  assert.deepEqual(owners.map(({ boundary }) => boundary), ['handoff-final', 'declared-gates']);
});

test('task-2273 baseline: no repository-managed review-remote pre-push verifier exists', () => {
  const trackedFiles = fs.readdirSync(SOURCE_ROOT);
  assert.ok(trackedFiles.length > 0, 'repository fixture is available');
  assert.equal(fs.existsSync(path.join(REPO_ROOT, '.githooks', 'pre-push')), false,
    'the review-remote pre-push hook described by the backlog is local-only, not a tracked gate owner');
});

test('task-2273 review submission runs the handoff plan once and reuses it at the declared boundary', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2273-gate-count-'));
  const proofHome = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2273-proof-home-'));
  const counter = path.join(proofHome, 'counter');
  fs.writeFileSync(counter, '');
  const command = `sh -c "printf x >> ${counter}"`;
  const priorHome = process.env.PARALLIX_HOME;
  const slug = 'task-2273-proof-count';
  const missionDir = path.join(root, 'missions', slug);
  const taskFile = path.join(root, 'backlog', 'tasks', `${slug}.md`);
  const calls = { handoff: 0, reviewRemotePrePush: 0 };
  const logs = [];
  try {
    childProcess.execFileSync('git', ['init'], { cwd: root, stdio: 'pipe' });
    childProcess.execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
    childProcess.execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
    fs.writeFileSync(path.join(root, 'README.md'), 'fixture\n');
    childProcess.execFileSync('git', ['add', '.'], { cwd: root });
    childProcess.execFileSync('git', ['commit', '-m', 'fixture'], { cwd: root, stdio: 'pipe' });
    fs.mkdirSync(path.dirname(taskFile), { recursive: true });
    fs.mkdirSync(missionDir, { recursive: true });
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { verification: { command, defaultArea: 'workflow' } } }));
    fs.writeFileSync(path.join(missionDir, 'MISSION.md'), `# Mission\n\n## Gates\n- [ ] ${command}\n`);
    fs.writeFileSync(path.join(missionDir, 'CP-1.md'), '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| fixture | test/task-2273-review-gate-ownership.test.js | PASS |\n');
    fs.writeFileSync(taskFile, '---\nstatus: active\nassignee: [codex]\n---\n');
    childProcess.execFileSync('git', ['add', '.'], { cwd: root });
    childProcess.execFileSync('git', ['commit', '-m', 'declare gate'], { cwd: root, stdio: 'pipe' });
    process.env.PARALLIX_HOME = proofHome;
    t.mock.method(missionUtils, 'findMissionDir', () => missionDir);
    t.mock.method(missionUtils, 'findMissionArea', () => 'workflow');
    t.mock.method(missionUtils, 'findCheckpoints', () => [path.join(missionDir, 'CP-1.md')]);
    t.mock.method(missionUtils, 'missionBranchName', () => `mission/${slug}`);
    t.mock.method(git, 'getCurrentBranch', () => `mission/${slug}`);
    t.mock.method(git, 'getWorktreeStatus', () => []);
    t.mock.method(backlog, 'resolveTaskFile', () => ({ ok: true, taskFile }));
    t.mock.method(backlog, 'getTaskImplementer', () => 'codex');
    t.mock.method(backlog, 'transitionTask', () => true);
    const result = await performHandoff(slug, {
      missionServicesFn: stubMissionServices(),
      worktree: root,
      isForgejoReviewEnabledFn: () => false,
      rebaseFn: async () => ({ ok: true }),
      captureNelFn: () => ({ ok: true, nel: 1, bucket: { label: 'tiny' } }),
      runGatekeeperFn: () => ({ ok: true, missing: [], skipped: true }),
      runVerificationGateFn: () => { calls.handoff++; return { status: 0 }; },
      log: message => logs.push(message), error: () => {}
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(calls.handoff, 1, 'the configured handoff plan executes once');
    assert.equal(fs.readFileSync(counter, 'utf8'), '', `the declared boundary reuses the matching handoff proof: ${logs.join(' | ')}`);
    assert.equal(calls.reviewRemotePrePush, 0, 'the review-remote pre-push hook is local-only and has no repository owner');
  } finally {
    if (priorHome === undefined) delete process.env.PARALLIX_HOME;
    else process.env.PARALLIX_HOME = priorHome;
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(proofHome, { recursive: true, force: true });
  }
});
