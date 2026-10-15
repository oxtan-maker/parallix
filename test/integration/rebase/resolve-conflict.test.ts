

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { mockModule, installModuleMocks } from '../../lib/module-mock.js';
const missionUtils = mockModule<typeof import('../../../src/adapters/filesystem/mission-utils.js')>('../../../src/adapters/filesystem/mission-utils.js', import.meta.url);
const resolveConflictsForMissionModule = mockModule<typeof import('../../../src/adapters/cli/commands/integrate.js')>('../../../src/adapters/cli/commands/integrate.js', import.meta.url);
const resolveConflictModule = mockModule<typeof import('../../../src/adapters/cli/commands/resolve-conflict.js')>('../../../src/adapters/cli/commands/resolve-conflict.js', import.meta.url);
const buildAgentResolutionPromptModule = mockModule<typeof import('../../../src/adapters/cli/commands/resolve-conflict.js')>('../../../src/adapters/cli/commands/resolve-conflict.js', import.meta.url);
await installModuleMocks();
const resolveConflict = resolveConflictModule.default;
const { resolveConflictsForMission, buildConflictResolutionPrompt } = resolveConflictsForMissionModule;
const { buildAgentResolutionPrompt } = buildAgentResolutionPromptModule;
const { mock } = test;

// Mock getPrimaryBranch BEFORE requiring dependent modules to ensure they use the mock.
mock.method(missionUtils, 'getPrimaryBranch', () => 'main');

const { parseConflictFilesFromMergeOutput, getConflictFiles, getPrimaryBranch } = missionUtils;

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
  const gitCalls: string[][] = [];
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
  const gitCalls: string[][] = [];
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
  mock.method(fs, 'existsSync', (p: Parameters<(typeof fs)["existsSync"]>[0]) => p === TEST_WORKTREE);

  const lines: unknown[] = [];
  const origLog = console.log;
  console.log = (l: unknown) => lines.push(l);

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
    mock.method(missionUtils, 'getPrimaryBranch', () => 'main');
  }
});

// ---------------------------------------------------------------------------
// resolveConflictsForMission — mission-specific conflicts only
// ---------------------------------------------------------------------------

test('resolveConflictsForMission emits skip-all-conflicts path for mission-specific files', () => {
  mock.method(fs, 'existsSync', (p: Parameters<(typeof fs)["existsSync"]>[0]) => p === TEST_WORKTREE);

  const lines: unknown[] = [];
  const errs: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (l: unknown) => lines.push(l);
  console.error = (l: unknown) => errs.push(String(l));

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
    mock.method(missionUtils, 'getPrimaryBranch', () => 'main');
  }
});

// ---------------------------------------------------------------------------
// resolveConflictsForMission — shared file conflicts
// ---------------------------------------------------------------------------

test('resolveConflictsForMission warns and returns error for shared file conflicts', () => {
  mock.method(fs, 'existsSync', (p: Parameters<(typeof fs)["existsSync"]>[0]) => p === TEST_WORKTREE);

  const lines: unknown[] = [];
  const errs: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (l: unknown) => lines.push(l);
  console.error = (l: unknown) => errs.push(String(l));

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
    mock.method(missionUtils, 'getPrimaryBranch', () => 'main');
  }
});

// ---------------------------------------------------------------------------
// resolveConflictsForMission — missing worktree
// ---------------------------------------------------------------------------

test('resolveConflictsForMission returns error when worktree is missing', () => {
  mock.method(fs, 'existsSync', (p: Parameters<(typeof fs)["existsSync"]>[0]) => p !== MISSING_WORKTREE);

  const slug = 'task-nonexistent-zzz';
  const lines: unknown[] = [];
  const errs: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (l: unknown) => lines.push(l);
  console.error = (l: unknown) => errs.push(String(l));

  try {
    const result = resolveConflictsForMission(slug, 'docs', { worktreePathOverride: MISSING_WORKTREE });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'worktree-missing');
    assert.match(errs.join('\n'), /worktree not found/i);
  } finally {
    console.log = origLog;
    console.error = origErr;
    mock.restoreAll();
    mock.method(missionUtils, 'getPrimaryBranch', () => 'main');
  }
});

// ---------------------------------------------------------------------------
// resolveConflictsForMission — non-conflict merge failure
// ---------------------------------------------------------------------------

