import { agentFamily } from '../../../src/domain/agents.js';
import { missionVersion } from '../../../src/application/domain-ports.js';
import { fixtureMission, pendingReview } from '../../fixtures/mission-builders.js';
import { missionVersion as fixtureVersion } from '../../../src/application/domain-ports.js';
import type { RecordHandoffNelRequest } from "../../../src/application/mission-handoff-service.js";

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import { findUnverifiableGoalCheckRow } from '../../../src/application/static-evidence.js';
import { mockModule, installModuleMocks } from '../../lib/module-mock.js';
import { stubMissionServices } from '../../helpers/stub-mission-services.js';
const handoffModule = mockModule<typeof import('../../../src/adapters/cli/commands/handoff.js')>('../../../src/adapters/cli/commands/handoff.js', import.meta.url);
const git = mockModule<typeof import('../../../src/adapters/git/git.js')>('../../../src/adapters/git/git.js', import.meta.url);
const missionUtils = mockModule<typeof import('../../../src/adapters/filesystem/mission-utils.js')>('../../../src/adapters/filesystem/mission-utils.js', import.meta.url);
const backlog = mockModule<typeof import('../../../src/adapters/backlog/backlog.js')>('../../../src/adapters/backlog/backlog.js', import.meta.url);
// Sub-modules must be declared so they re-link with the facaded git binding
const forgejoGit = mockModule<typeof import('../../../src/adapters/forgejo/forgejo-git.js')>('../../../src/adapters/forgejo/forgejo-git.js', import.meta.url);
const forgejoPr = mockModule<typeof import('../../../src/adapters/forgejo/forgejo-pr.js')>('../../../src/adapters/forgejo/forgejo-pr.js', import.meta.url);
const forgejo = mockModule<typeof import('../../../src/adapters/forgejo/forgejo.js')>('../../../src/adapters/forgejo/forgejo.js', import.meta.url);
const setupReview = mockModule<typeof import('../../../src/adapters/review/setup-review.js')>('../../../src/adapters/review/setup-review.js', import.meta.url);
const gatekeeper = mockModule<typeof import('../../../src/adapters/verification/gatekeeper.js')>('../../../src/adapters/verification/gatekeeper.js', import.meta.url);
const worktree = mockModule<typeof import('../../../src/adapters/git/worktree.js')>('../../../src/adapters/git/worktree.js', import.meta.url);
await installModuleMocks();
const { createHandoffPorts, verifyHandoff, performHandoff, _findUnverifiableGoalCheckRow, runDeclaredGates, captureNelAtHandoff, validateDeclaredGates } = handoffModule;
const { mock } = test;
// Each case owns its files, including when another worktree runs this suite.
let handoffRoot: string;
test.beforeEach(() => {
  handoffRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-case-'));
});
test.afterEach(() => {
  mock.restoreAll();
  fs.rmSync(handoffRoot, { recursive: true, force: true });
});

test('evidence shell commands require an existing file argument', () => {
  const rootDir = '/repo';
  const fileSystem = {
    existsSync: target => target === '/repo/package.json',
    readText: () => { throw new Error('Evidence command validation must not read repository files'); },
    listEntries: () => [],
    listNames: () => [],
  } satisfies NonNullable<Parameters<typeof findUnverifiableGoalCheckRow>[0]>;
  const bareCommandRow = '| Criterion | `cat` | PASS |';
  const fileCommandRow = '| Criterion | `cat package.json` | PASS |';

  assert.equal(findUnverifiableGoalCheckRow(fileSystem, [bareCommandRow], rootDir), bareCommandRow);
  assert.equal(findUnverifiableGoalCheckRow(fileSystem, [fileCommandRow], rootDir), null);
  const missingFileRow = '| Criterion | `cat missing.json` | PASS |';
  assert.equal(findUnverifiableGoalCheckRow(fileSystem, [missingFileRow], rootDir), missingFileRow);
});

