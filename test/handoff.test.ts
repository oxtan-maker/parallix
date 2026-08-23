// @ts-nocheck -- TASK-2328: partial test doubles from ESM seam migration; resolve in follow-up

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import { HandoffCommandUseCase } from '../src/application/handoff-command-use-case.js';
import { createHandoffCommand } from '../src/interfaces/cli/handoff.js';
import { mockModule, installModuleMocks } from './lib/module-mock.js';
import { stubMissionServices } from './helpers/stub-mission-services.js';
const handoffModule = mockModule<typeof import('../src/adapters/cli/commands/handoff.js')>('../src/adapters/cli/commands/handoff.js', import.meta.url);
const git = mockModule<typeof import('../src/adapters/git/git.js')>('../src/adapters/git/git.js', import.meta.url);
const missionUtils = mockModule<typeof import('../src/adapters/filesystem/mission-utils.js')>('../src/adapters/filesystem/mission-utils.js', import.meta.url);
const backlog = mockModule<typeof import('../src/adapters/backlog/backlog.js')>('../src/adapters/backlog/backlog.js', import.meta.url);
// Sub-modules must be declared so they re-link with the facaded git binding
const forgejoGit = mockModule<typeof import('../src/adapters/forgejo/forgejo-git.js')>('../src/adapters/forgejo/forgejo-git.js', import.meta.url);
const forgejoPr = mockModule<typeof import('../src/adapters/forgejo/forgejo-pr.js')>('../src/adapters/forgejo/forgejo-pr.js', import.meta.url);
const forgejo = mockModule<typeof import('../src/adapters/forgejo/forgejo.js')>('../src/adapters/forgejo/forgejo.js', import.meta.url);
const setupReview = mockModule<typeof import('../src/adapters/review/setup-review.js')>('../src/adapters/review/setup-review.js', import.meta.url);
const gatekeeper = mockModule<typeof import('../src/adapters/verification/gatekeeper.js')>('../src/adapters/verification/gatekeeper.js', import.meta.url);
const worktree = mockModule<typeof import('../src/adapters/git/worktree.js')>('../src/adapters/git/worktree.js', import.meta.url);
await installModuleMocks();
const { createHandoffPorts, verifyHandoff, performHandoff, _findUnverifiableGoalCheckRow, runDeclaredGates, captureNelAtHandoff, validateDeclaredGates } = handoffModule;
const { mock } = test;
test.afterEach(() => mock.restoreAll());

test('evidence shell commands require an existing file argument', () => {
  const rootDir = path.join(import.meta.dirname, '..');
  const bareCommandRow = '| Criterion | `cat` | PASS |';
  const fileCommandRow = '| Criterion | `cat package.json` | PASS |';

  assert.equal(_findUnverifiableGoalCheckRow([bareCommandRow], rootDir), bareCommandRow);
  assert.equal(_findUnverifiableGoalCheckRow([fileCommandRow], rootDir), null);
});

test('evidence accepts git commands inside escaped-backtick markdown cells', () => {
  const rootDir = path.join(import.meta.dirname, '..');
  // Markdown cells often escape the outer backticks, producing `` `git diff --name-only` ``.
  // The evidence regex must not span across the escaped pair and treat the leading
  // backtick as part of the command (which would break the `git` prefix check).
  const escapedBacktickRow =
    '| SC3: No other files modified | `` `git diff --name-only` `` shows only `hello.sh` | PASS |';
  assert.equal(
    _findUnverifiableGoalCheckRow([escapedBacktickRow], rootDir),
    null,
    'escaped-backtick cell with `git` command should be accepted as verifiable evidence',
  );
});

// Mock external modules

/**
 * Give the mission an identity for the handoff to act under.
 *
 * This used to write a `review-state.json`; after the TASK-2322.12 cutover the
 * review identity comes from the Review aggregate, and where there is no
 * Review yet — which is exactly the case at handoff — it comes from the Backlog
 * task's implementer. These tests mock the Backlog module, so that is where the
 * identity is stated.
 */
function writeReviewState(missionDir, reviewer, implementer) {
  fs.mkdirSync(missionDir, { recursive: true });
  mock.method(backlog, 'getTaskImplementer', () => implementer);
  mock.method(backlog, 'getTaskAssignee', () => implementer);
}

test('verifyHandoff fails when mission directory is not found', () => {
  const result = verifyHandoff('non-existent-slug-999');
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /Mission directory not found/);
});

test('performHandoff uses provided worktree and fails hard on Backlog missing', async (t) => {
  const slug = 'task-098';
  const worktree = '/tmp/fake-worktree';

  // Mocking
  mock.method(missionUtils, 'findMissionDir', (s, root) => {
    if (s === slug && root === worktree) return '/tmp/fake-worktree/docs/missions/2026/task-098';
    return null;
  });
  mock.method(missionUtils, 'findMissionArea', () => 'docs');
  mock.method(git, 'getCurrentBranch', (root) => {
    if (root === worktree) return 'mission/task-098';
    return 'main';
  });
  mock.method(git, 'run', (cmd, args, opts) => {
    if (opts.cwd === worktree) return { status: 0 };
    return { status: 1 };
  });
  mock.method(git, 'git', (args, opts) => {
    // Should NOT push to origin
    if (args.includes('origin')) {
        assert.fail('Should not push to origin during handoff');
    }
    return { status: 0 };
  });
  mock.method(forgejo, 'readToken', () => 'fake-token');
  mock.method(forgejo, 'createPr', (branch, user, token, opts) => {
    if (opts.rootDir === worktree) return { ok: true, url: 'http://fake-pr' };
    return { ok: false, error: 'wrong rootDir' };
  });
  mock.method(forgejo, 'authenticatedReviewUrl', () => 'http://fake-url');

  const missionDir = '/tmp/fake-worktree/docs/missions/2026/task-098';
  const missionMdPath = path.join(missionDir, 'MISSION.md');
  fs.mkdirSync(missionDir, { recursive: true });
  fs.writeFileSync(missionMdPath, '# MISSION.md\n\nTest mission.\n');

  mock.method(backlog, 'resolveTaskFile', (s, root) => {
    if (s === slug && root === worktree) return { ok: false, reason: 'missing' };
    return { ok: true, taskFile: 'found' };
  });
  writeReviewState('/tmp/fake-worktree/docs/missions/2026/task-098', 'claude', 'claude');

  const result = await performHandoff(slug, { worktree, skipGate: true, missionServicesFn: stubMissionServices() });
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /Backlog task file for task-098 not found or ambiguous/);

  fs.rmSync(missionMdPath, { force: true });
});

test('performHandoff skips commit in Step 4 when Backlog transition already committed', async (t) => {
  const slug = 'task-098';
  const worktree = '/tmp/fake-worktree';
  const cpPath = '/tmp/fake-worktree/docs/missions/2026/task-098/CP-1.md';

  mock.method(missionUtils, 'findMissionDir', () => '/tmp/fake-worktree/docs/missions/2026/task-098');
  mock.method(missionUtils, 'findMissionArea', () => 'docs');
  mock.method(missionUtils, 'findCheckpoints', () => [cpPath]);
  mock.method(git, 'getCurrentBranch', () => 'mission/task-098');
  mock.method(git, 'getWorktreeStatus', () => []);
  mock.method(git, 'run', () => ({ status: 0 }));
  mock.method(git, 'git', (args) => {
    if (args.includes('origin')) assert.fail('Should not push to origin');
    if (args.includes('commit')) assert.fail('Should not commit when diff --cached shows nothing staged');
    // diff --cached --quiet exits 0 = nothing staged
    if (args.includes('--cached') && args.includes('--quiet')) return { status: 0 };
    return { status: 0 };
  });
  mock.method(forgejo, 'readToken', () => 'fake-token');
  mock.method(forgejo, 'createPr', () => ({ ok: true, url: 'http://fake-pr' }));
  mock.method(forgejo, 'authenticatedReviewUrl', () => 'http://fake-url');
  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true, taskFile: '/tmp/fake-task' }));
  mock.method(backlog, 'transitionTask', () => true);
  mock.method(gatekeeper, 'runGatekeeper', () => ({ ok: true, missing: [], skipped: false, posted: false }));

  // Provide a valid checkpoint file with Goal Check table for the new integrity gate
  const missionDir = '/tmp/fake-worktree/docs/missions/2026/task-098';
  const missionMdPath = path.join(missionDir, 'MISSION.md');
  writeReviewState(missionDir, 'codex', 'codex');
  fs.writeFileSync(missionMdPath, '# MISSION.md\n\nTest mission.\n');
  fs.writeFileSync(cpPath, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| test | test/example.test.ts | PASS |\n');

  const result = await performHandoff(slug, { worktree, skipGate: true, missionServicesFn: stubMissionServices() });
  assert.strictEqual(result.ok, true);

  fs.rmSync(cpPath, { force: true });
  fs.rmSync(missionMdPath, { force: true });
});

test('performHandoff refreshes the review tracking ref and lease-updates the rebased PR branch after its Backlog transition', async (t) => {
  const slug = 'task-098';
  const worktree = '/tmp/fake-worktree';
  const cpPath = '/tmp/fake-worktree/docs/missions/2026/task-098/CP-1.md';
  const gitCalls = [];

  mock.method(missionUtils, 'findMissionDir', () => '/tmp/fake-worktree/docs/missions/2026/task-098');
  mock.method(missionUtils, 'findMissionArea', () => 'docs');
  mock.method(missionUtils, 'findCheckpoints', () => [cpPath]);
  mock.method(git, 'getCurrentBranch', () => 'mission/task-098');
  mock.method(git, 'getWorktreeStatus', () => []);
  mock.method(git, 'run', () => ({ status: 0 }));
  mock.method(git, 'git', (args) => {
    gitCalls.push(args);
    if (args.includes('fetch')) return { status: 0, stdout: '', stderr: '' };
    if (args.includes('rev-parse')) return { status: 0, stdout: 'lease-sha\n', stderr: '' };
    return { status: 0, stdout: '', stderr: '' };
  });
  mock.method(forgejo, 'readToken', () => 'fake-token');
  mock.method(forgejo, 'createPr', () => ({ ok: true, url: 'http://fake-pr' }));
  mock.method(forgejo, 'authenticatedReviewUrl', () => 'http://fake-url');
  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true, taskFile: '/tmp/fake-task' }));
  mock.method(backlog, 'transitionTask', () => true);
  mock.method(gatekeeper, 'runGatekeeper', () => ({ ok: true, missing: [], skipped: false, posted: false }));

  const missionDir = '/tmp/fake-worktree/docs/missions/2026/task-098';
  const missionMdPath = path.join(missionDir, 'MISSION.md');
  // performHandoff refuses to run without a resolvable agent family. Declare
  // this test's own review identity instead of inheriting the previous test's
  // mocks, which `mock.restoreAll()` clears between tests.
  writeReviewState(missionDir, 'codex', 'codex');
  fs.writeFileSync(missionMdPath, '# MISSION.md\n\nTest mission.\n');
  fs.writeFileSync(cpPath, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| test | test/example.test.ts | PASS |\n');

  const mockRebase = async () => ({ ok: true, sharedFileConflicts: false });
  const result = await performHandoff(slug, {
      missionServicesFn: stubMissionServices(),
    worktree,
    skipGate: true,
    force: false,
    isForgejoReviewEnabledFn: () => true,
    rebaseFn: mockRebase,
  });
  assert.strictEqual(result.ok, true);
  assert.ok(gitCalls.some(args => args.includes('fetch') && args.includes('http://fake-url')));
  assert.ok(gitCalls.some(args => args.includes('push') && args.some(arg => arg.startsWith('--force-with-lease='))));

  fs.rmSync(cpPath, { force: true });
  fs.rmSync(missionMdPath, { force: true });
});

