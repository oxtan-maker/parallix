// Historical regression provenance: TASK-1004, TASK-2407.
// Behavior-owned suite (TASK-2622.09): mission path, worktree-topology, and Backlog task-file resolution
// as the unit-tier application seams see them (task-1004 slug suffixes, task-2407 topology export,
// backlog/ merge noise, worktree amplification, completed-duplicate reorder). Legacy case names unchanged.
import test, { mock, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { mockModule, installModuleMocks } from '../../../lib/module-mock.js';
import { mkdtemp as registeredMkdtemp, mkdtemp } from '../../../helpers/temp-dir.js';
import { parseConflictFilesFromMergeOutput, getConflictFiles, findLastNonNoiseCommit, squashTrailingBacklogNoiseIntoPreviousMission, softResetTrailingBacklogNoise, findMissionDocInBranches, isMissionArtifact } from '../../../../src/adapters/filesystem/mission-utils.js';
import { checkBacklogIntegrity, pruneStaleBacklogDuplicates, resolveTaskFile } from '../../../../src/adapters/backlog/backlog.js';

// Declaration order is load-bearing: installModuleMocks relinks modules in this order, so a
// module must be declared after the modules it depends on (merged from every section below).
mockModule('../../../../src/adapters/backlog/backlog.js', import.meta.url);
mockModule('../../../../src/adapters/filesystem/mission-utils.js', import.meta.url);
await installModuleMocks();
const { ConcreteGateReadAdapter } = await import('../../../../src/adapters/backlog/concrete-gate-read-adapter.js');
const { ConcreteMissionReadAdapter } = await import('../../../../src/adapters/backlog/concrete-mission-read-adapter.js');
const { BoardProjectionBuilder } = await import('../../../../src/application/projections/board-readers.js');
const { snapshotWorktreeTopology } = await import('../../../../src/adapters/git/worktree.js');
const { repositoryId } = await import('../../../../src/domain/repository.js');

// ---- task-1004 task-file and slug-suffix resolution (consolidated from test/task_1004.test.ts, TASK-2622.09) ----
describe("task-file and slug-suffix resolution", () => {
  const resolveTaskFileModule = mockModule<typeof import('../../../../src/adapters/backlog/backlog.js')>('../../../../src/adapters/backlog/backlog.js', import.meta.url);
  const findMissionDirModule = mockModule<typeof import('../../../../src/adapters/filesystem/mission-utils.js')>('../../../../src/adapters/filesystem/mission-utils.js', import.meta.url);

  test.afterEach(() => mock.restoreAll());
  const { resolveTaskFile, checkBacklogIntegrity } = resolveTaskFileModule;
  const { findMissionDir, getMissionYear } = findMissionDirModule;
  function withTempRepo(fn) {
    const previous = process.cwd();
    const root = registeredMkdtemp('workflow-task-1004-');
    fs.mkdirSync(path.join(root, 'backlog', 'tasks'), { recursive: true });
    process.chdir(root);

    try {
      fn(root);
    } finally {
      process.chdir(previous);
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  test('resolveTaskFile prefers exact frontmatter id: match over filename-prefix matches', () => {
    withTempRepo(root => {
      const taskDir = path.join(root, 'backlog', 'tasks');

      // Create two files with the same filename prefix but different frontmatter IDs
      const file1 = path.join(taskDir, 'task-093 - gemini-draft-bug.md');
      fs.writeFileSync(file1, '---\nid: TASK-093\n---\n');

      const file2 = path.join(taskDir, 'task-093 - Non-UI-Login-Helper.md');
      fs.writeFileSync(file2, '---\nid: TASK-099\n---\n');

      // Searching for task-093 should resolve to file1 because it has id: TASK-093
      const result = resolveTaskFile('task-093');
      assert.equal(result.ok, true);
      assert.equal(result.taskFile, fs.realpathSync(file1));

      // Searching for task-099 should resolve to file2 even if its filename starts with task-093
      const result2 = resolveTaskFile('task-099');
      assert.equal(result2.ok, true, `Expected task-099 to resolve via frontmatter ID, got: ${result2.reason}`);
      assert.equal(result2.taskFile, fs.realpathSync(file2));
    });
  });

  test('resolveTaskFile handles slugs with suffixes by falling back to base task ID', () => {
    withTempRepo(root => {
      const taskDir = path.join(root, 'backlog', 'tasks');

      const file1 = path.join(taskDir, 'task-1004 - harden-workflow.md');
      fs.writeFileSync(file1, '---\nid: TASK-1004\n---\n');

      // Searching for task-1004-modern should resolve to file1 because it starts with task-1004
      const result = resolveTaskFile('task-1004-modern');
      assert.equal(result.ok, true);
      assert.equal(result.taskFile, fs.realpathSync(file1));
    });
  });

  test('findMissionDir and getMissionYear handle slugs with suffixes', () => {
    withTempRepo(root => {
      const missionDir = path.join(root, 'docs', 'missions', '2026', 'task-1004');
      fs.mkdirSync(missionDir, { recursive: true });
      fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Mission\n');

      // Should find the year even with suffix
      assert.equal(getMissionYear('task-1004-modern', root), '2026');

      // Should find the directory even with suffix
      const found = findMissionDir('task-1004-modern', root);
      assert.equal(found, missionDir);
    });
  });
});

// ---- merge-noise classification of backlog paths (consolidated from test/mission-utils-merge-noise.test.ts, TASK-2622.09) ----
describe("merge-noise classification of backlog paths", () => {
  const _require = createRequire(import.meta.url);
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

  test('noise squash caps dirty paths and suppresses warnings for untracked-only trees (TASK-2708)', () => {
    const logs = [];
    const originalLog = console.log;
    console.log = msg => logs.push(msg);
    try {
      for (const prefix of [' M', 'M ', '??']) {
        logs.length = 0;
        const calls = [];
        const runner = args => {
          calls.push(args);
          return { status: 0, stdout: Array.from({ length: 7 }, (_, i) => `${prefix} file-${i}.txt`).join('\n'), stderr: '' };
        };
        assert.equal(squashTrailingBacklogNoiseIntoPreviousMission('/tmp/worktree', runner), false);
        assert.equal(calls.length, 1, 'dirty trees never execute squash operations');
        if (prefix === '??') assert.equal(logs.length, 0);
        else {
          assert.match(logs.join('\n'), /file-0.txt.*file-4.txt.*2 more/);
          assert.doesNotMatch(logs.join('\n'), /file-5.txt|file-6.txt/);
          assert.match(logs.join('\n'), /Trailing backlog commits remain separate/);
        }
      }
    } finally { console.log = originalLog; }
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
    assert.ok(dirtyLogs.some(msg => msg.includes('[WARN] Skipping noise squash') && msg.includes('backlog/tasks/task.md') && msg.includes('Trailing backlog commits remain separate')));
    assert.ok(dirtyLogs.some(msg => msg.includes('Skipping noise reset') && msg.includes('worktree is not clean')));

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
    const root = mkdtemp('workflow-mission-utils-');
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
});

// ---- task-2407 snapshotWorktreeTopology composition export (consolidated from test/task-2407-snapshot-worktree-topology-runtime-repro.test.ts, TASK-2622.09) ----
describe("snapshotWorktreeTopology composition export", async () => {
  /**
   * Runtime regression for task-2407: `snapshotWorktreeTopology` must be a
   * callable named export once the real CLI composition graph is loaded.
   *
   * The integrate/handoff runtime loads this graph the same way
   * `src/composition/application-services.ts` does: it dynamically imports
   * `production-capabilities`, which statically imports `board-projection`,
   * which statically imports `snapshotWorktreeTopology` from the git adapter
   * `src/adapters/git/worktree.ts`. When that composition graph is loaded under
   * a circular import, Node fails the named import with
   * "does not provide an export named 'snapshotWorktreeTopology'" before any code
   * runs, so handoff stops at step 1.7 (NEL capture) with no board projection.
   *
   * This test loads the production-relevant graph in that exact order and asserts
   * the export is callable. It imports the real modules (no mocking of the
   * composition graph) so a cyclic-export regression turns it red; it only stubs
   * the git boundary through the adapter's own `gitFn` option, never by replacing
   * the production modules, so it stays a hermetic unit test.
   *
   * The graph is loaded at module top level, in the exact production order,
   * before any test body runs. Loading it inside a test body costs ~0.8s of
   * full-graph TS compilation and trips the 500ms unit-test headroom, so the
   * load lives here: a broken named import still fails this file at load time
   * (the import itself is the assertion), and the tests below verify the
   * bindings it produced.
   */

  // 1. Load the production composition graph the way the handoff runtime does.
  //    This is the import that throws the missing-named-export error under a
  //    circular dependency, so a bare dynamic import is itself the assertion.
  const productionCapabilities = await import('../../../../src/composition/production-capabilities.js');

  // 2. Load the handoff use-case so the graph that reaches captureNelAtHandoff
  //    is fully resolved through the same composition entry point.
  const handoffUseCase = await import('../../../../src/application/handoff-command-use-case.js');

  // 3. The git adapter export must be a callable named export once the graph is
  //    loaded, not an undefined binding from a partially-initialised cycle.
  const worktree = await import('../../../../src/adapters/git/worktree.js');

  test('task-2407 CLI composition graph provides snapshotWorktreeTopology as a callable named export', () => {
    assert.equal(
      typeof productionCapabilities.composeProductionCapabilities,
      'function',
      'production-capabilities must load composeProductionCapabilities from the composition graph',
    );

    assert.equal(
      typeof handoffUseCase.HandoffCommandUseCase,
      'function',
      'handoff use-case must resolve through the composition graph',
    );

    assert.equal(
      typeof worktree.snapshotWorktreeTopology,
      'function',
      'snapshotWorktreeTopology must be a callable named export once the CLI composition graph is loaded',
    );
  });

  test('task-2407 snapshotWorktreeTopology topology resolves a worktree through its own gitFn boundary', async () => {
    const { snapshotWorktreeTopology } = await import('../../../../src/adapters/git/worktree.js');
    let gitCalls = 0;
    const topology = snapshotWorktreeTopology({
      cwd: process.cwd(),
      gitFn: () => {
        gitCalls += 1;
        return { status: 0, stdout: '' };
      },
      currentBranch: () => '',
    });
    assert.equal(typeof topology.resolveWorktree, 'function');
    assert.equal(gitCalls, 1, 'the topology snapshot must read the worktree list once through the injected gitFn');
  });
});

// ---- board readers worktree amplification (consolidated from test/board-readers.worktree-amplification.test.ts, TASK-2622.09) ----
describe("board readers worktree amplification", () => {
  function taskDocument(id: string, title = id): string {
    return `---\nid: ${id}\ntitle: ${title}\nstatus: active\nassignee: codex\nlabels: [user_value]\nclosedAt: 2026-08-23\n---\n`;
  }

  function fixture(count: number, archive = false) {
    const rootDir = registeredMkdtemp('px-board-read-amplification-');
    const dir = path.join(rootDir, archive ? 'backlog/archive/tasks' : 'backlog/tasks');
    fs.mkdirSync(dir, { recursive: true });
    const taskFiles = new Map<string, string>();
    for (let number = 1; number <= count; number += 1) {
      const id = `task-${String(number).padStart(4, '0')}`;
      const file = path.join(dir, `${id}.md`);
      fs.writeFileSync(file, taskDocument(id), 'utf8');
      taskFiles.set(id, file);
    }
    return { rootDir, taskFiles };
  }

  async function buildWithCounts(count: number) {
    const { rootDir, taskFiles } = fixture(count);
    let gitCalls = 0;
    let taskReads = 0;
    const originalReadFileSync = fs.readFileSync;
    fs.readFileSync = ((filePath: fs.PathOrFileDescriptor, ...args: unknown[]) => {
      if (typeof filePath === 'string' && [...taskFiles.values()].includes(filePath)) {
        taskReads += 1;
      }
      return originalReadFileSync(filePath, ...(args as [BufferEncoding]));
    }) as typeof fs.readFileSync;
    syncBuiltinESMExports();

    const resolveTaskFile = (id: string) => {
      const taskFile = taskFiles.get(id.toLowerCase());
      return taskFile ? { ok: true, taskFile, matches: [taskFile] } : { ok: false, matches: [], reason: 'missing' };
    };
    const resolveWorktree = () => null;
    try {
      const missions = new ConcreteMissionReadAdapter({
        rootDir,
        repositoryId: repositoryId('test-repo'),
        resolveTaskFile,
        resolveWorktree,
      });
      const gates = new ConcreteGateReadAdapter({ rootDir, resolveWorktree });
      await new BoardProjectionBuilder(
        missions,
        { async loadReviews(ids) { return new Map(ids.map((id) => [id, { review: null, approval: null }])); } },
        gates,
        { async loadAgentAvailability() { return []; }, async loadAssignedAgent() { return null; } },
        { async loadRepositoryId() { return repositoryId('test-repo'); }, async loadHeadCommit() { return 'head'; } },
        { async loadOperationLog() { return []; } },
        {
          prepareReads: () => {
            const topology = snapshotWorktreeTopology({
              cwd: rootDir,
              gitFn: () => ({ status: 0, stdout: (gitCalls += 1, '') }),
              currentBranch: () => '',
            });
            missions.useWorktreeTopology(topology);
            gates.useWorktreeTopology(topology);
          },
        },
      ).build();
      return { gitCalls, taskReads, distinctTaskFiles: taskFiles.size };
    } finally {
      fs.readFileSync = originalReadFileSync;
      syncBuiltinESMExports();
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  }

  test('board projection worktree-list count is O(1) vs mission count', async () => {
    const five = await buildWithCounts(5);
    const fifty = await buildWithCounts(50);
    assert.ok(fifty.gitCalls <= five.gitCalls + 2, `${five.gitCalls} -> ${fifty.gitCalls}`);
  });

  test('board projection reads each distinct task document once for metadata', async () => {
    const result = await buildWithCounts(5);
    assert.equal(result.taskReads, result.distinctTaskFiles);
  });

  test('board projection does not scan or materialize backlog archive', async () => {
    const { rootDir } = fixture(1, true);
    const archiveDir = path.join(rootDir, 'backlog/archive/tasks');
    const originalExistsSync = fs.existsSync;
    const originalReaddirSync = fs.readdirSync;
    const scanned: string[] = [];
    fs.existsSync = ((candidate: fs.PathLike) => {
      if (candidate === archiveDir) { scanned.push('exists'); }
      return originalExistsSync(candidate);
    }) as typeof fs.existsSync;
    fs.readdirSync = ((candidate: fs.PathLike, ...args: unknown[]) => {
      if (candidate === archiveDir) { scanned.push('readdir'); }
      return originalReaddirSync(candidate, ...(args as []));
    }) as typeof fs.readdirSync;
    syncBuiltinESMExports();
    try {
      const missions = await new ConcreteMissionReadAdapter({ rootDir, repositoryId: repositoryId('test-repo') }).loadAllMissions();
      assert.deepEqual(missions, []);
      assert.deepEqual(scanned, []);
    } finally {
      fs.existsSync = originalExistsSync;
      fs.readdirSync = originalReaddirSync;
      syncBuiltinESMExports();
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });
});

// ---- backlog reorder with completed duplicates (consolidated from test/backlog_reorder_completed_duplicate.test.ts, TASK-2622.09) ----
describe("backlog reorder with completed duplicates", () => {
  // Regression for TASK-1343: a "Reorder tasks in backlog" / ordinal write path
  // recreates a `status: backlog` copy in backlog/tasks/ for a task whose
  // canonical record already lives in backlog/completed/ (or backlog/archive/).
  // The integrity gate must flag the duplicate; pruning must drop the stale
  // backlog/tasks/ copy while keeping the completed copy canonical.


  function withTempRepo(fn) {
    const root = registeredMkdtemp('workflow-reorder-dup-');
    fs.mkdirSync(path.join(root, 'backlog', 'tasks'), { recursive: true });
    fs.mkdirSync(path.join(root, 'backlog', 'completed'), { recursive: true });
    fs.mkdirSync(path.join(root, 'backlog', 'archive', 'tasks'), { recursive: true });
    try {
      fn(root);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  // Mirror the evidence from TASK-1343: a recreated backlog copy carrying
  // `status: backlog` and an `ordinal:` field alongside a done completed copy.
  function reproduceReorderRecreate(root) {
    const completedFile = path.join(root, 'backlog', 'completed', 'task-1323 - example.md');
    fs.writeFileSync(completedFile, '---\nid: TASK-1323\nstatus: done\n---\n# done copy\n');

    const staleFile = path.join(root, 'backlog', 'tasks', 'task-1323 - example.md');
    fs.writeFileSync(staleFile, '---\nid: TASK-1323\nstatus: backlog\nordinal: 43000\n---\n# recreated backlog copy\n');

    return { completedFile, staleFile };
  }

  test('checkBacklogIntegrity flags a reorder-recreated backlog copy of a completed task', () => {
    withTempRepo(root => {
      const { staleFile, completedFile } = reproduceReorderRecreate(root);

      const issues = checkBacklogIntegrity(root);
      const dup = issues.find(i => i.type === 'duplicate-completed' && i.taskId === 'TASK-1323');

      assert.ok(dup, 'expected a duplicate-completed issue for TASK-1323');
      assert.equal(dup.file, path.relative(root, staleFile));
      assert.equal(dup.canonicalFile, path.relative(root, completedFile));
    });
  });

  test('checkBacklogIntegrity also flags a tasks/ copy that duplicates an archived task', () => {
    withTempRepo(root => {
      fs.writeFileSync(
        path.join(root, 'backlog', 'archive', 'tasks', 'task-1400 - archived.md'),
        '---\nid: TASK-1400\nstatus: done\n---\n'
      );
      fs.writeFileSync(
        path.join(root, 'backlog', 'tasks', 'task-1400 - archived.md'),
        '---\nid: TASK-1400\nstatus: backlog\nordinal: 50000\n---\n'
      );

      const issues = checkBacklogIntegrity(root);
      assert.ok(
        issues.some(i => i.type === 'duplicate-completed' && i.taskId === 'TASK-1400'),
        'expected the archive duplicate to be flagged'
      );
    });
  });

  test('pruneStaleBacklogDuplicates removes the stale copy and clears the gate', () => {
    withTempRepo(root => {
      const { staleFile, completedFile } = reproduceReorderRecreate(root);

      const removed = pruneStaleBacklogDuplicates(root);

      assert.equal(removed.length, 1);
      assert.equal(removed[0].taskId, 'TASK-1323');
      assert.equal(fs.existsSync(staleFile), false, 'stale backlog/tasks copy must be removed');
      assert.equal(fs.existsSync(completedFile), true, 'completed copy must remain canonical');

      // After pruning, the integrity gate is clean and resolution returns the
      // canonical completed copy rather than the stale backlog copy.
      const issues = checkBacklogIntegrity(root);
      assert.equal(issues.filter(i => i.type === 'duplicate-completed').length, 0);

      const resolution = resolveTaskFile('task-1323', root);
      assert.equal(resolution.ok, true);
      assert.equal(resolution.taskFile, completedFile);
    });
  });

  test('integrity gate stays clean when no duplicate exists', () => {
    withTempRepo(root => {
      fs.writeFileSync(
        path.join(root, 'backlog', 'completed', 'task-1500 - shipped.md'),
        '---\nid: TASK-1500\nstatus: done\n---\n'
      );
      fs.writeFileSync(
        path.join(root, 'backlog', 'tasks', 'task-1501 - open.md'),
        '---\nid: TASK-1501\nstatus: backlog\n---\n'
      );

      const issues = checkBacklogIntegrity(root);
      assert.equal(issues.filter(i => i.type === 'duplicate-completed').length, 0);
      assert.equal(pruneStaleBacklogDuplicates(root).length, 0);
    });
  });
});
