/** Concrete implementations of the focused status ports.
 * Wires existing git, backlog, forgejo, agents, and board-projection adapters
 * into the focused status ports owned by the application layer. */

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
} from '../../../application/ports/cli-workflows.js';
import { detectRebaseState, getCurrentBranch, getUncommittedCount, getLastThreeCommits, run } from '../../git/git.js';
import { findTaskFile, getTaskStatus } from '../../backlog/backlog.js';
import {
  getPrimaryWorktree,
  inferSlug,
  missionBranchName,
  missionBranchPrefix,
} from '../../filesystem/mission-utils.js';
import { WORKFLOW_AGENT_NAMES, eligibleAgentsForStep, readAgentConfigOrExit, workflowLauncherStatus } from '../../agents/agents.js';
import { getPrStatus } from '../../forgejo/forgejo.js';
import type { BoardProjectionBuilder } from '../../../application/projections/board-readers.js';

/** Factory options for creating the status workflow adapter. */
export interface StatusWorkflowAdapterOptions {
  /** Build BoardProjectionBuilder for the given root directory. */
  readonly buildProjectionFn: (_rootDir: string) => Promise<BoardProjectionBuilder>;
  /** Infer mission slug from explicit input. */
  readonly inferSlugFn?: (_explicit?: string) => string | null;
  /** Get current git branch. */
  readonly getCurrentBranchFn?: () => string;
  /** Get PR status for a branch. */
  readonly getPrStatusFn?: (_branch: string) => { exists: boolean; number?: number; state?: string; raw?: string };
  /** Read agent configuration. */
  readonly readAgentConfigOrExitFn?: () => unknown;
  /** Get eligible agents for a workflow step. */
  readonly eligibleAgentsForStepFn?: (_step: string, _opts?: unknown) => string[];
  /** Get all workflow agent names. */
  readonly allWorkflowAgentNamesFn?: () => string[];
  /** Get workflow launcher status for an agent. */
  readonly workflowLauncherStatusFn?: (_agent: string) => { supported: boolean };
  /** Get last three commit messages. */
  readonly getLastThreeCommitsFn?: () => string[];
  /** Get count of uncommitted files. */
  readonly getUncommittedCountFn?: () => number;
  /** Detect rebase state for a worktree path. */
  readonly detectRebaseStateFn?: (_path: string) => { inProgress: boolean; detached: boolean; unmergedFiles: string[] };
  /** Git run function. */
  readonly gitRun?: typeof run;
  /** Find task file for a slug. */
  readonly findTaskFileFn?: typeof findTaskFile;
  /** Get task status from a task file. */
  readonly getTaskStatusFn?: typeof getTaskStatus;
  /** Primary worktree path (for stale detection). */
  readonly primaryWorktree?: string | null;
}

function parseWorktreeList(porcelain: string) {
  const entries: { path: string; branch: string | null }[] = [];
  let current: { path: string; branch: string | null } | null = null;

  for (const line of porcelain.split('\n')) {
    if (!line.trim()) {
      if (current) { entries.push(current); current = null; }
      continue;
    }
    if (line.startsWith('worktree ')) {
      if (current) { entries.push(current); }
      current = { path: line.slice('worktree '.length).trim(), branch: null };
      continue;
    }
    if (line.startsWith('branch ') && current) {
      current.branch = line.slice('branch '.length).trim();
    }
  }
  if (current) { entries.push(current); }
  return entries;
}

function findStaleMissionWorktrees(opts: {
  gitRun: typeof run;
  findTaskFileFn: typeof findTaskFile;
  getTaskStatusFn: typeof getTaskStatus;
  primaryWorktree: string | null;
}): StatusStaleWorktree[] {
  const result = opts.gitRun('git', ['worktree', 'list', '--porcelain']);
  if (result.status !== 0) { return []; }

  return parseWorktreeList(result.stdout)
    .filter(entry => entry.path !== opts.primaryWorktree)
    .map(entry => {
      const branchRef = entry.branch || '';
      const prefix = missionBranchPrefix(opts.primaryWorktree || process.cwd());
      const normalizedRefPrefix = `refs/heads/${prefix}`;
      const match = branchRef.startsWith(normalizedRefPrefix)
        ? [branchRef, branchRef.slice(normalizedRefPrefix.length)]
        : null;
      if (!match) { return null; }

      const slug = match[1];
      const taskFile = opts.findTaskFileFn(slug);
      const taskStatus = taskFile ? opts.getTaskStatusFn(taskFile) : null;
      if (taskStatus !== 'done' && taskFile) { return null; }

      return {
        slug,
        path: entry.path,
        branch: branchRef,
        taskStatus: taskStatus || 'missing',
        cleanupCommand: taskStatus === 'done'
          ? `scripts/cleanup-mission-worktree.sh ${slug}`
          : `git worktree remove ${entry.path} && git branch -D ${missionBranchName(slug, opts.primaryWorktree || process.cwd())}`,
      };
    })
    .filter(Boolean) as StatusStaleWorktree[];
}