test('evidence accepts git commands inside escaped-backtick markdown cells', () => {
  const rootDir = path.join(import.meta.dirname, '..', '..', '..');
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
function writeReviewState(missionDir: fs.PathLike, reviewer: string, implementer: string) {
  fs.mkdirSync(missionDir, { recursive: true });
  mock.method(backlog, 'getTaskImplementer', () => implementer);
  mock.method(backlog, 'getTaskAssignee', () => implementer);
}

test('verifyHandoff fails when mission directory is not found', () => {
  const result = verifyHandoff('non-existent-slug-999');
  assert.strictEqual(result.ok, false);
  assert.ok(result.error);
  assert.match(result.error, /Mission directory not found/);
});

test('performHandoff uses provided worktree and fails hard on Backlog missing', async (t) => {
  const slug = 'task-098';
  const worktree = `${handoffRoot}/fake-worktree`;

  // Mocking
  mock.method(missionUtils, 'findMissionDir', (s: Parameters<(typeof missionUtils)["findMissionDir"]>[0], root: Parameters<(typeof missionUtils)["findMissionDir"]>[1]) => {
    if (s === slug && root === worktree) return `${handoffRoot}/fake-worktree/docs/missions/2026/task-098`;
    return null;
  });
  mock.method(missionUtils, 'findMissionArea', () => 'docs');
  mock.method(git, 'getCurrentBranch', (root: Parameters<(typeof git)["getCurrentBranch"]>[0]) => {
    if (root === worktree) return 'mission/task-098';
    return 'main';
  });
  mock.method(git, 'run', (cmd: Parameters<(typeof git)["run"]>[0], args: Parameters<(typeof git)["run"]>[1], opts: Parameters<(typeof git)["run"]>[2]) => {
    if (opts?.cwd === worktree) return { signal: null, stdout: '', stderr: '',  status: 0 };
    return { signal: null, stdout: '', stderr: '',  status: 1 };
  });
  mock.method(git, 'git', (args: Parameters<(typeof git)["git"]>[0], opts: Parameters<(typeof git)["git"]>[1]) => {
    // Should NOT push to origin
    if (args.includes('origin')) {
        return assert.fail('Should not push to origin during handoff');
    }
    return { signal: null, stdout: '', stderr: '',  status: 0 };
  });
  mock.method(forgejo, 'readToken', () => 'fake-token');
  mock.method(forgejo, 'createPr', (branch: Parameters<(typeof forgejo)["createPr"]>[0], user: Parameters<(typeof forgejo)["createPr"]>[1], token: Parameters<(typeof forgejo)["createPr"]>[2], opts: Parameters<(typeof forgejo)["createPr"]>[3]) => {
    if (opts?.rootDir === worktree) return { ok: true as const, url: 'http://fake-pr' };
    return { ok: false as const, error: 'wrong rootDir' };
  });
  mock.method(forgejo, 'authenticatedReviewUrl', () => 'http://fake-url');

  const missionDir = `${handoffRoot}/fake-worktree/docs/missions/2026/task-098`;
  const missionMdPath = path.join(missionDir, 'MISSION.md');
  fs.mkdirSync(missionDir, { recursive: true });
  fs.writeFileSync(missionMdPath, '# MISSION.md\n\nTest mission.\n');

  mock.method(backlog, 'resolveTaskFile', (s: Parameters<(typeof backlog)["resolveTaskFile"]>[0], root: Parameters<(typeof backlog)["resolveTaskFile"]>[1]) => {
    if (s === slug && root === worktree) return { ok: false as const, reason: 'missing' as const };
    return { ok: true as const, taskFile: 'found' };
  });
  writeReviewState(`${handoffRoot}/fake-worktree/docs/missions/2026/task-098`, 'claude', 'claude');

  const result = await performHandoff(slug, { worktree, skipGate: true, missionServicesFn: stubMissionServices() });
  assert.strictEqual(result.ok, false);
  assert.ok(result.error);
  assert.match(result.error, /Backlog task file for task-098 not found or ambiguous/);

  fs.rmSync(missionMdPath, { force: true });
});

test('performHandoff skips commit in Step 4 when Backlog transition already committed', async (t) => {
  const slug = 'task-098';
  const worktree = `${handoffRoot}/fake-worktree`;
  const cpPath = `${handoffRoot}/fake-worktree/docs/missions/2026/task-098/CP-1.md`;

  mock.method(missionUtils, 'findMissionDir', () => `${handoffRoot}/fake-worktree/docs/missions/2026/task-098`);
  mock.method(missionUtils, 'findMissionArea', () => 'docs');
  mock.method(missionUtils, 'findCheckpoints', () => [cpPath]);
  mock.method(git, 'getCurrentBranch', () => 'mission/task-098');
  mock.method(git, 'getWorktreeStatus', () => []);
  mock.method(git, 'run', () => ({ signal: null, stdout: '', stderr: '',  status: 0 }));
  mock.method(git, 'git', (args: Parameters<(typeof git)["git"]>[0]) => {
    if (args.includes('rev-parse') && args.includes('HEAD')) return { signal: null,  status: 0, stdout: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n', stderr: '' };
    if (args.includes('origin')) return assert.fail('Should not push to origin');
    if (args.includes('commit')) return assert.fail('Should not commit when diff --cached shows nothing staged');
    // diff --cached --quiet exits 0 = nothing staged
    if (args.includes('--cached') && args.includes('--quiet')) return { signal: null, stdout: '', stderr: '',  status: 0 };
    return { signal: null, stdout: '', stderr: '',  status: 0 };
  });
  mock.method(forgejo, 'readToken', () => 'fake-token');
  mock.method(forgejo, 'createPr', () => ({ ok: true as const, url: 'http://fake-pr' }));
  mock.method(forgejo, 'authenticatedReviewUrl', () => 'http://fake-url');
  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true as const, taskFile: '/tmp/fake-task' }));
  mock.method(backlog, 'transitionTask', () => true);
  mock.method(gatekeeper, 'runGatekeeper', () => ({ ok: true as const, missing: [], skipped: false, posted: false }));

  // Provide a valid checkpoint file with Goal Check table for the new integrity gate
  const missionDir = `${handoffRoot}/fake-worktree/docs/missions/2026/task-098`;
  const missionMdPath = path.join(missionDir, 'MISSION.md');
  writeReviewState(missionDir, 'codex', 'codex');
  fs.writeFileSync(missionMdPath, '# MISSION.md\n\nTest mission.\n');
  fs.writeFileSync(cpPath, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| test | `npm test -- test/example.test.ts` | PASS |\n');

  const result = await performHandoff(slug, { worktree, skipGate: true, missionServicesFn: stubMissionServices() });
  assert.strictEqual(result.ok, true);

  mock.method(git, 'git', (args: Parameters<(typeof git)["git"]>[0]) => ({ signal: null,  status: args.includes('rev-parse') ? 1 : 0, stdout: '', stderr: '' }));
  const missingHead = await performHandoff(slug, { worktree, skipGate: true, missionServicesFn: stubMissionServices() });
  assert.equal(missingHead.ok, false);
  assert.ok(missingHead.error);
  assert.match(missingHead.error, /Cannot capture the HEAD commit/);


  fs.rmSync(cpPath, { force: true });
  fs.rmSync(missionMdPath, { force: true });
});

test('performHandoff refreshes the review tracking ref and lease-updates the rebased PR branch after its Backlog transition', async (t) => {
  const slug = 'task-098';
  const worktree = `${handoffRoot}/fake-worktree`;
  const cpPath = `${handoffRoot}/fake-worktree/docs/missions/2026/task-098/CP-1.md`;
  const gitCalls: string[][] = [];

  mock.method(missionUtils, 'findMissionDir', () => `${handoffRoot}/fake-worktree/docs/missions/2026/task-098`);
  mock.method(missionUtils, 'findMissionArea', () => 'docs');
  mock.method(missionUtils, 'findCheckpoints', () => [cpPath]);
  mock.method(git, 'getCurrentBranch', () => 'mission/task-098');
  mock.method(git, 'getWorktreeStatus', () => []);
  mock.method(git, 'run', () => ({ signal: null, stdout: '', stderr: '',  status: 0 }));
  mock.method(git, 'git', (args: Parameters<(typeof git)["git"]>[0]) => {
    if (args.includes('rev-parse') && args.includes('HEAD')) return { signal: null,  status: 0, stdout: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n', stderr: '' };
    gitCalls.push(args);
    if (args.includes('fetch')) return { signal: null,  status: 0, stdout: '', stderr: '' };
    if (args.includes('rev-parse')) return { signal: null,  status: 0, stdout: 'lease-sha\n', stderr: '' };
    return { signal: null,  status: 0, stdout: '', stderr: '' };
  });
  mock.method(forgejo, 'readToken', () => 'fake-token');
  mock.method(forgejo, 'createPr', () => ({ ok: true as const, url: 'http://fake-pr' }));
  mock.method(forgejo, 'authenticatedReviewUrl', () => 'http://fake-url');
  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true as const, taskFile: '/tmp/fake-task' }));
  mock.method(backlog, 'transitionTask', () => true);
  mock.method(gatekeeper, 'runGatekeeper', () => ({ ok: true as const, missing: [], skipped: false, posted: false }));

  const missionDir = `${handoffRoot}/fake-worktree/docs/missions/2026/task-098`;
  const missionMdPath = path.join(missionDir, 'MISSION.md');
  // performHandoff refuses to run without a resolvable agent family. Declare
  // this test's own review identity instead of inheriting the previous test's
  // mocks, which `mock.restoreAll()` clears between tests.
  writeReviewState(missionDir, 'codex', 'codex');
  fs.writeFileSync(missionMdPath, '# MISSION.md\n\nTest mission.\n');
  fs.writeFileSync(cpPath, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| test | `npm test -- test/example.test.ts` | PASS |\n');

  const mockRebase = async () => ({ ok: true as const, sharedFileConflicts: false });
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
  const gitCalls: string[][] = [];

  fs.mkdirSync(missionDir, { recursive: true });
  fs.mkdirSync(path.dirname(taskFile), { recursive: true });
  fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# MISSION.md\n\nTest mission.\n');
  fs.writeFileSync(cpPath, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| test | `npm test -- test/example.test.ts` | PASS |\n');
  fs.writeFileSync(taskFile, '---\nstatus: active\n---\n\n# token fallback\n');

  mock.method(missionUtils, 'findMissionDir', () => missionDir);
  mock.method(missionUtils, 'findMissionArea', () => 'workflow');
  mock.method(missionUtils, 'findCheckpoints', () => [cpPath]);
  mock.method(git, 'getCurrentBranch', () => `mission/${slug}`);
  mock.method(git, 'getWorktreeStatus', () => []);
  mock.method(git, 'run', () => ({ signal: null, stdout: '', stderr: '',  status: 0 }));
  mock.method(git, 'git', (args: Parameters<(typeof git)["git"]>[0]) => {
    if (args.includes('rev-parse') && args.includes('HEAD')) return { signal: null,  status: 0, stdout: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n', stderr: '' };
    gitCalls.push(args);
    return { signal: null,  status: 0, stdout: '', stderr: '' };
  });
  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true as const, taskFile }));
  mock.method(backlog, 'transitionTask', (taskSlug: Parameters<(typeof backlog)["transitionTask"]>[0], status: Parameters<(typeof backlog)["transitionTask"]>[1], options: Parameters<(typeof backlog)["transitionTask"]>[2]) => {
    assert.equal(taskSlug, slug);
    assert.equal(status, 'review');
    assert.ok(options != null);
    assert.equal(options.implementer, 'custom');
    return true;
  });
  mock.method(forgejo, 'readToken', (user: Parameters<(typeof forgejo)["readToken"]>[0]) => (user === 'human' ? 'human-token' : null));
  mock.method(forgejo, 'resolveForgejoSettings', () => ({
    url: 'http://localhost:3300',
    repo: 'human/visualboard',
  }));
  mock.method(setupReview, 'bootstrapReviewSurface', async () => ({
    ok: false as const,
    error: 'No owner token found for human at /tmp/no-token',
  }));
  mock.method(forgejo, 'createPr', (branch: Parameters<(typeof forgejo)["createPr"]>[0], user: Parameters<(typeof forgejo)["createPr"]>[1], token: Parameters<(typeof forgejo)["createPr"]>[2], opts: Parameters<(typeof forgejo)["createPr"]>[3]) => {
    assert.equal(branch, `mission/${slug}`);
    assert.equal(user, 'human');
    assert.equal(token, 'human-token');
    assert.ok(opts != null);
    assert.equal(opts.forceWithLease, true);
    return { ok: true as const, url: 'http://fake-pr' };
  });
  mock.method(forgejo, 'authenticatedReviewUrl', (user: Parameters<(typeof forgejo)["authenticatedReviewUrl"]>[0], token: Parameters<(typeof forgejo)["authenticatedReviewUrl"]>[1]) => {
    assert.equal(user, 'human');
    assert.equal(token, 'human-token');
    return 'http://fake-url';
  });
  mock.method(forgejo, 'resolveTrackingBranchSha', () => ({ ok: true as const, sha: 'lease-sha' }));
  mock.method(gatekeeper, 'runGatekeeper', () => ({ ok: true as const, missing: [], skipped: false, posted: false }));
  writeReviewState(missionDir, 'custom', 'custom');

  try {
    const mockRebase = async () => ({ ok: true as const, sharedFileConflicts: false });
    const result = await performHandoff(slug, {
      missionServicesFn: stubMissionServices({ store: { load: async id => ({ kind: 'found' as const, mission: fixtureMission(id, { assignee: agentFamily('custom'), checkpoints: [] }), version: missionVersion(1) }) } }),
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
    assert.ok(gitCalls.some(args => args.includes('commit') && args.includes(`backlog(${slug}): set fallback summary\n\nParallix-Bookkeeping: backlog-mirror`)));
  } finally {
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

test('performHandoff fails hard when git commit fails in Step 4', async (t) => {
    const slug = 'task-098';
    const worktree = `${handoffRoot}/fake-worktree`;
    const cpPath = `${handoffRoot}/fake-worktree/docs/missions/2026/task-098/CP-1.md`;

    // Mocking
    mock.method(missionUtils, 'findMissionDir', () => `${handoffRoot}/fake-worktree/docs/missions/2026/task-098`);
    mock.method(missionUtils, 'findMissionArea', () => 'docs');
    mock.method(missionUtils, 'findCheckpoints', () => [cpPath]);
    mock.method(git, 'getCurrentBranch', () => 'mission/task-098');
    mock.method(git, 'getWorktreeStatus', () => []);
    mock.method(git, 'run', () => ({ signal: null, stdout: '', stderr: '',  status: 0 }));
    mock.method(git, 'git', (args: Parameters<(typeof git)["git"]>[0]) => {
    if (args.includes('rev-parse') && args.includes('HEAD')) return { signal: null,  status: 0, stdout: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n', stderr: '' };
        if (args.includes('origin')) return assert.fail('Should not push to origin');
        if (args.includes('commit')) return { signal: null, stdout: '', stderr: '',  status: 1 }; // Step 4 Commit fail
        // diff --cached --quiet exits 1 = staged changes exist, proceed to commit
        if (args.includes('--cached') && args.includes('--quiet')) return { signal: null, stdout: '', stderr: '',  status: 1 };
        return { signal: null, stdout: '', stderr: '',  status: 0 };
    });
    mock.method(forgejo, 'readToken', () => 'fake-token');
    mock.method(forgejo, 'createPr', () => ({ ok: true as const, url: 'http://fake-pr' }));
    mock.method(forgejo, 'authenticatedReviewUrl', () => 'http://fake-url');
    mock.method(backlog, 'resolveTaskFile', () => ({ ok: true as const, taskFile: '/tmp/fake-task' }));
    mock.method(backlog, 'transitionTask', () => false);
    mock.method(gatekeeper, 'runGatekeeper', () => ({ ok: true as const, missing: [], skipped: false, posted: false }));
   // Provide a valid checkpoint file with Goal Check table for the new integrity gate
    const missionDir = `${handoffRoot}/fake-worktree/docs/missions/2026/task-098`;
    const missionMdPath = path.join(missionDir, 'MISSION.md');
    fs.mkdirSync(missionDir, { recursive: true });
    writeReviewState(missionDir, 'claude', 'claude');
    fs.writeFileSync(missionMdPath, '# MISSION.md\n\nTest mission.\n');
    fs.writeFileSync(cpPath, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| test | `npm test -- test/example.test.ts` | PASS |\n');

    const result = await performHandoff(slug, { worktree, skipGate: true, missionServicesFn: stubMissionServices() });
    assert.strictEqual(result.ok, false);
    assert.ok(result.error);
    assert.match(result.error, /Could not transition task task-098 to review/);

    fs.rmSync(cpPath, { force: true });
    fs.rmSync(missionMdPath, { force: true });
});

test('verifyHandoff accepts a typed mission without MISSION.md', () => {
  const slug = 'task-098';
  const worktree = `${handoffRoot}/fake-worktree-missing-mm`;
  const missionDir = `${handoffRoot}/fake-worktree-missing-mm/docs/missions/2026/task-098`;

  mock.method(missionUtils, 'findMissionDir', () => missionDir);
  mock.method(missionUtils, 'findMissionArea', () => 'docs');
  mock.method(git, 'getCurrentBranch', () => 'mission/task-098');

  const result = verifyHandoff(slug, { worktree });
  assert.strictEqual(result.ok, true);
});

for (const missing of ['contract', 'checkpoint'] as const) {
  test(`performHandoff rejects missing historical ${missing} evidence (TASK-2746)`, async (t) => {
    const slug = 'task-098';
    const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-missing-evidence-'));
    t.after(() => fs.rmSync(worktree, { recursive: true, force: true }));
    const missionDir = path.join(worktree, 'docs/missions/2026/task-098');

    mock.method(missionUtils, 'findMissionDir', () => missionDir);
    mock.method(missionUtils, 'findMissionArea', () => 'docs');
    mock.method(missionUtils, 'findCheckpoints', () => [`${missionDir}/CP-1.md`]);
    mock.method(git, 'getCurrentBranch', () => 'mission/task-098');
    mock.method(git, 'getWorktreeStatus', () => []);
    mock.method(backlog, 'resolveTaskFile', () => ({ ok: true as const, taskFile: '/tmp/fake-task' }));
    writeReviewState(missionDir, 'claude', 'claude');

    if (missing === 'contract') {
      fs.writeFileSync(path.join(missionDir, 'CP-1.md'), '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| test | `npm test` | PASS |\n');
    } else {
      fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Historical contract\n');
    }
    const rebaseFn = t.mock.fn(async () => { throw new Error('Rebase must not run before evidence validation'); });
    const exec = t.mock.method(childProcess, 'spawnSync', () => { throw new Error('No external effects before evidence validation'); });
    const result = await performHandoff(slug, { worktree, skipGate: true, missionServicesFn: stubMissionServices(), rebaseFn });
    assert.strictEqual(result.ok, false);
    assert.ok(result.error);
    assert.match(result.error, missing === 'contract' ? /MISSION\.md not found.*Import the historical contract/ : /CP-1\.md.*was not found/);
    assert.equal(rebaseFn.mock.callCount(), 0);
    assert.equal(exec.mock.callCount(), 0);
  });
}

test('performHandoff succeeds with ## Goal Check Table heading variant', async (t) => {
  const slug = 'task-098';
  const worktree = `${handoffRoot}/fake-worktree-gct`;
  const missionDir = `${handoffRoot}/fake-worktree-gct/docs/missions/2026/task-098`;
  const cpPath = `${missionDir}/CP-1.md`;

  mock.method(missionUtils, 'findMissionDir', () => missionDir);
  mock.method(missionUtils, 'findMissionArea', () => 'docs');
  mock.method(missionUtils, 'findCheckpoints', () => [cpPath]);
  mock.method(git, 'getCurrentBranch', () => 'mission/task-098');
  mock.method(git, 'getWorktreeStatus', () => []);
  mock.method(git, 'run', () => ({ signal: null, stdout: '', stderr: '',  status: 0 }));
  mock.method(git, 'git', (args: Parameters<(typeof git)["git"]>[0]) => {
    if (args.includes('rev-parse') && args.includes('HEAD')) return { signal: null,  status: 0, stdout: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n', stderr: '' };
    if (args.includes('origin')) return assert.fail('Should not push to origin');
    if (args.includes('--cached') && args.includes('--quiet')) return { signal: null, stdout: '', stderr: '',  status: 0 };
    return { signal: null, stdout: '', stderr: '',  status: 0 };
  });
  mock.method(forgejo, 'readToken', () => 'fake-token');
  mock.method(forgejo, 'createPr', () => ({ ok: true as const, url: 'http://fake-pr' }));
  mock.method(forgejo, 'authenticatedReviewUrl', () => 'http://fake-url');
  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true as const, taskFile: '/tmp/fake-task' }));
  mock.method(backlog, 'transitionTask', () => true);

  const missionMdPath = path.join(missionDir, 'MISSION.md');
  fs.mkdirSync(missionDir, { recursive: true });
  writeReviewState(missionDir, 'claude', 'claude');
  fs.writeFileSync(missionMdPath, '# MISSION.md\n\nTest mission.\n');
  fs.writeFileSync(cpPath, '# CP-1\n\n## Goal Check Table\n\n| Criteria | Evidence | Status |\n|----------|----------|--------|\n| test | `npm test -- test/example.test.ts` | PASS |\n');

  const result = await performHandoff(slug, { worktree, skipGate: true, missionServicesFn: stubMissionServices() });
  assert.strictEqual(result.ok, true);

  fs.rmSync(cpPath, { force: true });
  fs.rmSync(missionMdPath, { force: true });
});

test('performHandoff fails when MISSION.md is uncommitted', async () => {
  const slug = 'task-098';
  const worktree = `${handoffRoot}/fake-worktree`;
  const missionDir = `${handoffRoot}/fake-worktree/docs/missions/2026/task-098`;
  const missionMdPath = path.join(missionDir, 'MISSION.md');
  const cpPath = `${missionDir}/CP-1.md`;

  mock.method(missionUtils, 'findMissionDir', () => missionDir);
  mock.method(missionUtils, 'findMissionArea', () => 'docs');
  mock.method(missionUtils, 'findCheckpoints', () => [cpPath]);
  mock.method(git, 'getCurrentBranch', () => 'mission/task-098');
  mock.method(git, 'getWorktreeStatus', () => [' M docs/missions/2026/task-098/MISSION.md']);
  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true as const, taskFile: '/tmp/fake-task' }));

  fs.mkdirSync(missionDir, { recursive: true });
  fs.writeFileSync(missionMdPath, '# MISSION.md\n\nTest mission.\n');
  fs.writeFileSync(cpPath, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| test | `npm test -- test/example.test.ts` | PASS |\n');
  writeReviewState(missionDir, 'claude', 'claude');

  const result = await performHandoff(slug, { worktree, skipGate: true, missionServicesFn: stubMissionServices() });
  assert.strictEqual(result.ok, false);
  assert.ok(result.error);
  assert.match(result.error, /MISSION\.md is modified but uncommitted/);

  fs.rmSync(cpPath, { force: true });
  fs.rmSync(missionMdPath, { force: true });
});

test('performHandoff fails when no checkpoint documents exist', async () => {
  const slug = 'task-098';
  const worktree = `${handoffRoot}/fake-worktree`;
  const missionDir = `${handoffRoot}/fake-worktree/docs/missions/2026/task-098`;
  const missionMdPath = path.join(missionDir, 'MISSION.md');

  mock.method(missionUtils, 'findMissionDir', () => missionDir);
  mock.method(missionUtils, 'findMissionArea', () => 'docs');
  mock.method(missionUtils, 'findCheckpoints', () => []);
  mock.method(git, 'getCurrentBranch', () => 'mission/task-098');
  mock.method(git, 'getWorktreeStatus', () => []);
  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true as const, taskFile: '/tmp/fake-task' }));

  fs.mkdirSync(missionDir, { recursive: true });
  fs.writeFileSync(missionMdPath, '# MISSION.md\n\nTest mission.\n');
  writeReviewState(missionDir, 'claude', 'claude');

  const result = await performHandoff(slug, { worktree, skipGate: true, missionServicesFn: stubMissionServices() });
  assert.strictEqual(result.ok, false);
  assert.ok(result.error);
  assert.match(result.error, /No checkpoint documents found/);

  fs.rmSync(missionMdPath, { force: true });
});