test('resolveConflictsForMission returns merge-failed when getConflictFilesFn throws', () => {
  mock.method(fs, 'existsSync', (p: Parameters<(typeof fs)["existsSync"]>[0]) => p === TEST_WORKTREE);

  const lines: unknown[] = [];
  const errs: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (l: unknown) => lines.push(l);
  console.error = (l: unknown) => errs.push(String(l));

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
    mock.method(missionUtils, 'getPrimaryBranch', () => 'main');
  }
});

// ---------------------------------------------------------------------------
// buildConflictResolutionPrompt — agent-assisted path present
// ---------------------------------------------------------------------------

test('buildConflictResolutionPrompt includes agent-assisted resolve-conflict entrypoint', () => {
  const primaryBranch = getPrimaryBranch();
  const prompt = buildConflictResolutionPrompt('task-097', 'docs').join('\n');
  assert.match(prompt, /Copy\/paste from the mission worktree:/);
  assert.match(prompt, /stage every resolved file before each git rebase --continue/);
  assert.match(prompt, /Repeat through successive conflict pauses/);
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
  mock.method(fs, 'existsSync', (p: Parameters<(typeof fs)["existsSync"]>[0]) => p === TEST_WORKTREE);

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
    mock.method(missionUtils, 'getPrimaryBranch', () => 'main');
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
  assert.match(prompt, /no authorized resolution is available/i);
});

test('buildAgentResolutionPrompt states the execute-verify-report completion contract', () => {
  // task-2386 AC #2: during TASK-2385 the resolver announced its plan and then
  // stopped, so the handoff waited forever. The prompt must demand execution.
  const prompt = buildAgentResolutionPrompt({
    slug: 'task-2386',
    area: 'workflow',
    worktreePath: TEST_WORKTREE,
    missionSpecificFiles: ['docs/missions/2026/task-2386/CP-1.md']
  });

  assert.match(prompt, /Execute the listed commands now/);
  assert.match(prompt, /do not only describe or plan them/i);
  assert.match(prompt, /Report completion only after/i);
  assert.match(prompt, /report the failure and stop/i);
  assert.match(prompt, /ordinary Git rebase conflict pause is expected/i);
  assert.match(prompt, /stage every resolved file before each git rebase --continue/i);
  assert.match(prompt, /Repeat through successive conflict pauses/i);
  assert.match(prompt, /no rebase in progress or unmerged files/i);
  // The pre-existing per-file stop rule must survive the shared contract.
  assert.match(prompt, /NOT in the list/i);
});

// ---------------------------------------------------------------------------
// resolveConflict() — launcher control flow
// ---------------------------------------------------------------------------

test('resolveConflict exits 0 and skips agent when no conflicts', () => {
  let exitCode: { value: number | null } = { value: null };
  let agentCalled = false;
  const lines: unknown[] = [];
  const origLog = console.log;
  console.log = (l: unknown) => lines.push(l);

  try {
    resolveConflict(['task-108'], {
      resolveConflictsFn: () => ({ ok: true as const, conflictFiles: [], sharedFiles: [], missionSpecificFiles: [], worktreePath: '/tmp/wt' }),
      startAgentFn: async () => { agentCalled = true; return { agent: 'claude', result: { status: 0 } }; },
      exitFn: code => { exitCode.value = code; },
    });
  } finally {
    console.log = origLog;
  }

  assert.equal(exitCode.value, 0);
  assert.equal(agentCalled, false, 'agent must not be spawned when there are no conflicts');
});

test('resolveConflict exits 1 and skips agent for shared-file conflicts', () => {
  let exitCode: { value: number | null } = { value: null };
  let agentCalled = false;
  const errs: string[] = [];
  const origErr = console.error;
  console.error = (l: unknown) => errs.push(String(l));

  try {
    resolveConflict(['task-108'], {
      resolveConflictsFn: () => ({
        ok: false as const,
        error: 'shared-file-conflicts',
        conflictFiles: ['workflow/lib/commands/integrate.js'],
        sharedFiles: ['workflow/lib/commands/integrate.js'],
        missionSpecificFiles: [],
        worktreePath: '/tmp/wt',
      }),
      startAgentFn: async () => { agentCalled = true; return { agent: 'claude', result: { status: 0 } }; },
      exitFn: code => { exitCode.value = code; },
    });
  } finally {
    console.error = origErr;
  }

  assert.equal(exitCode.value, 1);
  assert.equal(agentCalled, false, 'agent must not be spawned for shared-file conflicts');
  assert.match(errs.join('\n'), /cannot guess/i);
});

