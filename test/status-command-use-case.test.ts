// Historical regression provenance: TASK-2521.03, TASK-2419.
import test, { describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import { StatusCommandUseCase } from '../src/application/status-command-use-case.js';
import { type StatusAgentPort, type StatusBoardPort, type StatusGitPort, type StatusMissionData, type StatusPrPort, type StatusResult, type StatusStaleWorktreesPort } from '../src/application/ports/cli-workflows.js';
import { createStatusCommand, parseStatusCliRequest, renderStatus, statusJson } from '../src/interfaces/cli/status.js';
import { createStatusBoardAdapter } from '../src/adapters/cli/commands/status-adapter.js';

describe('StatusCommandUseCase and status rendering', () => {
  // Mocked-port tests for status application use case and CLI boundary.
  // Covers: status board projection, parsing, rendering, and exit mapping.

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
      agents: [],
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
      agents: [],
      lastThreeCommits: [],
      uncommittedCount: 0,
    };
    renderStatus(result, (msg) => lines.push(msg));
    assert.ok(lines.some(l => l.includes('Mission status: active')), 'should render Mission status');
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
      agents: [],
      lastThreeCommits: [],
      uncommittedCount: 0,
    };
    renderStatus(result, (msg) => lines.push(msg));
    assert.ok(lines.some(l => l.includes('Mission status: unknown (projection unavailable)')), 'should render projection fallback');
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
      agents: [],
      lastThreeCommits: [],
      uncommittedCount: 0,
    };
    renderStatus(result, (msg) => lines.push(msg));
    assert.ok(lines.some(l => l.includes('Stale worktree:')), 'should render stale worktree');
    assert.ok(lines.some(l => l.includes('Rebase in progress on mission/task-stale')), 'should render stale worktree rebase');
    assert.ok(lines.some(l => l.includes('file1.ts')), 'should render unmerged file');
    assert.ok(lines.some(l => l.includes('Cleanup:')), 'should render cleanup command');
  });

  test('renderStatus: renders configured agents with their operator-database blocks', () => {
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
      agents: [
        { agent: 'codex', block: { kind: 'none' } },
        { agent: 'qwen', block: { kind: 'indefinite', reason: 'quota' } },
        { agent: 'vibe', block: { kind: 'until', untilMs: Date.parse('2026-09-24T00:00:00.000Z'), reason: null } },
      ],
      agentOverride: 'codex',
      lastThreeCommits: [],
      uncommittedCount: 0,
    };
    renderStatus(result, (msg) => lines.push(msg));
    assert.ok(lines.includes('Agents:'), 'should render the agents header');
    assert.ok(lines.some(l => l.includes('codex: available')), 'should render an unblocked agent');
    assert.ok(lines.some(l => l.includes('qwen: blocked (quota)')), 'should render an indefinite block with its reason');
    assert.ok(lines.some(l => l.includes('vibe: blocked until 2026-09-24T00:00:00.000Z')), 'should render a timed block');
    assert.ok(lines.some(l => l.includes('WORKFLOW_AGENT override:')), 'should render env override');
  });

  test('renderStatus: says agent blocks are unknown when the operator database is unavailable', () => {
    const lines: string[] = [];
    renderStatus({
      branch: 'main', worktree: '/tmp/repo', rebaseInfo: null, slug: null, missionData: null, prInfo: null,
      staleWorktrees: [], staleWorktreeRebase: {}, agents: null, lastThreeCommits: [], uncommittedCount: 0,
    }, (msg) => lines.push(msg));
    assert.ok(lines.includes('Agents: unknown (operator database unavailable)'));
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
      agents: [],
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
      agents: [],
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
      async getAgents() { return [{ agent: 'codex', block: { kind: 'none' as const } }]; },
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
    assert.equal(result.agents!.length, 1);
    assert.equal(result.agents![0].agent, 'codex');
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
    const mockAgent: StatusAgentPort = { async getAgents() { return []; }, getAgentOverride() { return undefined; } };
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
    const mockAgent: StatusAgentPort = { async getAgents() { return []; }, getAgentOverride() { return undefined; } };
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
    const mockAgent: StatusAgentPort = { async getAgents() { return []; }, getAgentOverride() { return undefined; } };
    const mockStale: StatusStaleWorktreesPort = { findStaleWorktrees() { return []; }, getStaleWorktreeRebase() { return {}; } };

    const useCase = new StatusCommandUseCase(mockBoard, mockGit, mockPr, mockAgent, mockStale);
    const cmd = createStatusCommand(useCase);

    await cmd(['task-1001'], {
      logFn: (msg) => lines.push(msg),
      exitFn: ((code) => { exitCode = code; }) as never,
    });

    assert.equal(exitCode, 0, 'should exit 0');
    assert.ok(lines.some(l => l.includes('Mission status: active')), 'should render Mission status');
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
    const mockAgent: StatusAgentPort = { async getAgents() { return []; }, getAgentOverride() { return undefined; } };
    const mockStale: StatusStaleWorktreesPort = { findStaleWorktrees() { return []; }, getStaleWorktreeRebase() { return {}; } };

    const useCase = new StatusCommandUseCase(mockBoard, mockGit, mockPr, mockAgent, mockStale);
    const cmd = createStatusCommand(useCase);

    await cmd([], {
      logFn: (msg) => lines.push(msg),
      exitFn: ((code) => { exitCode = code; }) as never,
    });

    assert.equal(exitCode, 0, 'should exit 0');
    assert.deepEqual(boardCalls, ['task-2332.13'], 'board is queried with the inferred slug');
    assert.ok(lines.some(l => l.includes('Mission status: in-review')), 'renders inferred mission status');
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
    const mockAgent: StatusAgentPort = { async getAgents() { return []; }, getAgentOverride() { return undefined; } };
    const mockStale: StatusStaleWorktreesPort = { findStaleWorktrees() { return []; }, getStaleWorktreeRebase() { return {}; } };

    const cmd = createStatusCommand(new StatusCommandUseCase(mockBoard, mockGit, mockPr, mockAgent, mockStale));

    await cmd(['--verbose'], {
      errorFn: (msg) => errors.push(msg),
      exitFn: ((code) => { exitCode = code; }) as never,
    });

    assert.equal(exitCode, 1, 'should exit 1 on parse error');
    assert.ok(errors.some(e => e.includes('Unknown status option')), 'should report unknown option');
  });
});

