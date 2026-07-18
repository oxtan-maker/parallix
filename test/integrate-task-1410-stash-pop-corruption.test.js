const test = require('node:test');
const { mock } = test;
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('node:child_process');

// Setup mocks BEFORE requiring integrate
const missionUtils = require('../dist/lib/core/mission-utils');
mock.method(missionUtils, 'getPrimaryBranch', () => 'main');

const { printIntegrationPreflight } = require('../dist/lib/commands/integrate');

// Helpers ---------------------------------------------------------------

function runGit(cwd, args, opts = {}) {
  const result = childProcess.spawnSync('git', args, {
    encoding: 'utf8',
    cwd,
    ...opts
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const err = new Error(
      `git ${args.join(' ')} failed (exit ${result.status}): ${result.stderr.trim() || result.stdout.trim()}`
    );
    // @ts-expect-error TS2339 Property 'result' does not exist on type 'Error'.
    err.result = result;
    throw err;
  }
  return result.stdout;
}

function createTestRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'integrate-1410-'));
  runGit(root, ['init']);
  runGit(root, ['config', 'user.email', 'task-1410@test.com']);
  runGit(root, ['config', 'user.name', 'Task 1410']);

  const tasksDir = path.join(root, 'backlog', 'tasks');
  fs.mkdirSync(tasksDir, { recursive: true });

  const taskFile = path.join(tasksDir, 'task-1410 - prevent-integrate-from-corrupting-main.md');
  fs.writeFileSync(taskFile, [
    '---',
    'id: TASK-1410',
    'title: Prevent integrate from corrupting main',
    'status: ready-for-integration',
    'assignee: [claude]',
    '---',
    '',
    'Status: \u25cb ready-for-integration',
    ''
  ].join('\n'));

  const missionDir = path.join(root, 'missions', 'task-1410');
  fs.mkdirSync(missionDir, { recursive: true });
  fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Mission: task-1410\n');

  runGit(root, ['add', '.']);
  runGit(root, ['commit', '-m', 'initial commit']);

  return root;
}

/**
 * Simulate the integrate stash/closeout/restore sequence.
 * Returns { corruptionDetected: boolean, details: string }.
 */
function simulateStashCloseoutRestore(root, taskFile, missionDoc) {
  const originalTaskContent = fs.readFileSync(taskFile, 'utf8');
  const originalMissionContent = fs.readFileSync(missionDoc, 'utf8');

  // Make files dirty
  const dirtyTask = originalTaskContent.replace(
    'Status: \u25cb ready-for-integration',
    'Status: \u25cb ready-for-integration\n\n<!-- operator note -->'
  );
  fs.writeFileSync(taskFile, dirtyTask, 'utf8');

  const dirtyMission = originalMissionContent + '\n<!-- operator note -->';
  fs.writeFileSync(missionDoc, dirtyMission, 'utf8');

  // Stash
  const stashResult = childProcess.spawnSync('git', [
    '-C', root, 'stash', 'push', '--include-untracked', '-m', 'integrate:task-1410: stash'
  ], { encoding: 'utf8' });
  if (stashResult.status !== 0) return { corruptionDetected: false, details: 'stash failed' };

  // Closeout: edit both files at same paths
  const closeoutTask = originalTaskContent.replace(
    'Status: \u25cb ready-for-integration',
    'Status: \u25cb done'
  );
  fs.writeFileSync(taskFile, closeoutTask, 'utf8');

  const closeoutMission = originalMissionContent.replace(
    'Mission: task-1410',
    'Mission: task-1410 (rewritten by integrate closeout)'
  );
  fs.writeFileSync(missionDoc, closeoutMission, 'utf8');

  runGit(root, ['add', '-A']);
  runGit(root, ['commit', '-m', 'mission/task-1410: closeout']);

  // Plain stash pop (the bug)
  const restoreResult = childProcess.spawnSync('git', [
    '-C', root, 'stash', 'pop'
  ], { encoding: 'utf8' });

  // Check for corruption
  const unresolvedConflicts = runGit(root, ['ls-files', '-u']);
  const dirtyStatus = runGit(root, ['status', '--porcelain']);

  const hasUnmergedConflicts = unresolvedConflicts.trim().length > 0;
  const hasDeletedTracked = dirtyStatus.includes('D backlog/') || dirtyStatus.includes('D missions/');
  const hasCollisionMarkers = dirtyStatus.includes('MM missions/') || dirtyStatus.includes('UU backlog/');

  return {
    corruptionDetected: hasUnmergedConflicts || hasDeletedTracked || hasCollisionMarkers,
    details: [
      hasUnmergedConflicts ? 'unmerged index entries' : '',
      hasDeletedTracked ? 'deleted tracked files' : '',
      hasCollisionMarkers ? 'collision markers' : ''
    ].filter(Boolean).join(', ') || 'none'
  };
}