// ---------------------------------------------------------------------------
// resolveConflict — implementer-owned conflict resolution (TASK-2294.01)
// ---------------------------------------------------------------------------

/** Mission-specific-only conflict classification for the agent-launch path. */
const MISSION_SPECIFIC_CONFLICTS: NonNullable<NonNullable<Parameters<typeof resolveConflict>[1]>["resolveConflictsFn"]> = () => ({
  ok: true as const,
  conflictFiles: ['docs/missions/2026/task-108/CP-1.md'],
  sharedFiles: [],
  missionSpecificFiles: ['docs/missions/2026/task-108/CP-1.md'],
  worktreePath: '/tmp/wt',
});

/** Backlog seams that record `implementer` as the mission's assignee. */
const implementerSeams = (implementer: string) => ({
  rootDir: '/repo',
  resolveTaskFileFn: () => ({ matches: ['/repo/backlog/tasks/task-108.md'],  ok: true as const, taskFile: '/repo/backlog/tasks/task-108.md' }),
  getTaskImplementerFn: () => implementer,
});

test('resolveConflict spawns agent for mission-specific-only conflicts and exits 0 on success', async () => {
  let exitCode: { value: number | null } = { value: null };
  let agentStep: { value: string | null } = { value: null };
  let agentOptions: { value: import("../../../src/adapters/agents/agent-launch-context.js").StartAgentOptions | undefined | null } = { value: null };
  const lines: unknown[] = [];
  const origLog = console.log;
  console.log = (l: unknown) => lines.push(l);

  try {
    await resolveConflict(['task-108'], {
      ...implementerSeams('codex'),
      resolveConflictsFn: MISSION_SPECIFIC_CONFLICTS,
      startAgentFn: async (step, options) => {
        agentStep.value = step;
        assert.ok(options?.agent);
        agentOptions.value = options;
        return { agent: options.agent, result: { status: 0 } };
      },
      exitFn: code => { exitCode.value = code; },
    });
  } finally {
    console.log = origLog;
  }

  assert.equal(exitCode.value, 0);
  assert.equal(agentStep.value, 'conflict-resolution');
  assert.ok(agentOptions.value != null);
  assert.equal(agentOptions.value.worktree, '/tmp/wt');
  assert.equal(typeof agentOptions.value.prompt, 'string');
  assert.ok(typeof agentOptions.value.prompt === 'string');
  assert.match(agentOptions.value.prompt, /CP-1\.md/);
  assert.equal(typeof agentOptions.value.prompt, 'string');
  assert.ok(typeof agentOptions.value.prompt === 'string');
  assert.match(agentOptions.value.prompt, /--theirs/);
  assert.match(lines.join('\n'), /PASS.*codex/i);
});

test('resolveConflict pins the recorded mission implementer as the conflict agent', async () => {
  let agentOptions: { value: import("../../../src/adapters/agents/agent-launch-context.js").StartAgentOptions | undefined | null } = { value: null };
  let exitCode: { value: number | null } = { value: null };
  const origLog = console.log;
  console.log = () => {};

  try {
    await resolveConflict(['task-108'], {
      ...implementerSeams('vibe'),
      resolveConflictsFn: MISSION_SPECIFIC_CONFLICTS,
      startAgentFn: async (_step, options) => {
        assert.ok(options?.agent);
        agentOptions.value = options;
        return { agent: options.agent, result: { status: 0 } };
      },
      exitFn: code => { exitCode.value = code; },
    });
  } finally {
    console.log = origLog;
  }

  assert.equal(exitCode.value, 0);
  // SC1: the launch carries the recorded implementer, not a pool selection.
  assert.ok(agentOptions.value != null);
  assert.equal(agentOptions.value.agent, 'vibe');
  // SC7: usage stays attributable to (conflict-resolution stage, implementer role).
  assert.equal(agentOptions.value.slug, 'task-108');
  assert.equal(agentOptions.value.role, 'implementer');
  // AC #3: no substitute family may be selected after a failure.
  assert.equal(agentOptions.value.pinnedAgent, true);
});