/** Create a concrete StatusWorkflowPort implementation. */
export function createStatusWorkflowAdapter(options: StatusWorkflowAdapterOptions): StatusWorkflowPort {
  const inferSlugFn = options.inferSlugFn || inferSlug;
  const getCurrentBranchFn = options.getCurrentBranchFn || getCurrentBranch;
  const getPrStatusFn = options.getPrStatusFn || getPrStatus;
  const readAgentConfigOrExitFn = options.readAgentConfigOrExitFn || readAgentConfigOrExit;
  const eligibleAgentsForStepFn = options.eligibleAgentsForStepFn || eligibleAgentsForStep;
  const allWorkflowAgentNamesFn = options.allWorkflowAgentNamesFn || (() => WORKFLOW_AGENT_NAMES);
  const workflowLauncherStatusFn = options.workflowLauncherStatusFn || workflowLauncherStatus;
  const getLastThreeCommitsFn = options.getLastThreeCommitsFn || getLastThreeCommits;
  const getUncommittedCountFn = options.getUncommittedCountFn || getUncommittedCount;
  const detectRebaseStateFn = options.detectRebaseStateFn || detectRebaseState;
  const gitRun = options.gitRun || run;
  const findTaskFileFn = options.findTaskFileFn || findTaskFile;
  const getTaskStatusFn = options.getTaskStatusFn || getTaskStatus;

  return {
    async getStatus(slug: string | null, rootDir: string): Promise<StatusResult> {
      const explicitSlug = slug;
      const resolvedSlug = inferSlugFn(slug || undefined);

      // Current worktree branch
      const branch = getCurrentBranchFn();

      // Rebase state for current worktree
      let rebaseInfo: StatusRebaseInfo | null = null;
      try {
        const rs = detectRebaseStateFn(rootDir);
        if (rs.inProgress && rs.detached) {
          rebaseInfo = { inProgress: rs.inProgress, detached: rs.detached, unmergedFiles: rs.unmergedFiles };
        }
      } catch { /* ignore transient failures */ }

      // Mission-specific data
      let missionData: StatusMissionData | null = null;
      let prInfo: StatusPrInfo | null = null;

      if (resolvedSlug) {
        // Board projection
        try {
          const projection = await options.buildProjectionFn(rootDir)
            .then(builder => builder.build())
            .catch(() => null);

          if (projection) {
            const card = projection.stages.flatMap((s) => s.cards).find(
              (c) => (c as any).id.toLowerCase() === resolvedSlug.toLowerCase(),
            );
            if (card) {
              missionData = {
                backlogStatus: (card as any).rawStatus ?? (card as any).status,
                checkpoint: (card as any).checkpoint,
                checkpointDescription: (card as any).checkpointDescription,
                reviewPhase: (card as any).reviewPhase,
                reviewRound: (card as any).reviewRound,
                reviewDisposition: (card as any).reviewDisposition,
                reviewHistory: ((card as any).reviewHistory || []).map((r: any) => ({
                  number: r.number,
                  reviewer: r.reviewer,
                  implementer: r.implementer,
                  disposition: r.disposition ?? 'pending',
                  comment: r.comment,
                  findingSummaries: r.findingSummaries || [],
                  fixes: r.fixes || [],
                  pushbacks: r.pushbacks || [],
                })),
              };
            }
          }
        } catch { /* projection unavailable */ }

        // PR status
        try {
          const pr = getPrStatusFn(missionBranchName(resolvedSlug));
          prInfo = pr;
        } catch {
          prInfo = { exists: false };
        }
      }

      // Stale worktrees (only when no explicit slug)
      let staleWorktrees: StatusStaleWorktree[] = [];
      const staleWorktreeRebase: Record<string, StatusRebaseInfo | null> = {};
      if (!explicitSlug) {
        let resolvedPrimary: string | null = options.primaryWorktree ?? null;
        if (!resolvedPrimary) {
          try { resolvedPrimary = getPrimaryWorktree(); } catch { resolvedPrimary = null; }
        }
        staleWorktrees = findStaleMissionWorktrees({
          gitRun,
          findTaskFileFn,
          getTaskStatusFn,
          primaryWorktree: resolvedPrimary,
        });

        // Rebase info for each stale worktree
        for (const wt of staleWorktrees) {
          try {
            const rs = detectRebaseStateFn(wt.path);
            if (rs.inProgress) {
              staleWorktreeRebase[wt.path] = { inProgress: rs.inProgress, detached: rs.detached, unmergedFiles: rs.unmergedFiles };
            }
          } catch { /* ignore disappearing worktrees */ }
        }
      }

      // Agent launcher matrix
      const config = readAgentConfigOrExitFn();
      const draftEligible = eligibleAgentsForStepFn('draft', { config: config as any });
      const activeEligible = eligibleAgentsForStepFn('active', { config: config as any });
      const baseAgents = allWorkflowAgentNamesFn();
      const allAgents = [...new Set([...baseAgents, ...draftEligible, ...activeEligible])].sort();
      const agentMatrix: StatusAgentEntry[] = allAgents.map(agent => ({
        agent,
        supported: workflowLauncherStatusFn(agent).supported,
        draftEligible: draftEligible.includes(agent),
        activeEligible: activeEligible.includes(agent),
      }));
      const agentOverride = process.env.WORKFLOW_AGENT;

      // Commits and uncommitted
      const lastThreeCommits = getLastThreeCommitsFn();
      const uncommittedCount = getUncommittedCountFn();

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
    },
  };
}

