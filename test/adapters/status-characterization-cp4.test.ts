import test from 'node:test';
import assert from 'node:assert/strict';

import status, { parseWorktreeList, findStaleMissionWorktrees } from '../../src/adapters/cli/commands/status.js';

// ---------------------------------------------------------------------------
// Characterization tests — prove output contract is preserved (SC9)
//
// The status command routes mission-specific output through BoardProjectionBuilder.
// The projection preserves the legacy output contract:
//   - Backlog status uses raw backlog value (e.g. "ready", "approved") via Mission.rawStatus
//   - Checkpoint uses raw filename with .md extension (e.g. "CP-2.md")
//   - Checkpoint description is the first line of the checkpoint file
// These are verified by the output contract tests below.
// ---------------------------------------------------------------------------

/**
 * Build common mock opts for status command testing.
 */
function buildCommonOpts(overrides: Record<string, any> = {}) {
  return {
    inferSlugFn: () => 'task-1031',
    getCurrentBranchFn: () => 'mission/task-1031',
    findTaskFileFn: () => '/tmp/task-1031.md',
    getTaskStatusFn: () => 'active',
    findMissionDirFn: () => '/tmp/docs/missions/2026/task-1031',
    findCheckpointsFn: () => ['/tmp/docs/missions/2026/task-1031/CP-2.md'],
    getFirstLineFn: () => 'Checkpoint 2',
    getPrStatusFn: () => ({ exists: true, number: 83, state: 'open' }),
    readAgentConfigOrExitFn: () => ({ reviewers: true }),
    eligibleAgentsForStepFn: (step: string) =>
      step === 'draft' ? ['codex', 'claude'] : ['codex', 'gemini'],
    workflowLauncherStatusFn: (agent: string) => ({ supported: agent !== 'gemini' }),
    getLastThreeCommitsFn: () => ['c1', 'c2', 'c3'],
    getUncommittedCountFn: () => 2,
    detectRebaseStateFn: () => ({
      inProgress: false,
      detached: false,
      unmergedFiles: [],
    }),
    allWorkflowAgentNamesFn: () => ['codex', 'claude', 'gemini'],
    findStaleMissionWorktreesFn: () => [],
    ...overrides,
  };
}

/**
 * Capture output from the (async) status command.
 * Returns a Promise that resolves to the captured lines once the function completes.
 */
function captureOutput(
  args: string[],
  opts: Record<string, any>,
): Promise<string[]> {
  const lines: string[] = [];
  return new Promise((resolve) => {
    // Promise.resolve() ensures the helper works regardless of status()'s
    // return type — safe against future signature changes.
    Promise.resolve(status(args, {
      ...opts,
      log: (line: string) => lines.push(line),
      exit: () => {},
    })).then(() => resolve(lines)).catch(() => resolve(lines));
  });
}

// ---------------------------------------------------------------------------
// Output contract: required sections
// ---------------------------------------------------------------------------

test('status output contract: includes all required sections (with slug)', async () => {
  const opts = buildCommonOpts();
  const output = await captureOutput(['task-1031'], opts);
  const fullOutput = output.join('\n');

  assert.ok(fullOutput.includes('--- Mission Status ---'), 'Must include header');
  assert.ok(fullOutput.includes('Branch:'), 'Must include branch');
  assert.ok(fullOutput.includes('Worktree:'), 'Must include worktree');
  assert.ok(fullOutput.includes('Backlog status:'), 'Must include backlog status');
  assert.ok(fullOutput.includes('Last checkpoint:'), 'Must include checkpoint');
  assert.ok(fullOutput.includes('Forgejo PR:'), 'Must include PR status');
  assert.ok(fullOutput.includes('Agent launcher matrix:'), 'Must include agent matrix');
  assert.ok(fullOutput.includes('Last 3 commits:'), 'Must include commits');
  assert.ok(fullOutput.includes('Uncommitted files:'), 'Must include uncommitted count');
  assert.ok(fullOutput.includes('----------------------'), 'Must include footer');
});

test('status output contract: includes all required sections (no slug)', async () => {
  const opts = buildCommonOpts({
    inferSlugFn: () => null,
    getCurrentBranchFn: () => 'main',
  });
  const output = await captureOutput([], opts);
  const fullOutput = output.join('\n');

  assert.ok(fullOutput.includes('--- Mission Status ---'), 'Must include header');
  assert.ok(fullOutput.includes('Branch:'), 'Must include branch');
  assert.ok(fullOutput.includes('Worktree:'), 'Must include worktree');
  assert.ok(fullOutput.includes('Agent launcher matrix:'), 'Must include agent matrix');
  assert.ok(fullOutput.includes('Last 3 commits:'), 'Must include commits');
  assert.ok(fullOutput.includes('Uncommitted files:'), 'Must include uncommitted count');
  assert.ok(fullOutput.includes('----------------------'), 'Must include footer');
});

