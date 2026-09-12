// Mocked-port tests for status application use case and CLI boundary.
// Covers: status board projection, parsing, rendering, and exit mapping.

import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { StatusCommandUseCase } from '../src/application/status-command-use-case.js';
import type { StatusResult } from '../src/application/ports/cli-workflows.js';
import type { StatusBoardPort, StatusGitPort, StatusPrPort, StatusAgentPort, StatusStaleWorktreesPort } from '../src/application/ports/cli-workflows.js';
import { parseStatusCliRequest, renderStatus, createStatusCommand } from '../src/interfaces/cli/status.js';
import { createStatusBoardAdapter } from '../src/adapters/cli/commands/status-adapter.js';
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
