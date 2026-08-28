// Mocked-port tests for status application use case and CLI boundary.
// Covers: status board projection, parsing, rendering, and exit mapping.

import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { StatusCommandUseCase } from '../src/application/status-command-use-case.js';
import { CheckpointCommandUseCase } from '../src/application/checkpoint-command-use-case.js';
import type { CheckpointRequest } from '../src/application/checkpoint-command-use-case.js';
import type { StatusResult, CheckpointResult } from '../src/application/ports/cli-workflows.js';
import type { CheckpointVerificationPort, CheckpointGitPort, CheckpointLifecyclePort, CheckpointLifecycleAuthorizationPort, CheckpointMissionPort } from '../src/application/ports/cli-workflows.js';
import type { StatusBoardPort, StatusGitPort, StatusPrPort, StatusAgentPort, StatusStaleWorktreesPort } from '../src/application/ports/cli-workflows.js';
import { parseStatusCliRequest, renderStatus, createStatusCommand } from '../src/interfaces/cli/status.js';
import { createStatusBoardAdapter } from '../src/adapters/cli/commands/status-adapter.js';
import { parseCheckpointCliRequest, renderCheckpoint, createCheckpointCommand } from '../src/interfaces/cli/checkpoint.js';

/** Narrow a checkpoint result to its failure members.
 * The test tsconfig has no strictNullChecks, so `!result.ok` does not narrow. */
function isCheckpointFailure(result: CheckpointResult): result is Exclude<CheckpointResult, { ok: true }> {
  return 'reason' in result;
}

// ============================================================================
// Status CLI parsing
// ============================================================================

test('parseStatusCliRequest: returns explicitSlug from positional arg', () => {
  const result = parseStatusCliRequest(['task-1234']);
  assert.equal(result.explicitSlug, 'task-1234');
});

test('parseStatusCliRequest: returns undefined explicitSlug for empty args', () => {
  const result = parseStatusCliRequest([]);
  assert.equal(result.explicitSlug, undefined);
});

test('parseStatusCliRequest: rejects unknown flags', () => {
  assert.throws(
    () => parseStatusCliRequest(['--verbose']),
    { message: 'Unknown status option: --verbose' },
  );
});

// ============================================================================
// Status rendering
// ============================================================================

test('renderStatus: renders branch, worktree, and separator', () => {
  const lines: string[] = [];
  const result: StatusResult = {
    branch: 'mission/task-1001',
    worktree: '/tmp/repo',
    rebaseInfo: null,
    slug: 'task-1001',
    missionData: null,
    prInfo: null,
    staleWorktrees: [],
    staleWorktreeRebase: {},
    agentMatrix: [],
    lastThreeCommits: [],
    uncommittedCount: 0,
  };
  renderStatus(result, (msg) => lines.push(msg));
  assert.ok(lines.some(l => l.includes('Mission Status')), 'should render header');
  assert.ok(lines.some(l => l.includes('mission/task-1001')), 'should render branch');
  assert.ok(lines.some(l => l.includes('/tmp/repo')), 'should render worktree');
  assert.ok(lines.some(l => l.includes('----------------------')), 'should render footer');
});

test('renderStatus: renders mission data with backlog, checkpoint, and review', () => {
  const lines: string[] = [];
  const result: StatusResult = {
    branch: 'mission/task-1001',
    worktree: '/tmp/repo',
    rebaseInfo: null,
    slug: 'task-1001',
    missionData: {
      backlogStatus: 'active',
      checkpoint: 'CP-2.md',
      checkpointDescription: 'Wire status use case',
      reviewPhase: 'review',
      reviewRound: 1,
      reviewDisposition: 'approved',
      reviewHistory: [{
        number: 1,
        reviewer: 'claude',
        implementer: 'codex',
        disposition: 'approved',
        comment: 'LGTM',
        findingSummaries: [],
        fixes: [],
        pushbacks: [],
      }],
    },
    prInfo: { exists: true, number: 42, state: 'open' },
    staleWorktrees: [],
    staleWorktreeRebase: {},
    agentMatrix: [],
    lastThreeCommits: [],
    uncommittedCount: 0,
  };
  renderStatus(result, (msg) => lines.push(msg));
  assert.ok(lines.some(l => l.includes('Backlog status: active')), 'should render backlog status');
  assert.ok(lines.some(l => l.includes('Last checkpoint: CP-2.md - Wire status use case')), 'should render checkpoint');
  assert.ok(lines.some(l => l.includes('Forgejo PR: #42 (open)')), 'should render PR');
  assert.ok(lines.some(l => l.includes('Review: round 1, phase review, disposition approved')), 'should render review');
  assert.ok(lines.some(l => l.includes('Round 1 [claude -> codex]: approved')), 'should render review history');
  assert.ok(lines.some(l => l.includes('comment: LGTM')), 'should render review comment');
});

test('renderStatus: renders fallback when projection unavailable', () => {
  const lines: string[] = [];
  const result: StatusResult = {
    branch: 'mission/task-1001',
    worktree: '/tmp/repo',
    rebaseInfo: null,
    slug: 'task-1001',
    missionData: null,
    prInfo: { exists: false },
    staleWorktrees: [],
    staleWorktreeRebase: {},
    agentMatrix: [],
    lastThreeCommits: [],
    uncommittedCount: 0,
  };
  renderStatus(result, (msg) => lines.push(msg));
  assert.ok(lines.some(l => l.includes('Backlog status: unknown (projection unavailable)')), 'should render projection fallback');
  assert.ok(lines.some(l => l.includes('Last checkpoint: none')), 'should render no checkpoint');
  assert.ok(lines.some(l => l.includes('Forgejo PR: none')), 'should render no PR');
});