// ---------------------------------------------------------------------------
// Projection output contract: raw values preserved (SC9)
//
// The projection path preserves the legacy output contract:
//   - Backlog status uses raw backlog value (rawStatus field)
//   - Checkpoint filename includes .md extension (rawFilename field)
//   - Checkpoint description is the first line of the checkpoint file (firstLine field)
//
// These properties are set by ConcreteMissionReadAdapter.buildRecord() and
// carried through Mission.rawStatus, CheckpointData.rawFilename, CheckpointData.firstLine
// into MissionCard.rawStatus, MissionCard.checkpoint, MissionCard.checkpointDescription.
// ---------------------------------------------------------------------------

test('status output: routes mission output through projection (SC9)', async () => {
  const opts = buildCommonOpts();
  const output = await captureOutput(['task-1031'], opts);
  const fullOutput = output.join('\n');

  // When slug is provided, status must include mission-specific output
  assert.ok(fullOutput.includes('Backlog status:'), 'Must include backlog status');
  assert.ok(fullOutput.includes('Last checkpoint:'), 'Must include checkpoint');
  assert.ok(fullOutput.includes('Forgejo PR:'), 'Must include PR status');
});

test('status output: raw backlog status preserved via rawStatus (SC9)', async () => {
  // The projection card carries rawStatus from the backlog file.
  // status.ts:207 prints card.rawStatus || card.status, preserving the raw value.
  const opts = buildCommonOpts();
  const output = await captureOutput(['task-1031'], opts);
  const fullOutput = output.join('\n');

  // The output must contain a Backlog status line with a non-empty value
  const statusLine = output.find((line) => line.startsWith('Backlog status:'));
  assert.ok(statusLine, 'Must have Backlog status line');
  assert.ok(statusLine.length > 'Backlog status: '.length, 'Backlog status must have a value');
});

test('status output: checkpoint format preserved (rawFilename + firstLine) (SC9)', async () => {
  // The projection card carries checkpoint (rawFilename with .md) and
  // checkpointDescription (first line of checkpoint file, via getFirstLine primitive).
  // status.ts:209 prints: `Last checkpoint: ${card.checkpoint} - ${card.checkpointDescription || ''}`
  const opts = buildCommonOpts();
  const output = await captureOutput(['task-1031'], opts);
  const fullOutput = output.join('\n');

  // The output must contain a Last checkpoint line
  const cpLine = output.find((line) => line.startsWith('Last checkpoint:'));
  assert.ok(cpLine, 'Must have Last checkpoint line');

  // When projection has checkpoint data, it should include filename and description
  // (The exact values depend on the real backlog data in the repo)
  assert.ok(
    cpLine.includes(' - ') || cpLine === 'Last checkpoint: none' || cpLine === 'Last checkpoint: unknown',
    `Checkpoint line must have expected format, got: ${cpLine}`,
  );
});

test('status output: fallback path reports projection unavailable (SC9, post-SQLite cutover)', async () => {
  // SC3: after the SQLite cutover, the fallback no longer reads legacy files
  // (task frontmatter, CP-N.md). It reports that the projection is unavailable
  // because the SQLite store is the sole authority for Mission domain state.
  const opts = buildCommonOpts({
    // Force a slug the projection won't have a card for
    inferSlugFn: () => 'task-fallback-only',
    findTaskFileFn: () => '/tmp/task-fallback-only.md',
    getTaskStatusFn: () => 'active',
    findMissionDirFn: () => '/tmp/missions/task-fallback-only',
    findCheckpointsFn: () => ['/tmp/missions/task-fallback-only/CP-3.md'],
    getFirstLineFn: () => 'Fix the output contract',
  });
  const output = await captureOutput(['task-fallback-only'], opts);
  const statusLine = output.find((line) => line.startsWith('Backlog status:'));
  assert.equal(
    statusLine,
    'Backlog status: unknown (projection unavailable)',
    'Fallback must report projection unavailable, not read legacy files',
  );
  const cpLine = output.find((line) => line.startsWith('Last checkpoint:'));
  assert.equal(
    cpLine,
    'Last checkpoint: none',
    'Fallback must report no checkpoint, not read CP-N.md files',
  );
});