test('legacy handoff fails closed without synthesizing or committing checkpoint evidence', async () => {
  const slug = 'task-1228-autoremediate';
  const worktree = fs.mkdtempSync(path.join('/tmp', 'handoff-autoremediate-'));
  const missionDir = path.join(worktree, 'docs/missions/2026', slug);
  const autoCpPath = path.join(missionDir, 'CP-1.md');
  const gitCalls: string[][] = [];

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
  mock.method(git, 'run', () => ({ signal: null, stdout: '', stderr: '',  status: 0 }));
  mock.method(git, 'git', (args: Parameters<(typeof git)["git"]>[0]) => {
    if (args.includes('rev-parse') && args.includes('HEAD')) return { signal: null,  status: 0, stdout: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n', stderr: '' };
    gitCalls.push(args);
    return { signal: null,  status: 0, stdout: '', stderr: '' };
  });
  mock.method(forgejo, 'readToken', () => 'fake-token');
  mock.method(forgejo, 'createPr', () => ({ ok: true as const, url: 'http://fake-pr' }));
  mock.method(forgejo, 'authenticatedReviewUrl', () => 'http://fake-url');
  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true as const, taskFile: '/tmp/fake-task' }));
  mock.method(backlog, 'transitionTask', () => true);
  mock.method(gatekeeper, 'runGatekeeper', () => ({ ok: true as const, missing: [], skipped: false, posted: false }));

  try {
    writeReviewState(missionDir, 'claude', 'claude');
    const result = await performHandoff(slug, { worktree, skipGate: true, missionServicesFn: stubMissionServices() });

    assert.strictEqual(result.ok, false);
    assert.ok(result.error);
    assert.match(result.error, /No checkpoint documents found/);

    assert.equal(fs.existsSync(autoCpPath), false, 'Handoff must not write checkpoint evidence');
    assert.equal(gitCalls.some(args => args.includes('commit')), false, 'Missing evidence must not trigger a commit');
    assert.equal(findCheckpointsCalls, 1);
  } finally {
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

test('performHandoff fails when the latest checkpoint document is uncommitted', async () => {
  const slug = 'task-098';
  const worktree = `${handoffRoot}/fake-worktree`;
  const missionDir = `${handoffRoot}/fake-worktree/docs/missions/2026/task-098`;
  const missionMdPath = path.join(missionDir, 'MISSION.md');
  const cp1Path = `${missionDir}/CP-1.md`;
  const cp2Path = `${missionDir}/CP-2.md`;

  mock.method(missionUtils, 'findMissionDir', () => missionDir);
  mock.method(missionUtils, 'findMissionArea', () => 'docs');
  mock.method(missionUtils, 'findCheckpoints', () => [cp1Path, cp2Path]);
  mock.method(git, 'getCurrentBranch', () => 'mission/task-098');
  mock.method(git, 'getWorktreeStatus', () => [' M docs/missions/2026/task-098/CP-2.md']);
  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true as const, taskFile: '/tmp/fake-task' }));

  fs.mkdirSync(missionDir, { recursive: true });
  fs.writeFileSync(missionMdPath, '# MISSION.md\n\nTest mission.\n');
  fs.writeFileSync(cp1Path, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| test | `npm test -- test/example.test.ts` | PASS |\n');
  fs.writeFileSync(cp2Path, '# CP-2\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| test | `npm test -- test/example.test.ts` | PASS |\n');
  writeReviewState(missionDir, 'claude', 'claude');

  const result = await performHandoff(slug, { worktree, skipGate: true, missionServicesFn: stubMissionServices() });
  assert.strictEqual(result.ok, false);
  assert.ok(result.error);
  assert.match(result.error, /latest checkpoint document is modified but uncommitted/);

  fs.rmSync(cp1Path, { force: true });
  fs.rmSync(cp2Path, { force: true });
  fs.rmSync(missionMdPath, { force: true });
});

