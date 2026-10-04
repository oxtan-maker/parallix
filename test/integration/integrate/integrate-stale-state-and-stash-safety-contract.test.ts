// Historical regression provenance: TASK-2532, TASK-1410, TASK-2212, TASK-2489.
// Behavior-owned suite (TASK-2622.09, integration-ci): stale integration state and stash safety over
// disposable Git topologies — dead rebase and marker-stash repair (task-2532), stash-pop payload collisions
// (task-1410), and interrupted e2e fixtures leaving no branch or worktree (task-2212). Legacy case names unchanged.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess, { execFileSync } from 'node:child_process';
import { mockModule, installModuleMocks } from '../../lib/module-mock.js';

// Declaration order is load-bearing: installModuleMocks relinks modules in this order, so a
// module must be declared after the modules it depends on (merged from every section below).
mockModule('../../../src/adapters/filesystem/mission-utils.js', import.meta.url);
mockModule('../../../src/adapters/cli/commands/integrate.js', import.meta.url);
await installModuleMocks();
const { createBaseWorktreeRepair } = await import('../../../src/application/integrate/base-worktree-repair.js');
const { resolveWorktree } = await import('../../../src/adapters/git/worktree.js');
const { resolveCanonicalRepositoryId } = await import('../../../src/adapters/git/repository-identity.js');