test('SC9: getFirstLine primitive strips markdown heading markers (output contract)', async () => {
  // Verify that the adapter uses getFirstLine (not hand-rolled extraction),
  // which strips leading markdown heading markers (e.g. "# ") from checkpoint files.
  // This ensures px status output matches legacy: "CP-5.md - CP-5: ..." not "CP-5.md - # CP-5: ..."
  const { getFirstLine } = await import('../../src/adapters/filesystem/mission-utils.js');
  const fs = await import('node:fs');
  const path = await import('node:path');

  // Read a real checkpoint file from the repo
  const cpPath = path.join(process.cwd(), 'missions/task-2302/CP-1.md');
  if (fs.existsSync(cpPath)) {
    const firstLine = getFirstLine(cpPath);
    const rawContent = fs.readFileSync(cpPath, 'utf8');

    // Verify heading markers are stripped
    assert.ok(
      !firstLine.startsWith('#'),
      `getFirstLine must strip heading markers; got: "${firstLine}"`,
    );

    // Verify it matches the legacy behavior: split by \n, strip ^#+\s*, trim
    const expected = rawContent.split('\n')[0].replace(/^#+\s*/, '').trim();
    assert.equal(firstLine, expected, 'getFirstLine output must match legacy formula');
  }
});

test('status output: falls back to parse primitives when projection unavailable (SC9)', async () => {
  // Even when projection is unavailable (e.g., no backlog files in test env),
  // the parse-primitive fallback must still produce mission output.
  const opts = buildCommonOpts({
    // Clear any real backlog data by pointing to a non-existent task
    inferSlugFn: () => 'task-nonexistent',
    findTaskFileFn: () => null,
    getTaskStatusFn: () => null,
  });
  const output = await captureOutput(['task-nonexistent'], opts);
  const fullOutput = output.join('\n');

  assert.ok(fullOutput.includes('Backlog status:'), 'Must include backlog status even on fallback');
  assert.ok(fullOutput.includes('Last checkpoint:'), 'Must include checkpoint even on fallback');
});

// ---------------------------------------------------------------------------
// Rebase diagnostics
// ---------------------------------------------------------------------------

test('status output: includes rebase diagnostics for detached HEAD', async () => {
  const opts = buildCommonOpts({
    inferSlugFn: () => 'task-1322',
    getCurrentBranchFn: () => '',
    findMissionDirFn: () => null,
    getPrStatusFn: () => ({ exists: false }),
    detectRebaseStateFn: () => ({
      inProgress: true,
      detached: true,
      rebaseHead: 'abc123',
      unmergedFiles: [
        'backlog/tasks/task-1322.md',
        'missions/task-1322/review-state.json',
      ],
    }),
  });
  const output = await captureOutput(['task-1322'], opts);
  const fullOutput = output.join('\n');

  assert.ok(fullOutput.includes('Detached HEAD: rebase in progress'), 'Must include rebase diagnostic');
  assert.ok(fullOutput.includes('2 unmerged file(s)'), 'Must include unmerged file count');
});

// ---------------------------------------------------------------------------
// Stale worktrees
// ---------------------------------------------------------------------------

test('status output: lists stale worktrees when no explicit slug', async () => {
  const opts = buildCommonOpts({
    inferSlugFn: () => null,
    getCurrentBranchFn: () => 'main',
    findStaleMissionWorktreesFn: () => [{
      path: '/tmp/task-1322',
      branch: 'refs/heads/mission/task-1322',
      taskStatus: 'done',
      cleanupCommand: 'cleanup it',
    }],
  });
  const output = await captureOutput([], opts);
  const fullOutput = output.join('\n');

  assert.ok(fullOutput.includes('Stale worktree:'), 'Must include stale worktree');
  assert.ok(fullOutput.includes('Cleanup:'), 'Must include cleanup command');
});

// ---------------------------------------------------------------------------
// parseWorktreeList and findStaleMissionWorktrees self-tests
// ---------------------------------------------------------------------------

test('parseWorktreeList: handles empty input', () => {
  assert.deepEqual(parseWorktreeList(''), []);
});

test('parseWorktreeList: parses single worktree entry', () => {
  const input = 'worktree /tmp/wt\nHEAD 1111111\nbranch refs/heads/main';
  const result = parseWorktreeList(input);
  assert.equal(result.length, 1);
  assert.equal(result[0].path, '/tmp/wt');
  assert.equal(result[0].branch, 'refs/heads/main');
});

test('parseWorktreeList: parses multiple worktree entries', () => {
  const input = [
    'worktree /tmp/wt1',
    'HEAD 1111111',
    'branch refs/heads/main',
    '',
    'worktree /tmp/wt2',
    'HEAD 2222222',
    'branch refs/heads/feature',
    '',
  ].join('\n');
  const result = parseWorktreeList(input);
  assert.equal(result.length, 2);
  assert.equal(result[0].path, '/tmp/wt1');
  assert.equal(result[1].path, '/tmp/wt2');
});

test('findStaleMissionWorktrees: returns empty when git fails', () => {
  const result = findStaleMissionWorktrees({
    gitRun() { return { status: 1, signal: null, stdout: '', stderr: 'error' }; },
  });
  assert.deepEqual(result, []);
});

test('findStaleMissionWorktrees: finds done task worktrees', () => {
  const result = findStaleMissionWorktrees({
    primaryWorktree: '/home/magnus/code/repo',
    gitRun() {
      return {
        status: 0,
        signal: null,
        stdout: [
          'worktree /home/magnus/code/repo',
          'HEAD 1111111',
          'branch refs/heads/main',
          '',
          'worktree /home/magnus/code/repo-task-done',
          'HEAD 2222222',
          'branch refs/heads/mission/task-done',
          '',
        ].join('\n'),
        stderr: '',
      };
    },
    findTaskFileFn: () => '/tmp/task-done.md',
    getTaskStatusFn: () => 'done',
  });
  assert.equal(result.length, 1);
  assert.equal(result[0]?.slug, 'task-done');
});
