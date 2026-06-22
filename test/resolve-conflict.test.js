const test = require('node:test');
const { mock } = test;
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Mock getPrimaryBranch BEFORE requiring dependent modules to ensure they use the mock.
const missionUtils = require('../lib/core/mission-utils');
mock.method(missionUtils, 'getPrimaryBranch', () => 'main');

const { parseConflictFilesFromMergeOutput, getConflictFiles, getPrimaryBranch } = missionUtils;
const { resolveConflictsForMission, buildConflictResolutionPrompt } = require('../lib/commands/integrate');
const resolveConflict = require('../lib/commands/resolve-conflict');
const { buildAgentResolutionPrompt } = require('../lib/commands/resolve-conflict');

const PRIMARY = getPrimaryBranch();
const TEST_WORKTREE = '/tmp/visualBoard-task-108';
const MISSING_WORKTREE = '/tmp/visualBoard-task-nonexistent-zzz';

// ---------------------------------------------------------------------------
// parseConflictFilesFromMergeOutput
// ---------------------------------------------------------------------------

test('parseConflictFilesFromMergeOutput parses content conflicts', () => {
  const output = [
    'Auto-merging workflow/lib/commands/integrate.js',
    'CONFLICT (content): Merge conflict in workflow/lib/commands/integrate.js',
    'Auto-merging docs/missions/2026/task-108/CP-1.md',
    'CONFLICT (content): Merge conflict in docs/missions/2026/task-108/CP-1.md',
    'Automatic merge failed; fix conflicts and then commit the result.'
  ].join('\n');

  const files = parseConflictFilesFromMergeOutput(output);
  assert.deepEqual(files, [
    'workflow/lib/commands/integrate.js',
    'docs/missions/2026/task-108/CP-1.md'
  ]);
});

test('parseConflictFilesFromMergeOutput parses modify/delete conflicts', () => {
  const output = [
    'CONFLICT (modify/delete): backlog/tasks/task-108 - Fix.md deleted in HEAD. Version mission/task-108 of backlog/tasks/task-108 - Fix.md left in tree.',
    'Automatic merge failed; fix conflicts and then commit the result.'
  ].join('\n');

  const files = parseConflictFilesFromMergeOutput(output);
  assert.equal(files.length, 1);
  assert.match(files[0], /task-108/);
});

test('parseConflictFilesFromMergeOutput returns empty array when no conflicts', () => {
  const output = 'Already up to date.\n';
  assert.deepEqual(parseConflictFilesFromMergeOutput(output), []);
});

test('parseConflictFilesFromMergeOutput deduplicates repeated conflict lines', () => {
  const output = [
    'CONFLICT (content): Merge conflict in workflow/lib/commands/integrate.js',
    'CONFLICT (content): Merge conflict in workflow/lib/commands/integrate.js'
  ].join('\n');

  const files = parseConflictFilesFromMergeOutput(output);
  assert.deepEqual(files, ['workflow/lib/commands/integrate.js']);
});

// ---------------------------------------------------------------------------
// getConflictFiles
// ---------------------------------------------------------------------------

test('getConflictFiles returns empty array when dry merge succeeds', () => {
  const gitCalls = [];
  const files = getConflictFiles('/tmp/worktree', PRIMARY, {
    gitRunner(args) {
      gitCalls.push(args);
      return { status: 0, stdout: 'Already up to date.\n', stderr: '' };
    }
  });

  assert.deepEqual(files, []);
  assert.equal(gitCalls.length, 2);
  assert.deepEqual(gitCalls[0], ['-C', '/tmp/worktree', 'merge', '--no-commit', '--no-ff', PRIMARY]);
  assert.deepEqual(gitCalls[1], ['-C', '/tmp/worktree', 'merge', '--abort']);
});

