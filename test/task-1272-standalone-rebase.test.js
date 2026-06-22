/**
 * task-1272: standalone (Forgejo-disabled) pre-review rebase behavior.
 *
 * When the review provider is not Forgejo, `rebaseBeforeReviewRound` must still
 * commit safe worktree state (so the reviewer sees a clean tree) but skip the
 * Forgejo-backed rebase entirely. See MISSION.md Scope (CP-1) and the Risk note.
 */
const test = require('node:test');
const { mock } = test;
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');
const { rebaseBeforeReviewRound } = require('../lib/review/review');

async function withTempGitRepo(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-test-1272-'));
  try {
    childProcess.spawnSync('git', ['init', '-b', 'master'], { cwd: root });
    childProcess.spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
    childProcess.spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: root });
    await fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('rebaseBeforeReviewRound commits safe artifacts and skips rebase when Forgejo is disabled', async () => {
  await withTempGitRepo(async (root) => {
    const slug = 'task-1272';
    const missionDir = path.join(root, 'docs', 'missions', '2026', slug);
    fs.mkdirSync(missionDir, { recursive: true });
    const missionPath = path.join(missionDir, 'MISSION.md');
    fs.writeFileSync(missionPath, '# MISSION');

    childProcess.spawnSync('git', ['add', '.'], { cwd: root });
    childProcess.spawnSync('git', ['commit', '-m', 'initial'], { cwd: root });

    // Make a safe mission artifact dirty.
    fs.writeFileSync(missionPath, '# MISSION - modified');

    const logs = [];
    const runFn = mock.fn(() => ({ status: 0, stdout: 'success', stderr: '' }));

    const result = await rebaseBeforeReviewRound(slug, {
      worktree: root,
      runFn,
      isForgejoReviewEnabledFn: () => false,
      log: m => logs.push(m)
    });

    assert.equal(result.ok, true, 'standalone rebase should succeed');
    assert.equal(result.sharedFileConflicts, false);

    // Worktree state was committed (safe artifacts), leaving a clean tree.
    const status = (childProcess.spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).stdout || '').trim();
    assert.equal(status, '', 'Worktree should be clean after standalone commit');

    const lastCommit = (childProcess.spawnSync('git', ['log', '-1', '--format=%s'], { cwd: root, encoding: 'utf8' }).stdout || '').trim();
    assert.equal(lastCommit, 'workflow(task-1272): auto-commit mission artifacts before pre-review rebase');

    // Rebase CLI must NOT be invoked in standalone mode.
    assert.equal(runFn.mock.callCount(), 0, 'rebase CLI should be skipped when Forgejo is disabled');
    assert.ok(logs.some(m => /skipping pre-review rebase/.test(m)), 'should log that rebase was skipped');
  });
});

test('rebaseBeforeReviewRound still blocks on unsafe dirty files in standalone mode', async () => {
  await withTempGitRepo(async (root) => {
    const slug = 'task-1272';
    const unsafePath = path.join(root, 'unsafe.js');
    fs.writeFileSync(unsafePath, 'console.log(1)');

    childProcess.spawnSync('git', ['add', '.'], { cwd: root });
    childProcess.spawnSync('git', ['commit', '-m', 'initial'], { cwd: root });
    fs.writeFileSync(unsafePath, 'console.log(2)');

    const errors = [];
    const runFn = mock.fn(() => ({ status: 0, stdout: '', stderr: '' }));

    const result = await rebaseBeforeReviewRound(slug, {
      worktree: root,
      runFn,
      isForgejoReviewEnabledFn: () => false,
      error: m => errors.push(m)
    });

    assert.equal(result.ok, false, 'unsafe dirty files must block before the skip path');
    assert.equal(runFn.mock.callCount(), 0, 'rebase CLI not called on unsafe block');
    const status = (childProcess.spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).stdout || '').trim();
    assert.ok(status.includes('unsafe.js'), 'unsafe file should remain dirty');
  });
});
