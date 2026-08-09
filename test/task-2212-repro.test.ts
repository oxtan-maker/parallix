


import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
const repoRoot = path.resolve(import.meta.dirname, '..');

function removeTestRepository(root) {
  try {
    childProcess.spawnSync('git', ['-C', root, 'worktree', 'remove', '--force', `${root}-task-2001`], { encoding: 'utf8' });
  } catch (_) {
    // The interrupted child may not have registered its worktree yet.
  }
  fs.rmSync(root, { recursive: true, force: true });
}

test('interrupted feature lifecycle leaves no e2e branch or worktree behind (SC1/SC2)', async () => {
  const before = new Set(fs.readdirSync(os.tmpdir()).filter(name => name.startsWith('parallix-e2e-')));
  const signalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2212-cleanup-'));
  const cleanupMarker = path.join(signalRoot, 'complete');
  const readyMarker = path.join(signalRoot, 'worktree-ready.json');
  const child = childProcess.spawn(process.execPath, [
    '--test', '--test-name-pattern=feature-branch lifecycle drafts', 'test/e2e-mission-lifecycle.test.ts'
  ], {
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_TEST_CONTEXT: undefined,
      PARALLIX_E2E_KEEP_TMP: '1',
      PARALLIX_E2E_CLEANUP_MARKER: cleanupMarker,
      PARALLIX_E2E_WORKTREE_READY_MARKER: readyMarker,
    },
    detached: process.platform !== 'win32',
    stdio: 'ignore'
  });
  const childExited = new Promise(resolve => child.once('exit', resolve));
  // The integration runner executes this alongside other process-heavy suites.
  // Allow the child to finish its real Git/bootstrap work under contention;
  // the ready marker still makes the wait finish immediately in isolation.
  const deadline = Date.now() + 30000;
  let fixtureRoot;
  let worktree;

  try {
    while (Date.now() < deadline) {
      if (fs.existsSync(readyMarker)) {
        const fixture = JSON.parse(fs.readFileSync(readyMarker, 'utf8'));
        fixtureRoot = fixture.tmpRoot;
        worktree = fixture.worktree;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.ok(fixtureRoot, 'the failed-test fixture should be created');
    assert.ok(worktree && fs.existsSync(worktree), 'the lifecycle should create its test worktree before interruption');
    if (process.platform === 'win32') {
      child.kill('SIGKILL');
    } else {
      process.kill(-child.pid, 'SIGKILL');
    }
    await childExited;

    const fixtureRepo = path.join(fixtureRoot, 'repo');
    while (!fs.existsSync(cleanupMarker)) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.ok(fs.existsSync(cleanupMarker), 'the detached cleanup watcher must report completion');
    const branch = childProcess.spawnSync('git', ['-C', fixtureRepo, 'branch', '--list', 'feature/e2e-base'], { encoding: 'utf8' });
    assert.equal((branch.stdout || '').trim(), '', 'feature/e2e-base must be removed after interruption');
    assert.equal(fs.existsSync(worktree), false, 'the e2e test worktree must be removed after interruption');
  } finally {
    if (!child.killed) child.kill('SIGKILL');
    if (fixtureRoot) removeTestRepository(fixtureRoot);
    fs.rmSync(signalRoot, { recursive: true, force: true });
  }
});

test('interrupted review fixture leaves no TASK-2198 stale-active task behind (SC1/SC3)', async () => {
  const hookDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2212-review-hook-'));
  const readyFile = path.join(hookDir, 'fixture-ready');
  const hookFile = path.join(hookDir, 'pause-after-fixture.js');
  // The hook is loaded through `--require`, so it is CommonJS and resolves its
  // own `fs` regardless of the module system of this file.
  fs.writeFileSync(hookFile, `
const fs = require('node:fs');
const original = fs.writeFileSync;
fs.writeFileSync = function (file, data, ...rest) {
  const result = original.call(this, file, data, ...rest);
  if (String(file).endsWith('task-2198 - stale-active.md')) {
    original.call(this, ${JSON.stringify(readyFile)}, JSON.stringify({ taskFile: String(file), pid: process.pid }));
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000);
  }
  return result;
};
`, 'utf8');
  // `review.test.ts` imports TypeScript helpers by their `.js` specifier and
  // installs `mock.module()` seams, so the child needs the same loader and
  // module-mock flag the integration runner uses.
  const child = childProcess.spawn(process.execPath, [
    '--import', 'tsx', '--experimental-test-module-mocks',
    '--test', '--test-name-pattern=repairs active', 'test/review.test.ts'
  ], {
    cwd: repoRoot,
    env: { ...process.env, NODE_TEST_CONTEXT: undefined, NODE_OPTIONS: `--require=${hookFile}` },
    stdio: 'ignore'
  });
  const childExited = new Promise(resolve => child.once('exit', resolve));
  let taskFile;
  let fixturePid;

  try {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline && !fs.existsSync(readyFile)) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.ok(fs.existsSync(readyFile), 'the review fixture should be created before interruption');
    const fixture = JSON.parse(fs.readFileSync(readyFile, 'utf8'));
    taskFile = fixture.taskFile;
    fixturePid = fixture.pid;
    process.kill(fixturePid, 'SIGKILL');
    await childExited;
    const cleanupDeadline = Date.now() + 5000;
    while (fs.existsSync(taskFile) && Date.now() < cleanupDeadline) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(fs.existsSync(taskFile), false, 'TASK-2198 stale-active fixture must be removed after interruption');
  } finally {
    if (!child.killed) child.kill('SIGKILL');
    if (taskFile) fs.rmSync(path.dirname(path.dirname(path.dirname(taskFile))), { recursive: true, force: true });
    fs.rmSync(hookDir, { recursive: true, force: true });
  }
});
