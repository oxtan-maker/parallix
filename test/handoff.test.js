const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { verifyHandoff, performHandoff } = require('../lib/commands/handoff');
const { mock } = test;

// Mock external modules
const git = require('../lib/core/git');
const missionUtils = require('../lib/core/mission-utils');
const backlog = require('../lib/tools/backlog');
const forgejo = require('../lib/tools/forgejo');
const setupReview = require('../lib/tools/setup-review');
const gatekeeper = require('../lib/tools/gatekeeper');

function writeReviewState(missionDir, reviewer, implementer) {
  fs.mkdirSync(missionDir, { recursive: true });
  fs.writeFileSync(path.join(missionDir, 'review-state.json'), JSON.stringify({
    mission: 'task-098',
    reviewer,
    implementer,
    round: 1,
    phase: 'reviewing'
  }, null, 2));
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

  const result = await performHandoff(slug, { worktree, skipGate: true });
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
  fs.writeFileSync(cpPath, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| test | test | PASS |\n');

  const result = await performHandoff(slug, { worktree, skipGate: true });
  assert.strictEqual(result.ok, true);

  fs.rmSync(cpPath, { force: true });
  fs.rmSync(missionMdPath, { force: true });
});

test('performHandoff refreshes the review tracking ref before a forced Forgejo state push', async (t) => {
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
  fs.mkdirSync(missionDir, { recursive: true });
  fs.writeFileSync(missionMdPath, '# MISSION.md\n\nTest mission.\n');
  fs.writeFileSync(cpPath, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| test | test | PASS |\n');

  const mockRebase = async () => ({ ok: true, sharedFileConflicts: false });
  const result = await performHandoff(slug, {
    worktree,
    skipGate: true,
    force: true,
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
  fs.writeFileSync(cpPath, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| test | test | PASS |\n');
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
  mock.method(gatekeeper, 'runGatekeeper', () => ({ ok: true, missing: [], skipped: false, posted: false }));
  writeReviewState(missionDir, 'custom', 'custom');

  try {
    const mockRebase = async () => ({ ok: true, sharedFileConflicts: false });
    const result = await performHandoff(slug, {
      worktree,
      skipGate: true,
      isForgejoReviewEnabledFn: () => true,
      rebaseFn: mockRebase,
    });

    assert.equal(result.ok, true);
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
    fs.writeFileSync(cpPath, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| test | test | PASS |\n');

    const result = await performHandoff(slug, { worktree, skipGate: true });
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

  const result = await performHandoff(slug, { worktree, skipGate: true });
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
  fs.writeFileSync(cpPath, '# CP-1\n\n## Goal Check Table\n\n| Criteria | Evidence | Status |\n|----------|----------|--------|\n| test | test evidence | PASS |\n');

  const result = await performHandoff(slug, { worktree, skipGate: true });
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
  fs.writeFileSync(cpPath, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| test | test | PASS |\n');
  writeReviewState(missionDir, 'claude', 'claude');

  const result = await performHandoff(slug, { worktree, skipGate: true });
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

  const result = await performHandoff(slug, { worktree, skipGate: true });
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /No checkpoint documents found/);

  fs.rmSync(missionMdPath, { force: true });
});

test('performHandoff auto-remediates missing checkpoints by writing CP-1.md and proceeding', async () => {
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
    const result = await performHandoff(slug, { worktree, skipGate: true });

    // Handoff proceeds to task transition (ok: true) instead of failing.
    assert.strictEqual(result.ok, true);

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
  fs.writeFileSync(cp1Path, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| test | test | PASS |\n');
  fs.writeFileSync(cp2Path, '# CP-2\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| test | test | PASS |\n');
  writeReviewState(missionDir, 'claude', 'claude');

  const result = await performHandoff(slug, { worktree, skipGate: true });
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

  const result = await performHandoff(slug, { worktree, skipGate: true });
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

  const result = await performHandoff(slug, { worktree, skipGate: true });
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

  const result = await performHandoff(slug, { worktree, skipGate: true });
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

  const result = await performHandoff(slug, { worktree, skipGate: true });
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /no evidence rows/);

  fs.rmSync(cpPath, { force: true });
  fs.rmSync(missionMdPath, { force: true });
});

test('handoffCommand normalizes uppercase explicit slugs', async (t) => {
  const { mock } = t;
  const handoff = require('../lib/commands/handoff');

  // We need to mock performHandoff which is exported from the same module
  // Actually, handoffCommand calls performHandoff from the same file.
  // We can't easily mock it unless we mock the whole module or its internal dependencies.

  // Let's mock missionUtils.inferSlug to see if it's called with the uppercase slug
  const inferSlugMock = mock.method(missionUtils, 'inferSlug', (s) => s.toLowerCase());

  // We don't want to actually run performHandoff because it has many dependencies.
  // We can mock performHandoff by overriding the export temporarily or just mocking its dependencies.

  mock.method(handoff, 'performHandoff', () => ({ ok: true }));

  // Mock process.exit to avoid crashing the test runner
  const exitMock = mock.method(process, 'exit', () => {});

  await handoff(['TASK-1022']);

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
  fs.writeFileSync(cpPath, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| test | test | PASS |\n');
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
  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true, taskFile }));
  mock.method(backlog, 'transitionTask', () => true);
  mock.method(gatekeeper, 'runGatekeeper', () => ({ ok: true, missing: [], skipped: false, posted: false }));
  writeReviewState(missionDir, 'custom', 'custom');

  try {
    const result = await performHandoff(slug, {
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
  fs.writeFileSync(cpPath, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| test | test | PASS |\n');
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
  fs.writeFileSync(cpPath, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| test | test | PASS |\n');
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
      worktree,
      skipGate: true,
      isForgejoReviewEnabledFn: () => true,
      rebaseFn: mockRebase,
    });

    assert.strictEqual(result.ok, false);
    assert.match(result.error, /shared-file conflicts/);
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
  fs.writeFileSync(cpPath, '# CP-1\n\n## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| test | test | PASS |\n');
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
  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true, taskFile }));
  mock.method(backlog, 'transitionTask', () => true);
  mock.method(gatekeeper, 'runGatekeeper', () => ({ ok: true, missing: [], skipped: false, posted: false }));
  writeReviewState(missionDir, 'custom', 'custom');

  try {
    const result = await performHandoff(slug, {
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

const { runDeclaredGates } = require('../lib/commands/handoff');

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

const { captureNelAtHandoff } = require('../lib/commands/handoff');

test('captureNelAtHandoff returns error when primary branch not detected', () => {
  const origGetPrimaryBranch = require('../lib/core/mission-utils').getPrimaryBranch;
  const { mock } = test;

  const mockFn = mock.method(require('../lib/core/mission-utils'), 'getPrimaryBranch', () => {
    throw new Error('no branch');
  });

  try {
    const result = captureNelAtHandoff('task-fake', {
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

test('captureNelAtHandoff writes nel-record.json with predicted bucket, actual NEL, actual bucket, review rounds', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nel-capture-'));
  const missionDir = path.join(tmpDir, 'missions/task-nel-test');
  const nelRecordPath = path.join(missionDir, 'nel-record.json');

  try {
    fs.mkdirSync(missionDir, { recursive: true });

    // Create MISSION.md with predicted NEL bucket
    fs.writeFileSync(path.join(missionDir, 'MISSION.md'), [
      '# Mission',
      '',
      '## Refinement Signals',
      '',
      '- Predicted NEL bucket: Small (0–80) / Medium (81–235) / Large (235+)',
      '- Confidence: High',
    ].join('\n'));

    // Create review-state.json with round info
    fs.writeFileSync(path.join(missionDir, 'review-state.json'), JSON.stringify({
      reviewer: 'claude',
      implementer: 'claude',
      round: 3,
      phase: 'reviewing',
    }, null, 2));

    // Mock getPrimaryBranch to return 'main'
    const { mock } = test;
    const mockFn = mock.method(require('../lib/core/mission-utils'), 'getPrimaryBranch', () => 'main');

    try {
      const result = captureNelAtHandoff('task-nel-test', {
        rootDir: tmpDir,
        missionDir,
        log: () => {},
        error: () => {},
      });

      assert.strictEqual(result.ok, true);
      assert.ok(typeof result.nel === 'number', 'nel should be a number');
      assert.ok(['Small', 'Medium', 'Large'].includes(result.bucket), `bucket should be valid, got ${result.bucket}`);

      // Verify nel-record.json was written
      assert.ok(fs.existsSync(nelRecordPath), 'nel-record.json should exist');
      const record = JSON.parse(fs.readFileSync(nelRecordPath, 'utf8'));
      assert.strictEqual(record.slug, 'task-nel-test');
      assert.strictEqual(record.predictedBucket, 'Small');
      assert.strictEqual(record.actualBucket, result.bucket);
      assert.strictEqual(record.reviewRounds, 3);
      assert.ok(record.capturedAt, 'should have capturedAt timestamp');
    } finally {
      mockFn.mock.restore();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('captureNelAtHandoff reads predicted bucket from MISSION.md Refinement Signals', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nel-capture-bucket-'));
  const missionDir = path.join(tmpDir, 'missions/task-nel-bucket');
  const nelRecordPath = path.join(missionDir, 'nel-record.json');

  try {
    fs.mkdirSync(missionDir, { recursive: true });

    // Create MISSION.md with Medium predicted bucket
    fs.writeFileSync(path.join(missionDir, 'MISSION.md'), [
      '# Mission',
      '',
      '## Refinement Signals',
      '',
      '- Predicted NEL bucket: Medium (81–235)',
    ].join('\n'));

    const { mock } = test;
    const mockFn = mock.method(require('../lib/core/mission-utils'), 'getPrimaryBranch', () => 'main');

    try {
      captureNelAtHandoff('task-nel-bucket', {
        rootDir: tmpDir,
        missionDir,
        log: () => {},
        error: () => {},
      });

      const record = JSON.parse(fs.readFileSync(nelRecordPath, 'utf8'));
      assert.strictEqual(record.predictedBucket, 'Medium');
    } finally {
      mockFn.mock.restore();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
