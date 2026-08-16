// @ts-nocheck -- TASK-2328: partial test doubles from ESM seam migration; resolve in follow-up



import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { mockModule, installModuleMocks } from './lib/module-mock.js';
const rebaseBeforeReviewRoundModule = mockModule<typeof import('../src/adapters/review/rebase.js')>('../src/adapters/review/rebase.js', import.meta.url);
const isMissionArtifactModule = mockModule<typeof import('../src/adapters/filesystem/mission-utils.js')>('../src/adapters/filesystem/mission-utils.js', import.meta.url);
await installModuleMocks();
test.afterEach(() => mock.restoreAll());
const { rebaseBeforeReviewRound } = rebaseBeforeReviewRoundModule;
const { isMissionArtifact, isWorkflowGeneratedArtifact } = isMissionArtifactModule;
function porcelainZ(entries) {
  return `${entries.join('\0')}\0`;
}

/**
 * In-process rebase-workflow seam (TASK-2377.02). The pre-review rebase no
 * longer spawns a CLI, so these tests drive the `RebaseWorkflowPort` seam and
 * record the argv the workflow is asked to run.
 */
function inProcessWorkflow(runs, { exitCode = 0, port = {}, onRun = null } = {}) {
  return {
    createRebaseWorkflowPortFn: () => ({ exit: () => {}, ...port }),
    runRebaseWorkflowFn: async (args, workflowPort) => {
      runs.push(args);
      if (onRun) { onRun(workflowPort); }
      workflowPort.exit(exitCode);
    },
  };
}

test('isMissionArtifact identifies safe mission artifacts', () => {
  const slug = 'task-1107';
  const year = new Date().getFullYear().toString();
  const rootDir = '/tmp/fake';

  assert.ok(isMissionArtifact(`docs/missions/${year}/${slug}/MISSION.md`, slug, rootDir));
  assert.ok(isMissionArtifact(`backlog/tasks/${slug} - title.md`, slug, rootDir));
  assert.ok(isMissionArtifact(`backlog/completed/${slug} - title.md`, slug, rootDir));
  assert.ok(isMissionArtifact(`backlog/tasks/${slug}.md`, slug, rootDir));

  assert.ok(!isMissionArtifact('workflow/lib/review/review.js', slug, rootDir));
  assert.ok(!isMissionArtifact(`docs/missions/${year}/task-9999/MISSION.md`, slug, rootDir));
  assert.ok(!isMissionArtifact(`backlog/tasks/task-9999 - title.md`, slug, rootDir));
  assert.ok(!isMissionArtifact(`backlog/tasks/${slug}.md.bak`, slug, rootDir));
  assert.ok(!isMissionArtifact(`backlog/tasks/${slug} - title.md.swp`, slug, rootDir));
  assert.ok(!isMissionArtifact(`backlog/tasks/${slug} - title.md.orig`, slug, rootDir));
});

test('isWorkflowGeneratedArtifact identifies ignorable workflow runtime state', () => {
  assert.ok(isWorkflowGeneratedArtifact('.workflow/codex-home/.codex/logs_2.sqlite'));
  assert.ok(isWorkflowGeneratedArtifact('.workflow/sessions/task-1-reviewer.json'));
  assert.ok(isWorkflowGeneratedArtifact('.sessions/task-1-reviewer.json'));
  assert.ok(isWorkflowGeneratedArtifact('graphify-out/GRAPH_REPORT.md'));
  assert.ok(isWorkflowGeneratedArtifact('graphify-out'));

  assert.ok(!isWorkflowGeneratedArtifact('workflow/lib/review/review.js'));
  assert.ok(!isWorkflowGeneratedArtifact('backlog/tasks/task-1.md'));
});

