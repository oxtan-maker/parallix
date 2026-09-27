/** Concrete implementations of the focused status ports.
 * Wires existing git, backlog, forgejo, agents, and board-projection adapters
 * into the focused status ports owned by the application layer. */

import type {
  StatusBoardPort,
  StatusGitPort,
  StatusPrPort,
  StatusAgentPort,
  StatusStaleWorktreesPort,
  StatusMissionData,
  StatusPrInfo,
  StatusStaleWorktree,
  StatusAgentEntry,
  StatusRebaseInfo,
} from '../../../application/ports/cli-workflows.js';
import { detectRebaseState, getCurrentBranch, getUncommittedCount, getLastThreeCommits, run } from '../../git/git.js';
import { findTaskFile, getTaskStatus } from '../../backlog/backlog.js';
import { readLegacyTaskContent } from '../../backlog/legacy-task-content.js';
import { readLegacyMissionContent, readLegacyReviewSnapshot } from '../../backlog/legacy-mission-content.js';
import {
  getPrimaryWorktree,
  inferSlug,
  missionBranchName,
  missionBranchPrefix,
} from '../../filesystem/mission-utils.js';
import { ConcreteAgentReadAdapter } from '../../backlog/concrete-agent-read-adapter.js';
import { knownAgentFamiliesFromConfig } from '../../agents/known-agent-families.js';
import { readAgentConfig } from '../../agents/agent-config.js';
import type { AgentBlocklistRepository } from '../../../application/ports/agent-blocklist.js';
import type { AgentFamily } from '../../../domain/agents.js';
import { getPrStatus } from '../../review/review-adapter.js';
import type { BoardProjectionBuilder } from '../../../application/projections/board-readers.js';
import type { MissionId } from '../../../domain/mission.js';
import { projectMissionActivity, type MissionActivitySource } from '../../../application/projections/mission-activity.js';
import { latestEvidencedCheckpoint } from '../../../domain/checkpoint.js';

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
        // SC5: no `scripts/cleanup-mission-worktree.sh` exists on disk. The
        // cleanup is the same local git one-liner for every stranded mission
        // worktree, so the hint must name a real git command.
        cleanupCommand: `git worktree remove ${entry.path} && git branch -D ${missionBranchName(slug, opts.primaryWorktree || process.cwd())}`,
      };
    })
    .filter(Boolean) as StatusStaleWorktree[];
}

// ---------------------------------------------------------------------------
// Focused status ports
// ---------------------------------------------------------------------------