test('performHandoff falls back to magnus and persists bootstrap failure summary', async () => {
  const slug = 'task-1213-fallback';
  const worktree = fs.mkdtempSync(path.join('/tmp', 'handoff-fallback-'));
  const missionDir = path.join(worktree, 'docs/missions/2026', slug);
  const cpPath = path.join(missionDir, 'CP-1.md');
  const taskFile = path.join(worktree, 'backlog/tasks', `${slug} - token fallback.md`);
  const gitCalls = [];

  fs.mkdirSync(missionDir, { recursive: true });
  fs.mkdirSync(path.dirname(taskFile), { recursive: true });
  fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# MISSION.md\n\nTest mission.\n');
  fs.writeFileSync(cpPath, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| test | test/example.test.ts | PASS |\n');
  fs.writeFileSync(taskFile, '---\nstatus: active\n---\n\n# token fallback\n');

  mock.method(missionUtils, 'findMissionDir', () => missionDir);
  mock.method(missionUtils, 'findMissionArea', () => 'workflow');
  mock.method(missionUtils, 'findCheckpoints', () => [cpPath]);
  mock.method(git, 'getCurrentBranch', () => `mission/${slug}`);
  mock.method(git, 'getWorktreeStatus', () => []);
  mock.method(git, 'run', () => ({ status: 0 }));
  mock.method(git, 'git', (args) => {
    gitCalls.push(args);
    return { status: 0, stdout: '', stderr: '' };
  });
  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true, taskFile }));
  mock.method(backlog, 'transitionTask', (taskSlug, status, options) => {
    assert.equal(taskSlug, slug);
    assert.equal(status, 'review');
    assert.equal(options.implementer, 'custom');
    return true;
  });
  mock.method(forgejo, 'readToken', (user) => (user === 'human' ? 'human-token' : null));
  mock.method(forgejo, 'resolveForgejoSettings', () => ({
    url: 'http://localhost:3300',
    repo: 'human/visualboard',
  }));
  mock.method(setupReview, 'bootstrapReviewSurface', async () => ({
    ok: false,
    error: 'No owner token found for human at /tmp/no-token',
  }));
  mock.method(forgejo, 'createPr', (branch, user, token, opts) => {
    assert.equal(branch, `mission/${slug}`);
    assert.equal(user, 'human');
    assert.equal(token, 'human-token');
    assert.equal(opts.forceWithLease, true);
    return { ok: true, url: 'http://fake-pr' };
  });
  mock.method(forgejo, 'authenticatedReviewUrl', (user, token) => {
    assert.equal(user, 'human');
    assert.equal(token, 'human-token');
    return 'http://fake-url';
  });
  mock.method(forgejo, 'resolveTrackingBranchSha', () => ({ ok: true, sha: 'lease-sha' }));
  mock.method(gatekeeper, 'runGatekeeper', () => ({ ok: true, missing: [], skipped: false, posted: false }));
  writeReviewState(missionDir, 'custom', 'custom');

  try {
    const mockRebase = async () => ({ ok: true, sharedFileConflicts: false });
    const result = await performHandoff(slug, {
      missionServicesFn: stubMissionServices(),
      worktree,
      skipGate: true,
      isForgejoReviewEnabledFn: () => true,
      rebaseFn: mockRebase,
    });

    assert.equal(result.ok, true, String(result.error));
    const taskContent = fs.readFileSync(taskFile, 'utf8');
    assert.match(taskContent, /## Fallback: PR submitted as human/);
    assert.match(taskContent, /Original user: custom/);
    assert.match(taskContent, /Bootstrap failure reason: No owner token found for human at \/tmp\/no-token/);
    assert.ok(gitCalls.some(args => args.includes('commit') && args.includes(`backlog(${slug}): set fallback summary`)));
  } finally {
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

test('performHandoff fails hard when git commit fails in Step 4', async (t) => {
    const slug = 'task-098';
    const worktree = '/tmp/fake-worktree';
    const cpPath = '/tmp/fake-worktree/docs/missions/2026/task-098/CP-1.md';

    // Mocking
    mock.method(missionUtils, 'findMissionDir', () => '/tmp/fake-worktree/docs/missions/2026/task-098');
    mock.method(missionUtils, 'findMissionArea', () => 'docs');
    mock.method(missionUtils, 'findCheckpoints', () => [cpPath]);
    mock.method(git, 'getCurrentBranch', () => 'mission/task-098');
    mock.method(git, 'getWorktreeStatus', () => []);
    mock.method(git, 'run', () => ({ status: 0 }));
    mock.method(git, 'git', (args) => {
        if (args.includes('origin')) assert.fail('Should not push to origin');
        if (args.includes('commit')) return { status: 1 }; // Step 4 Commit fail
        // diff --cached --quiet exits 1 = staged changes exist, proceed to commit
        if (args.includes('--cached') && args.includes('--quiet')) return { status: 1 };
        return { status: 0 };
    });
    mock.method(forgejo, 'readToken', () => 'fake-token');
    mock.method(forgejo, 'createPr', () => ({ ok: true, url: 'http://fake-pr' }));
    mock.method(forgejo, 'authenticatedReviewUrl', () => 'http://fake-url');
    mock.method(backlog, 'resolveTaskFile', () => ({ ok: true, taskFile: '/tmp/fake-task' }));
    mock.method(backlog, 'transitionTask', () => false);
    mock.method(gatekeeper, 'runGatekeeper', () => ({ ok: true, missing: [], skipped: false, posted: false }));
   // Provide a valid checkpoint file with Goal Check table for the new integrity gate
    const missionDir = '/tmp/fake-worktree/docs/missions/2026/task-098';
    const missionMdPath = path.join(missionDir, 'MISSION.md');
    fs.mkdirSync(missionDir, { recursive: true });
    writeReviewState(missionDir, 'claude', 'claude');
    fs.writeFileSync(missionMdPath, '# MISSION.md\n\nTest mission.\n');
    fs.writeFileSync(cpPath, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| test | test/example.test.ts | PASS |\n');

    const result = await performHandoff(slug, { worktree, skipGate: true, missionServicesFn: stubMissionServices() });
    assert.strictEqual(result.ok, false);
    assert.match(result.error, /Could not transition task task-098 to review/);

    fs.rmSync(cpPath, { force: true });
    fs.rmSync(missionMdPath, { force: true });
});

test('verifyHandoff fails when MISSION.md is missing from mission directory', () => {
  const slug = 'task-098';
  const worktree = '/tmp/fake-worktree-missing-mm';
  const missionDir = '/tmp/fake-worktree-missing-mm/docs/missions/2026/task-098';

  mock.method(missionUtils, 'findMissionDir', () => missionDir);
  mock.method(missionUtils, 'findMissionArea', () => 'docs');
  mock.method(git, 'getCurrentBranch', () => 'mission/task-098');

  const result = verifyHandoff(slug, { worktree });
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /MISSION\.md not found/);
});

test('performHandoff fails when MISSION.md is missing from mission directory', async () => {
  const slug = 'task-098';
  const worktree = '/tmp/fake-worktree-missing-mm2';
  const missionDir = '/tmp/fake-worktree-missing-mm2/docs/missions/2026/task-098';

  mock.method(missionUtils, 'findMissionDir', () => missionDir);
  mock.method(missionUtils, 'findMissionArea', () => 'docs');
  mock.method(missionUtils, 'findCheckpoints', () => [`${missionDir}/CP-1.md`]);
  mock.method(git, 'getCurrentBranch', () => 'mission/task-098');
  mock.method(git, 'getWorktreeStatus', () => []);
  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true, taskFile: '/tmp/fake-task' }));
  writeReviewState(missionDir, 'claude', 'claude');

  const result = await performHandoff(slug, { worktree, skipGate: true, missionServicesFn: stubMissionServices() });
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /MISSION\.md not found/);
});

test('performHandoff succeeds with ## Goal Check Table heading variant', async (t) => {
  const slug = 'task-098';
  const worktree = '/tmp/fake-worktree-gct';
  const missionDir = '/tmp/fake-worktree-gct/docs/missions/2026/task-098';
  const cpPath = `${missionDir}/CP-1.md`;

  mock.method(missionUtils, 'findMissionDir', () => missionDir);
  mock.method(missionUtils, 'findMissionArea', () => 'docs');
  mock.method(missionUtils, 'findCheckpoints', () => [cpPath]);
  mock.method(git, 'getCurrentBranch', () => 'mission/task-098');
  mock.method(git, 'getWorktreeStatus', () => []);
  mock.method(git, 'run', () => ({ status: 0 }));
  mock.method(git, 'git', (args) => {
    if (args.includes('origin')) assert.fail('Should not push to origin');
    if (args.includes('--cached') && args.includes('--quiet')) return { status: 0 };
    return { status: 0 };
  });
  mock.method(forgejo, 'readToken', () => 'fake-token');
  mock.method(forgejo, 'createPr', () => ({ ok: true, url: 'http://fake-pr' }));
  mock.method(forgejo, 'authenticatedReviewUrl', () => 'http://fake-url');
  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true, taskFile: '/tmp/fake-task' }));
  mock.method(backlog, 'transitionTask', () => true);

  const missionMdPath = path.join(missionDir, 'MISSION.md');
  fs.mkdirSync(missionDir, { recursive: true });
  writeReviewState(missionDir, 'claude', 'claude');
  fs.writeFileSync(missionMdPath, '# MISSION.md\n\nTest mission.\n');
  fs.writeFileSync(cpPath, '# CP-1\n\n## Goal Check Table\n\n| Criteria | Evidence | Status |\n|----------|----------|--------|\n| test | test/example.test.ts | PASS |\n');

  const result = await performHandoff(slug, { worktree, skipGate: true, missionServicesFn: stubMissionServices() });
  assert.strictEqual(result.ok, true);

  fs.rmSync(cpPath, { force: true });
  fs.rmSync(missionMdPath, { force: true });
});

test('performHandoff fails when MISSION.md is uncommitted', async () => {
  const slug = 'task-098';
  const worktree = '/tmp/fake-worktree';
  const missionDir = '/tmp/fake-worktree/docs/missions/2026/task-098';
  const missionMdPath = path.join(missionDir, 'MISSION.md');
  const cpPath = `${missionDir}/CP-1.md`;

  mock.method(missionUtils, 'findMissionDir', () => missionDir);
  mock.method(missionUtils, 'findMissionArea', () => 'docs');
  mock.method(missionUtils, 'findCheckpoints', () => [cpPath]);
  mock.method(git, 'getCurrentBranch', () => 'mission/task-098');
  mock.method(git, 'getWorktreeStatus', () => [' M docs/missions/2026/task-098/MISSION.md']);
  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true, taskFile: '/tmp/fake-task' }));

  fs.mkdirSync(missionDir, { recursive: true });
  fs.writeFileSync(missionMdPath, '# MISSION.md\n\nTest mission.\n');
  fs.writeFileSync(cpPath, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| test | test/example.test.ts | PASS |\n');
  writeReviewState(missionDir, 'claude', 'claude');

  const result = await performHandoff(slug, { worktree, skipGate: true, missionServicesFn: stubMissionServices() });
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /MISSION\.md is modified but uncommitted/);

  fs.rmSync(cpPath, { force: true });
  fs.rmSync(missionMdPath, { force: true });
});

test('performHandoff fails when no checkpoint documents exist', async () => {
  const slug = 'task-098';
  const worktree = '/tmp/fake-worktree';
  const missionDir = '/tmp/fake-worktree/docs/missions/2026/task-098';
  const missionMdPath = path.join(missionDir, 'MISSION.md');

  mock.method(missionUtils, 'findMissionDir', () => missionDir);
  mock.method(missionUtils, 'findMissionArea', () => 'docs');
  mock.method(missionUtils, 'findCheckpoints', () => []);
  mock.method(git, 'getCurrentBranch', () => 'mission/task-098');
  mock.method(git, 'getWorktreeStatus', () => []);
  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true, taskFile: '/tmp/fake-task' }));

  fs.mkdirSync(missionDir, { recursive: true });
  fs.writeFileSync(missionMdPath, '# MISSION.md\n\nTest mission.\n');
  writeReviewState(missionDir, 'claude', 'claude');

  const result = await performHandoff(slug, { worktree, skipGate: true, missionServicesFn: stubMissionServices() });
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /No checkpoint documents found/);

  fs.rmSync(missionMdPath, { force: true });
});