test('resolveConflict accepts any configured implementer family without hardcoding names', async () => {
  const seen: (string | undefined)[] = [];
  const origLog = console.log;
  console.log = () => {};

  try {
    for (const family of ['claude', 'codex', 'custom', 'vibe', 'future-family']) {
      await resolveConflict(['task-108'], {
        ...implementerSeams(family),
        resolveConflictsFn: MISSION_SPECIFIC_CONFLICTS,
        startAgentFn: async (_step, options) => {
          assert.ok(options?.agent);
          seen.push(options.agent);
          return { agent: options.agent, result: { status: 0 } };
        },
        exitFn: () => {},
      });
    }
  } finally {
    console.log = origLog;
  }

  // AC #4: the conflict path passes the recorded family through untouched.
  assert.deepEqual(seen, ['claude', 'codex', 'custom', 'vibe', 'future-family']);
});

test('resolveConflict exits non-zero when the mission has no recorded implementer', async () => {
  let exitCode: { value: number | null } = { value: null };
  let agentLaunched = false;
  const errs: string[] = [];
  const lines: unknown[] = [];
  const origErr = console.error;
  const origLog = console.log;
  console.error = (l: unknown) => errs.push(String(l));
  console.log = (l: unknown) => lines.push(l);

  try {
    await resolveConflict(['task-108'], {
      rootDir: '/repo',
      resolveTaskFileFn: () => ({ matches: [], reason: 'missing' as const,  ok: false as const }),
      getTaskImplementerFn: () => null,
      resolveConflictsFn: MISSION_SPECIFIC_CONFLICTS,
      startAgentFn: async () => { agentLaunched = true; return { agent: 'codex', result: { status: 0 } }; },
      exitFn: code => { exitCode.value = code; },
    });
  } finally {
    console.error = origErr;
    console.log = origLog;
  }

  // SC6: missing implementer is a hard stop, never a pool selection.
  assert.equal(exitCode.value, 1);
  assert.equal(agentLaunched, false);
  assert.match(errs.join('\n'), /no recorded implementer/i);
  assert.match(lines.join('\n'), /px resolve-conflict task-108/);
});

test('resolveConflict exits non-zero and names the implementer when its launcher is unavailable', async () => {
  let exitCode: { value: number | null } = { value: null };
  const errs: string[] = [];
  const lines: unknown[] = [];
  const origErr = console.error;
  const origLog = console.log;
  console.error = (l: unknown) => errs.push(String(l));
  console.log = (l: unknown) => lines.push(l);

  try {
    await resolveConflict(['task-108'], {
      ...implementerSeams('vibe'),
      resolveConflictsFn: MISSION_SPECIFIC_CONFLICTS,
      startAgentFn: async () => {
        throw Object.assign(
          new Error('Pinned agent "vibe" cannot run this step: launcher "vibe" not found on PATH'),
          { code: 'PINNED_AGENT_UNAVAILABLE' },
        );
      },
      exitFn: code => { exitCode.value = code; },
    });
  } finally {
    console.error = origErr;
    console.log = origLog;
  }

  // SC4: names the implementer family and the launcher detail.
  assert.equal(exitCode.value, 1);
  assert.match(errs.join('\n'), /vibe/);
  assert.match(errs.join('\n'), /not found on PATH/);
  assert.match(lines.join('\n'), /does not substitute another agent family/i);
});

test('resolveConflict exits with agent status when agent fails', async () => {
  let exitCode: { value: number | null } = { value: null };
  const errs: string[] = [];
  const origErr = console.error;
  console.error = (l: unknown) => errs.push(String(l));

  try {
    await resolveConflict(['task-108'], {
      ...implementerSeams('claude'),
      resolveConflictsFn: MISSION_SPECIFIC_CONFLICTS,
      startAgentFn: async () => ({ agent: 'claude', result: { status: 2 } }),
      exitFn: code => { exitCode.value = code; },
    });
  } finally {
    console.error = origErr;
  }

  assert.equal(exitCode.value, 2);
  assert.match(errs.join('\n'), /FAIL.*claude/i);
});
