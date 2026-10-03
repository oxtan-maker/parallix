// Behavior-owned suite (TASK-2622.09, integration-ci): the pre-review rebase over disposable Git
// topologies — safe artifact auto-commit (task-1104), standalone mode (task-1272), hardening, and
// diagnostics. Legacy case names unchanged.
import test, { mock, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import { mockModule, installModuleMocks } from './lib/module-mock.js';

// Declaration order is load-bearing: installModuleMocks relinks modules in this order, so a
// module must be declared after the modules it depends on (merged from every section below).
mockModule('../src/adapters/review/rebase.js', import.meta.url);
mockModule('../src/adapters/cli/commands/status.js', import.meta.url);
mockModule('../src/adapters/cli/commands/rebase.js', import.meta.url);
mockModule('../src/adapters/cli/commands/integrate.js', import.meta.url);
await installModuleMocks();

// ---- task-1104 rebase cleanup (consolidated from test/task-1104-rebase-cleanup.test.ts, TASK-2622.09) ----
describe("task-1104 rebase cleanup", () => {
  const rebaseBeforeReviewRoundModule = mockModule<typeof import('../src/adapters/review/rebase.js')>('../src/adapters/review/rebase.js', import.meta.url);

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

  test('rebaseBeforeReviewRound leaves unrelated dirty files untouched', async () => {
    await withTempGitRepo(async (root) => {
      const slug = 'task-1104';
      const unsafePath = path.join(root, 'unsafe.js');
      fs.writeFileSync(unsafePath, 'console.log(1)');

      childProcess.spawnSync('git', ['add', '.'], { cwd: root });
      childProcess.spawnSync('git', ['commit', '-m', 'initial'], { cwd: root });

      // Make unsafe file dirty
      fs.writeFileSync(unsafePath, 'console.log(2)');

      const runFn = mock.fn(() => ({ status: 1, stdout: '', stderr: 'dirty worktree' }));

      const result = await rebaseBeforeReviewRound(slug, {
        worktree: root,
        runFn,
        isForgejoReviewEnabledFn: () => false,
        error: m => assert.fail(`Should not have errored: ${m}`)
      });

      assert.equal(result.ok, true);

      // Unrelated content remains outside the mission auto-commit.
      const statusRes = childProcess.spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
      const status = (statusRes.stdout || '').trim();
      assert.ok(status.includes('unsafe.js'), 'Unsafe file should still be dirty');

      assert.equal(runFn.mock.callCount(), 0, 'standalone mode still skips the rebase workflow');
    });
  });
});

// ---- task-1272 standalone rebase (consolidated from test/task-1272-standalone-rebase.test.ts, TASK-2622.09) ----
describe("task-1272 standalone rebase", () => {
  /**
   * task-1272: standalone (Forgejo-disabled) pre-review rebase behavior.
   *
   * When the review provider is not Forgejo, `rebaseBeforeReviewRound` must still
   * commit safe worktree state (so the reviewer sees a clean tree) but skip the
   * Forgejo-backed rebase entirely. See MISSION.md Scope (CP-1) and the Risk note.
   */
  const rebaseBeforeReviewRoundModule = mockModule<typeof import('../src/adapters/review/rebase.js')>('../src/adapters/review/rebase.js', import.meta.url);

  test.afterEach(() => mock.restoreAll());
  const { rebaseBeforeReviewRound } = rebaseBeforeReviewRoundModule;

  const { mock } = test;

  function runGit(root, args) {
    const result = childProcess.spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    return {
      status: result.status,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
    };
  }

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
  // @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
        gitFn: (args) => runGit(root, args),
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

  test('rebaseBeforeReviewRound carries committed mission work forward with non-mission files present', async () => {
    await withTempGitRepo(async (root) => {
      const slug = 'task-2592';
      const missionPath = path.join(root, 'docs', 'missions', '2026', slug, 'MISSION.md');
      const unrelatedPath = path.join(root, 'scratch-notes.txt');
      fs.mkdirSync(path.dirname(missionPath), { recursive: true });
      fs.writeFileSync(missionPath, '# Initial mission');
      fs.writeFileSync(unrelatedPath, 'initial notes');
      childProcess.spawnSync('git', ['add', '.'], { cwd: root });
      childProcess.spawnSync('git', ['commit', '-m', 'initial'], { cwd: root });

      fs.writeFileSync(missionPath, '# Updated mission');
      fs.writeFileSync(unrelatedPath, 'operator notes');

      const result = await rebaseBeforeReviewRound(slug, {
        worktree: root,
  // @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
        gitFn: (args) => runGit(root, args),
        isForgejoReviewEnabledFn: () => false,
        error: message => assert.fail(`Should not have errored: ${message}`),
      });

      assert.equal(result.ok, true);
      const committedMission = childProcess.spawnSync('git', ['show', 'HEAD:docs/missions/2026/task-2592/MISSION.md'], { cwd: root, encoding: 'utf8' }).stdout;
      assert.equal(committedMission, '# Updated mission');
      const status = childProcess.spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).stdout || '';
      assert.match(status, /scratch-notes\.txt/, 'the unrelated file remains untouched');
    });
  });

  test('rebaseBeforeReviewRound leaves non-mission dirty files alone in standalone mode', async () => {
    await withTempGitRepo(async (root) => {
      const slug = 'task-1272';
      const unsafePath = path.join(root, 'unsafe.js');
      fs.writeFileSync(unsafePath, 'console.log(1)');

      childProcess.spawnSync('git', ['add', '.'], { cwd: root });
      childProcess.spawnSync('git', ['commit', '-m', 'initial'], { cwd: root });
      fs.writeFileSync(unsafePath, 'console.log(2)');

      const runFn = mock.fn(() => ({ status: 0, stdout: '', stderr: '' }));

      const result = await rebaseBeforeReviewRound(slug, {
        worktree: root,
        runFn,
  // @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
        gitFn: (args) => runGit(root, args),
        isForgejoReviewEnabledFn: () => false,
        error: m => assert.fail(`Should not have errored: ${m}`)
      });

      assert.equal(result.ok, true, 'unrelated dirty files must not block the skip path');
      assert.equal(runFn.mock.callCount(), 0, 'rebase CLI not called on unsafe block');
      const status = (childProcess.spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).stdout || '').trim();
      assert.ok(status.includes('unsafe.js'), 'unsafe file should remain dirty');
    });
  });
});