test('performHandoff auto-remediates missing checkpoints by writing CP-1.md but still fails the stronger evidence check', async () => {
  const slug = 'task-1228-autoremediate';
  const worktree = fs.mkdtempSync(path.join('/tmp', 'handoff-autoremediate-'));
  const missionDir = path.join(worktree, 'docs/missions/2026', slug);
  const autoCpPath = path.join(missionDir, 'CP-1.md');
  const gitCalls = [];

  fs.mkdirSync(missionDir, { recursive: true });
  fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# MISSION.md\n\nTest mission.\n');

  // findCheckpoints returns [] on the first call (triggering remediation) and the
  // generated CP-1.md on the re-scan, mirroring the real findCheckpoints behavior
  // once the file has been written.
  let findCheckpointsCalls = 0;
  mock.method(missionUtils, 'findMissionDir', () => missionDir);
  mock.method(missionUtils, 'findMissionArea', () => 'workflow');
  mock.method(missionUtils, 'findCheckpoints', () => {
    findCheckpointsCalls += 1;
    return findCheckpointsCalls === 1 ? [] : [autoCpPath];
  });
  mock.method(git, 'getCurrentBranch', () => `mission/${slug}`);
  mock.method(git, 'getWorktreeStatus', () => []);
  mock.method(git, 'run', () => ({ status: 0 }));
  mock.method(git, 'git', (args) => {
    gitCalls.push(args);
    return { status: 0, stdout: '', stderr: '' };
  });
  mock.method(forgejo, 'readToken', () => 'fake-token');
  mock.method(forgejo, 'createPr', () => ({ ok: true, url: 'http://fake-pr' }));
  mock.method(forgejo, 'authenticatedReviewUrl', () => 'http://fake-url');
  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true, taskFile: '/tmp/fake-task' }));
  mock.method(backlog, 'transitionTask', () => true);
  mock.method(gatekeeper, 'runGatekeeper', () => ({ ok: true, missing: [], skipped: false, posted: false }));

  try {
    writeReviewState(missionDir, 'claude', 'claude');
    const result = await performHandoff(slug, { worktree, skipGate: true, missionServicesFn: stubMissionServices() });

    assert.strictEqual(result.ok, false);
    assert.match(result.error, /no evidence rows that cite a verifiable reference/);

    // CP-1.md was actually written with the required structure.
    assert.ok(fs.existsSync(autoCpPath), 'CP-1.md should be written to the mission directory');
    const content = fs.readFileSync(autoCpPath, 'utf8');
    assert.match(content, /^# CP-1:/m);
    assert.match(content, /^## Goal Check\s*$/m);
    assert.match(content, /\| .+ \| .+ \| .+ \|/);

    // The generated checkpoint was committed during remediation.
    assert.ok(gitCalls.some(args => args.includes('commit') && args.some(a => a.includes('auto-generate CP-1.md'))));
  } finally {
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

test('performHandoff fails when the latest checkpoint document is uncommitted', async () => {
  const slug = 'task-098';
  const worktree = '/tmp/fake-worktree';
  const missionDir = '/tmp/fake-worktree/docs/missions/2026/task-098';
  const missionMdPath = path.join(missionDir, 'MISSION.md');
  const cp1Path = `${missionDir}/CP-1.md`;
  const cp2Path = `${missionDir}/CP-2.md`;

  mock.method(missionUtils, 'findMissionDir', () => missionDir);
  mock.method(missionUtils, 'findMissionArea', () => 'docs');
  mock.method(missionUtils, 'findCheckpoints', () => [cp1Path, cp2Path]);
  mock.method(git, 'getCurrentBranch', () => 'mission/task-098');
  mock.method(git, 'getWorktreeStatus', () => [' M docs/missions/2026/task-098/CP-2.md']);
  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true, taskFile: '/tmp/fake-task' }));

  fs.mkdirSync(missionDir, { recursive: true });
  fs.writeFileSync(missionMdPath, '# MISSION.md\n\nTest mission.\n');
  fs.writeFileSync(cp1Path, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| test | test/example.test.ts | PASS |\n');
  fs.writeFileSync(cp2Path, '# CP-2\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| test | test/example.test.ts | PASS |\n');
  writeReviewState(missionDir, 'claude', 'claude');

  const result = await performHandoff(slug, { worktree, skipGate: true, missionServicesFn: stubMissionServices() });
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /latest checkpoint document is modified but uncommitted/);

  fs.rmSync(cp1Path, { force: true });
  fs.rmSync(cp2Path, { force: true });
  fs.rmSync(missionMdPath, { force: true });
});

test('performHandoff fails when final checkpoint is missing Goal Check section', async () => {
  const slug = 'task-098';
  const worktree = '/tmp/fake-worktree';
  const missionDir = '/tmp/fake-worktree/docs/missions/2026/task-098';
  const missionMdPath = path.join(missionDir, 'MISSION.md');

  mock.method(missionUtils, 'findMissionDir', () => missionDir);
  mock.method(missionUtils, 'findMissionArea', () => 'docs');
  mock.method(missionUtils, 'findCheckpoints', () => [`${missionDir}/CP-1.md`]);
  mock.method(git, 'getCurrentBranch', () => 'mission/task-098');
  mock.method(git, 'getWorktreeStatus', () => []);

  // Create a checkpoint file without a Goal Check section
  const cpPath = `${missionDir}/CP-1.md`;
  fs.mkdirSync(missionDir, { recursive: true });
  fs.writeFileSync(missionMdPath, '# MISSION.md\n\nTest mission.\n');
  fs.writeFileSync(cpPath, '# CP-1\n\nSome checkpoint content.\n');
  writeReviewState(missionDir, 'claude', 'claude');

  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true, taskFile: '/tmp/fake-task' }));

  const result = await performHandoff(slug, { worktree, skipGate: true, missionServicesFn: stubMissionServices() });
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /missing a "## Goal Check" section/);

  fs.rmSync(cpPath, { force: true });
  fs.rmSync(missionMdPath, { force: true });
});

test('performHandoff fails when final checkpoint has Goal Check section but no evidence rows', async () => {
  const slug = 'task-098';
  const worktree = '/tmp/fake-worktree';
  const missionDir = '/tmp/fake-worktree/docs/missions/2026/task-098';
  const missionMdPath = path.join(missionDir, 'MISSION.md');

  mock.method(missionUtils, 'findMissionDir', () => missionDir);
  mock.method(missionUtils, 'findMissionArea', () => 'docs');
  mock.method(missionUtils, 'findCheckpoints', () => [`${missionDir}/CP-1.md`]);
  mock.method(git, 'getCurrentBranch', () => 'mission/task-098');
  mock.method(git, 'getWorktreeStatus', () => []);

  // Create a checkpoint with Goal Check header but no table rows
  const cpPath = `${missionDir}/CP-1.md`;
  fs.mkdirSync(missionDir, { recursive: true });
  fs.writeFileSync(missionMdPath, '# MISSION.md\n\nTest mission.\n');
  fs.writeFileSync(cpPath, '# CP-1\n\n## Goal Check\n\nNo evidence here.\n');
  writeReviewState(missionDir, 'claude', 'claude');

  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true, taskFile: '/tmp/fake-task' }));

  const result = await performHandoff(slug, { worktree, skipGate: true, missionServicesFn: stubMissionServices() });
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /no evidence rows/);

  fs.rmSync(cpPath, { force: true });
  fs.rmSync(missionMdPath, { force: true });
});

test('performHandoff fails when final checkpoint has header-only goal-check table (no evidence rows)', async () => {
  const slug = 'task-098';
  const worktree = '/tmp/fake-worktree';
  const missionDir = '/tmp/fake-worktree/docs/missions/2026/task-098';
  const missionMdPath = path.join(missionDir, 'MISSION.md');

  mock.method(missionUtils, 'findMissionDir', () => missionDir);
  mock.method(missionUtils, 'findMissionArea', () => 'docs');
  mock.method(missionUtils, 'findCheckpoints', () => [`${missionDir}/CP-1.md`]);
  mock.method(git, 'getCurrentBranch', () => 'mission/task-098');
  mock.method(git, 'getWorktreeStatus', () => []);

  // Create a checkpoint with Goal Check header and table header row but zero evidence rows
  const cpPath = `${missionDir}/CP-1.md`;
  fs.mkdirSync(missionDir, { recursive: true });
  fs.writeFileSync(missionMdPath, '# MISSION.md\n\nTest mission.\n');
  fs.writeFileSync(cpPath, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n');
  writeReviewState(missionDir, 'claude', 'claude');

  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true, taskFile: '/tmp/fake-task' }));

  const result = await performHandoff(slug, { worktree, skipGate: true, missionServicesFn: stubMissionServices() });
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /no evidence rows/);

  fs.rmSync(cpPath, { force: true });
  fs.rmSync(missionMdPath, { force: true });
});

test('performHandoff fails when final checkpoint has separator-only goal-check table', async () => {
  const slug = 'task-098';
  const worktree = '/tmp/fake-worktree';
  const missionDir = '/tmp/fake-worktree/docs/missions/2026/task-098';
  const missionMdPath = path.join(missionDir, 'MISSION.md');

  mock.method(missionUtils, 'findMissionDir', () => missionDir);
  mock.method(missionUtils, 'findMissionArea', () => 'docs');
  mock.method(missionUtils, 'findCheckpoints', () => [`${missionDir}/CP-1.md`]);
  mock.method(git, 'getCurrentBranch', () => 'mission/task-098');
  mock.method(git, 'getWorktreeStatus', () => []);

  // Create a checkpoint with Goal Check header, table header, and separator but no evidence
  const cpPath = `${missionDir}/CP-1.md`;
  fs.mkdirSync(missionDir, { recursive: true });
  fs.writeFileSync(missionMdPath, '# MISSION.md\n\nTest mission.\n');
  fs.writeFileSync(cpPath, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n|---|---|---|\n');
  writeReviewState(missionDir, 'claude', 'claude');

  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true, taskFile: '/tmp/fake-task' }));

  const result = await performHandoff(slug, { worktree, skipGate: true, missionServicesFn: stubMissionServices() });
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /no evidence rows/);

  fs.rmSync(cpPath, { force: true });
  fs.rmSync(missionMdPath, { force: true });
});

test('performHandoff fails when final checkpoint evidence row is placeholder prose only', async () => {
  const slug = 'task-098';
  const worktree = '/tmp/fake-worktree';
  const missionDir = '/tmp/fake-worktree/docs/missions/2026/task-098';
  const missionMdPath = path.join(missionDir, 'MISSION.md');

  mock.method(missionUtils, 'findMissionDir', () => missionDir);
  mock.method(missionUtils, 'findMissionArea', () => 'docs');
  mock.method(missionUtils, 'findCheckpoints', () => [`${missionDir}/CP-1.md`]);
  mock.method(git, 'getCurrentBranch', () => 'mission/task-098');
  mock.method(git, 'getWorktreeStatus', () => []);

  const cpPath = `${missionDir}/CP-1.md`;
  fs.mkdirSync(missionDir, { recursive: true });
  fs.writeFileSync(missionMdPath, '# MISSION.md\n\nTest mission.\n');
  fs.writeFileSync(cpPath, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| Works | Tested manually | Looks good |\n');
  writeReviewState(missionDir, 'claude', 'claude');

  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true, taskFile: '/tmp/fake-task' }));

  const result = await performHandoff(slug, { worktree, skipGate: true, missionServicesFn: stubMissionServices() });
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /no evidence rows that cite a verifiable reference/);

  fs.rmSync(cpPath, { force: true });
  fs.rmSync(missionMdPath, { force: true });
});

test('performHandoff fails when final checkpoint evidence row is shell output only', async () => {
  const slug = 'task-098';
  const worktree = '/tmp/fake-worktree-shell-only';
  const missionDir = '/tmp/fake-worktree-shell-only/docs/missions/2026/task-098';
  const missionMdPath = path.join(missionDir, 'MISSION.md');

  mock.method(missionUtils, 'findMissionDir', () => missionDir);
  mock.method(missionUtils, 'findMissionArea', () => 'docs');
  mock.method(missionUtils, 'findCheckpoints', () => [`${missionDir}/CP-1.md`]);
  mock.method(git, 'getCurrentBranch', () => 'mission/task-098');
  mock.method(git, 'getWorktreeStatus', () => []);

  const cpPath = `${missionDir}/CP-1.md`;
  fs.mkdirSync(missionDir, { recursive: true });
  fs.writeFileSync(missionMdPath, '# MISSION.md\n\nTest mission.\n');
  fs.writeFileSync(cpPath, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| Executable bit checked | `stat -c \'%A\' bin/hello.sh` → `-rwxrwxr-x` | PASS |\n');
  writeReviewState(missionDir, 'claude', 'claude');

  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true, taskFile: '/tmp/fake-task' }));

  const result = await performHandoff(slug, { worktree, skipGate: true, missionServicesFn: stubMissionServices() });
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /no evidence rows that cite a verifiable reference/);

  fs.rmSync(cpPath, { force: true });
  fs.rmSync(missionMdPath, { force: true });
});