test('renderStatus: renders stale worktrees with rebase and cleanup', () => {
  const lines: string[] = [];
  const result: StatusResult = {
    branch: 'main',
    worktree: '/tmp/repo',
    rebaseInfo: null,
    slug: null,
    missionData: null,
    prInfo: null,
    staleWorktrees: [{
      slug: 'task-stale',
      path: '/tmp/task-stale',
      branch: 'refs/heads/mission/task-stale',
      taskStatus: 'done',
      cleanupCommand: 'scripts/cleanup-mission-worktree.sh task-stale',
    }],
    staleWorktreeRebase: {
      '/tmp/task-stale': { inProgress: true, detached: true, unmergedFiles: ['file1.ts'] },
    },
    agentMatrix: [],
    lastThreeCommits: [],
    uncommittedCount: 0,
  };
  renderStatus(result, (msg) => lines.push(msg));
  assert.ok(lines.some(l => l.includes('Stale worktree:')), 'should render stale worktree');
  assert.ok(lines.some(l => l.includes('Rebase in progress on mission/task-stale')), 'should render stale worktree rebase');
  assert.ok(lines.some(l => l.includes('file1.ts')), 'should render unmerged file');
  assert.ok(lines.some(l => l.includes('Cleanup:')), 'should render cleanup command');
});

test('renderStatus: renders agent launcher matrix', () => {
  const lines: string[] = [];
  const result: StatusResult = {
    branch: 'main',
    worktree: '/tmp/repo',
    rebaseInfo: null,
    slug: null,
    missionData: null,
    prInfo: null,
    staleWorktrees: [],
    staleWorktreeRebase: {},
    agentMatrix: [
      { agent: 'codex', supported: true, draftEligible: true, activeEligible: true },
      { agent: 'gemini', supported: false, draftEligible: false, activeEligible: true },
    ],
    agentOverride: 'codex',
    lastThreeCommits: [],
    uncommittedCount: 0,
  };
  renderStatus(result, (msg) => lines.push(msg));
  assert.ok(lines.some(l => l.includes('Agent launcher matrix:')), 'should render matrix header');
  assert.ok(lines.some(l => l.includes('codex: supported | eligible: draft,active')), 'should render supported agent');
  assert.ok(lines.some(l => l.includes('gemini: blocked | eligible: -,active')), 'should render blocked agent');
  assert.ok(lines.some(l => l.includes('WORKFLOW_AGENT override:')), 'should render env override');
});

test('renderStatus: renders detached HEAD rebase diagnostics', () => {
  const lines: string[] = [];
  const result: StatusResult = {
    branch: '',
    worktree: '/tmp/repo',
    rebaseInfo: { inProgress: true, detached: true, unmergedFiles: ['a.ts', 'b.ts'] },
    slug: 'task-1001',
    missionData: null,
    prInfo: null,
    staleWorktrees: [],
    staleWorktreeRebase: {},
    agentMatrix: [],
    lastThreeCommits: [],
    uncommittedCount: 0,
  };
  renderStatus(result, (msg) => lines.push(msg));
  assert.ok(lines.some(l => l.includes('Detached HEAD: rebase in progress')), 'should render rebase diagnostic');
  assert.ok(lines.some(l => l.includes('2 unmerged file(s)')), 'should render unmerged count');
  assert.ok(lines.some(l => l.includes('a.ts')), 'should list unmerged file');
});

test('renderStatus: renders commits and uncommitted count', () => {
  const lines: string[] = [];
  const result: StatusResult = {
    branch: 'main',
    worktree: '/tmp/repo',
    rebaseInfo: null,
    slug: null,
    missionData: null,
    prInfo: null,
    staleWorktrees: [],
    staleWorktreeRebase: {},
    agentMatrix: [],
    lastThreeCommits: ['commit-a', 'commit-b', 'commit-c'],
    uncommittedCount: 3,
  };
  renderStatus(result, (msg) => lines.push(msg));
  assert.ok(lines.some(l => l.includes('Last 3 commits:')), 'should render commits header');
  assert.ok(lines.some(l => l.includes('commit-a')), 'should render commit');
  assert.ok(lines.some(l => l.includes('Uncommitted files: 3')), 'should render uncommitted count');
});

// ============================================================================
// Status use case with mocked ports
// ============================================================================