// ---------------------------------------------------------------------------
// Focused status ports
// ---------------------------------------------------------------------------

/** Create a concrete StatusBoardPort implementation. */
export function createStatusBoardAdapter(options: {
  readonly buildProjectionFn: (_rootDir: string) => Promise<BoardProjectionBuilder>;
  readonly inferSlugFn?: (_explicit?: string) => string | null;
}): StatusBoardPort {
  const inferSlugFn = options.inferSlugFn || inferSlug;
  return {
    inferSlug(explicit?: string): string | null {
      return inferSlugFn(explicit);
    },

    async getMissionData(slug: string, rootDir: string): Promise<StatusMissionData | null> {
      try {
        const projection = await options.buildProjectionFn(rootDir)
          .then(builder => builder.build())
          .catch(() => null);

        if (!projection) { return null; }

        const card = projection.stages.flatMap((s) => s.cards).find(
          (c) => (c as any).id.toLowerCase() === slug.toLowerCase(),
        );
        if (!card) { return null; }

        return {
          backlogStatus: (card as any).rawStatus ?? (card as any).status,
          checkpoint: (card as any).checkpoint,
          checkpointDescription: (card as any).checkpointDescription,
          reviewPhase: (card as any).reviewPhase,
          reviewRound: (card as any).reviewRound,
          reviewDisposition: (card as any).reviewDisposition,
          reviewHistory: ((card as any).reviewHistory || []).map((r: any) => ({
            number: r.number,
            reviewer: r.reviewer,
            implementer: r.implementer,
            disposition: r.disposition ?? 'pending',
            comment: r.comment,
            findingSummaries: r.findingSummaries || [],
            fixes: r.fixes || [],
            pushbacks: r.pushbacks || [],
          })),
        };
      } catch { /* projection unavailable */ }
      return null;
    },
  };
}

/** Create a concrete StatusGitPort implementation. */
export function createStatusGitAdapter(options: {
  readonly getCurrentBranchFn?: () => string;
  readonly detectRebaseStateFn?: (_path: string) => { inProgress: boolean; detached: boolean; unmergedFiles: string[] };
  readonly getLastThreeCommitsFn?: () => string[];
  readonly getUncommittedCountFn?: () => number;
} = {}): StatusGitPort {
  const getCurrentBranchFn = options.getCurrentBranchFn || getCurrentBranch;
  const detectRebaseStateFn = options.detectRebaseStateFn || detectRebaseState;
  const getLastThreeCommitsFn = options.getLastThreeCommitsFn || getLastThreeCommits;
  const getUncommittedCountFn = options.getUncommittedCountFn || getUncommittedCount;

  return {
    getCurrentBranch(): string {
      return getCurrentBranchFn();
    },

    getRebaseInfo(rootDir: string): StatusRebaseInfo | null {
      try {
        const rs = detectRebaseStateFn(rootDir);
        if (rs.inProgress && rs.detached) {
          return { inProgress: rs.inProgress, detached: rs.detached, unmergedFiles: rs.unmergedFiles };
        }
      } catch { /* ignore transient failures */ }
      return null;
    },

    getLastThreeCommits(): readonly string[] {
      return getLastThreeCommitsFn();
    },

    getUncommittedCount(): number {
      return getUncommittedCountFn();
    },
  };
}