test('performHandoff accepts final checkpoint evidence row with a real file:line reference', async () => {
  const slug = 'task-098';
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-real-evidence-'));
  const missionDir = path.join(worktree, 'docs/missions/2026/task-098');
  const missionMdPath = path.join(missionDir, 'MISSION.md');
  const cpPath = path.join(missionDir, 'CP-1.md');
  const sourcePath = path.join(worktree, 'lib/example.ts');

  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  fs.writeFileSync(sourcePath, 'export const example = 1;\n');
  fs.mkdirSync(missionDir, { recursive: true });
  fs.writeFileSync(missionMdPath, '# MISSION.md\n\nTest mission.\n');
  fs.writeFileSync(cpPath, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| Real source cited | lib/example.ts:1 | PASS |\n');
  writeReviewState(missionDir, 'codex', 'codex');

  mock.method(missionUtils, 'findMissionDir', () => missionDir);
  mock.method(missionUtils, 'findMissionArea', () => 'docs');
  mock.method(missionUtils, 'findCheckpoints', () => [cpPath]);
  mock.method(git, 'getCurrentBranch', () => 'mission/task-098');
  mock.method(git, 'getWorktreeStatus', () => []);
  mock.method(git, 'run', () => ({ status: 0 }));
  mock.method(git, 'git', () => ({ status: 0, stdout: '', stderr: '' }));
  mock.method(forgejo, 'readToken', () => 'fake-token');
  mock.method(forgejo, 'createPr', () => ({ ok: true, url: 'http://fake-pr' }));
  mock.method(forgejo, 'authenticatedReviewUrl', () => 'http://fake-url');
  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true, taskFile: '/tmp/fake-task' }));
  mock.method(backlog, 'transitionTask', () => true);
  mock.method(gatekeeper, 'runGatekeeper', () => ({ ok: true, missing: [], skipped: false, posted: false }));

  try {
    const result = await performHandoff(slug, { worktree, skipGate: true, missionServicesFn: stubMissionServices() });
    assert.strictEqual(result.ok, true);
  } finally {
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

test('performHandoff accepts file:line evidence with supporting shell context in the same cell', async () => {
  const slug = 'task-098';
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-supporting-context-'));
  const missionDir = path.join(worktree, 'docs/missions/2026/task-098');
  const missionMdPath = path.join(missionDir, 'MISSION.md');
  const cpPath = path.join(missionDir, 'CP-1.md');
  const sourcePath = path.join(worktree, 'bin/hello.sh');

  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  fs.writeFileSync(sourcePath, '#!/usr/bin/env bash\necho hello\n');
  fs.mkdirSync(missionDir, { recursive: true });
  fs.writeFileSync(missionMdPath, '# MISSION.md\n\nTest mission.\n');
  fs.writeFileSync(cpPath, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| Executable bit checked | bin/hello.sh:1; supporting context: `stat -c \'%A\' bin/hello.sh` → `-rwxr-xr-x` | PASS |\n');
  writeReviewState(missionDir, 'codex', 'codex');

  mock.method(missionUtils, 'findMissionDir', () => missionDir);
  mock.method(missionUtils, 'findMissionArea', () => 'docs');
  mock.method(missionUtils, 'findCheckpoints', () => [cpPath]);
  mock.method(git, 'getCurrentBranch', () => 'mission/task-098');
  mock.method(git, 'getWorktreeStatus', () => []);
  mock.method(git, 'run', () => ({ status: 0 }));
  mock.method(git, 'git', () => ({ status: 0, stdout: '', stderr: '' }));
  mock.method(forgejo, 'readToken', () => 'fake-token');
  mock.method(forgejo, 'createPr', () => ({ ok: true, url: 'http://fake-pr' }));
  mock.method(forgejo, 'authenticatedReviewUrl', () => 'http://fake-url');
  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true, taskFile: '/tmp/fake-task' }));
  mock.method(backlog, 'transitionTask', () => true);
  mock.method(gatekeeper, 'runGatekeeper', () => ({ ok: true, missing: [], skipped: false, posted: false }));

  try {
    const result = await performHandoff(slug, { worktree, skipGate: true, missionServicesFn: stubMissionServices() });
    assert.strictEqual(result.ok, true);
  } finally {
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

test('handoff CLI normalizes uppercase explicit slugs', async (t) => {
  const { mock } = t;

  // The composition root binds the adapter ports to the CLI interface.
  // Stub the workflow method rather than bypassing that boundary.
  const inferSlugMock = mock.method(missionUtils, 'inferSlug', (s) => s.toLowerCase());
  mock.method(HandoffCommandUseCase.prototype, 'performHandoff', async () => ({ ok: true }));

  // Mock process.exit to avoid crashing the test runner
  const exitMock = mock.method(process, 'exit', () => {});

  await createHandoffCommand(new HandoffCommandUseCase(createHandoffPorts()))(['TASK-1022']);

  assert.strictEqual(inferSlugMock.mock.calls[0].arguments[0], 'TASK-1022');
  assert.strictEqual(exitMock.mock.calls.length, 0, 'Should not exit on success');
});

test('performHandoff calls rebaseBeforeReviewRound before Forgejo PR creation', async (t) => {
  const { mock } = t;
  const slug = 'task-rebase-order';
  const worktree = fs.mkdtempSync(path.join('/tmp', 'handoff-rebase-order-'));
  const missionDir = path.join(worktree, 'docs/missions/2026', slug);
  const cpPath = path.join(missionDir, 'CP-1.md');
  const taskFile = path.join(worktree, 'backlog/tasks', `${slug} - rebase order.md`);
  const prCallOrder = [];

  fs.mkdirSync(missionDir, { recursive: true });
  fs.mkdirSync(path.dirname(taskFile), { recursive: true });
  fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# MISSION.md\n\nTest mission.\n');
  fs.writeFileSync(cpPath, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| test | test/example.test.ts | PASS |\n');
  fs.writeFileSync(taskFile, '---\nstatus: active\n---\n\n# rebase order\n');

  let rebaseCalled = false;
  let rebaseCalledBeforePr = false;
  const mockRebase = async (slugArg, opts) => {
    rebaseCalled = true;
    rebaseCalledBeforePr = prCallOrder.length === 0;
    return { ok: true, sharedFileConflicts: false };
  };

  mock.method(missionUtils, 'findMissionDir', () => missionDir);
  mock.method(missionUtils, 'findMissionArea', () => 'workflow');
  mock.method(missionUtils, 'findCheckpoints', () => [cpPath]);
  mock.method(git, 'getCurrentBranch', () => `mission/${slug}`);
  mock.method(git, 'getWorktreeStatus', () => []);
  mock.method(git, 'run', () => ({ status: 0 }));
  mock.method(git, 'git', (args) => {
    if (args.includes('origin')) prCallOrder.push('git-origin');
    return { status: 0, stdout: '', stderr: '' };
  });
  mock.method(forgejo, 'readToken', () => 'fake-token');
  mock.method(forgejo, 'createPr', (branch, user, token, opts) => {
    prCallOrder.push('forgejo-createPr');
    return { ok: true, url: 'http://fake-pr' };
  });
  mock.method(forgejo, 'authenticatedReviewUrl', () => 'http://fake-url');
  mock.method(forgejo, 'resolveTrackingBranchSha', () => ({ ok: true, sha: 'lease-sha' }));
  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true, taskFile }));
  mock.method(backlog, 'transitionTask', () => true);
  mock.method(gatekeeper, 'runGatekeeper', () => ({ ok: true, missing: [], skipped: false, posted: false }));
  writeReviewState(missionDir, 'custom', 'custom');

  try {
    const result = await performHandoff(slug, {
      missionServicesFn: stubMissionServices(),
      worktree,
      skipGate: true,
      isForgejoReviewEnabledFn: () => true,
      rebaseFn: mockRebase,
    });

    assert.strictEqual(result.ok, true);
    assert.ok(rebaseCalled, 'rebaseFn should have been called');
    assert.ok(rebaseCalledBeforePr, 'rebaseFn must be called before forgejo.createPr');
    assert.ok(prCallOrder.includes('forgejo-createPr'), 'Forgejo PR should have been created');
  } finally {
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

test('performHandoff fails when rebase returns ok=false with no shared-file conflicts', async (t) => {
  const { mock } = t;
  const slug = 'task-rebase-fail';
  const worktree = fs.mkdtempSync(path.join('/tmp', 'handoff-rebase-fail-'));
  const missionDir = path.join(worktree, 'docs/missions/2026', slug);
  const cpPath = path.join(missionDir, 'CP-1.md');
  const taskFile = path.join(worktree, 'backlog/tasks', `${slug} - rebase fail.md`);

  fs.mkdirSync(missionDir, { recursive: true });
  fs.mkdirSync(path.dirname(taskFile), { recursive: true });
  fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# MISSION.md\n\nTest mission.\n');
  fs.writeFileSync(cpPath, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| test | test/example.test.ts | PASS |\n');
  fs.writeFileSync(taskFile, '---\nstatus: active\n---\n\n# rebase fail\n');

  const mockRebase = async () => ({ ok: false, sharedFileConflicts: false });

  mock.method(missionUtils, 'findMissionDir', () => missionDir);
  mock.method(missionUtils, 'findMissionArea', () => 'workflow');
  mock.method(missionUtils, 'findCheckpoints', () => [cpPath]);
  mock.method(git, 'getCurrentBranch', () => `mission/${slug}`);
  mock.method(git, 'getWorktreeStatus', () => []);
  mock.method(git, 'run', () => ({ status: 0 }));
  mock.method(git, 'git', () => ({ status: 0, stdout: '', stderr: '' }));
  mock.method(forgejo, 'readToken', () => 'fake-token');
  mock.method(forgejo, 'createPr', () => {
    assert.fail('createPr should NOT be called when rebase fails');
    return { ok: true, url: 'http://fake-pr' };
  });
  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true, taskFile }));
  mock.method(backlog, 'transitionTask', () => {
    assert.fail('transitionTask should NOT be called when rebase fails');
    return true;
  });
  writeReviewState(missionDir, 'custom', 'custom');

  try {
    const result = await performHandoff(slug, {
      missionServicesFn: stubMissionServices(),
      worktree,
      skipGate: true,
      isForgejoReviewEnabledFn: () => true,
      rebaseFn: mockRebase,
    });

    assert.strictEqual(result.ok, false);
    assert.match(result.error, /Rebase failed before handoff/);
  } finally {
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

test('performHandoff fails when rebase returns sharedFileConflicts=true', async (t) => {
  const { mock } = t;
  const slug = 'task-rebase-shared-conflict';
  const worktree = fs.mkdtempSync(path.join('/tmp', 'handoff-shared-conflict-'));
  const missionDir = path.join(worktree, 'docs/missions/2026', slug);
  const cpPath = path.join(missionDir, 'CP-1.md');
  const taskFile = path.join(worktree, 'backlog/tasks', `${slug} - shared conflict.md`);

  fs.mkdirSync(missionDir, { recursive: true });
  fs.mkdirSync(path.dirname(taskFile), { recursive: true });
  fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# MISSION.md\n\nTest mission.\n');
  fs.writeFileSync(cpPath, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| test | test/example.test.ts | PASS |\n');
  fs.writeFileSync(taskFile, '---\nstatus: active\n---\n\n# shared conflict\n');

  const mockRebase = async () => ({ ok: false, sharedFileConflicts: true });

  mock.method(missionUtils, 'findMissionDir', () => missionDir);
  mock.method(missionUtils, 'findMissionArea', () => 'workflow');
  mock.method(missionUtils, 'findCheckpoints', () => [cpPath]);
  mock.method(git, 'getCurrentBranch', () => `mission/${slug}`);
  mock.method(git, 'getWorktreeStatus', () => []);
  mock.method(git, 'run', () => ({ status: 0 }));
  mock.method(git, 'git', () => ({ status: 0, stdout: '', stderr: '' }));
  mock.method(forgejo, 'readToken', () => 'fake-token');
  mock.method(forgejo, 'createPr', () => {
    assert.fail('createPr should NOT be called when rebase has shared-file conflicts');
    return { ok: true, url: 'http://fake-pr' };
  });
  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true, taskFile }));
  mock.method(backlog, 'transitionTask', () => {
    assert.fail('transitionTask should NOT be called when rebase has shared-file conflicts');
    return true;
  });
  writeReviewState(missionDir, 'custom', 'custom');

  try {
    const result = await performHandoff(slug, {
      missionServicesFn: stubMissionServices(),
      worktree,
      skipGate: true,
      isForgejoReviewEnabledFn: () => true,
      rebaseFn: mockRebase,
    });

    assert.strictEqual(result.ok, false);
    assert.match(result.error, /shared-file conflicts/);
    // task-2386 AC #1: the bounce must command execution, not description.
    assert.match(result.error, /Execute the listed commands now/);
    assert.match(result.error, /report the failure and stop/i);
  } finally {
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

test('performHandoff proceeds normally when rebase is a no-op (branch already up-to-date)', async (t) => {
  const { mock } = t;
  const slug = 'task-rebase-uptodate';
  const worktree = fs.mkdtempSync(path.join('/tmp', 'handoff-rebase-uptodate-'));
  const missionDir = path.join(worktree, 'docs/missions/2026', slug);
  const cpPath = path.join(missionDir, 'CP-1.md');
  const taskFile = path.join(worktree, 'backlog/tasks', `${slug} - rebase uptodate.md`);

  fs.mkdirSync(missionDir, { recursive: true });
  fs.mkdirSync(path.dirname(taskFile), { recursive: true });
  fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# MISSION.md\n\nTest mission.\n');
  fs.writeFileSync(cpPath, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| test | test/example.test.ts | PASS |\n');
  fs.writeFileSync(taskFile, '---\nstatus: active\n---\n\n# rebase uptodate\n');

  const mockRebase = async () => ({ ok: true, sharedFileConflicts: false });

  mock.method(missionUtils, 'findMissionDir', () => missionDir);
  mock.method(missionUtils, 'findMissionArea', () => 'workflow');
  mock.method(missionUtils, 'findCheckpoints', () => [cpPath]);
  mock.method(git, 'getCurrentBranch', () => `mission/${slug}`);
  mock.method(git, 'getWorktreeStatus', () => []);
  mock.method(git, 'run', () => ({ status: 0 }));
  mock.method(git, 'git', (args) => {
    if (args.includes('origin')) assert.fail('Should not push to origin');
    if (args.includes('--cached') && args.includes('--quiet')) return { status: 0 };
    return { status: 0, stdout: '', stderr: '' };
  });
  mock.method(forgejo, 'readToken', () => 'fake-token');
  mock.method(forgejo, 'createPr', () => ({ ok: true, url: 'http://fake-pr' }));
  mock.method(forgejo, 'authenticatedReviewUrl', () => 'http://fake-url');
  mock.method(forgejo, 'resolveTrackingBranchSha', () => ({ ok: true, sha: 'lease-sha' }));
  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true, taskFile }));
  mock.method(backlog, 'transitionTask', () => true);
  mock.method(gatekeeper, 'runGatekeeper', () => ({ ok: true, missing: [], skipped: false, posted: false }));
  writeReviewState(missionDir, 'custom', 'custom');

  try {
    const result = await performHandoff(slug, {
      missionServicesFn: stubMissionServices(),
      worktree,
      skipGate: true,
      isForgejoReviewEnabledFn: () => true,
      rebaseFn: mockRebase,
    });

    assert.strictEqual(result.ok, true);
  } finally {
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

// ---------- runDeclaredGates (generic ## Gates runner) ----------

test('runDeclaredGates returns skipped when no ## Gates section exists', () => {
  const missionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gates-test-'));
  fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Mission\n\nNo gates here.\n');
  try {
    const result = runDeclaredGates(missionDir, '/tmp/fake', { log: () => {}, error: () => {} });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.skipped, true);
    assert.strictEqual(result.reason, 'no-gates-section');
  } finally {
    fs.rmSync(missionDir, { recursive: true, force: true });
  }
});

test('runDeclaredGates returns skipped when ## Gates section is empty', () => {
  const missionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gates-test-'));
  fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Mission\n\n## Gates\n\n');
  try {
    const result = runDeclaredGates(missionDir, '/tmp/fake', { log: () => {}, error: () => {} });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.skipped, true);
    assert.strictEqual(result.reason, 'no-gates-declared');
  } finally {
    fs.rmSync(missionDir, { recursive: true, force: true });
  }
});

test('runDeclaredGates executes passing gates and reports count', () => {
  const missionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gates-test-'));
  fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Mission\n\n## Gates\n\n- [ ] echo hello\n- [ ] true\n');
  try {
    const result = runDeclaredGates(missionDir, missionDir, { log: () => {}, error: () => {} });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.skipped, false);
    assert.strictEqual(result.count, 2);
    assert.strictEqual(result.reason, 'all-gates-passed');
  } finally {
    fs.rmSync(missionDir, { recursive: true, force: true });
  }
});

test('runDeclaredGates fails when a gate command exits non-zero', () => {
  const missionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gates-test-'));
  fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Mission\n\n## Gates\n\n- [ ] false\n');
  try {
    const result = runDeclaredGates(missionDir, missionDir, { log: () => {}, error: () => {} });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'gate-failed');
    assert.strictEqual(result.gate, 'false');
  } finally {
    fs.rmSync(missionDir, { recursive: true, force: true });
  }
});

test('runDeclaredGates skips when mission directory does not exist', () => {
  const result = runDeclaredGates('/nonexistent/dir', '/tmp/fake', { log: () => {}, error: () => {} });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.skipped, true);
  assert.strictEqual(result.reason, 'no-mission-file');
});

test('runDeclaredGates handles checkbox prefixes [- [ ] and - [x])', () => {
  const missionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gates-test-'));
  fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Mission\n\n## Gates\n\n- [ ] echo step1\n- [x] true\n');
  try {
    const result = runDeclaredGates(missionDir, missionDir, { log: () => {}, error: () => {} });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.skipped, false);
    assert.strictEqual(result.count, 2);
  } finally {
    fs.rmSync(missionDir, { recursive: true, force: true });
  }
});