test('StatusCommandUseCase: returns board projection from mocked ports', async () => {
  const mockBoard: StatusBoardPort = {
    inferSlug() { return 'task-1001'; },
    async getMissionData() {
      return {
        backlogStatus: 'active',
        checkpoint: 'CP-1.md',
        checkpointDescription: 'Initial checkpoint',
        reviewHistory: [],
      };
    },
  };
  const mockGit: StatusGitPort = {
    getCurrentBranch() { return 'mission/task-1001'; },
    missionBranchName(slug: string) { return 'mission/' + slug; },
    getRebaseInfo() { return null; },
    getLastThreeCommits() { return ['init']; },
    getUncommittedCount() { return 0; },
  };
  const mockPr: StatusPrPort = {
    getPrInfo() { return { exists: true, number: 10, state: 'open' }; },
  };
  const mockAgent: StatusAgentPort = {
    getAgentMatrix() { return [{ agent: 'codex', supported: true, draftEligible: true, activeEligible: true }]; },
    getAgentOverride() { return undefined; },
  };
  const mockStale: StatusStaleWorktreesPort = {
    findStaleWorktrees() { return []; },
    getStaleWorktreeRebase() { return {}; },
  };

  const useCase = new StatusCommandUseCase(mockBoard, mockGit, mockPr, mockAgent, mockStale);
  const result = await useCase.execute('/tmp/repo', 'task-1001');

  assert.equal(result.slug, 'task-1001');
  assert.equal(result.branch, 'mission/task-1001');
  assert.equal(result.worktree, '/tmp/repo');
  assert.ok(result.missionData, 'should have mission data');
  assert.equal(result.missionData!.backlogStatus, 'active');
  assert.equal(result.missionData!.checkpoint, 'CP-1.md');
  assert.ok(result.prInfo!.exists, 'should have PR');
  assert.equal(result.prInfo!.number, 10);
  assert.equal(result.agentMatrix.length, 1);
  assert.equal(result.agentMatrix[0].agent, 'codex');
});

test('StatusCommandUseCase: passes null slug for inferred status', async () => {
  const mockBoard: StatusBoardPort = { inferSlug() { return null; }, async getMissionData() { return null; } };
  const mockGit: StatusGitPort = {
    getCurrentBranch() { return 'main'; },
    missionBranchName(slug: string) { return 'mission/' + slug; },
    getRebaseInfo() { return null; },
    getLastThreeCommits() { return []; },
    getUncommittedCount() { return 0; },
  };
  const mockPr: StatusPrPort = { getPrInfo() { return null; } };
  const mockAgent: StatusAgentPort = { getAgentMatrix() { return []; }, getAgentOverride() { return undefined; } };
  const mockStale: StatusStaleWorktreesPort = { findStaleWorktrees() { return []; }, getStaleWorktreeRebase() { return {}; } };

  const useCase = new StatusCommandUseCase(mockBoard, mockGit, mockPr, mockAgent, mockStale);
  const result = await useCase.execute('/tmp/repo', null);

  assert.equal(result.slug, null);
  assert.equal(result.missionData, null);
  assert.equal(result.prInfo, null);
});

test('StatusCommandUseCase: infers slug when null and resolves mission data', async () => {
  const mockBoard: StatusBoardPort = {
    inferSlug() { return 'task-inferred'; },
    async getMissionData() {
      return {
        backlogStatus: 'active',
        checkpoint: 'CP-1.md',
        checkpointDescription: 'Inferred',
        reviewHistory: [],
      };
    },
  };
  const mockGit: StatusGitPort = {
    getCurrentBranch() { return 'mission/task-inferred'; },
    missionBranchName(slug: string) { return 'mission/' + slug; },
    getRebaseInfo() { return null; },
    getLastThreeCommits() { return []; },
    getUncommittedCount() { return 0; },
  };
  const mockPr: StatusPrPort = { getPrInfo() { return { exists: true, number: 1, state: 'open' }; } };
  const mockAgent: StatusAgentPort = { getAgentMatrix() { return []; }, getAgentOverride() { return undefined; } };
  const mockStale: StatusStaleWorktreesPort = { findStaleWorktrees() { return []; }, getStaleWorktreeRebase() { return {}; } };

  const useCase = new StatusCommandUseCase(mockBoard, mockGit, mockPr, mockAgent, mockStale);
  const result = await useCase.execute('/tmp/repo', null);

  assert.equal(result.slug, 'task-inferred');
  assert.ok(result.missionData, 'should have mission data for inferred slug');
  assert.equal(result.missionData!.backlogStatus, 'active');
  assert.ok(result.prInfo!.exists, 'should have PR for inferred slug');
});

// ============================================================================
// Status CLI command (createStatusCommand)
// ============================================================================

test('createStatusCommand: renders status and exits 0', async () => {
  const lines: string[] = [];
  let exitCode: number | undefined;

  const mockBoard: StatusBoardPort = {
    inferSlug() { return 'task-1001'; },
    async getMissionData() {
      return {
        backlogStatus: 'active',
        checkpoint: 'CP-1.md',
        checkpointDescription: 'Initial',
        reviewHistory: [],
      };
    },
  };
  const mockGit: StatusGitPort = {
    getCurrentBranch() { return 'mission/task-1001'; },
    missionBranchName(slug: string) { return 'mission/' + slug; },
    getRebaseInfo() { return null; },
    getLastThreeCommits() { return []; },
    getUncommittedCount() { return 0; },
  };
  const mockPr: StatusPrPort = { getPrInfo() { return { exists: false }; } };
  const mockAgent: StatusAgentPort = { getAgentMatrix() { return []; }, getAgentOverride() { return undefined; } };
  const mockStale: StatusStaleWorktreesPort = { findStaleWorktrees() { return []; }, getStaleWorktreeRebase() { return {}; } };

  const useCase = new StatusCommandUseCase(mockBoard, mockGit, mockPr, mockAgent, mockStale);
  const cmd = createStatusCommand(useCase);

  await cmd(['task-1001'], {
    logFn: (msg) => lines.push(msg),
    exitFn: ((code) => { exitCode = code; }) as never,
  });

  assert.equal(exitCode, 0, 'should exit 0');
  assert.ok(lines.some(l => l.includes('Backlog status: active')), 'should render backlog status');
  assert.ok(lines.some(l => l.includes('Last checkpoint: CP-1.md - Initial')), 'should render checkpoint');
});