describe("status projection of Mission brief and checkpoint", () => {
  /**
   * TASK-2521.03 — the Mission projection behind `px status` and `px status --json`.
   *
   * `px status` is the single Mission reporting surface: there is no second
   * context command. These tests pin AC #1 (complete current Mission state is
   * readable), AC #11 (a structured form exists) and the three consumers that
   * must not fall back to a file: execute resume, review continuity and restart
   * recovery.
   */



  const BRIEF = {
    goal: 'Make the agent read/write workflow first-class through px',
    why: 'Agents otherwise fall back to filesystem archaeology.',
    scope: 'Typed read and write commands over existing authorities.',
    outOfScope: ['A generic patch endpoint', 'Direct SQL for agents'],
  };

  function missionData(overrides: Partial<StatusMissionData> = {}): StatusMissionData {
    return {
      backlogStatus: 'active',
      brief: BRIEF,
      declaredGates: ['./scripts/verify-local.sh all'],
      checkpoint: 'CP-1',
      checkpointDescription: 'Typed write surface',
      goalCheck: [{ criterion: 'Typed verbs exist', evidence: 'test/mission-brief-and-mutation-contract.test.ts' }],
      nextAction: 'Record the next checkpoint.',
      version: 7,
      reviewHistory: [],
      ...overrides,
    };
  }

  function result(md: StatusMissionData | null): StatusResult {
    return {
      branch: 'mission/task-2521.03',
      worktree: '/tmp/parallix-task-2521.03',
      rebaseInfo: null,
      slug: 'task-2521.03',
      missionData: md,
      prInfo: null,
      staleWorktrees: [],
      staleWorktreeRebase: {},
      agents: [],
      agentOverride: undefined,
      lastThreeCommits: [],
      uncommittedCount: 0,
    } as StatusResult;
  }

  function render(md: StatusMissionData | null): string {
    const lines: string[] = [];
    renderStatus(result(md), (msg) => lines.push(msg));
    return lines.join('\n');
  }

  test('AC #1: px status reports the brief, the declared gates and the latest checkpoint', () => {
    const output = render(missionData());
    assert.match(output, /Goal: Make the agent read\/write workflow first-class through px/);
    assert.match(output, /Why: Agents otherwise fall back/);
    assert.match(output, /Scope: Typed read and write commands/);
    assert.match(output, /Out of scope: A generic patch endpoint; Direct SQL for agents/);
    assert.match(output, /Declared gates: \.\/scripts\/verify-local\.sh all/);
    assert.match(output, /Last checkpoint: CP-1/);
    assert.match(output, /Typed verbs exist: test\/mission-brief-and-mutation-contract\.test\.ts/);
    assert.match(output, /Next action: Record the next checkpoint\./);
  });

  test('AC #10: px status reports the version an agent passes to --expected-version', () => {
    assert.match(render(missionData()), /Version: 7 \(pass to --expected-version when writing\)/);
    assert.equal(JSON.parse(statusJson(result(missionData()))).version, 7);
  });

  test('AC #11: px status --json exposes the recorded fields as structured data', () => {
    const parsed = JSON.parse(statusJson(result(missionData())));
    for (const key of ['slug', 'backlogStatus', 'version', 'brief', 'declaredGates', 'latestCheckpoint']) {
      assert.ok(Object.hasOwn(parsed, key), `--json output must expose ${key}`);
    }
    assert.deepEqual(parsed.declaredGates, ['./scripts/verify-local.sh all']);
    assert.equal(parsed.brief.goal, BRIEF.goal);
    assert.equal(parsed.latestCheckpoint.name, 'CP-1');
    assert.equal(parsed.latestCheckpoint.goalCheck[0].criterion, 'Typed verbs exist');
  });

  test('the JSON form carries no machine-local operator facts an agent could depend on', () => {
    const parsed = JSON.parse(statusJson(result(missionData())));
    for (const key of ['agents', 'staleWorktrees', 'lastThreeCommits', 'worktree', 'uncommittedCount']) {
      assert.ok(!Object.hasOwn(parsed, key), `--json must not expose the operator-local ${key}`);
    }
  });

  test('execute resume reads the next action and gates from the recorded state', () => {
    const parsed = JSON.parse(statusJson(result(missionData())));
    assert.equal(parsed.latestCheckpoint.nextAction, 'Record the next checkpoint.');
    assert.ok(parsed.declaredGates.length > 0, 'a resumed execute agent must see its declared gates');
  });

  test('review continuity reports round, phase, disposition and prior rounds', () => {
    const parsed = JSON.parse(statusJson(result(missionData({
      backlogStatus: 'review',
      reviewPhase: 'fixing',
      reviewRound: 2,
      reviewDisposition: 'CHANGES_MADE',
      reviewHistory: [{
        number: 1, reviewer: 'codex', implementer: 'claude', disposition: 'CHANGES_REQUESTED',
        comment: 'see findings', findingSummaries: ['F1 typed writes missing'], fixes: ['F1 fixed'], pushbacks: [],
      }],
    }))));
    assert.equal(parsed.review.round, 2);
    assert.equal(parsed.review.phase, 'fixing');
    assert.equal(parsed.review.disposition, 'CHANGES_MADE');
    assert.equal(parsed.review.history[0].findingSummaries[0], 'F1 typed writes missing');
  });

  test('restart recovery still reports lane and checkpoint when no brief is recorded', () => {
    const output = render(missionData({ brief: null, declaredGates: [] }));
    assert.match(output, /Brief: none recorded/);
    assert.match(output, /Declared gates: none/);
    assert.match(output, /Mission status: active/);
    assert.match(output, /Last checkpoint: CP-1/);
    // Absence is reported as absence, never invented.
    assert.ok(!/Goal: /.test(output), 'no goal may be rendered when none is recorded');
  });

  test('an unrecorded mission reports nothing rather than falling back to files', () => {
    const parsed = JSON.parse(statusJson(result(null)));
    assert.equal(parsed.brief, null);
    assert.deepEqual(parsed.declaredGates, []);
    assert.equal(parsed.latestCheckpoint, null);
    assert.equal(parsed.version, null);
  });

  test('--json is parsed as a status flag and does not become a slug', () => {
    assert.deepEqual(parseStatusCliRequest(['task-2521.03', '--json']), { explicitSlug: 'task-2521.03', json: true });
    assert.deepEqual(parseStatusCliRequest(['--json']), { explicitSlug: undefined, json: true });
    assert.equal(parseStatusCliRequest(['task-2521.03']).json, false);
    assert.throws(() => parseStatusCliRequest(['--nope']), /Unknown status option/);
  });

  test('px status reports the repository title, never the intake placeholder', () => {
    // `title` is target-repository authority (MISSION_FIELD_AUTHORITY). The
    // aggregate's title is written at `px draft` intake while MISSION.md is still
    // the scaffold, so it holds the literal `<Title> (slug)` placeholder; reading
    // it from the store instead of the card published that placeholder to agents.
    const titled = missionData({ title: 'Mission 3 — Make the workflow first-class through px' });
    assert.match(render(titled), /Title: Mission 3 — Make the workflow first-class through px/);
    assert.doesNotMatch(render(titled), /<Title>/);
    assert.equal(JSON.parse(statusJson(result(titled))).title, 'Mission 3 — Make the workflow first-class through px');
  });
});