test('getConflictFiles returns conflict files and always aborts', () => {
  const gitCalls = [];
  const conflictOutput = [
    'Auto-merging workflow/lib/commands/integrate.js',
    'CONFLICT (content): Merge conflict in workflow/lib/commands/integrate.js',
    'Automatic merge failed; fix conflicts and then commit the result.'
  ].join('\n');

  const files = getConflictFiles('/tmp/worktree', PRIMARY, {
    gitRunner(args) {
      gitCalls.push(args);
      if (args.includes('--no-commit')) {
        return { status: 1, stdout: conflictOutput, stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    }
  });

  assert.deepEqual(files, ['workflow/lib/commands/integrate.js']);
  assert.equal(gitCalls.length, 2);
  assert.deepEqual(gitCalls[1], ['-C', '/tmp/worktree', 'merge', '--abort']);
});

test('getConflictFiles throws for non-conflict merge failure (no CONFLICT lines)', () => {
  assert.throws(() => {
    getConflictFiles('/tmp/worktree', PRIMARY, {
      gitRunner(args) {
        if (args.includes('--no-commit')) {
          return { status: 128, stdout: '', stderr: 'fatal: index.lock: File exists.' };
        }
        return { status: 0, stdout: '', stderr: '' };
      }
    });
  }, /git merge exited 128 with no CONFLICT lines/);
});

// ---------------------------------------------------------------------------
// resolveConflictsForMission — no conflicts
// ---------------------------------------------------------------------------

test('resolveConflictsForMission returns ok when no conflicts detected', () => {
  mock.method(fs, 'existsSync', (p) => p === TEST_WORKTREE);

  const lines = [];
  const origLog = console.log;
  console.log = l => lines.push(l);

  try {
    const result = resolveConflictsForMission('task-108', 'docs', {
      worktreePathOverride: TEST_WORKTREE,
      getConflictFilesFn: () => []
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.conflictFiles, []);
    assert.deepEqual(result.sharedFiles, []);
    assert.match(lines.join('\n'), /No conflicts detected/i);
  } finally {
    console.log = origLog;
    mock.restoreAll();
    mock.method(require('../lib/core/mission-utils'), 'getPrimaryBranch', () => 'main');
  }
});

// ---------------------------------------------------------------------------
// resolveConflictsForMission — mission-specific conflicts only
// ---------------------------------------------------------------------------

test('resolveConflictsForMission emits skip-all-conflicts path for mission-specific files', () => {
  mock.method(fs, 'existsSync', (p) => p === TEST_WORKTREE);

  const lines = [];
  const errs = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = l => lines.push(l);
  console.error = l => errs.push(l);

  try {
    const result = resolveConflictsForMission('task-108', 'docs', {
      worktreePathOverride: TEST_WORKTREE,
      getConflictFilesFn: () => [
        'docs/missions/2026/task-108/CP-1.md',
        'backlog/tasks/task-108 - Fix.md'
      ]
    });

    assert.equal(result.ok, true);
    assert.equal(result.sharedFiles.length, 0);
    assert.equal(result.missionSpecificFiles.length, 2);

    const out = lines.join('\n');
    assert.match(out, /mission-specific/i);
    assert.match(out, /--theirs/);
    assert.match(out, /cd "\/tmp\/visualBoard-task-108"/);
    assert.match(out, new RegExp(`git rebase ${PRIMARY}`));
    assert.match(out, /no verification gate configured/);
    assert.match(out, /px integrate task-108 --dry-run/);
    // No shared-file warning
    assert.equal(errs.filter(l => /shared/i.test(l)).length, 0);
  } finally {
    console.log = origLog;
    console.error = origErr;
    mock.restoreAll();
    mock.method(require('../lib/core/mission-utils'), 'getPrimaryBranch', () => 'main');
  }
});

// ---------------------------------------------------------------------------
// resolveConflictsForMission — shared file conflicts
// ---------------------------------------------------------------------------

test('resolveConflictsForMission warns and returns error for shared file conflicts', () => {
  mock.method(fs, 'existsSync', (p) => p === TEST_WORKTREE);

  const lines = [];
  const errs = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = l => lines.push(l);
  console.error = l => errs.push(l);

  try {
    const result = resolveConflictsForMission('task-108', 'docs', {
      worktreePathOverride: TEST_WORKTREE,
      getConflictFilesFn: () => [
        'workflow/lib/commands/integrate.js',
        'docs/missions/2026/task-108/CP-1.md'
      ]
    });

    assert.equal(result.ok, false);
    assert.equal(result.error, 'shared-file-conflicts');
    assert.equal(result.sharedFiles.length, 1);
    assert.deepEqual(result.sharedFiles, ['workflow/lib/commands/integrate.js']);
    assert.equal(result.missionSpecificFiles.length, 1);

    const out = lines.join('\n');
    assert.match(out, /manual resolution/i);
    assert.match(out, /cd "\/tmp\/visualBoard-task-108"/);
    assert.match(out, new RegExp(`git rebase ${PRIMARY}`));
  } finally {
    console.log = origLog;
    console.error = origErr;
    mock.restoreAll();
    mock.method(require('../lib/core/mission-utils'), 'getPrimaryBranch', () => 'main');
  }
});

// ---------------------------------------------------------------------------
// resolveConflictsForMission — missing worktree
// ---------------------------------------------------------------------------

test('resolveConflictsForMission returns error when worktree is missing', () => {
  mock.method(fs, 'existsSync', (p) => p !== MISSING_WORKTREE);

  const slug = 'task-nonexistent-zzz';
  const lines = [];
  const errs = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = l => lines.push(l);
  console.error = l => errs.push(l);

  try {
    const result = resolveConflictsForMission(slug, 'docs', { worktreePathOverride: MISSING_WORKTREE });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'worktree-missing');
    assert.match(errs.join('\n'), /worktree not found/i);
  } finally {
    console.log = origLog;
    console.error = origErr;
    mock.restoreAll();
    mock.method(require('../lib/core/mission-utils'), 'getPrimaryBranch', () => 'main');
  }
});

// ---------------------------------------------------------------------------
// resolveConflictsForMission — non-conflict merge failure
// ---------------------------------------------------------------------------

test('resolveConflictsForMission returns merge-failed when getConflictFilesFn throws', () => {
  mock.method(fs, 'existsSync', (p) => p === TEST_WORKTREE);

  const lines = [];
  const errs = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = l => lines.push(l);
  console.error = l => errs.push(l);

  try {
    const result = resolveConflictsForMission('task-108', 'docs', {
      worktreePathOverride: TEST_WORKTREE,
      getConflictFilesFn: () => { throw new Error(`git merge exited 128 with no CONFLICT lines — raw output:\nfatal: index.lock: File exists.`); }
    });

    assert.equal(result.ok, false);
    assert.equal(result.error, 'merge-failed');
    assert.match(errs.join('\n'), /non-conflict error/i);
  } finally {
    console.log = origLog;
    console.error = origErr;
    mock.restoreAll();
    mock.method(require('../lib/core/mission-utils'), 'getPrimaryBranch', () => 'main');
  }
});

// ---------------------------------------------------------------------------
// buildConflictResolutionPrompt — agent-assisted path present
// ---------------------------------------------------------------------------

test('buildConflictResolutionPrompt includes agent-assisted resolve-conflict entrypoint', () => {
  const primaryBranch = getPrimaryBranch();
  const prompt = buildConflictResolutionPrompt('task-097', 'docs').join('\n');
  assert.match(prompt, /Copy\/paste from the mission worktree:/);
  assert.match(prompt, /px resolve-conflict task-097/);
  assert.match(prompt, /Agent-assisted/i);
  assert.match(prompt, /Manual/i);
  assert.match(prompt, new RegExp(`Rebase the mission branch onto the local ${PRIMARY} branch`, 'i'));
  assert.match(prompt, new RegExp(`git rebase ${PRIMARY}`));
  assert.match(prompt, /no verification gate configured/);
  assert.match(prompt, /px integrate task-097 --dry-run/);
});

// ---------------------------------------------------------------------------
// resolveConflictsForMission — worktreePath in return value
// ---------------------------------------------------------------------------

test('resolveConflictsForMission includes worktreePath in every return shape', () => {
  mock.method(fs, 'existsSync', (p) => p === TEST_WORKTREE);

  try {
    // No-conflicts path
    const r1 = resolveConflictsForMission('task-108', 'docs', { worktreePathOverride: TEST_WORKTREE, getConflictFilesFn: () => [] });
    assert.ok(r1.worktreePath, 'worktreePath present on no-conflict result');

    // Mission-specific conflicts path
    const r2 = resolveConflictsForMission('task-108', 'docs', {
      worktreePathOverride: TEST_WORKTREE,
      getConflictFilesFn: () => ['docs/missions/2026/task-108/CP-1.md']
    });
    assert.ok(r2.worktreePath, 'worktreePath present on mission-specific result');

    // Shared-file conflicts path
    const r3 = resolveConflictsForMission('task-108', 'docs', {
      worktreePathOverride: TEST_WORKTREE,
      getConflictFilesFn: () => ['workflow/lib/commands/integrate.js']
    });
    assert.ok(r3.worktreePath, 'worktreePath present on shared-conflict result');
  } finally {
    mock.restoreAll();
    mock.method(require('../lib/core/mission-utils'), 'getPrimaryBranch', () => 'main');
  }
});

// ---------------------------------------------------------------------------
// resolve-conflict CLI — buildAgentResolutionPrompt
// ---------------------------------------------------------------------------

// Access the internal helper for unit testing via the module's closure.
// We test it indirectly through the exported resolveConflict by stubbing agents.

// ---------------------------------------------------------------------------
// buildAgentResolutionPrompt
// ---------------------------------------------------------------------------

test('buildAgentResolutionPrompt contains deterministic --theirs commands for each file', () => {
  const prompt = buildAgentResolutionPrompt({
    slug: 'task-108',
    area: 'docs',
    worktreePath: TEST_WORKTREE,
    missionSpecificFiles: [
      'docs/missions/2026/task-108/CP-1.md',
      'backlog/tasks/task-108 - Rename.md'
    ]
  });

  assert.match(prompt, /conflict-resolution/i);
  assert.match(prompt, /task-108/);
  assert.match(prompt, /cd "\/tmp\/visualBoard-task-108"/);
  assert.match(prompt, new RegExp(`git rebase ${PRIMARY}`));
  assert.match(prompt, /git checkout --theirs "docs\/missions\/2026\/task-108\/CP-1\.md"/);
  assert.match(prompt, /git checkout --theirs "backlog\/tasks\/task-108 - Rename\.md"/);
  assert.match(prompt, /no verification gate configured/);
  assert.match(prompt, /px integrate task-108 --dry-run/);
  // Must instruct agent to stop on unexpected files, not guess
  assert.match(prompt, /NOT in the list/i);
  assert.match(prompt, /stop immediately/i);
});

// ---------------------------------------------------------------------------
// resolveConflict() — launcher control flow
// ---------------------------------------------------------------------------

test('resolveConflict exits 0 and skips agent when no conflicts', () => {
  let exitCode = null;
  let agentCalled = false;
  const lines = [];
  const origLog = console.log;
  console.log = l => lines.push(l);

  try {
    resolveConflict(['task-108'], {
      resolveConflictsFn: () => ({ ok: true, conflictFiles: [], sharedFiles: [], missionSpecificFiles: [], worktreePath: '/tmp/wt' }),
      startAgentFn: () => { agentCalled = true; return { agent: 'claude', result: { status: 0 } }; },
      exitFn: code => { exitCode = code; },
    });
  } finally {
    console.log = origLog;
  }

  assert.equal(exitCode, 0);
  assert.equal(agentCalled, false, 'agent must not be spawned when there are no conflicts');
});

test('resolveConflict exits 1 and skips agent for shared-file conflicts', () => {
  let exitCode = null;
  let agentCalled = false;
  const errs = [];
  const origErr = console.error;
  console.error = l => errs.push(l);

  try {
    resolveConflict(['task-108'], {
      resolveConflictsFn: () => ({
        ok: false,
        error: 'shared-file-conflicts',
        conflictFiles: ['workflow/lib/commands/integrate.js'],
        sharedFiles: ['workflow/lib/commands/integrate.js'],
        missionSpecificFiles: [],
        worktreePath: '/tmp/wt',
      }),
      startAgentFn: () => { agentCalled = true; return { agent: 'claude', result: { status: 0 } }; },
      exitFn: code => { exitCode = code; },
    });
  } finally {
    console.error = origErr;
  }

  assert.equal(exitCode, 1);
  assert.equal(agentCalled, false, 'agent must not be spawned for shared-file conflicts');
  assert.match(errs.join('\n'), /cannot guess/i);
});

test('resolveConflict spawns agent for mission-specific-only conflicts and exits 0 on success', async () => {
  let exitCode = null;
  let agentStep = null;
  let agentPrompt = null;
  let agentWorktree = null;
  const lines = [];
  const origLog = console.log;
  console.log = l => lines.push(l);

  try {
    await resolveConflict(['task-108'], {
      resolveConflictsFn: () => ({
        ok: true,
        conflictFiles: ['docs/missions/2026/task-108/CP-1.md'],
        sharedFiles: [],
        missionSpecificFiles: ['docs/missions/2026/task-108/CP-1.md'],
        worktreePath: '/tmp/wt',
      }),
      startAgentFn: async (step, { prompt, worktree }) => {
        agentStep = step;
        agentPrompt = prompt;
        agentWorktree = worktree;
        return { agent: 'codex', result: { status: 0 } };
      },
      exitFn: code => { exitCode = code; },
    });
  } finally {
    console.log = origLog;
  }

  assert.equal(exitCode, 0);
  assert.equal(agentStep, 'conflict-resolution');
  assert.equal(agentWorktree, '/tmp/wt');
  assert.match(agentPrompt, /CP-1\.md/);
  assert.match(agentPrompt, /--theirs/);
  assert.match(lines.join('\n'), /PASS.*codex/i);
});

test('resolveConflict exits with agent status when agent fails', async () => {
  let exitCode = null;
  const errs = [];
  const origErr = console.error;
  console.error = l => errs.push(l);

  try {
    await resolveConflict(['task-108'], {
      resolveConflictsFn: () => ({
        ok: true,
        conflictFiles: ['docs/missions/2026/task-108/CP-1.md'],
        sharedFiles: [],
        missionSpecificFiles: ['docs/missions/2026/task-108/CP-1.md'],
        worktreePath: '/tmp/wt',
      }),
      startAgentFn: async () => ({ agent: 'claude', result: { status: 2 } }),
      exitFn: code => { exitCode = code; },
    });
  } finally {
    console.error = origErr;
  }

  assert.equal(exitCode, 2);
  assert.match(errs.join('\n'), /FAIL.*claude/i);
});
