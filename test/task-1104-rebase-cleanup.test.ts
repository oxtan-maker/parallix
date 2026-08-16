

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import childProcess from 'child_process';
import { mockModule, installModuleMocks } from './lib/module-mock.js';
const rebaseBeforeReviewRoundModule = mockModule<typeof import('../src/adapters/review/rebase.js')>('../src/adapters/review/rebase.js', import.meta.url);
await installModuleMocks();
test.afterEach(() => mock.restoreAll());
const { rebaseBeforeReviewRound } = rebaseBeforeReviewRoundModule;
const { mock } = test;

async function withTempGitRepo(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-test-rebase-'));
  try {
    childProcess.spawnSync('git', ['init', '-b', 'master'], { cwd: root });
    childProcess.spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
    childProcess.spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: root });
    await fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('rebaseBeforeReviewRound auto-commits safe mission artifacts', async () => {
  await withTempGitRepo(async (root) => {
    const slug = 'task-1104';
    const missionDir = path.join(root, 'docs', 'missions', '2026', slug);
    fs.mkdirSync(missionDir, { recursive: true });
    const missionPath = path.join(missionDir, 'MISSION.md');
    fs.writeFileSync(missionPath, '# MISSION');

    const taskDir = path.join(root, 'backlog', 'tasks');
    fs.mkdirSync(taskDir, { recursive: true });
    const taskPath = path.join(taskDir, 'task-1104.md');
    fs.writeFileSync(taskPath, 'id: TASK-1104\nstatus: active');

    childProcess.spawnSync('git', ['add', '.'], { cwd: root });
    childProcess.spawnSync('git', ['commit', '-m', 'initial'], { cwd: root });

    // Make MISSION.md dirty
    fs.writeFileSync(missionPath, '# MISSION - modified');

    const logs = [];
    const rebaseCalls = [];
    // In-process rebase-workflow seam (TASK-2377.02): the pre-review rebase no
    // longer spawns the `px rebase` CLI, so the workflow is driven in-process.
    const result = await rebaseBeforeReviewRound(slug, {
      worktree: root,
      taskFile: taskPath,
      // Exercise the Forgejo-enabled path: rebase runs after the safe-artifact commit.
      isForgejoReviewEnabledFn: () => true,
      createRebaseWorkflowPortFn: () =>
        // Partial seam double: only `exit` is touched by this test's workflow fn.
        ({ exit: () => {} } as unknown as import('../src/application/ports/rebase-workflow.js').RebaseWorkflowPort),
      runRebaseWorkflowFn: async (args, workflowPort) => {
        rebaseCalls.push(args);
        workflowPort.exit(0);
      },
      log: m => logs.push(m)
    });

    assert.equal(result.ok, true);

    // Verify auto-commit
    const statusRes = childProcess.spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
    const status = (statusRes.stdout || '').trim();
    assert.equal(status, '', 'Worktree should be clean after auto-commit');

    const lastCommitRes = childProcess.spawnSync('git', ['log', '-1', '--format=%s'], { cwd: root, encoding: 'utf8' });
    const lastCommit = (lastCommitRes.stdout || '').trim();
    assert.equal(lastCommit, 'workflow(task-1104): auto-commit mission artifacts before pre-review rebase');

    assert.ok(logs.some(m => m.includes('Auto-committing safe mission artifacts')));
    assert.equal(rebaseCalls.length, 1, 'Should have driven the rebase workflow in-process');
    assert.deepEqual(rebaseCalls[0], [slug, '--push']);
  });
});

test('rebaseBeforeReviewRound does NOT auto-commit unsafe files', async () => {
  await withTempGitRepo(async (root) => {
    const slug = 'task-1104';
    const unsafePath = path.join(root, 'unsafe.js');
    fs.writeFileSync(unsafePath, 'console.log(1)');

    childProcess.spawnSync('git', ['add', '.'], { cwd: root });
    childProcess.spawnSync('git', ['commit', '-m', 'initial'], { cwd: root });

    // Make unsafe file dirty
    fs.writeFileSync(unsafePath, 'console.log(2)');

    const errors = [];
    const runFn = mock.fn(() => ({ status: 1, stdout: '', stderr: 'dirty worktree' }));

    const result = await rebaseBeforeReviewRound(slug, {
      worktree: root,
      runFn,
      error: m => errors.push(m)
    });

    assert.equal(result.ok, false);

    // Verify NOT auto-committed
    const statusRes = childProcess.spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
    const status = (statusRes.stdout || '').trim();
    assert.ok(status.includes('unsafe.js'), 'Unsafe file should still be dirty');

    assert.ok(errors.some(m => m.includes('Worktree is dirty with unsafe or conflicted files')));
  });
});