test('performHandoff fails when final checkpoint is missing Goal Check section', async () => {
  const slug = 'task-098';
  const worktree = `${handoffRoot}/fake-worktree`;
  const missionDir = `${handoffRoot}/fake-worktree/docs/missions/2026/task-098`;
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

  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true as const, taskFile: '/tmp/fake-task' }));

  const result = await performHandoff(slug, { worktree, skipGate: true, missionServicesFn: stubMissionServices() });
  assert.strictEqual(result.ok, false);
  assert.ok(result.error);
  assert.match(result.error, /missing a "## Goal Check" section/);

  fs.rmSync(cpPath, { force: true });
  fs.rmSync(missionMdPath, { force: true });
});

test('performHandoff fails when final checkpoint has Goal Check section but no evidence rows', async () => {
  const slug = 'task-098';
  const worktree = `${handoffRoot}/fake-worktree`;
  const missionDir = `${handoffRoot}/fake-worktree/docs/missions/2026/task-098`;
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

  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true as const, taskFile: '/tmp/fake-task' }));

  const result = await performHandoff(slug, { worktree, skipGate: true, missionServicesFn: stubMissionServices() });
  assert.strictEqual(result.ok, false);
  assert.ok(result.error);
  assert.match(result.error, /no evidence rows/);

  fs.rmSync(cpPath, { force: true });
  fs.rmSync(missionMdPath, { force: true });
});

test('performHandoff fails when final checkpoint has header-only goal-check table (no evidence rows)', async () => {
  const slug = 'task-098';
  const worktree = `${handoffRoot}/fake-worktree`;
  const missionDir = `${handoffRoot}/fake-worktree/docs/missions/2026/task-098`;
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

  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true as const, taskFile: '/tmp/fake-task' }));

  const result = await performHandoff(slug, { worktree, skipGate: true, missionServicesFn: stubMissionServices() });
  assert.strictEqual(result.ok, false);
  assert.ok(result.error);
  assert.match(result.error, /no evidence rows/);

  fs.rmSync(cpPath, { force: true });
  fs.rmSync(missionMdPath, { force: true });
});

test('performHandoff fails when final checkpoint has separator-only goal-check table', async () => {
  const slug = 'task-098';
  const worktree = `${handoffRoot}/fake-worktree`;
  const missionDir = `${handoffRoot}/fake-worktree/docs/missions/2026/task-098`;
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

  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true as const, taskFile: '/tmp/fake-task' }));

  const result = await performHandoff(slug, { worktree, skipGate: true, missionServicesFn: stubMissionServices() });
  assert.strictEqual(result.ok, false);
  assert.ok(result.error);
  assert.match(result.error, /no evidence rows/);

  fs.rmSync(cpPath, { force: true });
  fs.rmSync(missionMdPath, { force: true });
});

test('performHandoff fails when final checkpoint evidence row is placeholder prose only', async () => {
  const slug = 'task-098';
  const worktree = `${handoffRoot}/fake-worktree`;
  const missionDir = `${handoffRoot}/fake-worktree/docs/missions/2026/task-098`;
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

  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true as const, taskFile: '/tmp/fake-task' }));

  const result = await performHandoff(slug, { worktree, skipGate: true, missionServicesFn: stubMissionServices() });
  assert.strictEqual(result.ok, false);
  assert.ok(result.error);
  assert.match(result.error, /no evidence rows that cite a verifiable reference/);

  fs.rmSync(cpPath, { force: true });
  fs.rmSync(missionMdPath, { force: true });
});

test('performHandoff fails when final checkpoint evidence row is shell output only', async () => {
  const slug = 'task-098';
  const worktree = `${handoffRoot}/fake-worktree-shell-only`;
  const missionDir = `${handoffRoot}/fake-worktree-shell-only/docs/missions/2026/task-098`;
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

  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true as const, taskFile: '/tmp/fake-task' }));

  const result = await performHandoff(slug, { worktree, skipGate: true, missionServicesFn: stubMissionServices() });
  assert.strictEqual(result.ok, false);
  assert.ok(result.error);
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
  mock.method(git, 'run', () => ({ signal: null, stdout: '', stderr: '',  status: 0 }));
  mock.method(git, 'git', (args: Parameters<(typeof git)["git"]>[0]) => ({ signal: null,  status: 0, stdout: args.includes('rev-parse') ? 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' : '', stderr: '' }));
  mock.method(forgejo, 'readToken', () => 'fake-token');
  mock.method(forgejo, 'createPr', () => ({ ok: true as const, url: 'http://fake-pr' }));
  mock.method(forgejo, 'authenticatedReviewUrl', () => 'http://fake-url');
  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true as const, taskFile: '/tmp/fake-task' }));
  mock.method(backlog, 'transitionTask', () => true);
  mock.method(gatekeeper, 'runGatekeeper', () => ({ ok: true as const, missing: [], skipped: false, posted: false }));

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
  mock.method(git, 'run', () => ({ signal: null, stdout: '', stderr: '',  status: 0 }));
  mock.method(git, 'git', (args: Parameters<(typeof git)["git"]>[0]) => ({ signal: null,  status: 0, stdout: args.includes('rev-parse') ? 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' : '', stderr: '' }));
  mock.method(forgejo, 'readToken', () => 'fake-token');
  mock.method(forgejo, 'createPr', () => ({ ok: true as const, url: 'http://fake-pr' }));
  mock.method(forgejo, 'authenticatedReviewUrl', () => 'http://fake-url');
  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true as const, taskFile: '/tmp/fake-task' }));
  mock.method(backlog, 'transitionTask', () => true);
  mock.method(gatekeeper, 'runGatekeeper', () => ({ ok: true as const, missing: [], skipped: false, posted: false }));

  try {
    const result = await performHandoff(slug, { worktree, skipGate: true, missionServicesFn: stubMissionServices() });
    assert.strictEqual(result.ok, true);
  } finally {
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});