// Tests -----------------------------------------------------------------

test('reproduction: overlapping dirty paths trigger FAIL in preflight (blocks integrate)', () => {
  // The fix upgrades overlapping dirty paths from WARN to FAIL in preflight.
  // This prevents the corruption vector from being reached.
  //
  // On unfixed code: preflight returns WARN → integrate proceeds → corruption
  // On fixed code: preflight returns FAIL → integrate blocks → no corruption

  const root = createTestRepo();
  const missionDoc = path.join(root, 'missions', 'task-1410', 'MISSION.md');
  const taskFile = path.join(root, 'backlog', 'tasks',
    'task-1410 - prevent-integrate-from-corrupting-main.md');

  try {
    // Make mission doc dirty
    const originalContent = fs.readFileSync(missionDoc, 'utf8');
    const dirtyContent = originalContent + '\n<!-- operator local note -->';
    fs.writeFileSync(missionDoc, dirtyContent, 'utf8');

    const context = {
      slug: 'task-1410',
      branch: 'mission/task-1410',
      currentBranch: 'main',
      missionDir: path.join(root, 'missions', 'task-1410'),
      task: { ok: true, taskFile },
      taskStatus: 'ready-for-integration',
      taskAssignee: 'claude',
      forgejoUser: 'claude',
      taskAssigneeWarning: null,
      pr: { exists: false },
      siblingPrs: [],
      approval: { ok: false, error: 'forgejo-off', reviewState: null },
      baseBranch: 'main',
      baseWorktree: root,
      mainBranch: 'main',
      mainDirty: true,
      mainDirtyEntries: [' M missions/task-1410/MISSION.md']
    };

    const result = printIntegrationPreflight(context, {
      readTokenFn: () => null,
      resolveTokenFileFn: () => null,
      isForgejoReviewEnabledFn: () => false,
      getUnresolvedIndexConflictsFn: () => ({ ok: true, files: [] })
    });

    // FIX VERIFICATION: overlapping dirty paths should produce FAIL
    assert.ok(result.failures.includes('main-dirty-overlap'),
      'Overlap detection should block integrate with FAIL for overlapping dirty paths.'
    );

    // Verify [STASH] prefix in fail output (fmt.log.fail uses console.error)
    const failLines = [];
    const originalError = console.error;
    console.error = line => failLines.push(line);
    try {
      printIntegrationPreflight(context, {
        readTokenFn: () => null,
        resolveTokenFileFn: () => null,
        isForgejoReviewEnabledFn: () => false,
        getUnresolvedIndexConflictsFn: () => ({ ok: true, files: [] })
      });
      const output = failLines.join('\n');
      assert.match(output, /\[STASH\]/, 'Should include [STASH] prefix for dirty-state interaction');
      assert.match(output, /overlapping paths/i, 'Should mention overlapping paths');
    } finally {
      console.error = originalError;
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('reproduction: non-overlapping dirty paths produce WARN not FAIL (narrow scope)', () => {
  // Non-overlapping dirty files should still produce WARN with [STASH] prefix.
  // This ensures the fix is narrow and doesn't over-block.

  const root = createTestRepo();
  const readme = path.join(root, 'README.md');
  fs.writeFileSync(readme, '# Project\n');
  runGit(root, ['add', 'README.md']);
  runGit(root, ['commit', '-m', 'add readme']);

  try {
    fs.writeFileSync(readme, '# Project\n\n<!-- operator note -->\n', 'utf8');

    const taskFile = path.join(root, 'backlog', 'tasks',
      'task-1410 - prevent-integrate-from-corrupting-main.md');

    const context = {
      slug: 'task-1410',
      branch: 'mission/task-1410',
      currentBranch: 'main',
      missionDir: path.join(root, 'missions', 'task-1410'),
      task: { ok: true, taskFile },
      taskStatus: 'ready-for-integration',
      taskAssignee: 'claude',
      forgejoUser: 'claude',
      taskAssigneeWarning: null,
      pr: { exists: false },
      siblingPrs: [],
      approval: { ok: false, error: 'forgejo-off', reviewState: null },
      baseBranch: 'main',
      baseWorktree: root,
      mainBranch: 'main',
      mainDirty: true,
      mainDirtyEntries: [' M README.md']
    };

    const result = printIntegrationPreflight(context, {
      readTokenFn: () => null,
      resolveTokenFileFn: () => null,
      isForgejoReviewEnabledFn: () => false,
      getUnresolvedIndexConflictsFn: () => ({ ok: true, files: [] })
    });

    assert.ok(!result.failures.includes('main-dirty-overlap'),
      'Non-overlapping dirty paths should NOT trigger overlap FAIL'
    );
    assert.ok(result.warnings.includes('main-dirty'),
      'Non-overlapping dirty paths should produce main-dirty WARN'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('reproduction: dirty task+mission files cause stash-pop collision (proves corruption vector)', () => {
  // Full reproduce: run preflight, then simulate the sequence if preflight doesn't block.
  //
  // On unfixed code: preflight returns WARN → sequence runs → corruption → FAIL (RED)
  // On fixed code: preflight returns FAIL → sequence skipped → PASS (GREEN)

  const root = createTestRepo();
  const taskFile = path.join(root, 'backlog', 'tasks',
    'task-1410 - prevent-integrate-from-corrupting-main.md');
  const missionDoc = path.join(root, 'missions', 'task-1410', 'MISSION.md');

  try {
    // Make mission doc dirty
    const originalMissionContent = fs.readFileSync(missionDoc, 'utf8');
    const dirtyMission = originalMissionContent + '\n<!-- operator note -->';
    fs.writeFileSync(missionDoc, dirtyMission, 'utf8');

    // 1. Run preflight
    const context = {
      slug: 'task-1410',
      branch: 'mission/task-1410',
      currentBranch: 'main',
      missionDir: path.join(root, 'missions', 'task-1410'),
      task: { ok: true, taskFile },
      taskStatus: 'ready-for-integration',
      taskAssignee: 'claude',
      forgejoUser: 'claude',
      taskAssigneeWarning: null,
      pr: { exists: false },
      siblingPrs: [],
      approval: { ok: false, error: 'forgejo-off', reviewState: null },
      baseBranch: 'main',
      baseWorktree: root,
      mainBranch: 'main',
      mainDirty: true,
      mainDirtyEntries: [' M missions/task-1410/MISSION.md']
    };

    const preflightResult = printIntegrationPreflight(context, {
      readTokenFn: () => null,
      resolveTokenFileFn: () => null,
      isForgejoReviewEnabledFn: () => false,
      getUnresolvedIndexConflictsFn: () => ({ ok: true, files: [] })
    });

    // FIX EXPECTATION: preflight should return FAIL for overlapping dirty paths.
    // If it does, the integrate is blocked and no corruption occurs → test passes.
    // If preflight returns WARN (unfixed code), simulate the sequence and check for corruption.
    if (preflightResult.failures.includes('main-dirty-overlap')) {
      // Fix is in place: preflight blocked the integrate. No further check needed.
      assert.ok(true, 'Preflight blocked integrate with FAIL for overlapping dirty paths.');
    } else {
      // Unfixed code: preflight only warned. Simulate the sequence and verify corruption.
      const { corruptionDetected, details } = simulateStashCloseoutRestore(root, taskFile, missionDoc);
      assert.equal(corruptionDetected, false,
        `Stash pop left corruption: ${details}. ` +
        'Fix should block via overlap detection in preflight.'
      );
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('reproduction: dirty non-overlapping file restores cleanly (sanity)', () => {
  // Sanity: dirty files outside backlog/ and missions/ should restore cleanly.
  // Passes on both unfixed and fixed code.

  const root = createTestRepo();
  const readme = path.join(root, 'README.md');
  fs.writeFileSync(readme, '# Project\n');
  runGit(root, ['add', 'README.md']);
  runGit(root, ['commit', '-m', 'add readme']);

  try {
    fs.writeFileSync(readme, '# Project\n\n<!-- operator note -->\n', 'utf8');

    const stashMsg = 'integrate:task-1410: temporary integration checkout stash';
    const stashResult = childProcess.spawnSync('git', [
      '-C', root, 'stash', 'push', '--include-untracked', '-m', stashMsg
    ], { encoding: 'utf8' });
    assert.equal(stashResult.status, 0, 'stash should succeed');

    const taskFile = path.join(root, 'backlog', 'tasks',
      'task-1410 - prevent-integrate-from-corrupting-main.md');
    const originalContent = fs.readFileSync(taskFile, 'utf8');
    const closeoutContent = originalContent.replace(
      'Status: \u25cb ready-for-integration',
      'Status: \u25cb done'
    );
    fs.writeFileSync(taskFile, closeoutContent, 'utf8');

    runGit(root, ['add', '-A']);
    runGit(root, ['commit', '-m', 'mission/task-1410: closeout']);

    const restoreResult = childProcess.spawnSync('git', [
      '-C', root, 'stash', 'pop'
    ], { encoding: 'utf8' });

    const unresolvedConflicts = runGit(root, ['ls-files', '-u']);

    assert.equal(unresolvedConflicts.trim().length, 0,
      'non-overlapping dirty files should not cause stash-pop corruption'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('cross-task regression: dirty file from different backlog task triggers FAIL (reviewer reproduction)', () => {
  // Reproduces the reviewer's exact reproduction case:
  //   printIntegrationPreflight({ slug: 'task-1404', mainDirtyEntries: [' M backlog/tasks/task-1403 - something-else.md'] })
  // On unfixed code: returns failures=[], warnings=['main-dirty'] (WRONG — should be main-dirty-overlap)
  // On fixed code: returns failures=['main-dirty-overlap'] (CORRECT — overlap detection catches all backlog tasks)
  //
  // This proves the fix is broad enough to catch cross-task corruption like the task-1404 incident.
  // Test goes RED on unfixed code because it asserts main-dirty-overlap is in failures.

  const root = createTestRepo();

  try {
    const taskFile = path.join(root, 'backlog', 'tasks',
      'task-1410 - prevent-integrate-from-corrupting-main.md');

    const context = {
      slug: 'task-1404',
      branch: 'mission/task-1404',
      currentBranch: 'main',
      missionDir: path.join(root, 'missions', 'task-1404'),
      task: { ok: true, taskFile },
      taskStatus: 'ready-for-integration',
      taskAssignee: 'claude',
      forgejoUser: 'claude',
      taskAssigneeWarning: null,
      pr: { exists: false },
      siblingPrs: [],
      approval: { ok: false, error: 'forgejo-off', reviewState: null },
      baseBranch: 'main',
      baseWorktree: root,
      mainBranch: 'main',
      mainDirty: true,
      mainDirtyEntries: [' M backlog/tasks/task-1403 - something-else.md']
    };

    const result = printIntegrationPreflight(context, {
      readTokenFn: () => null,
      resolveTokenFileFn: () => null,
      isForgejoReviewEnabledFn: () => false,
      getUnresolvedIndexConflictsFn: () => ({ ok: true, files: [] })
    });

    // Cross-task dirty file under backlog/tasks/ MUST trigger main-dirty-overlap FAIL
    assert.ok(result.failures.includes('main-dirty-overlap'),
      'Cross-task dirty file under backlog/tasks/ should trigger main-dirty-overlap FAIL. ' +
      'On unfixed code this returns only main-dirty WARN, missing the overlap entirely.'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('cross-task regression: dirty file in backlog/completed/ triggers FAIL', () => {
  // backlog/completed/ is also in the broad overlap set because closeout can touch archived tasks.
  // Test goes RED on unfixed code.

  const root = createTestRepo();

  try {
    const taskFile = path.join(root, 'backlog', 'tasks',
      'task-1410 - prevent-integrate-from-corrupting-main.md');

    const context = {
      slug: 'task-1404',
      branch: 'mission/task-1404',
      currentBranch: 'main',
      missionDir: path.join(root, 'missions', 'task-1404'),
      task: { ok: true, taskFile },
      taskStatus: 'ready-for-integration',
      taskAssignee: 'claude',
      forgejoUser: 'claude',
      taskAssigneeWarning: null,
      pr: { exists: false },
      siblingPrs: [],
      approval: { ok: false, error: 'forgejo-off', reviewState: null },
      baseBranch: 'main',
      baseWorktree: root,
      mainBranch: 'main',
      mainDirty: true,
      mainDirtyEntries: [' M backlog/completed/task-1399 - old-task.md']
    };

    const result = printIntegrationPreflight(context, {
      readTokenFn: () => null,
      resolveTokenFileFn: () => null,
      isForgejoReviewEnabledFn: () => false,
      getUnresolvedIndexConflictsFn: () => ({ ok: true, files: [] })
    });

    assert.ok(result.failures.includes('main-dirty-overlap'),
      'Dirty file under backlog/completed/ should trigger main-dirty-overlap FAIL.'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