test('rebaseBeforeReviewRound auto-commits safe mission artifacts before rebase', async () => {
  const logs = [];
  const gitCalls = [];
  const rebaseCalls = [];
  const slug = 'task-1107';
  const year = new Date().getFullYear().toString();

  const result = await rebaseBeforeReviewRound(slug, {
    worktree: '/tmp/worktree',
    isForgejoReviewEnabledFn: () => true,
    gitFn: (args) => {
      gitCalls.push(args);
      if (args.includes('status')) {
        return { status: 0, stdout: porcelainZ([` M docs/missions/${year}/${slug}/MISSION.md`, `?? backlog/tasks/${slug} - title.md`]), stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    },
    ...inProcessWorkflow(rebaseCalls),
    log: message => logs.push(message),
    error: message => assert.fail(`Should not have errored: ${message}`)
  });

  assert.deepEqual(result, { ok: true, sharedFileConflicts: false, hookFailure: false });
  assert.ok(logs.some(m => m.includes('Auto-committing safe mission artifacts')), 'Should log auto-commit start');
  assert.ok(logs.some(m => m.includes('Mission artifacts committed')), 'Should log auto-commit success');

  // Verify git calls
  assert.ok(gitCalls.some(args => args.includes('add') && args.includes(`docs/missions/${year}/${slug}/MISSION.md`)));
  assert.ok(gitCalls.some(args => args.includes('add') && args.includes(`backlog/tasks/${slug} - title.md`)));
  assert.ok(gitCalls.some(args => args.includes('commit') && args.includes(`workflow(${slug}): auto-commit mission artifacts before pre-review rebase`)));
  assert.deepEqual(rebaseCalls, [[slug, '--push']], 'Pre-review rebase drives the workflow in-process');
});

test('rebaseBeforeReviewRound parses rename, copy, and space paths from porcelain z output', async () => {
  const gitCalls = [];
  const slug = 'task-1107';

  const result = await rebaseBeforeReviewRound(slug, {
    worktree: '/tmp/worktree',
    isForgejoReviewEnabledFn: () => true,
    gitFn: (args) => {
      gitCalls.push(args);
      if (args.includes('status')) {
        return {
          status: 0,
          stdout: porcelainZ([
            `R  docs/missions/2026/${slug}/Renamed File.md`,
            `docs/missions/2026/${slug}/Old File.md`,
            `C  backlog/tasks/${slug} - copied title.md`,
            `backlog/tasks/${slug} - original title.md`,
            ` M docs/missions/2026/${slug}/path with space.md`
          ]),
          stderr: ''
        };
      }
      return { status: 0, stdout: '', stderr: '' };
    },
    ...inProcessWorkflow([]),
    log: () => {},
    error: message => assert.fail(`Should not have errored: ${message}`)
  });

  assert.deepEqual(result, { ok: true, sharedFileConflicts: false, hookFailure: false });
  assert.ok(gitCalls.some(args => args.includes('add') && args.includes(`docs/missions/2026/${slug}/Renamed File.md`)));
  assert.ok(gitCalls.some(args => args.includes('add') && args.includes(`backlog/tasks/${slug} - copied title.md`)));
  assert.ok(gitCalls.some(args => args.includes('add') && args.includes(`docs/missions/2026/${slug}/path with space.md`)));
});

test('rebaseBeforeReviewRound refuses rename or copy records with unsafe sources', async () => {
  const errors = [];
  const slug = 'task-1107';

  const result = await rebaseBeforeReviewRound(slug, {
    worktree: '/tmp/worktree',
    isForgejoReviewEnabledFn: () => true,
    gitFn: (args) => {
      if (args.includes('status')) {
        return {
          status: 0,
          stdout: porcelainZ([
            `R  docs/missions/2026/${slug}/MISSION.md`,
            'workflow/lib/review/review.js'
          ]),
          stderr: ''
        };
      }
      return { status: 0, stdout: '', stderr: '' };
    },
    ...inProcessWorkflow([], { onRun: () => assert.fail('Should not have run rebase') }),
    log: () => {},
    error: message => errors.push(message)
  });

  assert.equal(result.ok, false);
  assert.equal(result.sharedFileConflicts, false);
  assert.equal(result.hookFailure, false);
  assert.equal(result.failure.kind, 'unsafe-worktree');
  assert.ok(errors.some(m => m.includes('workflow/lib/review/review.js')), 'Should list the unsafe rename source');
});

test('rebaseBeforeReviewRound refuses to auto-commit when unsafe files are present', async () => {
  const logs = [];
  const errors = [];
  const slug = 'task-1107';

  const result = await rebaseBeforeReviewRound(slug, {
    worktree: '/tmp/worktree',
    isForgejoReviewEnabledFn: () => true,
    gitFn: (args) => {
      if (args.includes('status')) {
        return { status: 0, stdout: porcelainZ([` M docs/missions/2026/${slug}/MISSION.md`, ' M workflow/lib/review/review.js']), stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    },
    ...inProcessWorkflow([], { onRun: () => assert.fail('Should not have run rebase') }),
    log: message => logs.push(message),
    error: message => errors.push(message)
  });

  assert.equal(result.ok, false);
  assert.equal(result.sharedFileConflicts, false);
  assert.equal(result.hookFailure, false);
  assert.equal(result.failure.kind, 'unsafe-worktree');
  assert.ok(errors.some(m => m.includes('Cannot auto-commit: dirty files include non-mission paths')), 'Should report unsafe files');
  assert.ok(errors.some(m => m.includes('workflow/lib/review/review.js')), 'Should list the unsafe file');
});

test('rebaseBeforeReviewRound ignores workflow-generated runtime state when checking for unsafe files', async () => {
  const slug = 'task-1107';

  const result = await rebaseBeforeReviewRound(slug, {
    worktree: '/tmp/worktree',
    isForgejoReviewEnabledFn: () => true,
    gitFn: (args) => {
      if (args.includes('status')) {
        return {
          status: 0,
          stdout: porcelainZ([
            '?? .workflow/codex-home/.codex/logs_2.sqlite',
            '?? .workflow/codex-home/.npm/cache/index.json',
            `?? .workflow/sessions/${slug}-reviewer.json`,
            '?? graphify-out/GRAPH_REPORT.md'
          ]),
          stderr: ''
        };
      }
      return { status: 0, stdout: '', stderr: '' };
    },
    ...inProcessWorkflow([]),
    log: () => {},
    error: message => assert.fail(`Should not have errored: ${message}`)
  });

  assert.deepEqual(result, { ok: true, sharedFileConflicts: false, hookFailure: false });
});

test('rebaseBeforeReviewRound refuses to auto-commit when unmerged conflicts exist', async () => {
  const logs = [];
  const errors = [];
  const slug = 'task-1107';

  const result = await rebaseBeforeReviewRound(slug, {
    worktree: '/tmp/worktree',
    isForgejoReviewEnabledFn: () => true,
    gitFn: (args) => {
      if (args.includes('status')) {
        return { status: 0, stdout: porcelainZ([`UU docs/missions/2026/${slug}/MISSION.md`]), stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    },
    ...inProcessWorkflow([], { onRun: () => assert.fail('Should not have run rebase') }),
    log: message => logs.push(message),
    error: message => errors.push(message)
  });

  assert.equal(result.ok, false);
  assert.equal(result.sharedFileConflicts, false);
  assert.equal(result.hookFailure, false);
  assert.equal(result.failure.kind, 'unsafe-worktree');
  assert.ok(errors.some(m => m.includes('Cannot auto-commit: unmerged/conflicting files detected')), 'Should report unmerged conflicts');
});

test('rebaseBeforeReviewRound reports shared-file rebase conflicts', async () => {
  const logs = [];
  const errors = [];
  const slug = 'task-1107';

  const result = await rebaseBeforeReviewRound(slug, {
    worktree: '/tmp/worktree',
    isForgejoReviewEnabledFn: () => true,
    gitFn: () => ({ status: 0, stdout: '', stderr: '' }),
    ...inProcessWorkflow([], {
      exitCode: 1,
      port: {
        resolveConflictsForMission: () => ({
          ok: true,
          conflictFiles: ['workflow/lib/review/review.js'],
          missionSpecificFiles: [],
          sharedFiles: ['workflow/lib/review/review.js'],
        }),
      },
      onRun: (workflowPort) => { workflowPort.resolveConflictsForMission(slug, 'lib', {}); },
    }),
    log: message => logs.push(message),
    error: message => errors.push(message)
  });

  assert.equal(result.ok, false);
  assert.equal(result.sharedFileConflicts, true);
  assert.equal(result.hookFailure, false);
  assert.equal(result.failure.kind, 'conflict');
  assert.deepEqual(result.failure.sharedFiles, ['workflow/lib/review/review.js']);
  assert.ok(errors.some(m => m.includes('Shared-file rebase conflicts detected')), 'Should report shared-file conflicts');
});

test('rebaseBeforeReviewRound reports missing Forgejo token failure from rebase push', async () => {
  const errors = [];
  const slug = 'task-1107';

  const result = await rebaseBeforeReviewRound(slug, {
    worktree: '/tmp/worktree',
    isForgejoReviewEnabledFn: () => true,
    gitFn: () => ({ status: 0, stdout: '', stderr: '' }),
    // The workflow reports a missing Forgejo token by exiting non-zero before it
    // ever reaches `createPr`, so no gate or hook evidence is produced.
    ...inProcessWorkflow([], { exitCode: 1 }),
    log: () => {},
    error: message => errors.push(message)
  });

  assert.equal(result.ok, false);
  assert.equal(result.sharedFileConflicts, false);
  assert.equal(result.hookFailure, false);
  assert.equal(result.failure.kind, 'other');
  assert.equal(result.failure.operation, 'rebase');
  assert.ok(errors.some(m => m.includes('Rebase failed before launching reviewer')), 'Should keep missing-token failure blocking');
});

test('rebaseBeforeReviewRound reports generic rebase failure', async () => {
  const logs = [];
  const errors = [];
  const slug = 'task-1107';

  const result = await rebaseBeforeReviewRound(slug, {
    worktree: '/tmp/worktree',
    isForgejoReviewEnabledFn: () => true,
    gitFn: () => ({ status: 0, stdout: '', stderr: '' }),
    ...inProcessWorkflow([], { exitCode: 1 }),
    log: message => logs.push(message),
    error: message => errors.push(message)
  });

  assert.equal(result.ok, false);
  assert.equal(result.sharedFileConflicts, false);
  assert.equal(result.hookFailure, false);
  assert.equal(result.failure.kind, 'other');
  assert.ok(errors.some(m => m.includes('Rebase failed before launching reviewer')), 'Should report generic failure');
});
