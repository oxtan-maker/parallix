


import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);
import { parseConflictFilesFromMergeOutput, getConflictFiles, findLastNonNoiseCommit, squashTrailingBacklogNoiseIntoPreviousMission, softResetTrailingBacklogNoise, findMissionDocInBranches, isMissionArtifact, } from '../src/adapters/filesystem/mission-utils.js';
test('parseConflictFilesFromMergeOutput parses content and modify/delete conflicts and deduplicates paths', () => {
  const output = [
    'CONFLICT (content): Merge conflict in workflow/lib/file.js',
    'CONFLICT (modify/delete): docs/missions/2026/task-132/CP-1.md deleted in HEAD.',
    'CONFLICT (content): Merge conflict in workflow/lib/file.js',
  ].join('\n');

  assert.deepEqual(parseConflictFilesFromMergeOutput(output), [
    'workflow/lib/file.js',
    'docs/missions/2026/task-132/CP-1.md'
  ]);
});

test('getConflictFiles returns conflict paths, empty arrays for clean merges, and throws on non-conflict failures', () => {
  const calls = [];
  const conflicts = getConflictFiles('/tmp/worktree', 'main', {
    gitRunner: args => {
      calls.push(args);
      if (args.includes('--abort')) return { status: 0, stdout: '', stderr: '' };
      return {
        status: 1,
        stdout: '',
        stderr: 'CONFLICT (content): Merge conflict in workflow/lib/file.js\n'
      };
    }
  });
  assert.deepEqual(conflicts, ['workflow/lib/file.js']);
  assert.ok(calls.some(args => args.includes('--abort')));

  const clean = getConflictFiles('/tmp/worktree', 'main', {
    gitRunner: args => ({ status: 0, stdout: '', stderr: '' })
  });
  assert.deepEqual(clean, []);

  assert.throws(
    () => getConflictFiles('/tmp/worktree', 'main', {
      gitRunner: args => {
        if (args.includes('--abort')) return { status: 0, stdout: '', stderr: '' };
        return { status: 2, stdout: '', stderr: 'fatal: index.lock' };
      }
    }),
    /no CONFLICT lines/
  );
});

test('findLastNonNoiseCommit skips trailing backlog noise and stops on shared commits', () => {
  const responses = {
    'rev-parse --symbolic-full-name HEAD': 'refs/heads/mission/task-132',
    'rev-parse HEAD': 'sha-head',
    'rev-parse HEAD^': 'sha-prev',
    'branch -a --contains sha-head --format=%(refname)': 'refs/heads/mission/task-132',
    'branch -a --contains sha-prev --format=%(refname)': 'refs/heads/mission/task-132',
    'log -1 --format=%s HEAD': 'Update task TASK-132',
    'log -1 --format=%s HEAD^': 'mission/task-132: real implementation',
    'diff-tree --no-commit-id --name-only -r HEAD': 'backlog/tasks/task-132 - sample.md',
    'diff-tree --no-commit-id --name-only -r HEAD^': 'workflow/lib/core/runtime-matrix.js'
  };
  const runner = args => ({ status: 0, stdout: responses[args.slice(2).join(' ')] || '', stderr: '' });
  assert.equal(findLastNonNoiseCommit('/tmp/worktree', runner), 'HEAD^');

  const sharedRunner = args => {
    if (args.includes('--contains') && args.includes('sha-head')) {
      return { status: 0, stdout: 'refs/heads/mission/task-132\nrefs/remotes/review/mission/task-132\n', stderr: '' };
    }
    return runner(args);
  };
  assert.equal(findLastNonNoiseCommit('/tmp/worktree', sharedRunner), null);
});

test('squashTrailingBacklogNoiseIntoPreviousMission and softResetTrailingBacklogNoise refuse dirty trees and run resets on clean ones', () => {
  const dirtyLogs = [];
  const originalLog = console.log;
  console.log = msg => dirtyLogs.push(msg);
  try {
    const dirtyRunner = args => ({ status: 0, stdout: args.includes('status') ? ' M backlog/tasks/task.md' : '', stderr: '' });
    assert.equal(squashTrailingBacklogNoiseIntoPreviousMission('/tmp/worktree', dirtyRunner), false);
    assert.equal(softResetTrailingBacklogNoise('/tmp/worktree', dirtyRunner), false);
  } finally {
    console.log = originalLog;
  }
  assert.ok(dirtyLogs.some(msg => msg.includes('worktree is not clean')));

  const calls = [];
  const cleanResponses = {
    'status --porcelain': '',
    'rev-parse --symbolic-full-name HEAD': 'refs/heads/mission/task-132',
    'rev-parse HEAD': 'sha-head',
    'rev-parse HEAD^': 'sha-base',
    'branch -a --contains sha-head --format=%(refname)': 'refs/heads/mission/task-132',
    'branch -a --contains sha-base --format=%(refname)': 'refs/heads/mission/task-132',
    'log -1 --format=%s HEAD': 'Update task TASK-132',
    'log -1 --format=%s HEAD^': 'mission/task-132: real implementation',
    'diff-tree --no-commit-id --name-only -r HEAD': 'backlog/tasks/task.md',
    'diff-tree --no-commit-id --name-only -r HEAD^': 'workflow/lib/tools/backlog.js',
    'log -1 --format=%aD sha-base': 'Thu, 07 May 2026 18:00:00 +0200'
  };
  const cleanRunner = args => {
    calls.push(args);
    const key = args.slice(2).join(' ');
    return { status: 0, stdout: cleanResponses[key] || '', stderr: '' };
  };

  assert.equal(squashTrailingBacklogNoiseIntoPreviousMission('/tmp/worktree', cleanRunner), true);
  assert.ok(calls.some(args => args.includes('--soft')));
  assert.ok(calls.some(args => args.includes('--amend')));

  const resetCalls = [];
  const resetRunner = args => {
    resetCalls.push(args);
    const key = args.slice(2).join(' ');
    return { status: 0, stdout: cleanResponses[key] || '', stderr: '' };
  };
  assert.equal(softResetTrailingBacklogNoise('/tmp/worktree', resetRunner), true);
  assert.ok(resetCalls.some(args => args.includes('--soft')));
});