/** Create a concrete StatusPrPort implementation. */
export function createStatusPrAdapter(options: {
  readonly getPrStatusFn?: (_branch: string) => { exists: boolean; number?: number; state?: string; raw?: string };
} = {}): StatusPrPort {
  const getPrStatusFn = options.getPrStatusFn || getPrStatus;

  return {
    getPrInfo(branch: string): StatusPrInfo | null {
      try {
        return getPrStatusFn(branch);
      } catch {
        return { exists: false };
      }
    },
  };
}

/** Create a concrete StatusAgentPort implementation. */
export function createStatusAgentAdapter(options: {
  readonly readAgentConfigOrExitFn?: () => unknown;
  readonly eligibleAgentsForStepFn?: (_step: string, _opts?: unknown) => string[];
  readonly allWorkflowAgentNamesFn?: () => string[];
  readonly workflowLauncherStatusFn?: (_agent: string) => { supported: boolean };
} = {}): StatusAgentPort {
  const readAgentConfigOrExitFn = options.readAgentConfigOrExitFn || readAgentConfigOrExit;
  const eligibleAgentsForStepFn = options.eligibleAgentsForStepFn || eligibleAgentsForStep;
  const allWorkflowAgentNamesFn = options.allWorkflowAgentNamesFn || (() => WORKFLOW_AGENT_NAMES);
  const workflowLauncherStatusFn = options.workflowLauncherStatusFn || workflowLauncherStatus;

  return {
    getAgentMatrix(): readonly StatusAgentEntry[] {
      const config = readAgentConfigOrExitFn();
      const draftEligible = eligibleAgentsForStepFn('draft', { config: config as any });
      const activeEligible = eligibleAgentsForStepFn('active', { config: config as any });
      const baseAgents = allWorkflowAgentNamesFn();
      const allAgents = [...new Set([...baseAgents, ...draftEligible, ...activeEligible])].sort();
      return allAgents.map(agent => ({
        agent,
        supported: workflowLauncherStatusFn(agent).supported,
        draftEligible: draftEligible.includes(agent),
        activeEligible: activeEligible.includes(agent),
      }));
    },

    getAgentOverride(): string | undefined {
      return process.env.WORKFLOW_AGENT;
    },
  };
}

/** Create a concrete StatusStaleWorktreesPort implementation. */
export function createStatusStaleWorktreesAdapter(options: {
  readonly gitRun?: typeof run;
  readonly findTaskFileFn?: typeof findTaskFile;
  readonly getTaskStatusFn?: typeof getTaskStatus;
  readonly detectRebaseStateFn?: (_path: string) => { inProgress: boolean; detached: boolean; unmergedFiles: string[] };
  readonly primaryWorktree?: string | null;
} = {}): StatusStaleWorktreesPort {
  const gitRun = options.gitRun || run;
  const findTaskFileFn = options.findTaskFileFn || findTaskFile;
  const getTaskStatusFn = options.getTaskStatusFn || getTaskStatus;
  const detectRebaseStateFn = options.detectRebaseStateFn || detectRebaseState;

  return {
    findStaleWorktrees(explicitSlug: string | null, _rootDir: string): readonly StatusStaleWorktree[] {
      if (explicitSlug) { return []; }

      let resolvedPrimary: string | null = options.primaryWorktree ?? null;
      if (!resolvedPrimary) {
        try { resolvedPrimary = getPrimaryWorktree(); } catch { resolvedPrimary = null; }
      }

      return findStaleMissionWorktrees({
        gitRun,
        findTaskFileFn,
        getTaskStatusFn,
        primaryWorktree: resolvedPrimary,
      });
    },

    getStaleWorktreeRebase(staleWorktrees: readonly StatusStaleWorktree[]): Record<string, StatusRebaseInfo | null> {
      const rebaseMap: Record<string, StatusRebaseInfo | null> = {};
      for (const wt of staleWorktrees) {
        try {
          const rs = detectRebaseStateFn(wt.path);
          if (rs.inProgress) {
            rebaseMap[wt.path] = { inProgress: rs.inProgress, detached: rs.detached, unmergedFiles: rs.unmergedFiles };
          }
        } catch { /* ignore disappearing worktrees */ }
      }
      return rebaseMap;
    },
  };
}