// ---------- captureNelAtHandoff ----------

/**
 * TASK-2322.05: NEL capture now records through the checked Mission boundary,
 * whose selected compatibility authority is the Backlog task record plus the
 * mission documents. These fixtures therefore write the task document the
 * production path always has (handoff already refuses a mission whose task
 * cannot be transitioned).
 */
function writeCompatibilityTaskRecord(rootDir, slug, status = 'active') {
  const tasksDir = path.join(rootDir, 'backlog', 'tasks');
  fs.mkdirSync(tasksDir, { recursive: true });
  const taskFile = path.join(tasksDir, `${slug} - nel fixture.md`);
  fs.writeFileSync(taskFile, [
    '---',
    `id: ${slug.toUpperCase()}`,
    'title: NEL fixture',
    `status: ${status}`,
    'assignee: [codex]',
    '---',
    '',
    '## Description',
    '',
    'NEL fixture task.',
    '',
  ].join('\n'));
  return taskFile;
}

test('captureNelAtHandoff returns error when primary branch not detected', async () => {
  const origGetPrimaryBranch = missionUtils.getPrimaryBranch;
  const { mock } = test;

  const mockFn = mock.method(missionUtils, 'getPrimaryBranch', () => {
    throw new Error('no branch');
  });

  try {
    const result = await captureNelAtHandoff('task-fake', {
      rootDir: '/tmp/fake',
      missionDir: '/tmp/fake/missions/task-fake',
      log: () => {},
      error: () => {},
    });
    assert.strictEqual(result.ok, false);
    assert.match(result.error, /primary branch/);
  } finally {
    mockFn.mock.restore();
  }
});