// ---- rebase hardening (consolidated from test/rebase_hardening.test.ts, TASK-2622.09) ----
describe("rebase hardening", () => {
  const rebaseModule = mockModule<typeof import('../src/adapters/cli/commands/rebase.js')>('../src/adapters/cli/commands/rebase.js', import.meta.url);

  test.afterEach(() => mock.restoreAll());
  const rebase = rebaseModule.default;
  test('rebase applies core.editor=true to initial rebase call', async () => {
    let capturedArgs = null;
    await rebase(['task-1077'], {
      isForgejoReviewEnabledFn: () => false,
      inferSlugFn: () => 'task-1077',
      findMissionDirFn: () => '/tmp/task-1077',
      findMissionAreaFn: () => 'workflow',
      getCurrentBranchFn: () => 'mission/task-1077',
      gitFn: (args, opts) => {
        if (args.includes('branch') && args.includes('--list')) return { status: 0, stdout: 'main\n' };
        if (args[0] === 'fetch') return { status: 0 };
        if (args.includes('rebase') && args.includes('main')) {
          capturedArgs = args;
          return { status: 0 };
        }
        if (args.includes('rebase') && args.includes('--show-current')) return { status: 0, stdout: '' };
        return { status: 0, stdout: '' };
      },
      exitFn: () => {},
    });

    assert.ok(capturedArgs, 'Args should be captured');
    assert.ok(capturedArgs.indexOf('core.editor=true') < capturedArgs.indexOf('rebase'), 'core.editor=true should be before rebase');
    assert.ok(capturedArgs.indexOf('merge.autoedit=no') < capturedArgs.indexOf('rebase'), 'merge.autoedit=no should be before rebase');
  });

  test('rebase applies core.editor=true to continueRebase calls', async () => {
    let capturedArgsList = [];
    await rebase(['task-1077'], {
      isForgejoReviewEnabledFn: () => false,
      inferSlugFn: () => 'task-1077',
      findMissionDirFn: () => '/tmp/task-1077',
      findMissionAreaFn: () => 'workflow',
      getCurrentBranchFn: () => 'mission/task-1077',
      resolveConflictsFn: () => ({
        ok: true,
        conflictFiles: ['file.js'],
        missionSpecificFiles: ['file.js'],
        sharedFiles: [],
      }),
      gitFn: (args, opts) => {
        if (args.includes('branch') && args.includes('--list')) return { status: 0, stdout: 'main\n' };
        if (args[0] === 'fetch') return { status: 0 };
        if (args.includes('rebase') && args.includes('main')) return { status: 1, stderr: 'CONFLICT' };
        if (args[0] === 'checkout') return { status: 0 };
        if (args[0] === 'add') return { status: 0 };
        if (args.includes('rebase') && args.includes('--continue')) {
          capturedArgsList.push(args);
          return { status: 0 };
        }
        if (args.includes('rebase') && args.includes('--show-current')) return { status: 0, stdout: '' };
        return { status: 0, stdout: '' };
      },
      exitFn: () => {},
    });

    assert.ok(capturedArgsList.length > 0, 'continueRebase should be called');
    capturedArgsList.forEach(args => {
      assert.ok(args.indexOf('core.editor=true') < args.indexOf('rebase'), 'core.editor=true should be before rebase');
      assert.ok(args.indexOf('merge.autoedit=no') < args.indexOf('rebase'), 'merge.autoedit=no should be before rebase');
    });
  });

  test('rebase uses the selected mission root for rebase state, Git, and publication', async () => {
    const missionRoot = '/tmp/mission-tree';
    let stateRoot = null;
    let publishedRoot = null;
    let rebaseArgs = null;
    await rebase(['task-1077', '--push'], {
      inferSlugFn: () => 'task-1077',
      resolveWorktreeFn: () => missionRoot,
      findMissionDirFn: (_slug, root) => root === missionRoot ? '/tmp/mission-tree/missions/task-1077' : null,
      findMissionAreaFn: () => 'workflow',
      detectRebaseStateFn: root => {
        stateRoot = root;
        return { inProgress: false, unmergedFiles: [] };
      },
      isForgejoReviewEnabledFn: root => root === missionRoot,
      getCurrentBranchFn: root => root === missionRoot ? 'mission/task-1077' : 'main',
      resolveMissionBaseBranchFn: (_slug, root) => root === missionRoot ? 'main' : 'wrong-base',
      resolveReviewIdentityFn: () => ({ forgejoUser: 'tester' }),
      readTokenFn: () => 'token',
      createPrFn: (_branch, _user, _token, options) => { publishedRoot = options.rootDir; return { ok: true }; },
      gitFn: args => {
        if (args.includes('rebase') && args.includes('main')) { rebaseArgs = args; return { status: 0, stdout: '', stderr: '' }; }
        return { status: 0, stdout: '', stderr: '' };
      },
      exitFn: () => {},
    });
    assert.equal(stateRoot, missionRoot);
    assert.equal(publishedRoot, missionRoot);
    assert.deepEqual(rebaseArgs.slice(0, 2), ['-C', missionRoot]);
  });
});