test('findMissionDocInBranches finds mission docs on slug and base-slug branches and ignores branch lookup failures', () => {
  const runner = args => {
    const key = args.slice(2).join(' ');
    if (key === 'branch -a --format=%(refname:short)') {
      return {
        status: 0,
        stdout: 'mission/task-132\nreview/task-132-refresh\nmain\n',
        stderr: ''
      };
    }
    if (args.includes('ls-tree')) {
      const branch = args[4];
      const file = args[5];
      const match = (branch === 'mission/task-132' && file === 'missions/task-132/MISSION.md')
        || (branch === 'review/task-132-refresh' && file === 'missions/task-132/MISSION.md');
      return { status: 0, stdout: match ? file : '', stderr: '' };
    }
    return { status: 0, stdout: '', stderr: '' };
  };

  const candidates = findMissionDocInBranches('task-132-refresh', '/tmp/root', runner);
  assert.deepEqual(candidates, [
    { branch: 'mission/task-132', path: 'missions/task-132/MISSION.md' },
    { branch: 'review/task-132-refresh', path: 'missions/task-132/MISSION.md' }
  ]);

  const empty = findMissionDocInBranches('task-132', '/tmp/root', () => {
    throw new Error('git failed');
  });
  assert.deepEqual(empty, []);
});

// ============================================================
// Bug reproduction tests (task-1202)
// ============================================================

test('isMissionArtifact respects adapter baseDir instead of hardcoded docs/missions', () => {
  const root = fs.mkdtempSync(path.join(_require('os').tmpdir(), 'workflow-mission-utils-'));
  try {
    // Create a custom adapter config that sets baseDir to 'missions' (without docs/)
    fs.mkdirSync(path.join(root, 'workflow'), { recursive: true });
    fs.writeFileSync(path.join(root, 'workflow', 'index.js'), '// stub\n');
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
      adapters: {
        missions: { baseDir: 'missions' }
      }
    }, null, 2));

    // Create a mission file at the flat adapter-resolved default path.
    const missionFile = 'missions/task-133/CP-1.md';
    fs.mkdirSync(path.join(root, 'missions', 'task-133'), { recursive: true });
    fs.writeFileSync(path.join(root, 'missions', 'task-133', 'CP-1.md'), '# CP-1');

    // With the bug, isMissionArtifact uses hardcoded 'docs/missions' and returns false
    // After fix, it should return true because the adapter baseDir is 'missions'
    assert.ok(isMissionArtifact(missionFile, 'task-133', root), 'should identify mission artifact at adapter baseDir path');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('findMissionDocInBranches uses exact slug matching, not substring', () => {
  const runner = args => {
    const key = args.slice(2).join(' ');
    if (key === 'branch -a --format=%(refname:short)') {
      return {
        status: 0,
        stdout: 'mission/task-101\nmission/task-1010\nmain\n',
        stderr: ''
      };
    }
    if (args.includes('ls-tree')) {
      const branch = args[4];
      const file = args[5];
      // Both branches have the task-101 file (simulating a branch that was renamed from task-101 to task-1010 but still has the old file)
      if (
        (branch === 'mission/task-101' && file === 'missions/task-101/MISSION.md') ||
        (branch === 'mission/task-1010' && file === 'missions/task-101/MISSION.md')
      ) {
        return { status: 0, stdout: file, stderr: '' };
      }
      return { status: 1, stdout: '', stderr: '' };
    }
    return { status: 0, stdout: '', stderr: '' };
  };

  // Query for task-101 should NOT match task-1010 branch (exact match only)
  const candidates = findMissionDocInBranches('task-101', '/tmp/root', runner);
  assert.equal(candidates.length, 1, 'should only find exact slug match, not substring match');
  assert.equal(candidates[0].branch, 'mission/task-101');
  assert.equal(candidates[0].path, 'missions/task-101/MISSION.md');
});