test('captureNelAtHandoff records the NEL through the Mission store and writes no nel-record.json', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nel-capture-'));
  const missionDir = path.join(tmpDir, 'missions/task-nel-test');
  const nelRecordPath = path.join(missionDir, 'nel-record.json');

  try {
    fs.mkdirSync(missionDir, { recursive: true });
    writeCompatibilityTaskRecord(tmpDir, 'task-nel-test');

    // Create MISSION.md with predicted NEL bucket
    fs.writeFileSync(path.join(missionDir, 'MISSION.md'), [
      '# Mission',
      '',
      '## Refinement Signals',
      '',
      '- Predicted NEL bucket: Small (0\u201380) / Medium (81\u2013235) / Large (235+)',
      '- Confidence: High',
    ].join('\n'));

    // Mock getPrimaryBranch to return 'main'
    const { mock } = test;
    const mockFn = mock.method(missionUtils, 'getPrimaryBranch', () => 'main');

    // TASK-2322.07: review rounds come from the Mission store, not review-state.json.
    const recorded = [];
    const missionServicesFn = stubMissionServices({
      store: {
        _repoId: 'test-repo',
        async load() {
          return {
            kind: 'found',
            mission: { review: { rounds: [{}, {}, {}] } },
            version: 1,
          };
        },
      },
      handoff: {
        async recordNel(request) {
          recorded.push(request);
          return { status: 'completed', value: {}, durableEvidence: [] };
        },
      },
    });

    try {
      const result = await captureNelAtHandoff('task-nel-test', {
        rootDir: tmpDir,
        missionDir,
        log: () => {},
        error: () => {},
        missionServicesFn,
      });

      assert.strictEqual(result.ok, true);
      assert.ok(typeof result.nel === 'number', 'nel should be a number');
      assert.ok(['Small', 'Medium', 'Large'].includes(result.bucket), `bucket should be valid, got ${result.bucket}`);

      // SC3: the retired legacy record is never written.
      assert.equal(fs.existsSync(nelRecordPath), false, 'nel-record.json must not be written after the cutover');

      assert.equal(recorded.length, 1, 'NEL is recorded once through the Mission store');
      const request = recorded[0];
      assert.strictEqual(request.missionId, 'task-nel-test');
      assert.strictEqual(request.predictedBucket, 'Small');
      assert.strictEqual(request.reviewRounds, 3);
      assert.deepEqual(request.artifacts, [{ kind: 'git-range', location: 'main..HEAD', byteSize: null }]);
      assert.ok(request.capturedAt, 'should have capturedAt timestamp');
    } finally {
      mockFn.mock.restore();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('captureNelAtHandoff reports a refused Mission write and leaves no legacy record', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nel-capture-fail-'));
  const missionDir = path.join(tmpDir, 'missions/task-nel-fail');
  fs.mkdirSync(missionDir, { recursive: true });
  writeCompatibilityTaskRecord(tmpDir, 'task-nel-fail');
  const primaryMock = mock.method(missionUtils, 'getPrimaryBranch', () => 'main');
  const errors = [];
  try {
    const result = await handoffModule.captureNelAtHandoff('task-nel-fail', {
      rootDir: tmpDir,
      missionDir,
      log: () => {},
      error: message => errors.push(message),
      missionServicesFn: stubMissionServices({
        handoff: {
          async recordNel() {
            return {
              status: 'failed',
              error: { kind: 'unavailable', message: 'injected NEL persistence failure' },
              durableEvidence: [],
            };
          },
        },
      }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.persistenceFailed, true);
    assert.match(result.error, /injected NEL persistence failure/);
    assert.equal(fs.existsSync(path.join(missionDir, 'nel-record.json')), false);
    assert.equal(errors.length, 1);
  } finally {
    primaryMock.mock.restore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('performHandoff stops before review transitions when NEL persistence fails', async (t) => {
  const slug = 'task-nel-stop';
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-nel-stop-'));
  const missionDir = path.join(worktree, 'missions', slug);
  const checkpoint = path.join(missionDir, 'CP-1.md');
  const taskFile = path.join(worktree, 'backlog', 'tasks', `${slug} - stop.md`);
  fs.mkdirSync(path.dirname(taskFile), { recursive: true });
  fs.mkdirSync(missionDir, { recursive: true });
  fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Mission\n');
  fs.writeFileSync(checkpoint, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| proof | test/handoff.test.js | PASS |\n');
  fs.writeFileSync(taskFile, '---\nstatus: active\n---\n');
  writeReviewState(missionDir, 'codex', 'codex');
  let transitions = 0;
  t.mock.method(missionUtils, 'findMissionDir', () => missionDir);
  t.mock.method(missionUtils, 'findMissionArea', () => 'workflow');
  t.mock.method(missionUtils, 'findCheckpoints', () => [checkpoint]);
  t.mock.method(git, 'getCurrentBranch', () => `mission/${slug}`);
  t.mock.method(git, 'getWorktreeStatus', () => []);
  t.mock.method(backlog, 'resolveTaskFile', () => ({ ok: true, taskFile }));
  t.mock.method(backlog, 'transitionTask', () => { transitions++; return true; });
  try {
    const result = await performHandoff(slug, {
      missionServicesFn: stubMissionServices(),
      worktree,
      skipGate: true,
      isForgejoReviewEnabledFn: () => false,
      rebaseFn: async () => ({ ok: true }),
      captureNelFn: () => ({ ok: false, persistenceFailed: true, error: 'injected failure' }),
      log: () => {},
      error: () => {},
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /stopped before review state advanced/);
    assert.equal(transitions, 0);
  } finally {
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

test('performHandoff no longer stages or commits a legacy NEL record before transitioning Backlog', async (t) => {
  const slug = 'task-nel-commit';
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-nel-commit-'));
  const missionDir = path.join(worktree, 'missions', slug);
  const checkpoint = path.join(missionDir, 'CP-1.md');
  const taskFile = path.join(worktree, 'backlog', 'tasks', `${slug} - commit.md`);
  fs.mkdirSync(path.dirname(taskFile), { recursive: true });
  fs.mkdirSync(missionDir, { recursive: true });
  fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Mission\n');
  fs.writeFileSync(checkpoint, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| proof | test/handoff.test.js | PASS |\n');
  fs.writeFileSync(taskFile, '---\nstatus: active\n---\n');
  writeReviewState(missionDir, 'codex', 'codex');
  const gitCalls = [];
  let transitions = 0;
  t.mock.method(missionUtils, 'findMissionDir', () => missionDir);
  t.mock.method(missionUtils, 'findMissionArea', () => 'workflow');
  t.mock.method(missionUtils, 'findCheckpoints', () => [checkpoint]);
  t.mock.method(git, 'getCurrentBranch', () => `mission/${slug}`);
  t.mock.method(git, 'getWorktreeStatus', () => []);
  t.mock.method(git, 'git', args => {
    gitCalls.push(args);
    if (args.includes('diff')) { return { status: 1, stdout: '', stderr: '' }; }
    return { status: 0, stdout: '', stderr: '' };
  });
  t.mock.method(backlog, 'resolveTaskFile', () => ({ ok: true, taskFile }));
  t.mock.method(backlog, 'transitionTask', () => { transitions++; return true; });
  try {
    const result = await performHandoff(slug, {
      missionServicesFn: stubMissionServices(),
      worktree,
      skipGate: true,
      isForgejoReviewEnabledFn: () => false,
      rebaseFn: async () => ({ ok: true }),
      captureNelFn: () => {
        fs.writeFileSync(path.join(missionDir, 'nel-record.json'), '{}');
        return { ok: true, nel: 0, bucket: { label: 'Small' } };
      },
      log: () => {},
      error: () => {},
    });
    assert.equal(result.ok, true);
    // SC3: the NEL lives in SQLite, so handoff stages and commits nothing for
    // it. Everything git is asked here is a read — the review target-branch
    // lookup for the Mission transition, and worktree resolution.
    assert.deepEqual(
      gitCalls.filter(args => args.includes('add') || args.includes('commit')),
      [],
      'no NEL record may be staged or committed',
    );
    assert.ok(
      gitCalls.some(args => args.includes('branch') && args.includes('--list')),
      'the review target branch is still resolved for the Mission transition',
    );
    assert.equal(transitions, 1);
  } finally {
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

test('captureNelAtHandoff reads predicted bucket from MISSION.md Refinement Signals', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nel-capture-bucket-'));
  const missionDir = path.join(tmpDir, 'missions/task-nel-bucket');

  try {
    fs.mkdirSync(missionDir, { recursive: true });
    writeCompatibilityTaskRecord(tmpDir, 'task-nel-bucket');

    // Create MISSION.md with Medium predicted bucket
    fs.writeFileSync(path.join(missionDir, 'MISSION.md'), [
      '# Mission',
      '',
      '## Refinement Signals',
      '',
      '- Predicted NEL bucket: Medium (81\u2013235)',
    ].join('\n'));

    const { mock } = test;
    const mockFn = mock.method(missionUtils, 'getPrimaryBranch', () => 'main');
    const recorded = [];

    try {
      await captureNelAtHandoff('task-nel-bucket', {
        rootDir: tmpDir,
        missionDir,
        log: () => {},
        error: () => {},
        missionServicesFn: stubMissionServices({
          handoff: {
            async recordNel(request) {
              recorded.push(request);
              return { status: 'completed', value: {}, durableEvidence: [] };
            },
          },
        }),
      });

      assert.strictEqual(recorded[0].predictedBucket, 'Medium');
    } finally {
      mockFn.mock.restore();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ---------- Gate output capture (task-1387, SC1 & SC2) ----------

test('performHandoff captures verification gate stdout/stderr on non-zero exit (SC1)', async (t) => {
  const { mock } = t;
  const slug = 'task-1387-sc1';
  const worktree = fs.mkdtempSync(path.join('/tmp', 'handoff-sc1-'));
  const missionDir = path.join(worktree, 'docs/missions/2026', slug);
  const cpPath = path.join(missionDir, 'CP-1.md');
  const taskFile = path.join(worktree, 'backlog/tasks', `${slug} - sc1.md`);

  fs.mkdirSync(missionDir, { recursive: true });
  fs.mkdirSync(path.dirname(taskFile), { recursive: true });
  fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# MISSION.md\n\nTest mission.\n');
  fs.writeFileSync(cpPath, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| test | test/example.test.ts | PASS |\n');
  fs.writeFileSync(taskFile, '---\nstatus: active\n---\n\n# sc1\n');

  const mockRebase = async () => ({ ok: true, sharedFileConflicts: false });

  // Provide a mock runVerificationGate that returns non-zero with known output
  const mockVerifyGate = () => ({
    status: 1,
    stdout: 'lint: ERROR: unused import in foo.js',
    stderr: 'TypeScript: error TS2345: type mismatch'
  });

  mock.method(missionUtils, 'findMissionDir', () => missionDir);
  mock.method(missionUtils, 'findMissionArea', () => 'workflow');
  mock.method(missionUtils, 'findCheckpoints', () => [cpPath]);
  mock.method(git, 'getCurrentBranch', () => `mission/${slug}`);
  mock.method(git, 'getWorktreeStatus', () => []);
  mock.method(git, 'run', () => ({ status: 0 }));
  mock.method(git, 'git', () => ({ status: 0, stdout: '', stderr: '' }));
  mock.method(forgejo, 'readToken', () => 'fake-token');
  mock.method(forgejo, 'createPr', () => ({ ok: true, url: 'http://fake-pr' }));
  mock.method(forgejo, 'authenticatedReviewUrl', () => 'http://fake-url');
  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true, taskFile }));
  mock.method(backlog, 'transitionTask', () => true);
  mock.method(gatekeeper, 'runGatekeeper', () => ({ ok: true, missing: [], skipped: false, posted: false }));
  writeReviewState(missionDir, 'custom', 'custom');

  try {
    const result = await performHandoff(slug, {
      missionServicesFn: stubMissionServices(),
      worktree,
      isForgejoReviewEnabledFn: () => true,
      rebaseFn: mockRebase,
      runVerificationGateFn: mockVerifyGate,
    });

    assert.strictEqual(result.ok, false);
    assert.ok(result.gateOutput, 'gateOutput should be present on gate failure');
    assert.strictEqual(result.gateOutput.stdout, 'lint: ERROR: unused import in foo.js');
    assert.strictEqual(result.gateOutput.stderr, 'TypeScript: error TS2345: type mismatch');
  } finally {
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

test('runDeclaredGates captures stdout and stderr on gate failure (SC2)', async (t) => {
  const { mock } = t;
  const missionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gates-sc2-'));
  // Gate that produces both stdout and stderr on failure
  fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Mission\n\n## Gates\n\n- [ ] bash -c \'echo "out message"; echo "err message" >&2; exit 1\'\n');

  // Mock spawnSync to capture the actual gate command
  const origSpawnSync = childProcess.spawnSync;
  const mockSpawnSync = mock.method(childProcess, 'spawnSync', (...args) => {
    // Let real spawnSync run, we just want to verify the result is captured
    return origSpawnSync.apply(childProcess, args);
  });

  try {
    const result = runDeclaredGates(missionDir, missionDir, { log: () => {}, error: () => {} });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'gate-failed');
    assert.ok(result.stdout !== undefined, 'stdout should be captured');
    assert.ok(result.stderr !== undefined, 'stderr should be captured');
    assert.ok(result.stdout.includes('out message'), 'stdout should contain expected output');
    assert.ok(result.stderr.includes('err message'), 'stderr should contain expected error');
  } finally {
    mockSpawnSync.mock.restore();
    fs.rmSync(missionDir, { recursive: true, force: true });
  }
});

// ---------- validateDeclaredGates (pre-validation of gate commands) ----------

test('validateDeclaredGates passes for valid commands with existing files', () => {
  const rootDir = path.join(import.meta.dirname, '..');
  const result = validateDeclaredGates(
    ['./scripts/verify-local.sh docs', './scripts/verify-local.sh static-analysis'],
    rootDir
  );
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, 'all-gates-valid');
});

test('validateDeclaredGates fails for non-existent file with validation-failed reason', () => {
  const rootDir = path.join(import.meta.dirname, '..');
  const result = validateDeclaredGates(['./scripts/nonexistent.sh'], rootDir);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'validation-failed');
  assert.strictEqual(result.gate, './scripts/nonexistent.sh');
  assert.ok(result.error.includes('non-existent file') || result.error.includes('nonexistent.sh'));
});

test('validateDeclaredGates fails for unclosed single quotes with validation-failed reason', () => {
  const rootDir = path.join(import.meta.dirname, '..');
  const result = validateDeclaredGates(['echo \'hello'], rootDir);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'validation-failed');
  assert.strictEqual(result.gate, 'echo \'hello');
  assert.ok(result.error.includes('unclosed single quotes'));
});

test('validateDeclaredGates fails for unclosed double quotes with validation-failed reason', () => {
  const rootDir = path.join(import.meta.dirname, '..');
  const result = validateDeclaredGates(['echo "hello'], rootDir);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'validation-failed');
  assert.strictEqual(result.gate, 'echo "hello');
  assert.ok(result.error.includes('unclosed double quotes'));
});

test('validateDeclaredGates fails for unmatched parentheses with validation-failed reason', () => {
  const rootDir = path.join(import.meta.dirname, '..');
  const result = validateDeclaredGates(['echo (hello'], rootDir);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'validation-failed');
  assert.strictEqual(result.gate, 'echo (hello');
  assert.ok(result.error.includes('unmatched parentheses'));
});

test('validateDeclaredGates fails for unmatched braces with validation-failed reason', () => {
  const rootDir = path.join(import.meta.dirname, '..');
  const result = validateDeclaredGates(['echo {hello'], rootDir);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'validation-failed');
  assert.ok(result.error.includes('unmatched braces'));
});

test('validateDeclaredGates fails for unmatched brackets with validation-failed reason', () => {
  const rootDir = path.join(import.meta.dirname, '..');
  const result = validateDeclaredGates(['echo [hello'], rootDir);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'validation-failed');
  assert.ok(result.error.includes('unmatched brackets'));
});

test('validateDeclaredGates fails on first invalid command in mixed valid/invalid set', () => {
  const rootDir = path.join(import.meta.dirname, '..');
  const result = validateDeclaredGates(
    ['./scripts/verify-local.sh docs', './scripts/nonexistent.sh'],
    rootDir
  );
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'validation-failed');
  assert.strictEqual(result.gate, './scripts/nonexistent.sh');
});

test('validateDeclaredGates passes for shell builtins without file paths', () => {
  const rootDir = path.join(import.meta.dirname, '..');
  const result = validateDeclaredGates(['echo hello', 'true', 'false'], rootDir);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, 'all-gates-valid');
});

test('validateDeclaredGates skips URL patterns', () => {
  const rootDir = path.join(import.meta.dirname, '..');
  const result = validateDeclaredGates(['curl https://example.com'], rootDir);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, 'all-gates-valid');
});

test('validateDeclaredGates passes for commands with flags', () => {
  const rootDir = path.join(import.meta.dirname, '..');
  const result = validateDeclaredGates(['node --version', 'npm run test'], rootDir);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, 'all-gates-valid');
});

// ---------- runDeclaredGates integration with validation ----------

test('runDeclaredGates fails with validation-failed before executing invalid file reference', () => {
  const missionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gates-validation-test-'));
  fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Mission\n\n## Gates\n\n- [ ] ./scripts/nonexistent.sh\n');
  try {
    const result = runDeclaredGates(missionDir, missionDir, { log: () => {}, error: () => {} });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'validation-failed');
    assert.strictEqual(result.gate, './scripts/nonexistent.sh');
  } finally {
    fs.rmSync(missionDir, { recursive: true, force: true });
  }
});

test('runDeclaredGates fails with validation-failed before executing syntax error', () => {
  const missionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gates-validation-test-'));
  fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Mission\n\n## Gates\n\n- [ ] echo \'unclosed\n');
  try {
    const result = runDeclaredGates(missionDir, missionDir, { log: () => {}, error: () => {} });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'validation-failed');
  } finally {
    fs.rmSync(missionDir, { recursive: true, force: true });
  }
});

// ---------- Regression tests for realistic gate-command text (Finding 1 fix) ----------

test('validateDeclaredGates passes glob patterns (no false positive on /*)', () => {
  const rootDir = path.join(import.meta.dirname, '..');
  const result = validateDeclaredGates(
    ['All 108+ tests in `test/*.test.js` pass via `npm test`'],
    rootDir
  );
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, 'all-gates-valid');
});

test('validateDeclaredGates passes directory references with trailing slash', () => {
  const rootDir = path.join(import.meta.dirname, '..');
  const result = validateDeclaredGates(
    ["npm run prepublishOnly && npm pack --dry-run 2>&1 | grep -q 'src/adapters/agents/'"],
    rootDir
  );
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, 'all-gates-valid');
});

test('validateDeclaredGates passes apostrophe inside double-quoted string', () => {
  const rootDir = path.join(import.meta.dirname, '..');
  const result = validateDeclaredGates(
    [`echo "it's a test"`],
    rootDir
  );
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, 'all-gates-valid');
});

test('validateDeclaredGates passes double apostrophe inside double-quoted string', () => {
  const rootDir = path.join(import.meta.dirname, '..');
  const result = validateDeclaredGates(
    [`echo "it's Bob's test"`],
    rootDir
  );
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, 'all-gates-valid');
});

test('validateDeclaredGates passes mixed prose with embedded path', () => {
  const rootDir = path.join(import.meta.dirname, '..');
  const result = validateDeclaredGates(
    ['./scripts/verify-local.sh static-analysis && echo "All checks passed"'],
    rootDir
  );
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, 'all-gates-valid');
});

test('validateDeclaredGates passes command with valid ./ path and quoted arg', () => {
  const rootDir = path.join(import.meta.dirname, '..');
  const result = validateDeclaredGates(
    ['./scripts/verify-local.sh docs --verbose'],
    rootDir
  );
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, 'all-gates-valid');
});