test('createStatusCommand: no-argument invocation renders inferred mission output', async () => {
  const lines: string[] = [];
  let exitCode: number | undefined;
  const boardCalls: string[] = [];

  const mockBoard: StatusBoardPort = {
    inferSlug(explicit?: string) {
      assert.equal(explicit, undefined, 'no-argument invocation passes no explicit slug');
      return 'task-2332.13';
    },
    async getMissionData(slug: string) {
      boardCalls.push(slug);
      return {
        backlogStatus: 'in-review',
        checkpoint: 'CP-3.md',
        checkpointDescription: 'Verify checkpoint integration',
        reviewPhase: 'reviewing',
        reviewRound: 7,
        reviewHistory: [],
      };
    },
  };
  const mockGit: StatusGitPort = {
    getCurrentBranch() { return 'mission/task-2332.13'; },
    missionBranchName(slug: string) { return 'mission/' + slug; },
    getRebaseInfo() { return null; },
    getLastThreeCommits() { return []; },
    getUncommittedCount() { return 0; },
  };
  const mockPr: StatusPrPort = { getPrInfo() { return { exists: true, number: 247, state: 'open' }; } };
  const mockAgent: StatusAgentPort = { getAgentMatrix() { return []; }, getAgentOverride() { return undefined; } };
  const mockStale: StatusStaleWorktreesPort = { findStaleWorktrees() { return []; }, getStaleWorktreeRebase() { return {}; } };

  const useCase = new StatusCommandUseCase(mockBoard, mockGit, mockPr, mockAgent, mockStale);
  const cmd = createStatusCommand(useCase);

  await cmd([], {
    logFn: (msg) => lines.push(msg),
    exitFn: ((code) => { exitCode = code; }) as never,
  });

  assert.equal(exitCode, 0, 'should exit 0');
  assert.deepEqual(boardCalls, ['task-2332.13'], 'board is queried with the inferred slug');
  assert.ok(lines.some(l => l.includes('Backlog status: in-review')), 'renders inferred mission backlog status');
  assert.ok(lines.some(l => l.includes('Last checkpoint: CP-3.md - Verify checkpoint integration')), 'renders inferred mission checkpoint');
  assert.ok(lines.some(l => l.includes('Review: round 7, phase reviewing')), 'renders inferred mission review state');
  assert.ok(lines.some(l => l.includes('Forgejo PR: #247 (open)')), 'renders inferred mission PR state');
});

test('createStatusBoardAdapter: inferSlug delegates to the injected slug inference', () => {
  const seen: (string | undefined)[] = [];
  const board = createStatusBoardAdapter({
    buildProjectionFn: async () => { throw new Error('projection should not be built'); },
    inferSlugFn: (explicit?: string) => { seen.push(explicit); return explicit ? null : 'task-inferred'; },
  });

  assert.equal(board.inferSlug(), 'task-inferred');
  assert.equal(board.inferSlug('task-explicit'), null);
  assert.deepEqual(seen, [undefined, 'task-explicit']);
});

test('createStatusCommand: exits 1 on parse error', async () => {
  const errors: string[] = [];
  let exitCode: number | undefined;

  const mockBoard: StatusBoardPort = { inferSlug() { return null; }, async getMissionData() { return null; } };
  const mockGit: StatusGitPort = { getCurrentBranch() { return ''; }, missionBranchName(slug: string) { return 'mission/' + slug; }, getRebaseInfo() { return null; }, getLastThreeCommits() { return []; }, getUncommittedCount() { return 0; } };
  const mockPr: StatusPrPort = { getPrInfo() { return null; } };
  const mockAgent: StatusAgentPort = { getAgentMatrix() { return []; }, getAgentOverride() { return undefined; } };
  const mockStale: StatusStaleWorktreesPort = { findStaleWorktrees() { return []; }, getStaleWorktreeRebase() { return {}; } };

  const cmd = createStatusCommand(new StatusCommandUseCase(mockBoard, mockGit, mockPr, mockAgent, mockStale));

  await cmd(['--verbose'], {
    errorFn: (msg) => errors.push(msg),
    exitFn: ((code) => { exitCode = code; }) as never,
  });

  assert.equal(exitCode, 1, 'should exit 1 on parse error');
  assert.ok(errors.some(e => e.includes('Unknown status option')), 'should report unknown option');
});

// ============================================================================
// Checkpoint CLI parsing
// ============================================================================

test('parseCheckpointCliRequest: returns parsed positional args', () => {
  const result = parseCheckpointCliRequest(['task-1234', 'CP-1.md', 'Wire checkpoint use case']);
  assert.equal(result.explicitSlug, 'task-1234');
  assert.equal(result.cpName, 'CP-1.md');
  assert.equal(result.nextAction, 'Wire checkpoint use case');
});

