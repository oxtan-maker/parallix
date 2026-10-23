import { projectStatusMissionData } from './status-mission-data.js';
import type { ParallixConfiguration } from "../../../application/ports/configuration.js";
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
import {
  extractSlugFromBranch,
  inferSlug,
  missionBranchName,
} from '../../filesystem/mission-utils.js';
import { ConcreteAgentReadAdapter } from '../../backlog/concrete-agent-read-adapter.js';
import { knownAgentFamiliesFromConfig } from '../../agents/known-agent-families.js';
import { readAgentConfig } from '../../agents/agent-config.js';
import type { AgentBlocklistRepository } from '../../../application/ports/agent-blocklist.js';
import type { AgentFamily } from '../../../domain/agents.js';
import { getPrStatus } from '../../review/review-adapter.js';
import type { BoardProjectionBuilder } from '../../../application/projections/board-readers.js';
import { missionId } from '../../../domain/mission.js';
import type { RepositoryId } from '../../../domain/repository.js';
import type { MissionStore } from '../../../application/domain-ports.js';
import type { MissionId } from '../../../domain/mission.js';

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

async function findStaleMissionWorktrees(opts: {
  gitRun: typeof run;
  rootDir: string;
  primaryWorktree: string | null;
  missionStore?: Pick<MissionStore, 'load'>;
  repositoryId?: RepositoryId;
}): Promise<StatusStaleWorktree[]> {
  const result = opts.gitRun('git', ['-C', opts.rootDir, 'worktree', 'list', '--porcelain']);
  if (result.status !== 0) { return []; }

  const worktrees = parseWorktreeList(result.stdout);
  // Git reports the owning checkout first, even when invoked from a linked
  // worktree. Derive it from this same repository-scoped observation.
  const primary = opts.primaryWorktree ?? worktrees[0]?.path;
  const entries = await Promise.all(worktrees
    .filter(entry => entry.path !== primary)
    .map(async entry => {
      const branchRef = entry.branch || '';
      const slug = extractSlugFromBranch(branchRef.replace(/^refs\/heads\//, ''), opts.rootDir);
      if (!slug) { return null; }
      const base = { slug, path: entry.path, branch: branchRef };
      try {
        const loaded = await opts.missionStore?.load(missionId(slug));
        if (loaded?.kind === 'found') {
          if (opts.repositoryId && loaded.mission.repositoryId !== opts.repositoryId) {
            return { ...base, taskStatus: 'unknown', uncertainty: 'Mission not found in this repository' };
          }
          if (loaded.mission.status !== 'done') { return null; }
          return {
            ...base,
            taskStatus: loaded.mission.closedAt ? 'closed' : 'done',
            // Recovery still verifies landing and completes stats/hooks.
            cleanupCommand: `px integrate ${slug} --recover-landed`,
          };
        }
        return { ...base, taskStatus: 'unknown',
          uncertainty: loaded?.kind === 'missing' ? 'Mission not found in authoritative store'
            : `Mission authority unavailable${loaded?.kind === 'unavailable' ? `: ${loaded.reason}` : ''}` };
      } catch (error) {
        return { ...base, taskStatus: 'unknown',
          uncertainty: `Authoritative Mission lookup failed: ${String(error)}` };
      }
    }));
  return entries
    .filter(Boolean) as StatusStaleWorktree[];
}

// ---------------------------------------------------------------------------
// Focused status ports
// ---------------------------------------------------------------------------

/** Create a concrete StatusBoardPort implementation. */
export function createStatusBoardAdapter(options: {
  readonly buildProjectionFn: (_rootDir: string) => Promise<Pick<BoardProjectionBuilder, 'buildMissionCard'>>;
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
        return projectStatusMissionData(recorded, card, slug, rootDir);
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
  configuration?: ParallixConfiguration;
  readonly rootDir: string;
  /** Null when the operator database is unavailable; status then says so. */
  readonly blocklistRepo: AgentBlocklistRepository | null;
  readonly knownAgentFamilies?: readonly AgentFamily[];
}): StatusAgentPort {
  const agents = options.blocklistRepo && new ConcreteAgentReadAdapter({
    rootDir: options.rootDir,
    readAgentConfig: () => readAgentConfig(undefined, { configuration: options.configuration }),
    blocklistRepo: options.blocklistRepo,
    // The effective agent config (the working-tree copy, else the bundled
    // one), so a repository without its own config still reports families.
    knownAgentFamilies: options.knownAgentFamilies ?? knownAgentFamiliesFromConfig(readAgentConfig(undefined, { configuration: options.configuration })),
  });
  return {
    async getAgents(): Promise<readonly StatusAgentEntry[] | null> {
      if (!agents) { return null; }
      const availability = await agents.loadAgentAvailability();
      return availability.map(({ family, block }) => ({ agent: family, block }));
    },

    getAgentOverride(): string | undefined {
      return options.configuration?.agents.override;
    },
  };
}

/** Create a concrete StatusStaleWorktreesPort implementation. */
export function createStatusStaleWorktreesAdapter(options: {
  readonly gitRun?: typeof run;
  readonly missionStore?: Pick<MissionStore, 'load'>;
  readonly repositoryId?: RepositoryId;
  readonly detectRebaseStateFn?: (_path: string) => { inProgress: boolean; detached: boolean; unmergedFiles: string[] };
  readonly primaryWorktree?: string | null;
} = {}): StatusStaleWorktreesPort {
  const gitRun = options.gitRun || run;
  const detectRebaseStateFn = options.detectRebaseStateFn || detectRebaseState;

  return {
    async findStaleWorktrees(explicitSlug: string | null, rootDir: string): Promise<readonly StatusStaleWorktree[]> {
      if (explicitSlug) { return []; }

      return findStaleMissionWorktrees({
        gitRun,
        rootDir,
        missionStore: options.missionStore,
        repositoryId: options.repositoryId,
        primaryWorktree: options.primaryWorktree ?? null,
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