/** Create a concrete StatusBoardPort implementation. */
export function createStatusBoardAdapter(options: {
  readonly buildProjectionFn: (_rootDir: string) => Promise<BoardProjectionBuilder>;
  readonly inferSlugFn?: (_explicit?: string) => string | null;
  /**
   * Loads the recorded Mission and its version. Optional so the many test and
   * legacy constructions of this adapter keep working; when absent, `px status`
   * reports the board facts and states that no execution context is recorded
   * rather than inventing one.
   */
  readonly loadMissionFn?: (_slug: string) => Promise<{
    readonly mission: import('../../../domain/mission.js').Mission;
    readonly version: number;
  } | null>;
}): StatusBoardPort {
  const inferSlugFn = options.inferSlugFn || inferSlug;
  return {
    inferSlug(explicit?: string): string | null {
      return inferSlugFn(explicit);
    },

    async getMissionData(slug: string, rootDir: string): Promise<StatusMissionData | null> {
      try {
        // Mission state remains reportable when this is an ad-hoc Mission
        // without a Backlog card.
        const recorded = options.loadMissionFn ? await options.loadMissionFn(slug.toLowerCase()) : null;
        // An explicit slug is a single-mission question, so it takes the
        // builder's focused route: the board projection is never assembled and
        // unrelated missions are never materialised merely to locate this card.
        const card = await options.buildProjectionFn(rootDir)
          .then(builder => builder.buildMissionCard(slug.toLowerCase() as MissionId))
          .catch(() => null);

        if (!card && !recorded) { return null; }

        // The brief, the declared gates and the write version come from the
        // Mission store, not the board card: the card is a board view, while
        // these are Mission state.
        const latest = latestEvidencedCheckpoint(recorded?.mission.checkpoints ?? []);
        const brief = recorded?.mission.brief ?? null;
        const taskRef = recorded?.mission.externalTaskRef ?? null;
        const legacyTask = taskRef ? readLegacyTaskContent(taskRef, rootDir) : null;
        const legacyMission = readLegacyMissionContent(slug, rootDir);
        const legacyReview = readLegacyReviewSnapshot(slug, rootDir);

        return {
          activity: card ? projectMissionActivity(card as MissionActivitySource) : null,
          brief: brief
            ? { goal: brief.goal, why: brief.why, scope: brief.scope, outOfScope: [...brief.outOfScope] }
            : null,
          declaredGates: [...(recorded?.mission.declaredGates ?? [])],
          successCriteria: [...(recorded?.mission.successCriteria ?? [])],
          dependencies: [...(recorded?.mission.dependencies ?? [])],
          checkpoints: (recorded?.mission.checkpoints ?? []).map((checkpoint) => ({
            name: checkpoint.name,
            description: checkpoint.firstLine ?? '',
            recorded: checkpoint.goalCheck.length > 0,
          })),
          predictedNelBucket: recorded?.mission.predictedNelBucket ?? null,
          reproductionTest: recorded?.mission.reproductionTest ?? null,
          goalCheck: latest ? latest.goalCheck.map((r) => ({ criterion: r.criterion, evidence: r.evidence })) : [],
          nextAction: latest?.nextActionText ?? null,
          version: recorded?.version ?? null,
          // `title` is target-repository authority (MISSION_FIELD_AUTHORITY), so
          // it comes from the card. The stored title is written at `px draft`
          // intake while MISSION.md is still the scaffold, so reading it from
          // the aggregate reports the literal `<Title> (slug)` placeholder.
          title: card?.title ?? recorded?.mission.title ?? null,
          assignee: recorded?.mission.assignee ?? null,
          externalTaskRef: recorded?.mission.externalTaskRef
            ? {
              source: recorded.mission.externalTaskRef.source,
              id: recorded.mission.externalTaskRef.id,
              url: recorded.mission.externalTaskRef.url,
            }
            : null,
          missionStatus: recorded?.mission.status ?? (card as any)?.status,
          // Retained for the JSON compatibility surface; lifecycle presentation
          // reads missionStatus above, never this frozen intake field.
          backlogStatus: (card as any)?.rawStatus ?? (card as any)?.status ?? recorded?.mission.status ?? 'unknown',
          legacyTaskContent: legacyTask?.content ?? null,
          legacyTaskError: legacyTask?.error ?? null,
          legacyMissionContent: legacyMission.content,
          legacyMissionError: legacyMission.error,
          legacyReviewStateContent: legacyReview.content,
          legacyReviewStateError: legacyReview.error,
          closedAt: recorded?.mission.closedAt ?? null,
          // A recorded checkpoint names itself. Only fall back to the board
          // card when nothing is recorded, so the reported name can never
          // belong to a different checkpoint than the Goal Check rows below it.
          checkpoint: latest?.name ?? (card as any)?.checkpoint,
          checkpointDescription: (card as any)?.checkpointDescription,
          reviewPhase: (card as any)?.reviewPhase,
          reviewRound: (card as any)?.reviewRound,
          reviewDisposition: (card as any)?.reviewDisposition,
          approvalOwed: (card as any)?.approvalOwed,
          reviewHistory: ((card as any)?.reviewHistory || []).map((r: any) => ({
            number: r.number,
            reviewer: r.reviewer,
            implementer: r.implementer,
            disposition: r.disposition ?? 'pending',
            comment: r.comment,
            findingSummaries: r.findingSummaries || [],
            fixes: r.fixes || [],
            pushbacks: r.pushbacks || [],
            revocation: r.revocation ?? null,
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

    missionBranchName(slug: string, rootDir: string): string {
      return missionBranchName(slug, rootDir);
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
  readonly getPrStatusFn?: (_branch: string, _rootDir?: string) => { exists: boolean; number?: number; state?: string; raw?: string };
  /**
   * The repository being reported on. Without it the provider lookup falls back
   * to `process.cwd()`, so `px status` would consult whichever repo the process
   * happens to sit in rather than the one it is reporting — reaching a review
   * provider that the target repository has disabled.
   */
  readonly rootDir?: string;
} = {}): StatusPrPort {
  const getPrStatusFn = options.getPrStatusFn || getPrStatus;
  const rootDir = options.rootDir;

  return {
    getPrInfo(branch: string): StatusPrInfo | null {
      try {
        return rootDir === undefined ? getPrStatusFn(branch) : getPrStatusFn(branch, rootDir);
      } catch {
        return { exists: false };
      }
    },
  };
}

/**
 * Create a concrete StatusAgentPort implementation.
 *
 * Reads availability exactly as the web board does — the configured agent
 * families and their blocks in the operator database — without spawning any
 * launcher. Whether a family's CLI answers is decided when it is launched.
 */
export function createStatusAgentAdapter(options: {
  readonly rootDir: string;
  /** Null when the operator database is unavailable; status then says so. */
  readonly blocklistRepo: AgentBlocklistRepository | null;
  readonly knownAgentFamilies?: readonly AgentFamily[];
}): StatusAgentPort {
  const agents = options.blocklistRepo && new ConcreteAgentReadAdapter({
    rootDir: options.rootDir,
    blocklistRepo: options.blocklistRepo,
    // The effective agent config (the working-tree copy, else the bundled
    // one), so a repository without its own config still reports families.
    knownAgentFamilies: options.knownAgentFamilies ?? knownAgentFamiliesFromConfig(readAgentConfig()),
  });
  return {
    async getAgents(): Promise<readonly StatusAgentEntry[] | null> {
      if (!agents) { return null; }
      const availability = await agents.loadAgentAvailability();
      return availability.map(({ family, block }) => ({ agent: family, block }));
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