test('performHandoff calls rebaseBeforeReviewRound before Forgejo PR creation', async (t) => {
  const { mock } = t;
  const slug = 'task-rebase-order';
  const worktree = fs.mkdtempSync(path.join('/tmp', 'handoff-rebase-order-'));
  const missionDir = path.join(worktree, 'docs/missions/2026', slug);
  const cpPath = path.join(missionDir, 'CP-1.md');
  const taskFile = path.join(worktree, 'backlog/tasks', `${slug} - rebase order.md`);
  const prCallOrder: ("git-origin" | "forgejo-createPr")[] = [];

  fs.mkdirSync(missionDir, { recursive: true });
  fs.mkdirSync(path.dirname(taskFile), { recursive: true });
  fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# MISSION.md\n\nTest mission.\n');
  fs.writeFileSync(cpPath, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| test | `npm test -- test/example.test.ts` | PASS |\n');
  fs.writeFileSync(taskFile, '---\nstatus: active\n---\n\n# rebase order\n');

  let rebaseCalled = false;
  let rebaseCalledBeforePr = false;
  const mockRebase: NonNullable<NonNullable<Parameters<typeof performHandoff>[1]>['rebaseFn']> = async () => {
    rebaseCalled = true;
    rebaseCalledBeforePr = prCallOrder.length === 0;
    return { ok: true as const, sharedFileConflicts: false };
  };

  mock.method(missionUtils, 'findMissionDir', () => missionDir);
  mock.method(missionUtils, 'findMissionArea', () => 'workflow');
  mock.method(missionUtils, 'findCheckpoints', () => [cpPath]);
  mock.method(git, 'getCurrentBranch', () => `mission/${slug}`);
  mock.method(git, 'getWorktreeStatus', () => []);
  mock.method(git, 'run', () => ({ signal: null, stdout: '', stderr: '',  status: 0 }));
  mock.method(git, 'git', (args: Parameters<(typeof git)["git"]>[0]) => {
    if (args.includes('rev-parse') && args.includes('HEAD')) return { signal: null,  status: 0, stdout: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n', stderr: '' };
    if (args.includes('origin')) prCallOrder.push('git-origin');
    return { signal: null,  status: 0, stdout: '', stderr: '' };
  });
  mock.method(forgejo, 'readToken', () => 'fake-token');
  mock.method(forgejo, 'createPr', (branch: Parameters<(typeof forgejo)["createPr"]>[0], user: Parameters<(typeof forgejo)["createPr"]>[1], token: Parameters<(typeof forgejo)["createPr"]>[2], opts: Parameters<(typeof forgejo)["createPr"]>[3]) => {
    prCallOrder.push('forgejo-createPr');
    return { ok: true as const, url: 'http://fake-pr' };
  });
  mock.method(forgejo, 'authenticatedReviewUrl', () => 'http://fake-url');
  mock.method(forgejo, 'resolveTrackingBranchSha', () => ({ ok: true as const, sha: 'lease-sha' }));
  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true as const, taskFile }));
  mock.method(backlog, 'transitionTask', () => true);
  mock.method(gatekeeper, 'runGatekeeper', () => ({ ok: true as const, missing: [], skipped: false, posted: false }));
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
  fs.writeFileSync(cpPath, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| test | `npm test -- test/example.test.ts` | PASS |\n');
  fs.writeFileSync(taskFile, '---\nstatus: active\n---\n\n# rebase fail\n');

  const mockRebase = async () => ({ ok: false as const, sharedFileConflicts: false });

  mock.method(missionUtils, 'findMissionDir', () => missionDir);
  mock.method(missionUtils, 'findMissionArea', () => 'workflow');
  mock.method(missionUtils, 'findCheckpoints', () => [cpPath]);
  mock.method(git, 'getCurrentBranch', () => `mission/${slug}`);
  mock.method(git, 'getWorktreeStatus', () => []);
  mock.method(git, 'run', () => ({ signal: null, stdout: '', stderr: '',  status: 0 }));
  mock.method(git, 'git', (args: Parameters<(typeof git)["git"]>[0]) => ({ signal: null,  status: 0, stdout: args.includes('rev-parse') ? 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' : '', stderr: '' }));
  mock.method(forgejo, 'readToken', () => 'fake-token');
  mock.method(forgejo, 'createPr', () => {
    return assert.fail('createPr should NOT be called when rebase fails');
    return { ok: true as const, url: 'http://fake-pr' };
  });
  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true as const, taskFile }));
  mock.method(backlog, 'transitionTask', () => {
    return assert.fail('transitionTask should NOT be called when rebase fails');
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
    assert.ok(result.error);
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
  fs.writeFileSync(cpPath, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| test | `npm test -- test/example.test.ts` | PASS |\n');
  fs.writeFileSync(taskFile, '---\nstatus: active\n---\n\n# shared conflict\n');

  const mockRebase = async () => ({ ok: false as const, sharedFileConflicts: true });

  mock.method(missionUtils, 'findMissionDir', () => missionDir);
  mock.method(missionUtils, 'findMissionArea', () => 'workflow');
  mock.method(missionUtils, 'findCheckpoints', () => [cpPath]);
  mock.method(git, 'getCurrentBranch', () => `mission/${slug}`);
  mock.method(git, 'getWorktreeStatus', () => []);
  mock.method(git, 'run', () => ({ signal: null, stdout: '', stderr: '',  status: 0 }));
  mock.method(git, 'git', (args: Parameters<(typeof git)["git"]>[0]) => ({ signal: null,  status: 0, stdout: args.includes('rev-parse') ? 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' : '', stderr: '' }));
  mock.method(forgejo, 'readToken', () => 'fake-token');
  mock.method(forgejo, 'createPr', () => {
    return assert.fail('createPr should NOT be called when rebase has shared-file conflicts');
    return { ok: true as const, url: 'http://fake-pr' };
  });
  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true as const, taskFile }));
  mock.method(backlog, 'transitionTask', () => {
    return assert.fail('transitionTask should NOT be called when rebase has shared-file conflicts');
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
    assert.ok(result.error);
    assert.match(result.error, /shared-file conflicts/);
    // task-2386 AC #1: the bounce must command execution, not description.
    assert.ok(result.error);
    assert.match(result.error, /Execute the listed commands now/);
    assert.ok(result.error);
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
  fs.writeFileSync(cpPath, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| test | `npm test -- test/example.test.ts` | PASS |\n');
  fs.writeFileSync(taskFile, '---\nstatus: active\n---\n\n# rebase uptodate\n');

  const mockRebase = async () => ({ ok: true as const, sharedFileConflicts: false });

  mock.method(missionUtils, 'findMissionDir', () => missionDir);
  mock.method(missionUtils, 'findMissionArea', () => 'workflow');
  mock.method(missionUtils, 'findCheckpoints', () => [cpPath]);
  mock.method(git, 'getCurrentBranch', () => `mission/${slug}`);
  mock.method(git, 'getWorktreeStatus', () => []);
  mock.method(git, 'run', () => ({ signal: null, stdout: '', stderr: '',  status: 0 }));
  mock.method(git, 'git', (args: Parameters<(typeof git)["git"]>[0]) => {
    if (args.includes('rev-parse') && args.includes('HEAD')) return { signal: null,  status: 0, stdout: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n', stderr: '' };
    if (args.includes('origin')) return assert.fail('Should not push to origin');
    if (args.includes('--cached') && args.includes('--quiet')) return { signal: null, stdout: '', stderr: '',  status: 0 };
    return { signal: null,  status: 0, stdout: '', stderr: '' };
  });
  mock.method(forgejo, 'readToken', () => 'fake-token');
  mock.method(forgejo, 'createPr', () => ({ ok: true as const, url: 'http://fake-pr' }));
  mock.method(forgejo, 'authenticatedReviewUrl', () => 'http://fake-url');
  mock.method(forgejo, 'resolveTrackingBranchSha', () => ({ ok: true as const, sha: 'lease-sha' }));
  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true as const, taskFile }));
  mock.method(backlog, 'transitionTask', () => true);
  mock.method(gatekeeper, 'runGatekeeper', () => ({ ok: true as const, missing: [], skipped: false, posted: false }));
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

test('runDeclaredGates returns skipped when no ## Gates section exists', async () => {
  const missionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gates-test-'));
  fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Mission\n\nNo gates here.\n');
  try {
    const result = await runDeclaredGates(missionDir, '/tmp/fake', { log: () => {}, error: () => {} });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.skipped, true);
    assert.strictEqual(result.reason, 'no-gates-section');
  } finally {
    fs.rmSync(missionDir, { recursive: true, force: true });
  }
});

// TASK-2521.03: gates recorded through `px gate add` are Mission state and are
// the authority; the mission document is only the legacy fallback.
test('runDeclaredGates runs recorded gates and never reads the mission document', async () => {
  const missionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gates-test-'));
  // A document whose ## Gates section would fail if it were consulted.
  fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Mission\n\n## Gates\n- [ ] exit 1\n');
  try {
    const result = await runDeclaredGates(missionDir, missionDir, {
      log: () => {}, error: () => {},
      recordedGates: ['true'],
    });
    assert.strictEqual(result.ok, true, 'the recorded gate runs, not the document gate');
    assert.strictEqual(result.skipped, false);
    assert.strictEqual(result.count, 1);
  } finally {
    fs.rmSync(missionDir, { recursive: true, force: true });
  }
});

test('runDeclaredGates falls back to the mission document when nothing is recorded', async () => {
  const missionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gates-test-'));
  fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Mission\n\n## Gates\n- [ ] true\n');
  try {
    const result = await runDeclaredGates(missionDir, missionDir, {
      log: () => {}, error: () => {},
      recordedGates: [],
    });
    assert.strictEqual(result.ok, true);
    assert.equal(result.skipped, false);
    assert.strictEqual(result.count, 1, 'the document gate still runs for a legacy mission');
  } finally {
    fs.rmSync(missionDir, { recursive: true, force: true });
  }
});

test('a failing recorded gate blocks handoff exactly as a failing document gate does', async () => {
  const missionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gates-test-'));
  try {
    const result = await runDeclaredGates(missionDir, missionDir, {
      log: () => {}, error: () => {},
      recordedGates: ['exit 3'],
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.gate, 'exit 3');
    assert.strictEqual(result.reason, 'gate-failed');
  } finally {
    fs.rmSync(missionDir, { recursive: true, force: true });
  }
});

test('runDeclaredGates returns skipped when ## Gates section is empty', async () => {
  const missionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gates-test-'));
  fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Mission\n\n## Gates\n\n');
  try {
    const result = await runDeclaredGates(missionDir, '/tmp/fake', { log: () => {}, error: () => {} });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.skipped, true);
    assert.strictEqual(result.reason, 'no-gates-declared');
  } finally {
    fs.rmSync(missionDir, { recursive: true, force: true });
  }
});

test('runDeclaredGates executes passing gates and reports count', async () => {
  const missionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gates-test-'));
  fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Mission\n\n## Gates\n\n- [ ] echo hello\n- [ ] true\n');
  try {
    const result = await runDeclaredGates(missionDir, missionDir, { log: () => {}, error: () => {} });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.skipped, false);
    assert.strictEqual(result.count, 2);
    assert.strictEqual(result.reason, 'all-gates-passed');
  } finally {
    fs.rmSync(missionDir, { recursive: true, force: true });
  }
});

test('runDeclaredGates fails when a gate command exits non-zero', async () => {
  const missionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gates-test-'));
  fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Mission\n\n## Gates\n\n- [ ] false\n');
  try {
    const result = await runDeclaredGates(missionDir, missionDir, { log: () => {}, error: () => {} });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'gate-failed');
    assert.strictEqual(result.gate, 'false');
  } finally {
    fs.rmSync(missionDir, { recursive: true, force: true });
  }
});

test('runDeclaredGates skips when mission directory does not exist', async () => {
  const result = await runDeclaredGates('/nonexistent/dir', '/tmp/fake', { log: () => {}, error: () => {} });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.skipped, true);
  assert.strictEqual(result.reason, 'no-mission-file');
});

test('runDeclaredGates handles checkbox prefixes [- [ ] and - [x])', async () => {
  const missionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gates-test-'));
  fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Mission\n\n## Gates\n\n- [ ] echo step1\n- [x] true\n');
  try {
    const result = await runDeclaredGates(missionDir, missionDir, { log: () => {}, error: () => {} });
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
function writeCompatibilityTaskRecord(rootDir: string, slug: string, status = 'active') {
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
    assert.ok(result.error);
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
    const recorded: RecordHandoffNelRequest[] = [];
    const missionServicesFn = stubMissionServices({
      store: {
        async load() {
          return {
            kind: 'found' as const,
            mission: fixtureMission('task-nel-test', { review: { ...pendingReview('task-nel-test'), rounds: [{ ...pendingReview('task-nel-test').rounds[0], number: 1 }, { ...pendingReview('task-nel-test').rounds[0], number: 2 }, { ...pendingReview('task-nel-test').rounds[0], number: 3 }] } }),
            version: fixtureVersion(1),
          };
        },
      },
      handoff: {
        async recordNel(request) {
          recorded.push(request);
          return { status: 'completed' as const, durableEvidence: [] };
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
              status: 'failed' as const,
              error: { kind: 'unavailable' as const, message: 'injected NEL persistence failure' },
              durableEvidence: [],
            };
          },
        },
      }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.persistenceFailed, true);
    assert.ok(result.error);
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
  fs.writeFileSync(checkpoint, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| proof | `npm test -- test/handoff.test.js` | PASS |\n');
  fs.writeFileSync(taskFile, '---\nstatus: active\n---\n');
  writeReviewState(missionDir, 'codex', 'codex');
  let transitions = 0;
  t.mock.method(missionUtils, 'findMissionDir', () => missionDir);
  t.mock.method(missionUtils, 'findMissionArea', () => 'workflow');
  t.mock.method(missionUtils, 'findCheckpoints', () => [checkpoint]);
  t.mock.method(git, 'getCurrentBranch', () => `mission/${slug}`);
  t.mock.method(git, 'getWorktreeStatus', () => []);
  t.mock.method(backlog, 'resolveTaskFile', () => ({ ok: true as const, taskFile }));
  t.mock.method(backlog, 'transitionTask', () => { transitions++; return true; });
  try {
    const result = await performHandoff(slug, {
      missionServicesFn: stubMissionServices(),
      worktree,
      skipGate: true,
      isForgejoReviewEnabledFn: () => false,
      rebaseFn: async () => ({ ok: true as const }),
      captureNelFn: async () => ({ ok: false as const, persistenceFailed: true, error: 'injected failure' }),
      log: () => {},
      error: () => {},
    });
    assert.equal(result.ok, false);
    assert.ok(result.error);
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
  fs.writeFileSync(checkpoint, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| proof | `npm test -- test/handoff.test.js` | PASS |\n');
  fs.writeFileSync(taskFile, '---\nstatus: active\n---\n');
  writeReviewState(missionDir, 'codex', 'codex');
  const gitCalls: string[][] = [];
  let transitions = 0;
  t.mock.method(missionUtils, 'findMissionDir', () => missionDir);
  t.mock.method(missionUtils, 'findMissionArea', () => 'workflow');
  t.mock.method(missionUtils, 'findCheckpoints', () => [checkpoint]);
  t.mock.method(git, 'getCurrentBranch', () => `mission/${slug}`);
  t.mock.method(git, 'getWorktreeStatus', () => []);
  t.mock.method(git, 'git', (args: Parameters<(typeof git)["git"]>[0]) => {
    if (args.includes('rev-parse') && args.includes('HEAD')) return { status: 0, stdout: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n', stderr: '' };
    gitCalls.push(args);
    if (args.includes('diff')) { return { status: 1, stdout: '', stderr: '' }; }
    return { status: 0, stdout: '', stderr: '' };
  });
  t.mock.method(backlog, 'resolveTaskFile', () => ({ ok: true as const, taskFile }));
  t.mock.method(backlog, 'transitionTask', () => { transitions++; return true; });
  try {
    const result = await performHandoff(slug, {
      missionServicesFn: stubMissionServices(),
      worktree,
      skipGate: true,
      isForgejoReviewEnabledFn: () => false,
      rebaseFn: async () => ({ ok: true as const }),
      captureNelFn: async () => {
        fs.writeFileSync(path.join(missionDir, 'nel-record.json'), '{}');
        return { ok: true as const, nel: 0, bucket: 'Small' };
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
    const recorded: RecordHandoffNelRequest[] = [];

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
              return { status: 'completed' as const, durableEvidence: [] };
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
  fs.writeFileSync(cpPath, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| test | `npm test -- test/example.test.ts` | PASS |\n');
  fs.writeFileSync(taskFile, '---\nstatus: active\n---\n\n# sc1\n');

  const mockRebase = async () => ({ ok: true as const, sharedFileConflicts: false });

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
  mock.method(git, 'run', () => ({ signal: null, stdout: '', stderr: '',  status: 0 }));
  mock.method(git, 'git', (args: Parameters<(typeof git)["git"]>[0]) => ({ signal: null,  status: 0, stdout: args.includes('rev-parse') ? 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' : '', stderr: '' }));
  mock.method(forgejo, 'readToken', () => 'fake-token');
  mock.method(forgejo, 'createPr', () => ({ ok: true as const, url: 'http://fake-pr' }));
  mock.method(forgejo, 'authenticatedReviewUrl', () => 'http://fake-url');
  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true as const, taskFile }));
  mock.method(backlog, 'transitionTask', () => true);
  mock.method(gatekeeper, 'runGatekeeper', () => ({ ok: true as const, missing: [], skipped: false, posted: false }));
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
  const mockSpawnSync = mock.method(childProcess, 'spawnSync', async (...args: Parameters<typeof origSpawnSync>) => {
    // Let real spawnSync run, we just want to verify the result is captured
    return origSpawnSync.apply(childProcess, args);
  });

  try {
    const result = await runDeclaredGates(missionDir, missionDir, { log: () => {}, error: () => {} });
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
  const rootDir = path.join(import.meta.dirname, '..', '..', '..');
  const result = validateDeclaredGates(
    ['./scripts/verify-local.sh docs', './scripts/verify-local.sh static-analysis'],
    rootDir
  );
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, 'all-gates-valid');
});

test('validateDeclaredGates fails for non-existent file with validation-failed reason', () => {
  const rootDir = path.join(import.meta.dirname, '..', '..', '..');
  const result = validateDeclaredGates(['./scripts/nonexistent.sh'], rootDir);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'validation-failed');
  assert.strictEqual(result.gate, './scripts/nonexistent.sh');
  assert.ok(result.error.includes('non-existent file') || result.error.includes('nonexistent.sh'));
});

test('validateDeclaredGates fails for unclosed single quotes with validation-failed reason', () => {
  const rootDir = path.join(import.meta.dirname, '..', '..', '..');
  const result = validateDeclaredGates(['echo \'hello'], rootDir);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'validation-failed');
  assert.strictEqual(result.gate, 'echo \'hello');
  assert.ok(result.error.includes('unclosed single quotes'));
});

test('validateDeclaredGates fails for unclosed double quotes with validation-failed reason', () => {
  const rootDir = path.join(import.meta.dirname, '..', '..', '..');
  const result = validateDeclaredGates(['echo "hello'], rootDir);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'validation-failed');
  assert.strictEqual(result.gate, 'echo "hello');
  assert.ok(result.error.includes('unclosed double quotes'));
});

test('validateDeclaredGates fails for unmatched parentheses with validation-failed reason', () => {
  const rootDir = path.join(import.meta.dirname, '..', '..', '..');
  const result = validateDeclaredGates(['echo (hello'], rootDir);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'validation-failed');
  assert.strictEqual(result.gate, 'echo (hello');
  assert.ok(result.error.includes('unmatched parentheses'));
});

test('validateDeclaredGates fails for unmatched braces with validation-failed reason', () => {
  const rootDir = path.join(import.meta.dirname, '..', '..', '..');
  const result = validateDeclaredGates(['echo {hello'], rootDir);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'validation-failed');
  assert.ok(result.error.includes('unmatched braces'));
});

test('validateDeclaredGates fails for unmatched brackets with validation-failed reason', () => {
  const rootDir = path.join(import.meta.dirname, '..', '..', '..');
  const result = validateDeclaredGates(['echo [hello'], rootDir);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'validation-failed');
  assert.ok(result.error.includes('unmatched brackets'));
});

test('validateDeclaredGates fails on first invalid command in mixed valid/invalid set', () => {
  const rootDir = path.join(import.meta.dirname, '..', '..', '..');
  const result = validateDeclaredGates(
    ['./scripts/verify-local.sh docs', './scripts/nonexistent.sh'],
    rootDir
  );
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'validation-failed');
  assert.strictEqual(result.gate, './scripts/nonexistent.sh');
});

test('validateDeclaredGates passes for shell builtins without file paths', () => {
  const rootDir = path.join(import.meta.dirname, '..', '..', '..');
  const result = validateDeclaredGates(['echo hello', 'true', 'false'], rootDir);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, 'all-gates-valid');
});

test('validateDeclaredGates skips URL patterns', () => {
  const rootDir = path.join(import.meta.dirname, '..', '..', '..');
  const result = validateDeclaredGates(['curl https://example.com'], rootDir);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, 'all-gates-valid');
});

test('validateDeclaredGates passes for commands with flags', () => {
  const rootDir = path.join(import.meta.dirname, '..', '..', '..');
  const result = validateDeclaredGates(['node --version', 'npm run test'], rootDir);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, 'all-gates-valid');
});

// ---------- runDeclaredGates integration with validation ----------

test('runDeclaredGates fails with validation-failed before executing invalid file reference', async () => {
  const missionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gates-validation-test-'));
  fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Mission\n\n## Gates\n\n- [ ] ./scripts/nonexistent.sh\n');
  try {
    const result = await runDeclaredGates(missionDir, missionDir, { log: () => {}, error: () => {} });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'validation-failed');
    assert.strictEqual(result.gate, './scripts/nonexistent.sh');
  } finally {
    fs.rmSync(missionDir, { recursive: true, force: true });
  }
});

test('runDeclaredGates fails with validation-failed before executing syntax error', async () => {
  const missionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gates-validation-test-'));
  fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Mission\n\n## Gates\n\n- [ ] echo \'unclosed\n');
  try {
    const result = await runDeclaredGates(missionDir, missionDir, { log: () => {}, error: () => {} });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'validation-failed');
  } finally {
    fs.rmSync(missionDir, { recursive: true, force: true });
  }
});