test('validateDeclaredGates still catches genuinely unclosed single quote', () => {
  const rootDir = path.join(import.meta.dirname, '..');
  const result = validateDeclaredGates(["echo 'unclosed"], rootDir);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'validation-failed');
  assert.ok(result.error.includes('unclosed single'));
});

test('validateDeclaredGates still catches genuinely unclosed double quote', () => {
  const rootDir = path.join(import.meta.dirname, '..');
  const result = validateDeclaredGates(['echo "unclosed'], rootDir);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'validation-failed');
  assert.ok(result.error.includes('unclosed double'));
});

test('validateDeclaredGates passes escaped quote inside double-quoted string', () => {
  const rootDir = path.join(import.meta.dirname, '..');
  const result = validateDeclaredGates(['echo "say \\"hi\\" to me"'], rootDir);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, 'all-gates-valid');
});

test('validateDeclaredGates fails for non-existent file still works with tokenized paths', () => {
  const rootDir = path.join(import.meta.dirname, '..');
  const result = validateDeclaredGates(['node ./lib/commands/nonexistent.js'], rootDir);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'validation-failed');
  assert.ok(result.error.includes('non-existent file'));
  assert.ok(result.error.includes('nonexistent.js'));
});

test('validateDeclaredGates passes command with absolute path that exists', () => {
  const rootDir = path.join(import.meta.dirname, '..');
  const result = validateDeclaredGates([`cat ${process.execPath}`], rootDir);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, 'all-gates-valid');
});

test('validateDeclaredGates fails for non-existent absolute path', () => {
  const rootDir = path.join(import.meta.dirname, '..');
  const result = validateDeclaredGates(['cat /nonexistent/path/file.txt'], rootDir);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'validation-failed');
  assert.ok(result.error.includes('non-existent file'));
});

// ---------- Command-only gate declaration regression and compatibility ----------

test('validateDeclaredGates rejects outcome prose with command-only remediation', () => {
  const gate = './scripts/verify-local.sh all passes on the final tree.';
  const result = validateDeclaredGates([gate], path.join(import.meta.dirname, '..'));

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'validation-failed');
  assert.equal(result.gate, gate);
  assert.match(result.error, /exact runnable command only/i);
  assert.match(result.error, /Success Criteria or checkpoint documentation/i);
});

test('runDeclaredGates rejects Markdown command followed by prose', () => {
  const missionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gates-backtick-prose-test-'));
  const gate = '`true` passes on the final tree.';
  fs.writeFileSync(path.join(missionDir, 'MISSION.md'), `# Mission\n\n## Gates\n\n- [ ] ${gate}\n`);
  try {
    const result = runDeclaredGates(missionDir, missionDir, { log: () => {}, error: () => {} });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'validation-failed');
    assert.equal(result.gate, gate);
  } finally {
    fs.rmSync(missionDir, { recursive: true, force: true });
  }
});

test('runDeclaredGates rejects explanatory dash suffixes', () => {
  for (const suffix of ['true — some description', 'true – brief note', 'true -– legacy note']) {
    const missionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gates-dash-prose-test-'));
    fs.writeFileSync(path.join(missionDir, 'MISSION.md'), `# Mission\n\n## Gates\n\n- [ ] ${suffix}\n`);
    try {
      const result = runDeclaredGates(missionDir, missionDir, { log: () => {}, error: () => {} });
      assert.equal(result.ok, false, suffix);
      assert.equal(result.reason, 'validation-failed', suffix);
    } finally {
      fs.rmSync(missionDir, { recursive: true, force: true });
    }
  }
});

test('runDeclaredGates executes bare, backticked, checked, and unchecked command forms', () => {
  const missionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gates-command-forms-test-'));
  fs.writeFileSync(path.join(missionDir, 'MISSION.md'), [
    '# Mission',
    '',
    '## Gates',
    '',
    '- true',
    '- [ ] `true`',
    '- [x] true',
    ''
  ].join('\n'));
  try {
    const result = runDeclaredGates(missionDir, missionDir, { log: () => {}, error: () => {} });
    assert.equal(result.ok, true);
    assert.equal(result.reason, 'all-gates-passed');
    assert.equal(result.count, 3);
  } finally {
    fs.rmSync(missionDir, { recursive: true, force: true });
  }
});

test('validateDeclaredGates preserves quoted arguments, pipelines, redirects, and compound commands', () => {
  const result = validateDeclaredGates(
    ['printf "%s\\n" "all checks pass" | grep -q pass && true > /dev/null'],
    path.join(import.meta.dirname, '..')
  );

  assert.equal(result.ok, true);
  assert.equal(result.reason, 'all-gates-valid');
});

// ---------- Gatekeeper pushback relaunch (task-1388) ----------

