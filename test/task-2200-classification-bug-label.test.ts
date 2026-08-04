
const test = require('node:test');
const assert = require('node:assert/strict');
const missionStart = require('../.test-runtime/adapters/cli/mission-start.js');

// Reproduces task-2200: mission-start's primary classification lookup
// (mission-start.ts:148) calls resolveMissionClassificationFn(slug) without
// passing the resolved worktree cwd, so the underlying resolver falls back to
// process.cwd() instead of the mission's actual worktree. When the process is
// not physically cwd'd into the worktree (e.g. driven from the primary
// checkout), classification resolution silently looks in the wrong root.
test('missionStart resolves classification using the mission worktree cwd, not process.cwd()', () => {
  const lines = [];
  const errors = [];
  const seenRootDirs = [];

  const result = missionStart(['task-2200'], {
    returnResult: true,
    cwdFn: () => '/tmp/project-task-2200',
    getCurrentBranchFn: () => 'mission/task-2200',
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/project-task-2200/task-2200.md' }),
    resolveMissionClassificationFn: (slug, rootDir) => {
      seenRootDirs.push(rootDir);
      // Simulate a task file with labels [ai_sdlc, bug] that only exists
      // under the mission worktree, not under process.cwd().
      if (rootDir === '/tmp/project-task-2200') {
        return { classification: 'ai_sdlc', taskFile: '/tmp/project-task-2200/task-2200.md' };
      }
      return {
        classification: null,
        taskFile: null,
        error: `Could not resolve backlog task for ${slug}.`,
      };
    },
    getTaskStatusFn: () => 'active',
    toVirtualFn: (s) => s,
    findMissionDirFn: () => '/tmp/docs/missions/2026/task-2200',
    fsExistsSync: () => true,
    findCheckpointsFn: () => [],
    getMissionYearFn: () => '2026',
    conventionalWorktreePathFn: () => '/tmp/project-task-2200',
    getLastCommitFn: () => ({ sha: 'abcdef123456', subject: 'Initial', date: '2026-04-30' }),
    getPrStatusFn: () => ({ exists: false }),
    log: line => lines.push(line),
    error: line => errors.push(line)
  });

  const output = lines.join('\n').replace(/\x1B\[\d+m/g, '');

  // The primary classification lookup must receive the mission worktree
  // cwd as rootDir so it can find the task file, mirroring the fix already
  // applied to the fallback lookup at mission-start.ts:161.
  assert.ok(
    seenRootDirs.includes('/tmp/project-task-2200'),
    `expected resolveMissionClassificationFn to be called with the mission worktree cwd; got rootDirs: ${JSON.stringify(seenRootDirs)}`
  );
  assert.deepEqual(result, { pass: true });
  assert.ok(output.includes('[PASS] Backlog classification: ai_sdlc'));
});