// ---------- Regression tests for realistic gate-command text (Finding 1 fix) ----------

test('validateDeclaredGates passes glob patterns (no false positive on /*)', () => {
  const rootDir = path.join(import.meta.dirname, '..', '..', '..');
  const result = validateDeclaredGates(
    ['All 108+ tests in `test/*.test.js` pass via `npm test`'],
    rootDir
  );
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, 'all-gates-valid');
});

test('validateDeclaredGates passes directory references with trailing slash', () => {
  const rootDir = path.join(import.meta.dirname, '..', '..', '..');
  const result = validateDeclaredGates(
    ["npm run prepublishOnly && npm pack --dry-run 2>&1 | grep -q 'src/adapters/agents/'"],
    rootDir
  );
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, 'all-gates-valid');
});

test('validateDeclaredGates passes apostrophe inside double-quoted string', () => {
  const rootDir = path.join(import.meta.dirname, '..', '..', '..');
  const result = validateDeclaredGates(
    [`echo "it's a test"`],
    rootDir
  );
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, 'all-gates-valid');
});

test('validateDeclaredGates passes double apostrophe inside double-quoted string', () => {
  const rootDir = path.join(import.meta.dirname, '..', '..', '..');
  const result = validateDeclaredGates(
    [`echo "it's Bob's test"`],
    rootDir
  );
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, 'all-gates-valid');
});