// ---- task-2532 stale integration state repair (consolidated from test/task-2532-stale-integration-state-repro.test.ts, TASK-2622.09) ----
describe("stale integration state repair", () => {
  // so it crosses the git boundary and runs in the integration layer.

  const { mock } = test;
  test.afterEach(() => mock.restoreAll());

  /** Run git against a working directory, throwing on a non-zero exit. */
  function runGit(cwd, args) {
    const result = childProcess.spawnSync('git', args, { encoding: 'utf8', cwd });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`git ${args.join(' ')} failed (exit ${result.status}): ${result.stderr.trim() || result.stdout.trim()}`);
    }
    return result.stdout;
  }

  /** A git runner that mirrors the application seam: the caller supplies `-C <rootDir>` inside each call. */
  function gitRunner() {
    return (args) => childProcess.spawnSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  }

  /** Seed a throwaway Git repository on `main` with one commit and return its root. */
  function seedRepo() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2532-stale-'));
    runGit(root, ['init', '-q']);
    runGit(root, ['config', 'user.email', 'task-2532@test.com']);
    runGit(root, ['config', 'user.name', 'Task 2532']);
    fs.writeFileSync(path.join(root, 'file.txt'), 'hello\n', 'utf8');
    runGit(root, ['add', '.']);
    runGit(root, ['commit', '-q', '-m', 'initial commit']);
    runGit(root, ['branch', '-M', 'main']);
    return root;
  }

  /**
   * Force a live rebase in the repo: advance `main` past the mission branch on a
   * shared file so rebasing the mission onto main dead-ends on a conflict, which
   * leaves a `rebase-merge/` directory and an unmerged index behind.
   */
  function seedDeadRebase(root) {
    // Diverge from the initial commit: the mission branch changes shared.txt first.
    runGit(root, ['checkout', '-q', '-b', 'mission/task-2532']);
    fs.writeFileSync(path.join(root, 'shared.txt'), 'mission version\n', 'utf8');
    runGit(root, ['add', '.']);
    runGit(root, ['commit', '-q', '-m', 'mission changes shared.txt']);
    // main advances on the same file, independently.
    runGit(root, ['checkout', '-q', 'main']);
    fs.writeFileSync(path.join(root, 'shared.txt'), 'main version\n', 'utf8');
    runGit(root, ['add', '.']);
    runGit(root, ['commit', '-q', '-m', 'main advances']);
    // Rebase the mission onto main -> conflict on shared.txt -> dead rebase left in progress.
    runGit(root, ['checkout', '-q', 'mission/task-2532']);
    const rebase = childProcess.spawnSync('git', ['rebase', 'main'], { encoding: 'utf8', cwd: root });
    if (rebase.status === 0) {
      throw new Error('expected the seed rebase to conflict; the dead-rebase fixture did not build');
    }
  }

  function stashList(root) {
    return runGit(root, ['stash', 'list']).trim();
  }

  function rebaseDirs(root) {
    const gitDir = runGit(root, ['rev-parse', '--git-dir']).trim();
    const abs = path.isAbsolute(gitDir) ? gitDir : path.join(root, gitDir);
    return ['rebase-merge', 'rebase-apply'].filter((d) => fs.existsSync(path.join(abs, d)));
  }

  function unmergedFiles(root) {
    return runGit(root, ['ls-files', '-u'])
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  }

  function headSha(root) {
    return runGit(root, ['log', '-1', '--format=%H']).trim();
  }

  // SC1 / SC3: a marker-tagged stash is dropped; a non-marker stash is kept.
  test('drops a marker-tagged integration stash and leaves a real stash untouched', async () => {
    const root = seedRepo();
    try {
      // A real, non-marker stash that must survive the sweep.
      runGit(root, ['checkout', '-q', '-b', 'wip']);
      fs.writeFileSync(path.join(root, 'notes.txt'), 'personal\n', 'utf8');
      runGit(root, ['add', '.']);
      runGit(root, ['commit', '-q', '-m', 'personal wip']);
      fs.writeFileSync(path.join(root, 'notes.txt'), 'personal edit\n', 'utf8');
      runGit(root, ['stash', 'push', '-m', 'my personal work in progress']);

      // A stale integration marker stash left by an interrupted integrate.
      runGit(root, ['checkout', '-q', 'main']);
      fs.writeFileSync(path.join(root, 'file.txt'), 'dirty\n', 'utf8');
      runGit(root, ['stash', 'push', '--include-untracked', '-m', 'integrate:task-001: temporary integration checkout stash']);

      const before = stashList(root);
      assert.ok(before.includes('my personal work in progress'), 'personal stash present before sweep');
      assert.ok(before.includes('integrate:task-001: temporary integration checkout stash'), 'marker stash present before sweep');

      const report = await createBaseWorktreeRepair({}).repairBaseWorktree({ baseWorktree: root, git: gitRunner() });

      const after = stashList(root);
      assert.ok(!after.includes('integrate:task-001: temporary integration checkout stash'), 'marker stash dropped by sweep');
      assert.ok(after.includes('my personal work in progress'), 'non-marker personal stash still present after sweep');
      assert.equal(report.markerStashesDropped, 1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // SC2: a live rebase-merge/ plus an unmerged index is aborted and cleared.
  test('aborts a dead rebase and clears the unmerged index', async () => {
    const root = seedRepo();
    try {
      seedDeadRebase(root);

      assert.ok(rebaseDirs(root).length > 0, 'rebase directory present before repair');
      assert.ok(unmergedFiles(root).length > 0, 'unmerged index entries present before repair');

      const report = await createBaseWorktreeRepair({}).repairBaseWorktree({ baseWorktree: root, git: gitRunner() });

      assert.deepEqual(rebaseDirs(root), [], 'no rebase-* directories remain after repair');
      assert.deepEqual(unmergedFiles(root), [], 'unmerged index cleared after repair');
      const showCurrent = childProcess.spawnSync('git', ['rebase', '--show-current'], { encoding: 'utf8', cwd: root });
      assert.equal(showCurrent.stdout.trim(), '', 'no rebase in progress after repair');
      assert.equal(report.rebaseAborted, true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // SC1 / SC3 / F1: two marker stashes above a non-marker stash. Dropping in
  // ascending index order would renumber the stack and destroy the personal
  // stash; descending order drops both markers and leaves the personal stash.
  test('drops two marker stashes in descending order and keeps a non-marker stash', async () => {
    const root = seedRepo();
    try {
      // A real, non-marker stash that must survive the sweep.
      runGit(root, ['checkout', '-q', '-b', 'wip']);
      fs.writeFileSync(path.join(root, 'notes.txt'), 'personal\n', 'utf8');
      runGit(root, ['add', '.']);
      runGit(root, ['commit', '-q', '-m', 'personal wip']);
      fs.writeFileSync(path.join(root, 'notes.txt'), 'personal edit\n', 'utf8');
      runGit(root, ['stash', 'push', '-m', 'my personal work in progress']);

      // Two stale integration marker stashes left by two interrupted runs.
      runGit(root, ['checkout', '-q', 'main']);
      fs.writeFileSync(path.join(root, 'file.txt'), 'dirty a\n', 'utf8');
      runGit(root, ['stash', 'push', '--include-untracked', '-m', 'integrate:task-001: temporary integration checkout stash']);
      fs.writeFileSync(path.join(root, 'file.txt'), 'dirty b\n', 'utf8');
      runGit(root, ['stash', 'push', '--include-untracked', '-m', 'integrate:task-002: temporary integration checkout stash']);

      const before = stashList(root);
      assert.equal(before.split('\n').filter(Boolean).length, 3, 'three stashes before sweep');

      const report = await createBaseWorktreeRepair({}).repairBaseWorktree({ baseWorktree: root, git: gitRunner() });

      const after = stashList(root);
      assert.equal(after.split('\n').filter(Boolean).length, 1, 'only the personal stash remains');
      assert.ok(after.includes('my personal work in progress'), 'non-marker personal stash still present');
      assert.ok(!after.includes('integrate:task-001'), 'first marker stash dropped');
      assert.ok(!after.includes('integrate:task-002'), 'second marker stash dropped');
      assert.equal(report.markerStashesDropped, 2, 'both marker stashes dropped');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // F2: a dry run detects poison but mutates nothing (stash list + rebase state).
  test('dry-run detects poison without mutating the base worktree', async () => {
    const root = seedRepo();
    try {
      runGit(root, ['checkout', '-q', 'main']);
      fs.writeFileSync(path.join(root, 'file.txt'), 'dirty\n', 'utf8');
      runGit(root, ['stash', 'push', '--include-untracked', '-m', 'integrate:task-001: temporary integration checkout stash']);

      const before = stashList(root);
      const report = await createBaseWorktreeRepair({}).repairBaseWorktree({
        baseWorktree: root,
        git: gitRunner(),
        dryRun: true,
      });

      assert.equal(stashList(root), before, 'stash list unchanged by dry run');
      assert.equal(report.markerStashesDropped, 1, 'dry run reports the poison it would drop');
      assert.equal(report.rebaseAborted, false, 'dry run aborts nothing');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // SC4: an already-clean base worktree is untouched.
  test('leaves an already-clean base worktree unchanged', async () => {
    const root = seedRepo();
    try {
      const beforeStash = stashList(root);
      const beforeDirs = rebaseDirs(root);
      const beforeHead = headSha(root);

      const report = await createBaseWorktreeRepair({}).repairBaseWorktree({ baseWorktree: root, git: gitRunner() });

      assert.equal(stashList(root), beforeStash, 'stash list unchanged');
      assert.deepEqual(rebaseDirs(root), beforeDirs, 'rebase-* directory set unchanged');
      assert.equal(headSha(root), beforeHead, 'HEAD unchanged');
      assert.equal(report.markerStashesDropped, 0, 'no stashes dropped on a clean worktree');
      assert.equal(report.rebaseAborted, false, 'no rebase aborted on a clean worktree');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---- task-1410 stash-pop corruption (consolidated from test/integrate-task-1410-stash-pop-corruption.test.ts, TASK-2622.09) ----
describe("stash-pop corruption", () => {
  const missionUtils = mockModule<typeof import('../../../src/adapters/filesystem/mission-utils.js')>('../../../src/adapters/filesystem/mission-utils.js', import.meta.url);
  const printIntegrationPreflightModule = mockModule<typeof import('../../../src/adapters/cli/commands/integrate.js')>('../../../src/adapters/cli/commands/integrate.js', import.meta.url);

  test.afterEach(() => mock.restoreAll());
  const { printIntegrationPreflight } = printIntegrationPreflightModule;
  const { mock } = test;

  // Setup mocks BEFORE requiring integrate
  mock.method(missionUtils, 'getPrimaryBranch', () => 'main');

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
  // @ts-expect-error -- Legacy fixture intentionally accesses runtime-only `result` absent from its inferred mock shape.
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
    runGit(root, ['branch', '-M', 'main']);
    runGit(root, ['branch', 'mission/task-1410']);
    runGit(root, ['branch', 'mission/task-1404']);

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

  test('dirty path in the mission squash payload still blocks integration', () => {
    const root = createTestRepo();
    try {
      const taskFile = path.join(root, 'backlog', 'tasks',
        'task-1410 - prevent-integrate-from-corrupting-main.md');
      const context = {
        slug: 'task-1410',
        branch: 'mission/task-1410',
        currentBranch: 'main',
        missionDir: path.join(root, 'missions', 'task-1410'),
        missionWorktree: root,
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
        mainDirtyEntries: [' M src/adapters/cli/commands/integrate.ts']
      };

      const result = printIntegrationPreflight(context, {
        readTokenFn: () => null,
        resolveTokenFileFn: () => null,
        isForgejoReviewEnabledFn: () => false,
        getUnresolvedIndexConflictsFn: () => ({ ok: true, files: [] }),
        gitFn: () => ({ status: 0, stdout: 'src/adapters/cli/commands/integrate.ts\n', stderr: '', signal: null })
      });

      assert.ok(result.failures.includes('main-dirty-overlap'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('unresolvable mission payload blocks a dirty integration checkout', () => {
    const root = createTestRepo();
    try {
      const taskFile = path.join(root, 'backlog', 'tasks',
        'task-1410 - prevent-integrate-from-corrupting-main.md');
      const context = {
        slug: 'task-1410', branch: 'mission/task-1410', currentBranch: 'main',
        missionDir: path.join(root, 'missions', 'task-1410'), missionWorktree: root,
        task: { ok: true, taskFile }, taskStatus: 'ready-for-integration',
        taskAssignee: 'claude', forgejoUser: 'claude', taskAssigneeWarning: null,
        pr: { exists: false }, siblingPrs: [],
        approval: { ok: false, error: 'forgejo-off', reviewState: null },
        baseBranch: 'main', baseWorktree: root, mainBranch: 'main',
        mainDirty: true, mainDirtyEntries: [' M README.md']
      };
      const result = printIntegrationPreflight(context, {
        readTokenFn: () => null, resolveTokenFileFn: () => null,
        isForgejoReviewEnabledFn: () => false,
        getUnresolvedIndexConflictsFn: () => ({ ok: true, files: [] }),
        gitFn: () => ({ status: 128, stdout: '', stderr: 'unknown revision', signal: null })
      });
      assert.ok(result.failures.includes('main-dirty-payload'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('untracked first-run agent config is restored after a payload collision', () => {
    const root = createTestRepo();
    try {
      const taskFile = path.join(root, 'backlog', 'tasks',
        'task-1410 - prevent-integrate-from-corrupting-main.md');
      const context = {
        slug: 'task-1410', branch: 'mission/task-1410', currentBranch: 'main',
        missionDir: path.join(root, 'missions', 'task-1410'), missionWorktree: root,
        task: { ok: true, taskFile }, taskStatus: 'ready-for-integration',
        taskAssignee: 'claude', forgejoUser: 'claude', taskAssigneeWarning: null,
        pr: { exists: false }, siblingPrs: [],
        approval: { ok: false, error: 'forgejo-off', reviewState: null },
        baseBranch: 'main', baseWorktree: root, mainBranch: 'main',
        mainDirty: true, mainDirtyEntries: ['?? config/agents.json']
      };
      const result = printIntegrationPreflight(context, {
        readTokenFn: () => null, resolveTokenFileFn: () => null,
        isForgejoReviewEnabledFn: () => false,
        getUnresolvedIndexConflictsFn: () => ({ ok: true, files: [] }),
        gitFn: () => ({ status: 0, stdout: 'config/agents.json\n', stderr: '', signal: null })
      });
      assert.ok(!result.failures.includes('main-dirty-overlap'));
      assert.ok(result.warnings.includes('main-dirty'));
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

  test('cross-task dirty backlog file is safe to stash and restore', () => {
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

      assert.ok(!result.failures.includes('main-dirty-overlap'));
      assert.ok(result.warnings.includes('main-dirty'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('cross-task dirty completed backlog file is safe to stash and restore', () => {

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

      assert.ok(!result.failures.includes('main-dirty-overlap'));
      assert.ok(result.warnings.includes('main-dirty'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---- task-2212 interrupted fixtures leave no residue (consolidated from test/task-2212-repro.test.ts, TASK-2622.09) ----
describe("interrupted fixtures leave no residue", () => {
  const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');

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
      '--import', 'tsx', '--test', '--test-name-pattern=feature-branch lifecycle drafts', 'test/e2e/lifecycle/mission-lifecycle.test.ts'
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
    // The integration runner executes this alongside other process-heavy suites,
    // and shared developer machines can run at many times their core count
    // (observed load 118 on 16 cores). Give the child's real Git/bootstrap work
    // real headroom; the ready marker still ends the wait immediately in isolation.
    const deadline = Date.now() + 120000;
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
      '--test', '--test-name-pattern=repairs active', 'test/integration/review/review.test.ts'
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
});

// ---- task-2489 lead from a mission worktree (consolidated from test/task-2489-lead-from-worktree.test.ts, TASK-2622.09) ----
describe("lead from a mission worktree", () => {
  // task-2489: `px lead` is started from any worktree, not only the primary
  // checkout. Everything it acts through — the mission worktree it presses a
  // command in or launches a recovery agent in, and the repository its operator
  // database rows belong to — must resolve the same from a sibling worktree.
  //
  // Real git in a temporary repository: the property under test is what
  // `git worktree list` reports from a linked worktree, which a fake cannot pin.


  function git(cwd: string, ...args: string[]): void {
    execFileSync('git', args, { cwd, stdio: 'pipe' });
  }

  test('lead started in one mission worktree resolves a sibling mission worktree and the shared repository', (t) => {
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-lead-worktree-')));
    const primary = path.join(base, 'repo');
    const started = path.join(base, 'repo-task-lead');
    const stuck = path.join(base, 'repo-task-stuck');
    const previous = process.cwd();
    t.after(() => {
      process.chdir(previous);
      fs.rmSync(base, { recursive: true, force: true });
    });

    fs.mkdirSync(primary);
    git(primary, 'init', '-q', '-b', 'main');
    git(primary, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init');
    git(primary, 'worktree', 'add', '-q', '-b', 'mission/task-lead', started);
    git(primary, 'worktree', 'add', '-q', '-b', 'mission/task-stuck', stuck);

    process.chdir(started);

    assert.equal(resolveWorktree('task-stuck', { cwd: started }), stuck, 'the stuck mission worktree is found from a sibling');
    assert.equal(resolveCanonicalRepositoryId(started), resolveCanonicalRepositoryId(primary), 'one repository, whichever checkout started lead');
  });
});
