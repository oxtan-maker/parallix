import type {
  StatusBoardPort,
  StatusGitPort,
  StatusPrPort,
  StatusAgentPort,
  StatusStaleWorktreesPort,
  StatusWorkflowPort,
  StatusResult,
  StatusMissionData,
  StatusPrInfo,
  StatusStaleWorktree,
  StatusAgentEntry,
  StatusRebaseInfo,
} from './ports/cli-workflows.js';

/** CLI-independent application entry point for the status workflow.
 * Orchestrates status data gathering through focused application ports. */
export class StatusCommandUseCase {
  constructor(
    private readonly _board: StatusBoardPort,
    private readonly _git: StatusGitPort,
    private readonly _pr: StatusPrPort,
    private readonly _agent: StatusAgentPort,
    private readonly _staleWorktrees: StatusStaleWorktreesPort,
  ) {}

  /** Gather complete status data. Returns interface-neutral result. */
  async execute(rootDir: string, slug: string | null = null): Promise<StatusResult> {
    const explicitSlug = slug;

    // Infer slug when not explicitly provided
    const resolvedSlug = slug || this._board.inferSlug(slug ?? undefined);

    // Git state
    const branch = this._git.getCurrentBranch();
    const rebaseInfo = this._git.getRebaseInfo(rootDir);
    const lastThreeCommits = this._git.getLastThreeCommits();
    const uncommittedCount = this._git.getUncommittedCount();

    // Mission-specific data
    let missionData: StatusMissionData | null = null;
    let prInfo: StatusPrInfo | null = null;

    if (resolvedSlug) {
      missionData = await this._board.getMissionData(resolvedSlug, rootDir);
      // SC1/SC2: look up the PR for the *requested* mission's branch, not the
      // branch the command happens to run on. A wrong PR number here points an
      // operator at another mission's review (task-2419). The branch is resolved
      // through the git port so the CLI-independent use case keeps its layering.
      prInfo = this._pr.getPrInfo(this._git.missionBranchName(resolvedSlug, rootDir));
    }

    // Stale worktrees (only when no explicit slug)
    const staleWorktrees = this._staleWorktrees.findStaleWorktrees(explicitSlug, rootDir);
    const staleWorktreeRebase = this._staleWorktrees.getStaleWorktreeRebase(staleWorktrees);

    // Agent matrix
    const agentMatrix = this._agent.getAgentMatrix();
    const agentOverride = this._agent.getAgentOverride();

    return {
      branch,
      worktree: rootDir,
      rebaseInfo,
      slug: resolvedSlug,
      missionData,
      prInfo,
      staleWorktrees,
      staleWorktreeRebase,
      agentMatrix,
      agentOverride,
      lastThreeCommits,
      uncommittedCount,
    };
  }
}

/** Legacy adapter that wraps a monolithic StatusWorkflowPort into focused ports.
 * Used by tests and composition roots that still supply the single-port adapter. */
export class StatusWorkflowAdapter implements StatusBoardPort, StatusGitPort, StatusPrPort, StatusAgentPort, StatusStaleWorktreesPort {
  constructor(private readonly _workflow: StatusWorkflowPort, private readonly _rootDir: string) {}

  /** Legacy path performs no inference: it reports only the explicit slug. */
  inferSlug(explicit?: string): string | null {
    return explicit ?? null;
  }

  async getMissionData(slug: string, rootDir: string): Promise<StatusMissionData | null> {
    const result = await this._workflow.getStatus(slug, rootDir);
    return result.missionData;
  }

  getCurrentBranch(): string {
    return ''; // populated by concrete adapter
  }

  // Legacy single-port path: no per-repo adapter config is available here, so
  // fall back to the default 'mission/' prefix. The production status command
  // wires createStatusGitAdapter, which resolves the real branch prefix.
  missionBranchName(slug: string): string {
    return 'mission/' + slug;
  }

  getRebaseInfo(_rootDir: string): StatusRebaseInfo | null {
    return null;
  }

  getLastThreeCommits(): readonly string[] {
    return [];
  }

  getUncommittedCount(): number {
    return 0;
  }

  getPrInfo(_branch: string): StatusPrInfo | null {
    return null;
  }

  getAgentMatrix(): readonly StatusAgentEntry[] {
    return [];
  }

  getAgentOverride(): string | undefined {
    return undefined;
  }

  findStaleWorktrees(_explicitSlug: string | null, _rootDir: string): readonly StatusStaleWorktree[] {
    return [];
  }

  getStaleWorktreeRebase(_staleWorktrees: readonly StatusStaleWorktree[]): Record<string, StatusRebaseInfo | null> {
    return {};
  }
}

// Re-export types for consumers
export type { StatusResult, StatusMissionData, StatusPrInfo, StatusStaleWorktree, StatusAgentEntry, StatusRebaseInfo, StatusReviewRound } from './ports/cli-workflows.js';