test('validateDeclaredGates passes mixed prose with embedded path', () => {
  const rootDir = path.join(import.meta.dirname, '..', '..', '..');
  const result = validateDeclaredGates(
    ['./scripts/verify-local.sh static-analysis && echo "All checks passed"'],
    rootDir
  );
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, 'all-gates-valid');
});

test('validateDeclaredGates passes command with valid ./ path and quoted arg', () => {
  const rootDir = path.join(import.meta.dirname, '..', '..', '..');
  const result = validateDeclaredGates(
    ['./scripts/verify-local.sh docs --verbose'],
    rootDir
  );
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, 'all-gates-valid');
});

test('validateDeclaredGates still catches genuinely unclosed single quote', () => {
  const rootDir = path.join(import.meta.dirname, '..', '..', '..');
  const result = validateDeclaredGates(["echo 'unclosed"], rootDir);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'validation-failed');
  assert.ok(result.error.includes('unclosed single'));
});

test('validateDeclaredGates still catches genuinely unclosed double quote', () => {
  const rootDir = path.join(import.meta.dirname, '..', '..', '..');
  const result = validateDeclaredGates(['echo "unclosed'], rootDir);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'validation-failed');
  assert.ok(result.error.includes('unclosed double'));
});

test('validateDeclaredGates passes escaped quote inside double-quoted string', () => {
  const rootDir = path.join(import.meta.dirname, '..', '..', '..');
  const result = validateDeclaredGates(['echo "say \\"hi\\" to me"'], rootDir);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, 'all-gates-valid');
});

test('validateDeclaredGates fails for non-existent file still works with tokenized paths', () => {
  const rootDir = path.join(import.meta.dirname, '..', '..', '..');
  const result = validateDeclaredGates(['node ./lib/commands/nonexistent.js'], rootDir);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'validation-failed');
  assert.ok(result.error.includes('non-existent file'));
  assert.ok(result.error.includes('nonexistent.js'));
});

test('validateDeclaredGates passes command with absolute path that exists', () => {
  const rootDir = path.join(import.meta.dirname, '..', '..', '..');
  const result = validateDeclaredGates([`cat ${process.execPath}`], rootDir);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, 'all-gates-valid');
});

test('validateDeclaredGates fails for non-existent absolute path', () => {
  const rootDir = path.join(import.meta.dirname, '..', '..', '..');
  const result = validateDeclaredGates(['cat /nonexistent/path/file.txt'], rootDir);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'validation-failed');
  assert.ok(result.error.includes('non-existent file'));
});

// ---------- Command-only gate declaration regression and compatibility ----------

test('validateDeclaredGates rejects outcome prose with command-only remediation', () => {
  const gate = './scripts/verify-local.sh all passes on the final tree.';
  const result = validateDeclaredGates([gate], path.join(import.meta.dirname, '..', '..', '..'));

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'validation-failed');
  assert.equal(result.gate, gate);
  assert.ok(result.error);
  assert.match(result.error, /exact runnable command only/i);
  assert.ok(result.error);
  assert.match(result.error, /Success Criteria or checkpoint documentation/i);
});

test('runDeclaredGates rejects Markdown command followed by prose', async () => {
  const missionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gates-backtick-prose-test-'));
  const gate = '`true` passes on the final tree.';
  fs.writeFileSync(path.join(missionDir, 'MISSION.md'), `# Mission\n\n## Gates\n\n- [ ] ${gate}\n`);
  try {
    const result = await runDeclaredGates(missionDir, missionDir, { log: () => {}, error: () => {} });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'validation-failed');
    assert.equal(result.gate, gate);
  } finally {
    fs.rmSync(missionDir, { recursive: true, force: true });
  }
});

test('runDeclaredGates rejects explanatory dash suffixes', async () => {
  for (const suffix of ['true — some description', 'true – brief note', 'true -– legacy note']) {
    const missionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gates-dash-prose-test-'));
    fs.writeFileSync(path.join(missionDir, 'MISSION.md'), `# Mission\n\n## Gates\n\n- [ ] ${suffix}\n`);
    try {
      const result = await runDeclaredGates(missionDir, missionDir, { log: () => {}, error: () => {} });
      assert.equal(result.ok, false, suffix);
      assert.equal(result.reason, 'validation-failed', suffix);
    } finally {
      fs.rmSync(missionDir, { recursive: true, force: true });
    }
  }
});