test('parseCheckpointCliRequest: accepts inferred slug (no explicit slug)', () => {
  const result = parseCheckpointCliRequest(['CP-1.md', 'Wire checkpoint use case']);
  assert.equal(result.explicitSlug, undefined);
  assert.equal(result.cpName, 'CP-1.md');
  assert.equal(result.nextAction, 'Wire checkpoint use case');
});

test('parseCheckpointCliRequest: rejects missing arguments', () => {
  assert.throws(
    () => parseCheckpointCliRequest(['CP-1.md']),
    { message: 'Usage: node parallix checkpoint [<slug>] <cp-name> "<next-action>"' },
  );
});

// ============================================================================
// Checkpoint rendering
// ============================================================================

test('renderCheckpoint: returns 0 and renders PASS for success', () => {
  const lines: string[] = [];
  const result: CheckpointResult = { ok: true, checkpointName: 'CP-1.md', nextAction: 'Next step', slug: 'task-1001' };
  const code = renderCheckpoint(result, 'task-1001', (msg) => lines.push(msg));
  assert.equal(code, 0);
  assert.ok(lines.some(l => l.includes('Checkpoint complete')), 'should render success');
});

test('renderCheckpoint: returns 1 and renders FAIL for verification failure', () => {
  const lines: string[] = [];
  const result: CheckpointResult = { ok: false, reason: 'verification-failure', area: 'lib', exitCode: 2, command: './scripts/verify-local.sh lib' };
  const code = renderCheckpoint(result, 'task-1001', (msg) => lines.push(msg));
  assert.equal(code, 1);
  assert.ok(lines.some(l => l.includes('Verification gate failed')), 'should render verification failure');
  assert.ok(lines.some(l => l.includes('./scripts/verify-local.sh lib')), 'should render command');
});

test('renderCheckpoint: returns 1 and renders FAIL for ignored files', () => {
  const lines: string[] = [];
  const result: CheckpointResult = { ok: false, reason: 'ignored-files', ignoredFiles: ['src/lib/index.ts'] };
  const code = renderCheckpoint(result, 'task-1001', (msg) => lines.push(msg));
  assert.equal(code, 1);
  assert.ok(lines.some(l => l.includes('Checkpoint refused')), 'should render ignored files failure');
  assert.ok(lines.some(l => l.includes('src/lib/index.ts')), 'should list ignored file');
});

test('renderCheckpoint: returns 1 and renders FAIL for commit failure', () => {
  const lines: string[] = [];
  const result: CheckpointResult = { ok: false, reason: 'commit-failure' };
  const code = renderCheckpoint(result, 'task-1001', (msg) => lines.push(msg));
  assert.equal(code, 1);
  assert.ok(lines.some(l => l.includes('Commit failed')), 'should render commit failure');
});

test('renderCheckpoint: returns 1 and renders FAIL for mission not found', () => {
  const lines: string[] = [];
  const result: CheckpointResult = { ok: false, reason: 'mission-not-found', slug: 'task-9999' };
  const code = renderCheckpoint(result, 'task-9999', (msg) => lines.push(msg));
  assert.equal(code, 1);
  assert.ok(lines.some(l => l.includes('Mission directory not found')), 'should render mission not found');
  assert.ok(lines.some(l => l.includes('task-9999')), 'should include slug');
});

// ============================================================================
// Checkpoint use case with mocked ports
// ============================================================================

test('CheckpointCommandUseCase: returns success from mocked ports', async () => {
  const mockVerification: CheckpointVerificationPort = {
    async runVerification() { return { exitCode: 0, area: 'lib', command: './scripts/verify-local.sh lib' }; },
  };
  const mockGit: CheckpointGitPort = {
    stage() {},
    findIgnoredSourceFiles() { return []; },
    async commit() { return 0; },
  };
  const mockLifecycle: CheckpointLifecyclePort = {
    async recordCheckpoint() {},
  };
  const mockLifecycleAuth: CheckpointLifecycleAuthorizationPort = { async checkLifecycleTransition() { return null; } };
  const mockMission: CheckpointMissionPort = {
    inferSlug() { return 'task-1001'; },
    resolveWorktree() { return '/worktrees/task-1001'; },
    async resolveMission() { return { missionDir: '/missions/task-1001', area: 'lib' }; },
    async resolveTaskAssignee() { return 'codex'; },
  };

  const useCase = new CheckpointCommandUseCase(mockVerification, mockGit, mockLifecycle, mockLifecycleAuth, mockMission);
  const result = await useCase.execute({ explicitSlug: 'task-1001', cpName: 'CP-2.md', nextAction: 'Run integration' });

  assert.ok(result.ok, 'should succeed');
  if (result.ok) {
    assert.equal(result.checkpointName, 'CP-2.md');
    assert.equal(result.nextAction, 'Run integration');
  }
});