describe("PR lookup follows the requested Mission branch", () => {
  // Regression test for task-2419: `px status <slug>` must report the Forgejo PR
  // of the *requested* mission's branch, not the PR of whatever branch the
  // command happens to run on.
  //
  // At the mission's parent commit this test is RED: `StatusCommandUseCase`
  // passes the current branch (`mission/task-2402`) to `getPrInfo`, so the
  // recorded branch is `mission/task-2402`, not the requested `mission/task-2419`.
  // After the fix it is GREEN.


  // A current branch for a *different* mission than the requested slug.
  const CURRENT_BRANCH = 'mission/task-2402';
  // The requested slug resolves to this branch under the default adapter
  // (branchPrefix 'mission/'), independent of the current branch.
  const REQUESTED_BRANCH = 'mission/task-2419';

  test('StatusCommandUseCase: PR lookup uses the requested mission branch, not the current branch', async () => {
    let capturedBranch: string | undefined;

    const mockBoard: StatusBoardPort = {
      inferSlug() { return null; },
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
      getCurrentBranch() { return CURRENT_BRANCH; },
      // Mirror the default adapter: the requested slug resolves to the 'mission/'
      // prefix branch regardless of the current branch.
      missionBranchName(slug: string) { return 'mission/' + slug; },
      getRebaseInfo() { return null; },
      getLastThreeCommits() { return []; },
      getUncommittedCount() { return 0; },
    };

    const mockPr: StatusPrPort = {
      getPrInfo(branch: string) {
        capturedBranch = branch;
        return { exists: true, number: 339, state: 'open' };
      },
    };

    const mockAgent: StatusAgentPort = {
      async getAgents() { return []; },
      getAgentOverride() { return undefined; },
    };

    const mockStale: StatusStaleWorktreesPort = {
      findStaleWorktrees() { return []; },
      getStaleWorktreeRebase() { return {}; },
    };

    const useCase = new StatusCommandUseCase(mockBoard, mockGit, mockPr, mockAgent, mockStale);
    const result = await useCase.execute('/tmp/repo', 'task-2419');

    // SC1: the branch passed to getPrInfo equals the requested mission's branch
    // and differs from the current branch.
    assert.equal(capturedBranch, REQUESTED_BRANCH);
    assert.notEqual(capturedBranch, CURRENT_BRANCH);
    assert.equal(result.prInfo?.number, 339);
  });
});