// ---- rebase diagnostics (consolidated from test/rebase_diagnostics.test.ts, TASK-2622.09) ----
describe("rebase diagnostics", () => {
  // ---------------------------------------------------------------------------
  // Test-local Git argument normalization
  // ---------------------------------------------------------------------------
  // Production rebase Git invocations are execution-root-aware: since commit
  // 6f401e34a each call is prefixed with `-C <executionRoot>` (and the existing
  // `-c <key=value>` config pairs) ahead of the Git subcommand. Strip exactly
  // those leading global options so a fake can check the Git subcommand at a
  // fixed index again, without loose whole-array matching that would also accept
  // a malformed command. Returns the tail whose index 0 is the Git subcommand.

  const statusModule = mockModule<typeof import('../src/adapters/cli/commands/status.js')>('../src/adapters/cli/commands/status.js', import.meta.url);
  const rebaseModule = mockModule<typeof import('../src/adapters/cli/commands/rebase.js')>('../src/adapters/cli/commands/rebase.js', import.meta.url);
  const printIntegrationPreflightModule = mockModule<typeof import('../src/adapters/cli/commands/integrate.js')>('../src/adapters/cli/commands/integrate.js', import.meta.url);

  test.afterEach(() => mock.restoreAll());
  const status = statusModule.default;
  const rebase = rebaseModule.default;
  const { printIntegrationPreflight } = printIntegrationPreflightModule;
  function gitSubcommandArgs(args: string[]): string[] {
    let i = 0;
    while (i + 1 < args.length && (args[i] === '-C' || args[i] === '-c')) {
      i += 2; // skip the global option and its required value
    }
    return args.slice(i);
  }

  const TASK_1322_UNMERGED = [
    'backlog/tasks/task-1322 - prevent-backlog-task-id-recycling-collision.md',
    'missions/task-1322/review-state.json',
    'missions/task-1322/CP-4.md'
  ];

  function task1322RebaseState() {
    return {
      inProgress: true,
      detached: true,
      rebaseHead: 'abc123def456',
      rebaseDir: '.git/rebase-merge',
      unmergedFiles: [...TASK_1322_UNMERGED]
    };
  }

  test('rebase reports git output and hook hints on non-conflict failure', async () => {
    let stderrLines = [];
    const capturedStderr = [];
    const originalError = console.error;
    console.error = (...args) => { capturedStderr.push(args.join(' ')); };

    await rebase(['task-1077'], {
      isForgejoReviewEnabledFn: () => false,
      inferSlugFn: () => 'task-1077',
      findMissionDirFn: () => '/tmp/task-1077',
      findMissionAreaFn: () => 'workflow',
      getCurrentBranchFn: () => 'mission/task-1077',
      gitFn: (args, opts) => {
        if (args.includes('branch') && args.includes('--list')) return { status: 0, stdout: 'main\n' };
        if (gitSubcommandArgs(args)[0] === 'fetch') return { status: 0 };
        if (args.includes('rebase') && args.includes('main')) {
          return { status: 1, stdout: '', stderr: 'error: pre-commit hook failed\nAborting rebase' };
        }
        return { status: 0, stdout: '' };
      },
      exitFn: () => {},
    });

    console.error = originalError;
    stderrLines = capturedStderr;
    const combined = stderrLines.join('\n');

    assert.match(combined, /Rebase failed with a non-conflict error/i);
    assert.match(combined, /--- Git Output ---/);
    assert.match(combined, /pre-commit hook failed/);
    assert.match(combined, /Hint: A git hook failed/);
    assert.match(combined, /Recovery: git rebase --abort/);
  });

  test('rebase reports git output on failed continue attempt', async () => {
    let stderrLines = [];
    const capturedStderr = [];
    const originalError = console.error;
    console.error = (...args) => { capturedStderr.push(args.join(' ')); };

    await rebase(['task-1077'], {
      isForgejoReviewEnabledFn: () => false,
      inferSlugFn: () => 'task-1077',
      findMissionDirFn: () => '/tmp/task-1077',
      findMissionAreaFn: () => 'workflow',
      getCurrentBranchFn: () => 'mission/task-1077',
      resolveConflictsFn: () => ({
        ok: true,
        conflictFiles: ['file.js'],
        missionSpecificFiles: ['file.js'],
        sharedFiles: [],
      }),
      gitFn: (args, opts) => {
        if (args.includes('branch') && args.includes('--list')) return { status: 0, stdout: 'main\n' };
        if (gitSubcommandArgs(args)[0] === 'fetch') return { status: 0 };
        if (args.includes('rebase') && args.includes('main')) return { status: 1, stderr: 'CONFLICT' };
        if (gitSubcommandArgs(args)[0] === 'checkout') return { status: 0 };
        if (gitSubcommandArgs(args)[0] === 'add') return { status: 0 };
        if (args.includes('rebase') && args.includes('--continue')) {
          return { status: 1, stdout: '', stderr: 'error: another hook failed' };
        }
        if (gitSubcommandArgs(args)[0] === 'status' && gitSubcommandArgs(args)[1] === '--porcelain') return { status: 0, stdout: 'M  file.js' };
        if (gitSubcommandArgs(args)[0] === 'rebase' && gitSubcommandArgs(args)[1] === '--show-current') return { status: 0, stdout: 'mission/task-1077' };
        return { status: 0, stdout: '' };
      },
      exitFn: () => {},
    });

    console.error = originalError;
    stderrLines = capturedStderr;
    const combined = stderrLines.join('\n');

    assert.match(combined, /git rebase --continue failed/i);
    assert.match(combined, /--- Git Output ---/);
    assert.match(combined, /another hook failed/);
  });

  test('task-1322 recovery diagnostics report an in-progress rebase across status, rebase, and integrate preflight', async () => {
    const statusLines = [];
    let statusExitCode = null;

    await status(['task-1322'], {
      inferSlugFn: () => 'task-1322',
      getCurrentBranchFn: () => '',
      findTaskFileFn: () => '/tmp/task-1322.md',
      getTaskStatusFn: () => 'active',
      findMissionDirFn: () => null,
      getPrStatusFn: () => ({ exists: false }),
      readAgentConfigOrExitFn: () => ({}),
      eligibleAgentsForStepFn: () => [],
      workflowLauncherStatusFn: () => ({ supported: false }),
      getLastThreeCommitsFn: () => [],
      getUncommittedCountFn: () => TASK_1322_UNMERGED.length,
      detectRebaseStateFn: () => task1322RebaseState(),
      log: line => statusLines.push(line),
      exit: code => { statusExitCode = code; }
    });

    assert.equal(statusExitCode, 0);
    const statusOutput = statusLines.join('\n');
    assert.match(statusOutput, /Detached HEAD: rebase in progress: detached HEAD, 3 unmerged file\(s\)/);
    TASK_1322_UNMERGED.forEach(file => assert.match(statusOutput, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))));

    const rebaseStdout = [];
    const rebaseStderr = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...args) => { rebaseStdout.push(args.join(' ')); };
    console.error = (...args) => { rebaseStderr.push(args.join(' ')); };

    let rebaseExitCode = null;
    let attemptedFreshRebase = false;

    try {
      await rebase(['task-1322'], {
        isForgejoReviewEnabledFn: () => false,
        inferSlugFn: () => 'task-1322',
        findMissionDirFn: () => '/tmp/docs/missions/2026/task-1322',
        findMissionAreaFn: () => 'docs',
        getCurrentBranchFn: () => 'mission/task-1322',
        detectRebaseStateFn: () => task1322RebaseState(),
        gitFn: args => {
          if (args.includes('rebase') && args.includes('main')) {
            attemptedFreshRebase = true;
          }
          return { status: 0, stdout: '', stderr: '' };
        },
        exitFn: code => { rebaseExitCode = code; }
      });
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }

    assert.equal(rebaseExitCode, 1);
    assert.equal(attemptedFreshRebase, false);
    const rebaseOutput = [...rebaseStderr, ...rebaseStdout].join('\n');
    assert.match(rebaseOutput, /Rebase already in progress for mission\/task-1322/);
    assert.match(rebaseOutput, /Current rebase head: abc123def456/);
    TASK_1322_UNMERGED.forEach(file => assert.match(rebaseOutput, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))));
    assert.match(rebaseOutput, /git rebase --continue/);
    assert.match(rebaseOutput, /git rebase --abort/);
    assert.match(rebaseOutput, /git rebase --skip/);

    const integrateLines = [];
    const integrateOriginalLog = console.log;
    console.log = line => integrateLines.push(line);

    try {
      const result = printIntegrationPreflight({
        slug: 'task-1322',
        branch: 'mission/task-1322',
        currentBranch: 'mission/task-1322',
        missionDir: '/tmp/docs/missions/2026/task-1322',
        task: { ok: true, taskFile: '/tmp/task-1322.md' },
        taskStatus: 'ready-for-integration',
        taskAssignee: 'codex',
        forgejoUser: 'codex',
        taskAssigneeWarning: null,
        pr: { exists: true, state: 'open', merged: false, number: 1322 },
        approval: { ok: true, reviewState: 'APPROVED' },
        mainBranch: 'main',
        mainAheadCount: 0,
        mainDirty: false,
        mainDirtyEntries: []
      }, {
        readTokenFn: () => 'secret-token',
        resolveTokenFileFn: () => '/tmp/tokens/codex',
        isForgejoReviewEnabledFn: () => true,
        detectRebaseStateFn: () => task1322RebaseState(),
        getUnresolvedIndexConflictsFn: () => ({ ok: true, files: [] })
      });

      assert.ok(result.failures.includes('rebase-in-progress'));
    } finally {
      console.log = integrateOriginalLog;
    }

    const integrateOutput = integrateLines.join('\n');
    assert.match(integrateOutput, /Integration checkout rebase: rebase in progress/i);
    assert.match(integrateOutput, /Current rebase head: abc123def456/);
    TASK_1322_UNMERGED.forEach(file => assert.match(integrateOutput, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))));
    assert.match(integrateOutput, /git -C .* rebase --continue/);
    assert.match(integrateOutput, /git -C .* rebase --abort/);
    assert.match(integrateOutput, /git -C .* rebase --skip/);
  });
});