test('CheckpointCommandUseCase: returns verification failure from mocked port', async () => {
  const mockVerification: CheckpointVerificationPort = {
    async runVerification() { return { exitCode: 1, area: 'lib', command: './scripts/verify-local.sh lib' }; },
  };
  const mockGit: CheckpointGitPort = { stage() {}, findIgnoredSourceFiles() { return []; }, async commit() { return 0; } };
  const mockLifecycle: CheckpointLifecyclePort = { async recordCheckpoint() {} };
  const mockLifecycleAuth: CheckpointLifecycleAuthorizationPort = { async checkLifecycleTransition() { return null; } };
  const mockMission: CheckpointMissionPort = {
    inferSlug() { return 'task-1001'; },
    resolveWorktree() { return '/worktrees/task-1001'; },
    async resolveMission() { return { missionDir: '/missions/task-1001', area: 'lib' }; },
    async resolveTaskAssignee() { return 'codex'; },
  };

  const useCase = new CheckpointCommandUseCase(mockVerification, mockGit, mockLifecycle, mockLifecycleAuth, mockMission);
  const result = await useCase.execute({ explicitSlug: 'task-1001', cpName: 'CP-1.md', nextAction: 'Fix lint' });

  if (!isCheckpointFailure(result)) { assert.fail('should fail'); }
  assert.equal(result.reason, 'verification-failure');
  assert.equal(result.area, 'lib');
  assert.equal(result.exitCode, 1);
});

test('CheckpointCommandUseCase: infers slug when explicit not provided', async () => {
  const mockVerification: CheckpointVerificationPort = {
    async runVerification() { return { exitCode: 0, area: 'lib', command: './scripts/verify-local.sh lib' }; },
  };
  const mockGit: CheckpointGitPort = {
    stage() {},
    findIgnoredSourceFiles() { return []; },
    async commit() { return 0; },
  };
  const mockLifecycle: CheckpointLifecyclePort = {
    async recordCheckpoint() { return null; },
  };
  const mockLifecycleAuth: CheckpointLifecycleAuthorizationPort = { async checkLifecycleTransition() { return null; } };
  const mockMission: CheckpointMissionPort = {
    inferSlug() { return 'task-inferred'; },
    resolveWorktree() { return '/worktrees/task-inferred'; },
    async resolveMission() { return { missionDir: '/missions/task-inferred', area: 'lib' }; },
    async resolveTaskAssignee() { return 'codex'; },
  };

  const useCase = new CheckpointCommandUseCase(mockVerification, mockGit, mockLifecycle, mockLifecycleAuth, mockMission);
  const result = await useCase.execute({ explicitSlug: null, cpName: 'CP-1.md', nextAction: 'Next' });

  assert.ok(result.ok, 'should succeed');
  if (result.ok) {
    assert.equal(result.slug, 'task-inferred');
  }
});

test('CheckpointCommandUseCase: lifecycle telemetry called after commit (order verified)', async () => {
  const callOrder: string[] = [];
  const mockVerification: CheckpointVerificationPort = {
    async runVerification() { return { exitCode: 0, area: 'lib', command: './scripts/verify-local.sh lib' }; },
  };
  const mockGit: CheckpointGitPort = {
    stage() {},
    findIgnoredSourceFiles() { return []; },
    async commit() { callOrder.push('commit'); return 0; },
  };
  const mockLifecycle: CheckpointLifecyclePort = {
    async recordCheckpoint() { callOrder.push('lifecycle'); },
  };
  const mockLifecycleAuth: CheckpointLifecycleAuthorizationPort = { async checkLifecycleTransition() { callOrder.push('auth'); return null; } };
  const mockMission: CheckpointMissionPort = {
    inferSlug() { return 'task-1001'; },
    resolveWorktree() { return '/worktrees/task-1001'; },
    async resolveMission() { return { missionDir: '/missions/task-1001', area: 'lib' }; },
    async resolveTaskAssignee() { return 'codex'; },
  };

  const useCase = new CheckpointCommandUseCase(mockVerification, mockGit, mockLifecycle, mockLifecycleAuth, mockMission);
  const result = await useCase.execute({ explicitSlug: 'task-1001', cpName: 'CP-1.md', nextAction: 'Next' });

  assert.ok(result.ok, 'should succeed');
  assert.deepEqual(callOrder, ['auth', 'commit', 'lifecycle'], 'auth before commit, telemetry after');
});

test('CheckpointCommandUseCase: returns mission-not-found when mission directory is missing', async () => {
  const mockVerification: CheckpointVerificationPort = { async runVerification() { return { exitCode: 0, area: 'lib', command: '' }; } };
  const mockGit: CheckpointGitPort = { stage() {}, findIgnoredSourceFiles() { return []; }, async commit() { return 0; } };
  const mockLifecycle: CheckpointLifecyclePort = { async recordCheckpoint() {} };
  const mockLifecycleAuth: CheckpointLifecycleAuthorizationPort = { async checkLifecycleTransition() { return null; } };
  const mockMission: CheckpointMissionPort = {
    inferSlug() { return 'task-9999'; },
    resolveWorktree() { return '/worktrees/task-9999'; },
    async resolveMission() { return null; },
    async resolveTaskAssignee() { return null; },
  };

  const useCase = new CheckpointCommandUseCase(mockVerification, mockGit, mockLifecycle, mockLifecycleAuth, mockMission);
  const result = await useCase.execute({ explicitSlug: 'task-9999', cpName: 'CP-1.md', nextAction: 'Next' });

  if (!isCheckpointFailure(result)) { assert.fail('should fail'); }
  assert.equal(result.reason, 'mission-not-found');
});