test('performHandoff attempts agent relaunch when gatekeeper posts pushback', async (t) => {
  const { mock } = t;
  const slug = 'task-1388-gk-pushback';
  const worktree = fs.mkdtempSync(path.join('/tmp', 'handoff-gk-pushback-'));
  const missionDir = path.join(worktree, 'docs/missions/2026', slug);
  const cpPath = path.join(missionDir, 'CP-1.md');
  const taskFile = path.join(worktree, 'backlog/tasks', `${slug} - gk pushback.md`);

  fs.mkdirSync(missionDir, { recursive: true });
  fs.mkdirSync(path.dirname(taskFile), { recursive: true });
  fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# MISSION.md\n\nTest mission.\n');
  fs.writeFileSync(cpPath, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| test | test/example.test.ts | PASS |\n');
  fs.writeFileSync(taskFile, '---\nstatus: active\n---\n\n# gk pushback\n');

  const mockRebase = async () => ({ ok: true, sharedFileConflicts: false });
  let relaunchCallCount = 0;
  let relaunchPrompt = null;

  mock.method(missionUtils, 'findMissionDir', () => missionDir);
  mock.method(missionUtils, 'findMissionArea', () => 'workflow');
  mock.method(missionUtils, 'findCheckpoints', () => [cpPath]);
  mock.method(git, 'getCurrentBranch', () => `mission/${slug}`);
  mock.method(git, 'getWorktreeStatus', () => []);
  mock.method(git, 'run', () => ({ status: 0 }));
  mock.method(git, 'git', () => ({ status: 0, stdout: '', stderr: '' }));
  mock.method(forgejo, 'readToken', () => 'fake-token');
  mock.method(forgejo, 'createPr', () => ({ ok: true, url: 'http://fake-pr' }));
  mock.method(forgejo, 'authenticatedReviewUrl', () => 'http://fake-url');
  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true, taskFile }));
  mock.method(backlog, 'transitionTask', () => true);
  mock.method(gatekeeper, 'runGatekeeper', () => ({
    ok: false, missing: ['docs/missions/2026/task-1388-gk-pushback/MISSION.md'], skipped: false, posted: true
  }));

  // TASK-2377.05: the pushback bounce runs through the rebound kernel, which
  // builds the fix prompt and hands it to this launch port.
  const mockStartAgent = async (_step, opts) => {
    relaunchCallCount++;
    const slot = opts && opts.prompt;
    relaunchPrompt = typeof slot === 'function' ? slot('custom') : (slot ?? null);
    throw new Error('agent not available');
  };

  writeReviewState(missionDir, 'custom', 'custom');

  try {
    const result = await performHandoff(slug, {
      missionServicesFn: stubMissionServices(),
      worktree,
      skipGate: true,
      isForgejoReviewEnabledFn: () => true,
      rebaseFn: mockRebase,
      startAgentFn: mockStartAgent,
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.gatekeeperPushedBack, true);
    assert.ok(result.error && result.error.includes('Manual intervention required'));
    assert.strictEqual(relaunchCallCount, 1, 'the kernel launched once against the remaining budget');
    assert.ok(relaunchPrompt, 'the kernel fix prompt should have been built');
    assert.ok(relaunchPrompt.includes('MISSION.md'), 'prompt should mention MISSION.md');
    assert.ok(relaunchPrompt.includes('create'), 'prompt should contain creation instructions');
  } finally {
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

test('performHandoff respects bounded retry limit of 2 for gatekeeper pushback', async (t) => {
  const { mock } = t;
  const slug = 'task-1388-retry-limit';
  const worktree = fs.mkdtempSync(path.join('/tmp', 'handoff-retry-limit-'));
  const missionDir = path.join(worktree, 'docs/missions/2026', slug);
  const cpPath = path.join(missionDir, 'CP-1.md');
  const taskFile = path.join(worktree, 'backlog/tasks', `${slug} - retry limit.md`);

  fs.mkdirSync(missionDir, { recursive: true });
  fs.mkdirSync(path.dirname(taskFile), { recursive: true });
  fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# MISSION.md\n\nTest mission.\n');
  fs.writeFileSync(cpPath, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| test | test/example.test.ts | PASS |\n');
  fs.writeFileSync(taskFile, '---\nstatus: active\n---\n\n# retry limit\n');

  const mockRebase = async () => ({ ok: true, sharedFileConflicts: false });

  mock.method(missionUtils, 'findMissionDir', () => missionDir);
  mock.method(missionUtils, 'findMissionArea', () => 'workflow');
  mock.method(missionUtils, 'findCheckpoints', () => [cpPath]);
  mock.method(git, 'getCurrentBranch', () => `mission/${slug}`);
  mock.method(git, 'getWorktreeStatus', () => []);
  mock.method(git, 'run', () => ({ status: 0 }));
  mock.method(git, 'git', () => ({ status: 0, stdout: '', stderr: '' }));
  mock.method(forgejo, 'readToken', () => 'fake-token');
  mock.method(forgejo, 'createPr', () => ({ ok: true, url: 'http://fake-pr' }));
  mock.method(forgejo, 'authenticatedReviewUrl', () => 'http://fake-url');
  mock.method(forgejo, 'resolveTrackingBranchSha', () => ({ ok: true, sha: 'fake-sha' }));
  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true, taskFile }));
  mock.method(backlog, 'transitionTask', () => true);

  // Gatekeeper always returns pushback (simulating artifacts never created)
  const mockGK = () => ({
    ok: false, missing: ['docs/missions/2026/task-1388-retry-limit/MISSION.md'], skipped: false, posted: true
  });

  // Mock relaunch always fails — loop should exit after 1 iteration
  let relaunchCallCount = 0;
  const mockStartAgent = async () => {
    relaunchCallCount++;
    throw new Error('relaunch failed');
  };

  writeReviewState(missionDir, 'custom', 'custom');

  try {
    const result = await performHandoff(slug, {
      missionServicesFn: stubMissionServices(),
      worktree,
      skipGate: true,
      isForgejoReviewEnabledFn: () => true,
      rebaseFn: mockRebase,
      startAgentFn: mockStartAgent,
      runGatekeeperFn: mockGK,
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.gatekeeperPushedBack, true);
    assert.ok(result.error && result.error.includes('Manual intervention required'), 'should mention manual intervention');
    // Loop exits after 1 call because relaunch failed (break in else branch)
    assert.strictEqual(relaunchCallCount, 1, 'should have attempted relaunch exactly 1 time before exiting');
  } finally {
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

test('performHandoff consumes full retry budget when relaunch succeeds but pushback persists', async (t) => {
  const { mock } = t;
  const slug = 'task-1388-retry-persists';
  const worktree = fs.mkdtempSync(path.join('/tmp', 'handoff-retry-persists-'));
  const missionDir = path.join(worktree, 'docs/missions/2026', slug);
  const cpPath = path.join(missionDir, 'CP-1.md');
  const taskFile = path.join(worktree, 'backlog/tasks', `${slug} - retry persists.md`);

  fs.mkdirSync(missionDir, { recursive: true });
  fs.mkdirSync(path.dirname(taskFile), { recursive: true });
  fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# MISSION.md\n\nTest mission.\n');
  fs.writeFileSync(cpPath, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| test | test/example.test.ts | PASS |\n');
  fs.writeFileSync(taskFile, '---\nstatus: active\n---\n\n# retry persists\n');

  const mockRebase = async () => ({ ok: true, sharedFileConflicts: false });
  let gkCallCount = 0;

  mock.method(missionUtils, 'findMissionDir', () => missionDir);
  mock.method(missionUtils, 'findMissionArea', () => 'workflow');
  mock.method(missionUtils, 'findCheckpoints', () => [cpPath]);
  mock.method(git, 'getCurrentBranch', () => `mission/${slug}`);
  mock.method(git, 'getWorktreeStatus', () => []);
  mock.method(git, 'run', () => ({ status: 0 }));
  mock.method(git, 'git', () => ({ status: 0, stdout: '', stderr: '' }));
  mock.method(forgejo, 'readToken', () => 'fake-token');
  mock.method(forgejo, 'createPr', () => ({ ok: true, url: 'http://fake-pr' }));
  mock.method(forgejo, 'authenticatedReviewUrl', () => 'http://fake-url');
  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true, taskFile }));
  mock.method(backlog, 'transitionTask', () => true);

  // Gatekeeper always returns pushback (simulating artifacts never created)
  const mockGK = () => ({
    ok: false, missing: ['docs/missions/2026/task-1388-retry-persists/MISSION.md'], skipped: false, posted: true
  });

  // Launch always succeeds but the verified handoff still fails
  let relaunchCallCount = 0;
  const mockStartAgent = async () => {
    relaunchCallCount++;
    return { agent: 'custom', result: { status: 0 } };
  };

  writeReviewState(missionDir, 'custom', 'custom');

  try {
    const result = await performHandoff(slug, {
      missionServicesFn: stubMissionServices(),
      worktree,
      skipGate: true,
      isForgejoReviewEnabledFn: () => true,
      rebaseFn: mockRebase,
      startAgentFn: mockStartAgent,
      runGatekeeperFn: mockGK,
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.gatekeeperPushedBack, true);
    assert.ok(result.error && result.error.includes('Manual intervention required'), 'should mention manual intervention');
    assert.strictEqual(relaunchCallCount, 2, 'should have attempted relaunch exactly 2 times (full budget)');
  } finally {
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

test('performHandoff succeeds after successful agent relaunch', async (t) => {
  const { mock } = t;
  const slug = 'task-1388-relaunch-success';
  const worktree = fs.mkdtempSync(path.join('/tmp', 'handoff-relaunch-success-'));
  const missionDir = path.join(worktree, 'docs/missions/2026', slug);
  const cpPath = path.join(missionDir, 'CP-1.md');
  const taskFile = path.join(worktree, 'backlog/tasks', `${slug} - relaunch success.md`);

  fs.mkdirSync(missionDir, { recursive: true });
  fs.mkdirSync(path.dirname(taskFile), { recursive: true });
  fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# MISSION.md\n\nTest mission.\n');
  fs.writeFileSync(cpPath, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| test | test/example.test.ts | PASS |\n');
  fs.writeFileSync(taskFile, '---\nstatus: active\n---\n\n# relaunch success\n');

  const mockRebase = async () => ({ ok: true, sharedFileConflicts: false });
  let gkCallCount = 0;

  mock.method(missionUtils, 'findMissionDir', () => missionDir);
  mock.method(missionUtils, 'findMissionArea', () => 'workflow');
  mock.method(missionUtils, 'findCheckpoints', () => [cpPath]);
  mock.method(git, 'getCurrentBranch', () => `mission/${slug}`);
  mock.method(git, 'getWorktreeStatus', () => []);
  mock.method(git, 'run', () => ({ status: 0 }));
  mock.method(git, 'git', () => ({ status: 0, stdout: '', stderr: '' }));
  mock.method(forgejo, 'readToken', () => 'fake-token');
  mock.method(forgejo, 'createPr', () => ({ ok: true, url: 'http://fake-pr' }));
  mock.method(forgejo, 'authenticatedReviewUrl', () => 'http://fake-url');
  mock.method(forgejo, 'resolveTrackingBranchSha', () => ({ ok: true, sha: 'fake-sha' }));
  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true, taskFile }));
  mock.method(backlog, 'transitionTask', () => true);

  // First call returns pushback, subsequent calls return ok
  const mockGK = (slugArg, opts) => {
    gkCallCount++;
    if (gkCallCount === 1) {
      return { ok: false, missing: ['docs/missions/2026/task-1388-relaunch-success/MISSION.md'], skipped: false, posted: true };
    }
    return { ok: true, missing: [], skipped: false, posted: false };
  };
  mock.method(gatekeeper, 'runGatekeeper', mockGK);

  const mockStartAgent = async () => ({ agent: 'custom', result: { status: 0 } });

  writeReviewState(missionDir, 'custom', 'custom');

  try {
    const result = await performHandoff(slug, {
      missionServicesFn: stubMissionServices(),
      worktree,
      skipGate: true,
      isForgejoReviewEnabledFn: () => true,
      rebaseFn: mockRebase,
      startAgentFn: mockStartAgent,
    });

    assert.strictEqual(result.ok, true, 'handoff should succeed after successful relaunch');
    assert.strictEqual(gkCallCount, 2, 'gatekeeper should have been called twice (initial + retry)');
  } finally {
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

test('performHandoff relaunch prompt lists all missing artifact types', async (t) => {
  const { mock } = t;
  const slug = 'task-1388-prompt-content';
  const worktree = fs.mkdtempSync(path.join('/tmp', 'handoff-prompt-'));
  const missionDir = path.join(worktree, 'docs/missions/2026', slug);
  const cpPath = path.join(missionDir, 'CP-1.md');
  const taskFile = path.join(worktree, 'backlog/tasks', `${slug} - prompt content.md`);

  fs.mkdirSync(missionDir, { recursive: true });
  fs.mkdirSync(path.dirname(taskFile), { recursive: true });
  fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# MISSION.md\n\nTest mission.\n');
  fs.writeFileSync(cpPath, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| test | test/example.test.ts | PASS |\n');
  fs.writeFileSync(taskFile, '---\nstatus: active\n---\n\n# prompt content\n');

  const mockRebase = async () => ({ ok: true, sharedFileConflicts: false });
  let capturedPrompt = null;

  mock.method(missionUtils, 'findMissionDir', () => missionDir);
  mock.method(missionUtils, 'findMissionArea', () => 'workflow');
  mock.method(missionUtils, 'findCheckpoints', () => [cpPath]);
  mock.method(git, 'getCurrentBranch', () => `mission/${slug}`);
  mock.method(git, 'getWorktreeStatus', () => []);
  mock.method(git, 'run', () => ({ status: 0 }));
  mock.method(git, 'git', () => ({ status: 0, stdout: '', stderr: '' }));
  mock.method(forgejo, 'readToken', () => 'fake-token');
  mock.method(forgejo, 'createPr', () => ({ ok: true, url: 'http://fake-pr' }));
  mock.method(forgejo, 'authenticatedReviewUrl', () => 'http://fake-url');
  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true, taskFile }));
  mock.method(backlog, 'transitionTask', () => true);
  mock.method(gatekeeper, 'runGatekeeper', () => ({
    ok: false,
    missing: [
      'docs/missions/2026/task-1388-prompt-content/MISSION.md',
      'docs/missions/2026/task-1388-prompt-content/CP-*.md (at least one checkpoint document)',
      'backlog/tasks/task-1388-prompt-content - *.md'
    ],
    skipped: false, posted: true
  }));

  // The kernel builds the fix prompt and passes it to the launch port.
  const mockStartAgent = async (_step, opts) => {
    const slot = opts && opts.prompt;
    capturedPrompt = typeof slot === 'function' ? slot('custom') : (slot ?? null);
    throw new Error('not available');
  };

  writeReviewState(missionDir, 'custom', 'custom');

  try {
    await performHandoff(slug, {
      missionServicesFn: stubMissionServices(),
      worktree,
      skipGate: true,
      isForgejoReviewEnabledFn: () => true,
      rebaseFn: mockRebase,
      startAgentFn: mockStartAgent,
    });

    assert.ok(capturedPrompt, 'prompt should have been captured');
    assert.ok(capturedPrompt.includes('MISSION.md'), 'prompt should list MISSION.md');
    assert.ok(capturedPrompt.includes('CP-'), 'prompt should list CP-*.md');
    assert.ok(capturedPrompt.includes('backlog/tasks'), 'prompt should list backlog task file');
    assert.ok(capturedPrompt.includes('create'), 'prompt should contain creation keyword');
    assert.ok(capturedPrompt.includes('frontmatter'), 'prompt should mention frontmatter for task file');
    assert.ok(capturedPrompt.includes('Goal Check'), 'prompt should mention Goal Check for checkpoints');
  } finally {
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

// ── task-2215: auto-generated checkpoint must pass evidence validation ────────

test('buildAutoCheckpointContent produces verifiable evidence rows', () => {
  const rootDir = path.join(import.meta.dirname, '..');

  const content = handoffModule._buildAutoCheckpointContent('task-2215');
  assert.match(content, /^## Goal Check$/m, 'template must contain the ## Goal Check heading');
  assert.ok(content.includes('buildAutoCheckpointContent'),
    'evidence must cite the auto-remediation symbol, not the removed handoff.js');
  assert.ok(!content.includes('handoff.js auto-remediation'),
    'template must not cite the non-existent handoff.js');
  assert.doesNotMatch(content, /\.ts:\d+/,
    'evidence must not pin a line number: it goes stale on any unrelated edit to the cited file');

  const goalCheckMatch = content.match(/^## Goal Check(?: Table)?\s*$/m);
  const afterHeader = content.slice((goalCheckMatch.index ?? 0) + goalCheckMatch[0].length);
  const evidenceRows = handoffModule._collectGoalCheckEvidenceRows(afterHeader);
  assert.ok(evidenceRows.length >= 2, 'template must produce at least two evidence rows');

  const offendingRow = handoffModule._findUnverifiableGoalCheckRow(evidenceRows, rootDir);
  assert.equal(offendingRow, null,
    `every evidence row must cite a verifiable reference; offending row: ${offendingRow}`);
});