test('runDeclaredGates executes bare, backticked, checked, and unchecked command forms', async () => {
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
    const result = await runDeclaredGates(missionDir, missionDir, { log: () => {}, error: () => {} });
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
    path.join(import.meta.dirname, '..', '..', '..')
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
  fs.writeFileSync(cpPath, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| test | `npm test -- test/example.test.ts` | PASS |\n');
  fs.writeFileSync(taskFile, '---\nstatus: active\n---\n\n# gk pushback\n');

  const mockRebase = async () => ({ ok: true as const, sharedFileConflicts: false });
  let relaunchCallCount = 0;
  let relaunchPrompt: { value: string | null } = { value: null };

  mock.method(missionUtils, 'findMissionDir', () => missionDir);
  mock.method(missionUtils, 'findMissionArea', () => 'workflow');
  mock.method(missionUtils, 'findCheckpoints', () => [cpPath]);
  mock.method(git, 'getCurrentBranch', () => `mission/${slug}`);
  mock.method(git, 'getWorktreeStatus', () => []);
  mock.method(git, 'run', () => ({ signal: null, stdout: '', stderr: '',  status: 0 }));
  mock.method(git, 'git', (args: Parameters<(typeof git)["git"]>[0]) => ({ signal: null,  status: 0, stdout: args.includes('rev-parse') ? 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' : '', stderr: '' }));
  mock.method(forgejo, 'readToken', () => 'fake-token');
  mock.method(forgejo, 'createPr', () => ({ ok: true as const, url: 'http://fake-pr' }));
  mock.method(forgejo, 'authenticatedReviewUrl', () => 'http://fake-url');
  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true as const, taskFile }));
  mock.method(backlog, 'transitionTask', () => true);
  mock.method(gatekeeper, 'runGatekeeper', () => ({
    ok: false as const, missing: ['docs/missions/2026/task-1388-gk-pushback/MISSION.md'], skipped: false, posted: true
  }));

  // TASK-2377.05: the pushback bounce runs through the rebound kernel, which
  // builds the fix prompt and hands it to this launch port.
  const mockStartAgent: NonNullable<NonNullable<Parameters<typeof performHandoff>[1]>['startAgentFn']> = async (_step, opts) => {
    relaunchCallCount++;
    const slot = opts && opts.prompt;
    relaunchPrompt.value = typeof slot === 'function' ? slot('custom') : (slot ?? null);
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
    assert.ok(relaunchPrompt.value, 'the kernel fix prompt should have been built');
    assert.ok(relaunchPrompt.value.includes('MISSION.md'), 'prompt should mention MISSION.md');
    assert.ok(relaunchPrompt.value.includes('create'), 'prompt should contain creation instructions');
    assert.ok(relaunchPrompt.value.includes(`px review ${slug} --start`), 'prompt should name the exact post-repair review-start command');
    assert.ok(!relaunchPrompt.value.includes('${slug}'), 'prompt must not leak an unsubstituted mission placeholder');
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
  fs.writeFileSync(cpPath, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| test | `npm test -- test/example.test.ts` | PASS |\n');
  fs.writeFileSync(taskFile, '---\nstatus: active\n---\n\n# retry limit\n');

  const mockRebase = async () => ({ ok: true as const, sharedFileConflicts: false });

  mock.method(missionUtils, 'findMissionDir', () => missionDir);
  mock.method(missionUtils, 'findMissionArea', () => 'workflow');
  mock.method(missionUtils, 'findCheckpoints', () => [cpPath]);
  mock.method(git, 'getCurrentBranch', () => `mission/${slug}`);
  mock.method(git, 'getWorktreeStatus', () => []);
  mock.method(git, 'run', () => ({ signal: null, stdout: '', stderr: '',  status: 0 }));
  mock.method(git, 'git', (args: Parameters<(typeof git)["git"]>[0]) => ({ signal: null,  status: 0, stdout: args.includes('rev-parse') ? 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' : '', stderr: '' }));
  mock.method(forgejo, 'readToken', () => 'fake-token');
  mock.method(forgejo, 'createPr', () => ({ ok: true as const, url: 'http://fake-pr' }));
  mock.method(forgejo, 'authenticatedReviewUrl', () => 'http://fake-url');
  mock.method(forgejo, 'resolveTrackingBranchSha', () => ({ ok: true as const, sha: 'fake-sha' }));
  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true as const, taskFile }));
  mock.method(backlog, 'transitionTask', () => true);

  // Gatekeeper always returns pushback (simulating artifacts never created)
  const mockGK = () => ({
    ok: false as const, missing: ['docs/missions/2026/task-1388-retry-limit/MISSION.md'], skipped: false, posted: true
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
  fs.writeFileSync(cpPath, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| test | `npm test -- test/example.test.ts` | PASS |\n');
  fs.writeFileSync(taskFile, '---\nstatus: active\n---\n\n# retry persists\n');

  const mockRebase = async () => ({ ok: true as const, sharedFileConflicts: false });
  let gkCallCount = 0;

  mock.method(missionUtils, 'findMissionDir', () => missionDir);
  mock.method(missionUtils, 'findMissionArea', () => 'workflow');
  mock.method(missionUtils, 'findCheckpoints', () => [cpPath]);
  mock.method(git, 'getCurrentBranch', () => `mission/${slug}`);
  mock.method(git, 'getWorktreeStatus', () => []);
  mock.method(git, 'run', () => ({ signal: null, stdout: '', stderr: '',  status: 0 }));
  mock.method(git, 'git', (args: Parameters<(typeof git)["git"]>[0]) => ({ signal: null,  status: 0, stdout: args.includes('rev-parse') ? 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' : '', stderr: '' }));
  mock.method(forgejo, 'readToken', () => 'fake-token');
  mock.method(forgejo, 'createPr', () => ({ ok: true as const, url: 'http://fake-pr' }));
  mock.method(forgejo, 'authenticatedReviewUrl', () => 'http://fake-url');
  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true as const, taskFile }));
  mock.method(backlog, 'transitionTask', () => true);

  // Gatekeeper always returns pushback (simulating artifacts never created)
  const mockGK = () => ({
    ok: false as const, missing: ['docs/missions/2026/task-1388-retry-persists/MISSION.md'], skipped: false, posted: true
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
  fs.writeFileSync(cpPath, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| test | `npm test -- test/example.test.ts` | PASS |\n');
  fs.writeFileSync(taskFile, '---\nstatus: active\n---\n\n# relaunch success\n');

  const mockRebase = async () => ({ ok: true as const, sharedFileConflicts: false });
  let gkCallCount = 0;

  mock.method(missionUtils, 'findMissionDir', () => missionDir);
  mock.method(missionUtils, 'findMissionArea', () => 'workflow');
  mock.method(missionUtils, 'findCheckpoints', () => [cpPath]);
  mock.method(git, 'getCurrentBranch', () => `mission/${slug}`);
  mock.method(git, 'getWorktreeStatus', () => []);
  mock.method(git, 'run', () => ({ signal: null, stdout: '', stderr: '',  status: 0 }));
  mock.method(git, 'git', (args: Parameters<(typeof git)["git"]>[0]) => ({ signal: null,  status: 0, stdout: args.includes('rev-parse') ? 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' : '', stderr: '' }));
  mock.method(forgejo, 'readToken', () => 'fake-token');
  mock.method(forgejo, 'createPr', () => ({ ok: true as const, url: 'http://fake-pr' }));
  mock.method(forgejo, 'authenticatedReviewUrl', () => 'http://fake-url');
  mock.method(forgejo, 'resolveTrackingBranchSha', () => ({ ok: true as const, sha: 'fake-sha' }));
  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true as const, taskFile }));
  mock.method(backlog, 'transitionTask', () => true);

  // First call returns pushback, subsequent calls return ok
  const mockGK: typeof gatekeeper.runGatekeeper = () => {
    gkCallCount++;
    if (gkCallCount === 1) {
      return { ok: false as const, missing: ['docs/missions/2026/task-1388-relaunch-success/MISSION.md'], skipped: false, posted: true };
    }
    return { ok: true as const, missing: [], skipped: false, posted: false };
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
  fs.writeFileSync(cpPath, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| test | `npm test -- test/example.test.ts` | PASS |\n');
  fs.writeFileSync(taskFile, '---\nstatus: active\n---\n\n# prompt content\n');

  const mockRebase = async () => ({ ok: true as const, sharedFileConflicts: false });
  let capturedPrompt: { value: string | null } = { value: null };

  mock.method(missionUtils, 'findMissionDir', () => missionDir);
  mock.method(missionUtils, 'findMissionArea', () => 'workflow');
  mock.method(missionUtils, 'findCheckpoints', () => [cpPath]);
  mock.method(git, 'getCurrentBranch', () => `mission/${slug}`);
  mock.method(git, 'getWorktreeStatus', () => []);
  mock.method(git, 'run', () => ({ signal: null, stdout: '', stderr: '',  status: 0 }));
  mock.method(git, 'git', (args: Parameters<(typeof git)["git"]>[0]) => ({ signal: null,  status: 0, stdout: args.includes('rev-parse') ? 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' : '', stderr: '' }));
  mock.method(forgejo, 'readToken', () => 'fake-token');
  mock.method(forgejo, 'createPr', () => ({ ok: true as const, url: 'http://fake-pr' }));
  mock.method(forgejo, 'authenticatedReviewUrl', () => 'http://fake-url');
  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true as const, taskFile }));
  mock.method(backlog, 'transitionTask', () => true);
  mock.method(gatekeeper, 'runGatekeeper', () => ({
    ok: false as const,
    missing: [
      'docs/missions/2026/task-1388-prompt-content/MISSION.md',
      'docs/missions/2026/task-1388-prompt-content/CP-*.md (at least one checkpoint document)',
      'backlog/tasks/task-1388-prompt-content - *.md'
    ],
    skipped: false, posted: true
  }));

  // The kernel builds the fix prompt and passes it to the launch port.
  const mockStartAgent: NonNullable<NonNullable<Parameters<typeof performHandoff>[1]>['startAgentFn']> = async (_step, opts) => {
    const slot = opts && opts.prompt;
    capturedPrompt.value = typeof slot === 'function' ? slot('custom') : (slot ?? null);
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

    assert.ok(capturedPrompt.value, 'prompt should have been captured');
    assert.ok(capturedPrompt.value.includes('MISSION.md'), 'prompt should list MISSION.md');
    assert.ok(capturedPrompt.value.includes('CP-'), 'prompt should list CP-*.md');
    assert.ok(capturedPrompt.value.includes('backlog/tasks'), 'prompt should list backlog task file');
    assert.ok(capturedPrompt.value.includes('create'), 'prompt should contain creation keyword');
    assert.ok(capturedPrompt.value.includes('frontmatter'), 'prompt should mention frontmatter for task file');
    assert.ok(capturedPrompt.value.includes('Goal Check'), 'prompt should mention Goal Check for checkpoints');
  } finally {
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});