test('CheckpointCommandUseCase: returns lifecycle-rejection when authorization port rejects', async () => {
  const mockVerification: CheckpointVerificationPort = {
    async runVerification() { return { exitCode: 0, area: 'lib', command: './scripts/verify-local.sh lib' }; },
  };
  const mockGit: CheckpointGitPort = {
    stage() {},
    findIgnoredSourceFiles() { return []; },
    async commit() { return 0; },
  };
  const mockLifecycle: CheckpointLifecyclePort = { async recordCheckpoint() {} };
  const mockLifecycleAuth: CheckpointLifecycleAuthorizationPort = {
    async checkLifecycleTransition() { return 'transition not allowed: active -> done requires review'; },
  };
  const mockMission: CheckpointMissionPort = {
    inferSlug() { return 'task-1001'; },
    resolveWorktree() { return '/worktrees/task-1001'; },
    async resolveMission() { return { missionDir: '/missions/task-1001', area: 'lib' }; },
    async resolveTaskAssignee() { return 'codex'; },
  };

  const useCase = new CheckpointCommandUseCase(mockVerification, mockGit, mockLifecycle, mockLifecycleAuth, mockMission);
  const result = await useCase.execute({ explicitSlug: 'task-1001', cpName: 'CP-1.md', nextAction: 'Next' });

  if (!isCheckpointFailure(result)) { assert.fail('should fail'); }
  assert.equal(result.reason, 'lifecycle-rejection');
  assert.ok(result.rejectionReason.includes('transition not allowed'), 'should carry rejection reason');
});

test('CheckpointCommandUseCase: lifecycle telemetry is non-blocking (fire-and-forget)', async () => {
  let lifecycleCalled = false;
  const mockVerification: CheckpointVerificationPort = {
    async runVerification() { return { exitCode: 0, area: 'lib', command: './scripts/verify-local.sh lib' }; },
  };
  const mockGit: CheckpointGitPort = {
    stage() {},
    findIgnoredSourceFiles() { return []; },
    async commit() { return 0; },
  };
  const mockLifecycle: CheckpointLifecyclePort = {
    async recordCheckpoint() { lifecycleCalled = true; },
  };
  const mockLifecycleAuth: CheckpointLifecycleAuthorizationPort = { async checkLifecycleTransition() { return null; } };
  const mockMission: CheckpointMissionPort = {
    inferSlug() { return 'task-1001'; },
    resolveWorktree() { return '/worktrees/task-1001'; },
    async resolveMission() { return { missionDir: '/missions/task-1001', area: 'lib' }; },
    async resolveTaskAssignee() { return 'codex'; },
  };

  const useCase = new CheckpointCommandUseCase(mockVerification, mockGit, mockLifecycle, mockLifecycleAuth, mockMission);
  const result = await useCase.execute({ explicitSlug: 'task-1001', cpName: 'CP-1.md', nextAction: 'Next' });

  assert.ok(result.ok, 'should succeed');
  assert.ok(lifecycleCalled, 'lifecycle telemetry must be called after commit');
});

// ============================================================================
// Checkpoint CLI command (createCheckpointCommand)
// ============================================================================

test('createCheckpointCommand: renders success and exits 0', async () => {
  const lines: string[] = [];
  let exitCode: number | undefined;

  const mockVerification: CheckpointVerificationPort = {
    async runVerification() { return { exitCode: 0, area: 'lib', command: '' }; },
  };
  const mockGit: CheckpointGitPort = { stage() {}, findIgnoredSourceFiles() { return []; }, async commit() { return 0; } };
  const mockLifecycle: CheckpointLifecyclePort = { async recordCheckpoint() {} };
  const mockLifecycleAuth: CheckpointLifecycleAuthorizationPort = { async checkLifecycleTransition() { return null; } };
  const mockMission: CheckpointMissionPort = {
    inferSlug() { return 'task-1001'; },
    resolveWorktree() { return '/worktrees/task-1001'; },
    async resolveMission() { return { missionDir: '/missions/task-1001', area: 'lib' }; },
    async resolveTaskAssignee() { return 'codex'; },
  };

  const useCase = new CheckpointCommandUseCase(mockVerification, mockGit, mockLifecycle, mockLifecycleAuth, mockMission);
  const cmd = createCheckpointCommand(useCase);

  await cmd(['task-1001', 'CP-1.md', 'Next step'], {
    logFn: (msg) => lines.push(msg),
    exitFn: ((code) => { exitCode = code; }) as never,
  });

  assert.equal(exitCode, 0, 'should exit 0');
  assert.ok(lines.some(l => l.includes('Checkpoint complete')), 'should render success');
});

test('createCheckpointCommand: renders verification failure and exits 1', async () => {
  const lines: string[] = [];
  let exitCode: number | undefined;

  const mockVerification: CheckpointVerificationPort = {
    async runVerification() { return { exitCode: 1, area: 'lib', command: './scripts/verify-local.sh lib' }; },
  };
  const mockGit: CheckpointGitPort = { stage() {}, findIgnoredSourceFiles() { return []; }, async commit() { return 0; } };
  const mockLifecycle: CheckpointLifecyclePort = { async recordCheckpoint() {} };
  const mockLifecycleAuth: CheckpointLifecycleAuthorizationPort = { async checkLifecycleTransition() { return null; } };
  const mockMission: CheckpointMissionPort = {
    inferSlug() { return 'task-1001'; },
    resolveWorktree() { return '/worktrees/task-1001'; },
    async resolveMission() { return { missionDir: '/missions/task-1001', area: 'lib' }; },
    async resolveTaskAssignee() { return 'codex'; },
  };

  const useCase = new CheckpointCommandUseCase(mockVerification, mockGit, mockLifecycle, mockLifecycleAuth, mockMission);
  const cmd = createCheckpointCommand(useCase);

  await cmd(['task-1001', 'CP-1.md', 'Fix lint'], {
    logFn: (msg) => lines.push(msg),
    exitFn: ((code) => { exitCode = code; }) as never,
  });

  assert.equal(exitCode, 1, 'should exit 1');
  assert.ok(lines.some(l => l.includes('Verification gate failed')), 'should render failure');
});

