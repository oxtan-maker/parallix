// @ts-nocheck -- TASK-2535: inline doubles for integrate-conflict seams; mirrors the
// mockModule/@ts-nocheck pattern in test/stats-backfill.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as ic from '../src/adapters/cli/commands/integrate-conflict.js';

function tempDir(prefix = 'integrate-conflict-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
function cleanup(dir) { fs.rmSync(dir, { recursive: true, force: true }); }

test('areAllBacklogOnlyConflicts treats an empty list as backlog-only', () => {
  assert.equal(ic.areAllBacklogOnlyConflicts([]), true);
});

test('areAllBacklogOnlyConflicts classifies backlog vs shared files', () => {
  assert.equal(ic.areAllBacklogOnlyConflicts(['backlog/tasks/task-1 - X.md']), true);
  assert.equal(ic.areAllBacklogOnlyConflicts(['src/app.ts', 'backlog/tasks/task-1 - X.md']), false);
});

test('parseStashPopCollisionFiles extracts colliding file paths', () => {
  const output = [
    'error: could not create dir at backlog/tasks: Already exists, no checkout',
    'error: while checking file src/app.ts: Already exists, no checkout',
    'Everything up to date',
  ].join('\n');
  assert.deepEqual(ic.parseStashPopCollisionFiles(output), [
    'error: could not create dir at backlog/tasks:',
    'error: while checking file src/app.ts:',
  ]);
});

test('parseStashPopCollisionFiles returns an empty list when there are no collisions', () => {
  assert.deepEqual(ic.parseStashPopCollisionFiles('Everything up to date\n'), []);
});

test('prepareNoisePatchForSquash captures a staged diff and resets the checkout', () => {
  const dir = tempDir();
  try {
    const calls = [];
    const result = ic.prepareNoisePatchForSquash(dir, {
      gitRunner: (args) => {
        calls.push(args.join(' '));
        if (args.includes('diff')) { return { status: 0, stdout: 'PATCHDATA', stderr: '' }; }
        return { status: 0, stdout: '', stderr: '' }; // reset --hard
      },
    });
    assert.equal(result.ok, true);
    assert.ok(result.patchPath && result.patchPath.endsWith('backlog-noise.patch'));
    assert.ok(fs.existsSync(result.patchPath));
    assert.match(calls.join('\n'), /diff --cached --binary/);
    assert.match(calls.join('\n'), /reset --hard HEAD/);
    result.cleanup();
    assert.equal(fs.existsSync(result.patchPath), false);
  } finally { cleanup(dir); }
});

test('prepareNoisePatchForSquash returns null patchPath when the staged diff is empty', () => {
  const dir = tempDir();
  try {
    const result = ic.prepareNoisePatchForSquash(dir, {
      gitRunner: () => ({ status: 0, stdout: '', stderr: '' }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.patchPath, null);
    assert.equal(typeof result.cleanup, 'function');
  } finally { cleanup(dir); }
});

test('prepareNoisePatchForSquash reports a diff failure', () => {
  const result = ic.prepareNoisePatchForSquash('/repo', {
    gitRunner: () => ({ status: 1, stdout: '', stderr: 'diff failed' }),
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /diff failed/);
});

test('restoreNoisePatchAfterSquash is a no-op without a patch path', () => {
  assert.deepEqual(ic.restoreNoisePatchAfterSquash('/repo', null), { ok: true });
});

test('restoreNoisePatchAfterSquash applies the patch or reports failure', () => {
  const applied = ic.restoreNoisePatchAfterSquash('/repo', '/tmp/x.patch', {
    gitRunner: () => ({ status: 0, stdout: '', stderr: '' }),
  });
  assert.deepEqual(applied, { ok: true });

  const failed = ic.restoreNoisePatchAfterSquash('/repo', '/tmp/x.patch', {
    gitRunner: () => ({ status: 1, stdout: '', stderr: 'apply failed' }),
  });
  assert.equal(failed.ok, false);
  assert.match(failed.error, /apply failed/);
});

test('getUnresolvedIndexConflicts parses unmerged index entries', () => {
  const result = ic.getUnresolvedIndexConflicts('/repo', {
    gitRunner: () => ({ status: 0, stdout: '100644 1 1\tbacklog/tasks/task-1 - X.md\n', stderr: '' }),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.files, ['backlog/tasks/task-1 - X.md']);
});

test('getUnresolvedIndexConflicts reports a git failure', () => {
  const result = ic.getUnresolvedIndexConflicts('/repo', {
    gitRunner: () => ({ status: 1, stdout: '', stderr: 'ls-files failed' }),
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.files, []);
});

test('maybeDropStashAfterCollision returns null when unmerged conflicts remain', () => {
  const result = ic.maybeDropStashAfterCollision(
    { stdout: '', stderr: '', status: 1 },
    '/repo',
    {
      // The real getUnresolvedIndexConflicts runs against this runner.
      gitRunner: () => ({ status: 0, stdout: '100644 1 1\tbacklog/x\n', stderr: '' }),
    },
  );
  assert.equal(result, null);
});

test('maybeDropStashAfterCollision returns null when a collision file is missing', () => {
  const dir = tempDir();
  try {
    const result = ic.maybeDropStashAfterCollision(
      { stdout: 'error: while checking file missing.txt: Already exists, no checkout\n', stderr: '', status: 1 },
      dir,
      {
        gitRunner: () => ({ status: 0, stdout: '', stderr: '' }),
        getUnresolvedIndexConflictsFn: () => ({ ok: true, files: [] }),
      },
    );
    assert.equal(result, null);
  } finally { cleanup(dir); }
});

test('maybeDropStashAfterCollision drops the stash when there are no unmerged conflicts', () => {
  const dir = tempDir();
  try {
    const result = ic.maybeDropStashAfterCollision(
      { stdout: 'nothing to restore', stderr: '', status: 1 },
      dir,
      {
        gitRunner: () => ({ status: 0, stdout: '', stderr: '' }),
      },
    );
    assert.deepEqual(result, { ok: true, ref: 'stash@{0}' });
  } finally { cleanup(dir); }
});

test('resolveConflictsForMission reports a missing worktree', () => {
  const missing = path.join(tempDir(), 'nope');
  const result = ic.resolveConflictsForMission('task-1', 'docs', {
    resolveWorktreeFn: () => missing,
    getConflictFilesFn: () => [],
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'worktree-missing');
});

test('resolveConflictsForMission reports no conflicts when the worktree check is empty', () => {
  const dir = tempDir();
  try {
    const result = ic.resolveConflictsForMission('task-1', 'docs', {
      resolveWorktreeFn: () => dir,
      getConflictFilesFn: () => [],
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.conflictFiles, []);
    assert.deepEqual(result.sharedFiles, []);
  } finally { cleanup(dir); }
});

test('resolveConflictsForMission flags shared-file conflicts requiring manual resolution', () => {
  const dir = tempDir();
  try {
    const result = ic.resolveConflictsForMission('task-1', 'docs', {
      resolveWorktreeFn: () => dir,
      getConflictFilesFn: () => ['src/app.ts', 'README.md'],
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'shared-file-conflicts');
    assert.deepEqual(result.sharedFiles, ['src/app.ts', 'README.md']);
    assert.deepEqual(result.missionSpecificFiles, []);
  } finally { cleanup(dir); }
});

test('buildConflictResolutionPrompt targets the provided base branch', () => {
  const prompt = ic.buildConflictResolutionPrompt('task-1', 'docs', { baseBranch: 'main' });
  const text = prompt.join('\n');
  assert.match(text, /git rebase main/);
  assert.match(text, /px integrate task-1 --dry-run/);
});

test('buildConflictResolutionPrompt falls back to the primary branch when none is provided', () => {
  const prompt = ic.buildConflictResolutionPrompt('task-1', 'docs', {});
  assert.ok(prompt.join('\n').length > 0);
});