test('createCheckpointCommand: renders lifecycle rejection and exits 1', async () => {
  const lines: string[] = [];
  let exitCode: number | undefined;

  const mockVerification: CheckpointVerificationPort = {
    async runVerification() { return { exitCode: 0, area: 'lib', command: './scripts/verify-local.sh lib' }; },
  };
  const mockGit: CheckpointGitPort = { stage() {}, findIgnoredSourceFiles() { return []; }, async commit() { return 0; } };
  const mockLifecycle: CheckpointLifecyclePort = { async recordCheckpoint() {} };
  const mockLifecycleAuth: CheckpointLifecycleAuthorizationPort = {
    async checkLifecycleTransition() { return 'transition not allowed: active -> done requires review'; },
  };
  const mockMission: CheckpointMissionPort = {
    inferSlug() { return 'task-1001'; },
    resolveWorktree() { return '/worktrees/task-1001'; },
    async resolveMission() { return { missionDir: '/missions/task-1001', area: 'lib' }; },
    async resolveTaskAssignee() { return 'codex'; },
  };

  const useCase = new CheckpointCommandUseCase(mockVerification, mockGit, mockLifecycle, mockLifecycleAuth, mockMission);
  const cmd = createCheckpointCommand(useCase);

  await cmd(['task-1001', 'CP-1.md', 'Next'], {
    logFn: (msg) => lines.push(msg),
    exitFn: ((code) => { exitCode = code; }) as never,
  });

  assert.equal(exitCode, 1, 'should exit 1');
  assert.ok(lines.some(l => l.includes('Checkpoint rejected')), 'should render rejection');
});

test('createCheckpointCommand: exits 1 on parse error', async () => {
  const errors: string[] = [];
  let exitCode: number | undefined;

  const mockVerification: CheckpointVerificationPort = { async runVerification() { return { exitCode: 0, area: '', command: '' }; } };
  const mockGit: CheckpointGitPort = { stage() {}, findIgnoredSourceFiles() { return []; }, async commit() { return 0; } };
  const mockLifecycle: CheckpointLifecyclePort = { async recordCheckpoint() {} };
  const mockLifecycleAuth: CheckpointLifecycleAuthorizationPort = { async checkLifecycleTransition() { return null; } };
  const mockMission: CheckpointMissionPort = { inferSlug() { return null; }, resolveWorktree() { return null; }, async resolveMission() { return null; }, async resolveTaskAssignee() { return null; } };

  const cmd = createCheckpointCommand(new CheckpointCommandUseCase(mockVerification, mockGit, mockLifecycle, mockLifecycleAuth, mockMission));

  await cmd(['CP-1.md'], {
    errorFn: (msg) => errors.push(msg),
    exitFn: ((code) => { exitCode = code; }) as never,
  });

  assert.equal(exitCode, 1, 'should exit 1 on parse error');
});

test('createCheckpointCommand: hands the use case a structured request, not raw argv', async () => {
  const received: unknown[] = [];
  const spyUseCase = {
    async execute(request: CheckpointRequest): Promise<CheckpointResult> {
      received.push(request);
      return { ok: true, checkpointName: request.cpName, nextAction: request.nextAction, slug: request.explicitSlug || '' };
    },
  };

  const cmd = createCheckpointCommand(spyUseCase);
  await cmd(['task-1001', 'CP-2.md', 'Wire the adapter', '--dry-run'], {
    logFn: () => {},
    exitFn: (() => {}) as never,
  });

  assert.equal(received.length, 1, 'use case should be invoked once');
  const request = received[0] as CheckpointRequest;
  assert.ok(!Array.isArray(request), 'use case must not receive raw argv');
  assert.deepEqual(
    { explicitSlug: request.explicitSlug, cpName: request.cpName, nextAction: request.nextAction },
    { explicitSlug: 'task-1001', cpName: 'CP-2.md', nextAction: 'Wire the adapter' },
    'CLI boundary owns positional interpretation and -- flag filtering',
  );
});

test('createCheckpointCommand: structured request carries null slug for inferred invocations', async () => {
  const received: CheckpointRequest[] = [];
  const spyUseCase = {
    async execute(request: CheckpointRequest): Promise<CheckpointResult> {
      received.push(request);
      return { ok: true, checkpointName: request.cpName, nextAction: request.nextAction, slug: 'task-inferred' };
    },
  };

  const cmd = createCheckpointCommand(spyUseCase);
  await cmd(['CP-1.md', 'Next'], { logFn: () => {}, exitFn: (() => {}) as never });

  assert.equal(received.length, 1, 'use case should be invoked once');
  assert.equal(received[0].explicitSlug, null, 'inferred invocation passes an explicit null slug');
  assert.equal(received[0].cpName, 'CP-1.md');
  assert.equal(received[0].nextAction, 'Next');
});
