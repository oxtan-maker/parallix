import { detectRebaseState, getCurrentBranch, getUncommittedCount, getLastThreeCommits, run } from '../core/git.js';
import { findTaskFile, getTaskStatus } from '../tools/backlog.js';
import {
  getPrimaryWorktree,
  inferSlug,
  missionBranchName,
  missionBranchPrefix,
} from '../core/mission-utils.js';
import { WORKFLOW_AGENT_NAMES, eligibleAgentsForStep, readAgentConfigOrExit, workflowLauncherStatus } from '../agents/agents.js';
import { getPrStatus } from '../tools/forgejo.js';
import * as fmt from '../core/fmt.js';

// SC8 / SC9 — projection wiring (dynamic imports for CJS rollback compat)
// These modules are not in the dist/ CJS bundle, so they are loaded lazily.
import type { BoardProjectionBuilder } from '../../../../application/projections/board-readers.js';
import type {
  AgentBlocklistRepository,
  OperationalHistoryRepository,
  BoardLaneEventRepository,
  UsageRepository,
} from '../../../../adapters/sqlite/ports.js';

/** @param {string} porcelain */
function parseWorktreeList(porcelain: string) {
  const entries = [];
  /** @type{{path: string, branch: string | null} | null} */
  let current: { path: string; branch: string | null } | null = null;

  for (const line of porcelain.split('\n')) {
    if (!line.trim()) {
      if (current) {
        entries.push(current);
        current = null;
      }
      continue;
    }

    if (line.startsWith('worktree ')) {
      if (current) {entries.push(current);}
      current = { path: line.slice('worktree '.length).trim(), branch: null };
      continue;
    }

    if (line.startsWith('branch ') && current) {
      current.branch = line.slice('branch '.length).trim() as string;
    }
  }

  if (current) {entries.push(current);}
  return entries;
}

function findStaleMissionWorktrees({
  gitRun = run,
  findTaskFileFn = findTaskFile,
  getTaskStatusFn = getTaskStatus,
  primaryWorktree = null
} = {}) {
  const result = gitRun('git', ['worktree', 'list', '--porcelain']);
  if (result.status !== 0) {
    return [];
  }

  /** @type {string | null} */
  let resolvedPrimary: string | null = primaryWorktree;
  if (!resolvedPrimary) {
    try {
      resolvedPrimary = getPrimaryWorktree();
    } catch (_) {
      resolvedPrimary = null;
    }
  }

  return parseWorktreeList(result.stdout)
    .filter(entry => entry.path !== resolvedPrimary)
    .map(entry => {
      const branchRef = entry.branch || '';
      const prefix = missionBranchPrefix(resolvedPrimary || process.cwd());
      const normalizedRefPrefix = `refs/heads/${prefix}`;
      const match = branchRef.startsWith(normalizedRefPrefix)
        ? [branchRef, branchRef.slice(normalizedRefPrefix.length)]
        : null;
      if (!match) {return null;}

      const slug = match[1];
      const taskFile = findTaskFileFn(slug);
      const taskStatus = taskFile ? getTaskStatusFn(taskFile) : null;
      if (taskStatus !== 'done' && taskFile) {
        return null;
      }

      return {
        slug,
        path: entry.path,
        branch: branchRef,
        taskStatus: taskStatus || 'missing',
        cleanupCommand: taskStatus === 'done'
          ? `scripts/cleanup-mission-worktree.sh ${slug}`
          : `git worktree remove ${entry.path} && git branch -D ${missionBranchName(slug, resolvedPrimary || process.cwd())}`
      };
    })
    .filter(Boolean);
}

/** @param {string} ref */
function formatWorktreeBranch(ref: string) {
  if (!ref) {return '(detached HEAD)';}
  return ref.replace(/^refs\/heads\//, '');
}

/** @param {Function} log @param {string} label @param {{detached?: boolean, unmergedFiles: string[]}} rebaseState */
function logRebaseDiagnostics(log: Function, label: string, rebaseState: {detached?: boolean, unmergedFiles: string[]}) {
  const detachedText = rebaseState.detached ? 'detached HEAD, ' : '';
  log(`${label}: ${detachedText}${rebaseState.unmergedFiles.length} unmerged file(s)`);
  rebaseState.unmergedFiles.forEach(file => {
    log(`  - ${file}`);
  });
}

// ---------------------------------------------------------------------------
// SC8 — Composition root: build BoardProjectionBuilder over concrete adapters
// ---------------------------------------------------------------------------

/**
 * Build a lightweight SQLite adapter set for projection reading.
 *
 * Resolves repositories from the production composition root rather than
 * opening SQLite independently. Falls back to empty repos when SQLite is
 * unavailable (CJS rollback bundle, missing modules, or database failure).
 *
 * Uses dynamic imports for CJS rollback bundle compatibility.
 */
async function createProjectionDeps(rootDir: string): Promise<{
  rootDir: string;
  blocklistRepo: AgentBlocklistRepository;
  historyRepo: OperationalHistoryRepository;
  laneEventRepo: BoardLaneEventRepository;
  usageRepo: UsageRepository;
}> {
  try {
    const { createProductionApplicationServices } = await import(
      '../composition/application-services.js'
    );

    const services = await createProductionApplicationServices(rootDir);
    const repos = services.operatorState.repositories;
    if (repos) {
      // Real repositories from the composition root
      return {
        rootDir,
        blocklistRepo: repos.agentBlocklist,
        historyRepo: repos.operationalHistory,
        laneEventRepo: repos.boardLaneEvents,
        usageRepo: repos.usage,
      };
    }
  } catch {
    // Adapter unavailable — fall through to empty fallbacks
  }

  // Empty fallbacks when SQLite is not available
  const emptyBlocklist: AgentBlocklistRepository = {
    async findAll() { return []; },
    async findByAgent() { return undefined; },
    async save() {},
    async deleteByAgent() {},
    async clear() {},
  };
  const emptyHistory: OperationalHistoryRepository = {
    async findAll() { return []; },
    async findByType() { return []; },
    async append() {},
    async clear() {},
  };
  const emptyLaneEvents: BoardLaneEventRepository = {
    async append() { return false; },
    async findByMissionId() { return []; },
    async findAll() { return []; },
    async clear() {},
  };
  const emptyUsage: UsageRepository = {
    async findAll() { return []; },
    async findWhere() { return []; },
    async save() {},
    async saveAll() {},
    async clear() {},
  };

  return {
    rootDir,
    blocklistRepo: emptyBlocklist,
    historyRepo: emptyHistory,
    laneEventRepo: emptyLaneEvents,
    usageRepo: emptyUsage,
  };
}

/** Build BoardProjectionBuilder from production concrete adapters (SC8). */
async function buildProjectionBuilder(rootDir: string): Promise<BoardProjectionBuilder> {
  const deps = await createProjectionDeps(rootDir);
  const { createBoardProjectionBuilder } = await import('../../../../application/projections/create-board-projection-builder.js');
  const { repositoryId } = await import('../../../../domain/repository.js');
  const { agentFamily } = await import('../../../../domain/agents.js');
  return createBoardProjectionBuilder({
    rootDir,
    repositoryId: repositoryId(rootDir),
    blocklistRepo: deps.blocklistRepo,
    historyRepo: deps.historyRepo,
    laneEventRepo: deps.laneEventRepo,
    usageRepo: deps.usageRepo,
    knownAgentFamilies: WORKFLOW_AGENT_NAMES.map((name: string) => agentFamily(name)),
  });
}

/** @param {string[]} args @param {{exit?: Function, log?: Function, inferSlugFn?: Function, getCurrentBranchFn?: Function, findTaskFileFn?: Function, getTaskStatusFn?: Function, findMissionDirFn?: Function, findCheckpointsFn?: Function, getFirstLineFn?: Function, getPrStatusFn?: Function, findStaleMissionWorktreesFn?: Function, readAgentConfigOrExitFn?: Function, eligibleAgentsForStepFn?: Function, allWorkflowAgentNamesFn?: Function, workflowLauncherStatusFn?: Function, getLastThreeCommitsFn?: Function, getUncommittedCountFn?: Function, detectRebaseStateFn?: Function, buildProjectionFn?: Function}} opts */
async function status(args: string[], opts: {exit?: Function, log?: Function, inferSlugFn?: Function, getCurrentBranchFn?: Function, findTaskFileFn?: Function, getTaskStatusFn?: Function, findMissionDirFn?: Function, findCheckpointsFn?: Function, getFirstLineFn?: Function, getPrStatusFn?: Function, findStaleMissionWorktreesFn?: Function, readAgentConfigOrExitFn?: Function, eligibleAgentsForStepFn?: Function, allWorkflowAgentNamesFn?: Function, workflowLauncherStatusFn?: Function, getLastThreeCommitsFn?: Function, getUncommittedCountFn?: Function, detectRebaseStateFn?: Function, buildProjectionFn?: Function}) {
  const exit = opts.exit || process.exit;
  const log = opts.log || fmt.log.plain;
  const inferSlugFn = opts.inferSlugFn || inferSlug;
  const getCurrentBranchFn = opts.getCurrentBranchFn || getCurrentBranch;
  // findTaskFileFn/getTaskStatusFn/findMissionDirFn/findCheckpointsFn/getFirstLineFn
  // remain on the options type for existing callers, but the TASK-2322.07 cutover
  // reads Mission state from SqliteMissionStore, so status no longer resolves the
  // legacy task/checkpoint files.
  const getPrStatusFn = opts.getPrStatusFn || getPrStatus;
  const findStaleMissionWorktreesFn = opts.findStaleMissionWorktreesFn || findStaleMissionWorktrees;
  const readAgentConfigOrExitFn = opts.readAgentConfigOrExitFn || readAgentConfigOrExit;
  const eligibleAgentsForStepFn = opts.eligibleAgentsForStepFn || eligibleAgentsForStep;
  const allWorkflowAgentNamesFn = opts.allWorkflowAgentNamesFn || (() => WORKFLOW_AGENT_NAMES);
  const workflowLauncherStatusFn = opts.workflowLauncherStatusFn || workflowLauncherStatus;
  const getLastThreeCommitsFn = opts.getLastThreeCommitsFn || getLastThreeCommits;
  const getUncommittedCountFn = opts.getUncommittedCountFn || getUncommittedCount;
  const detectRebaseStateFn = opts.detectRebaseStateFn || detectRebaseState;
  const buildProjectionFn = opts.buildProjectionFn || buildProjectionBuilder;

  const explicitSlug = args[0];
  const slug = inferSlugFn(explicitSlug);

  log(fmt.bold('--- Mission Status ---'));
  log(`Branch: ${fmt.branch(getCurrentBranchFn())}`);
  log(`Worktree: ${fmt.path(process.cwd())}`);

  try {
    const rebaseState = detectRebaseStateFn(process.cwd());
    if (rebaseState.inProgress && rebaseState.detached) {
      logRebaseDiagnostics(log, 'Detached HEAD: rebase in progress', rebaseState);
    }
  } catch (_) {
    // Ignore transient worktree/git-state failures in status output.
  }

  if (slug) {
    // SC9 — route mission-specific output through the BoardProjectionBuilder.
    // The projection is the single materialization path; parse primitives are
    // called internally by the concrete adapters, not directly here.
    const projection: Awaited<ReturnType<BoardProjectionBuilder['build']>> | null =
      await buildProjectionFn(process.cwd()).then(
        (builder: BoardProjectionBuilder) => builder.build(),
      ).catch(() => null);

    // SC3: do not fall back to legacy file reads (task frontmatter,
    // CP-N.md) for Mission domain state — the SQLite store is the sole
    // authority. When the projection is unavailable, report that directly.
    function logSqliteFallback() {
      log(`Backlog status: unknown (projection unavailable)`);
      log('Last checkpoint: none');
    }

    if (projection) {
      const card = projection.stages.flatMap((s) => s.cards).find(
        (c) => c.id.toLowerCase() === slug.toLowerCase(),
      );
      if (card) {
        log(`Backlog status: ${card.rawStatus ?? card.status}`);
        if (card.checkpoint) {
          log(`Last checkpoint: ${card.checkpoint} - ${card.checkpointDescription || ''}`);
        } else {
          log('Last checkpoint: none');
        }
      } else {
        logSqliteFallback();
      }
    } else {
      logSqliteFallback();
    }

    // Forgejo PR state
    const pr = getPrStatusFn(missionBranchName(slug));
    if (pr.exists) {
      log(`Forgejo PR: #${pr.number} (${pr.state})`);
    } else if (pr.raw) {
      log(`Forgejo PR: unavailable (${pr.raw})`);
    } else {
      log('Forgejo PR: none');
    }
  }

  if (!explicitSlug) {
    const staleWorktrees = findStaleMissionWorktreesFn();
    staleWorktrees.forEach((entry: { path: string; branch: string | null; taskStatus: string | null; cleanupCommand?: string }) => {
      log(`Stale worktree: ${fmt.path(entry.path)} (task: ${entry.taskStatus})`);
      try {
        const rebaseState = detectRebaseStateFn(entry.path);
        if (rebaseState.inProgress) {
          logRebaseDiagnostics(log, `Rebase in progress on ${formatWorktreeBranch(entry.branch || '')}`, rebaseState);
        }
      } catch (_) {
        // Ignore stale worktrees that disappear during inspection.
      }
      log(`  Cleanup: ${fmt.command(entry.cleanupCommand || '')}`);
    });
  }

  // Agent eligibility matrix
  const config = readAgentConfigOrExitFn();
  const draftEligible = eligibleAgentsForStepFn('draft', { config });
  const activeEligible = eligibleAgentsForStepFn('active', { config });
  const baseAgents = allWorkflowAgentNamesFn();
  const allAgents = [...new Set([...baseAgents, ...draftEligible, ...activeEligible])].sort();
  const envOverride = process.env.WORKFLOW_AGENT;
  log('Agent launcher matrix:');
  for (const agent of allAgents) {
    const launcher = workflowLauncherStatusFn(agent);
    const support = launcher.supported ? 'supported' : 'blocked';
    const draftMark = draftEligible.includes(agent) ? 'draft' : '-';
    const activeMark = activeEligible.includes(agent) ? 'active' : '-';
    log(`  ${fmt.agent(agent)}: ${support} | eligible: ${draftMark},${activeMark}`);
  }
  if (envOverride) {
    log(`  (WORKFLOW_AGENT override: ${fmt.agent(envOverride)})`);
  }

  const lastThree = getLastThreeCommitsFn();
  log('Last 3 commits:');
  lastThree.forEach((c: string) => log(`  - ${c}`));

  log(`Uncommitted files: ${getUncommittedCountFn()}`);
  log(fmt.bold('----------------------'));
  exit(0);
}

(status as any).parseWorktreeList = parseWorktreeList;
(status as any).findStaleMissionWorktrees = findStaleMissionWorktrees;
(status as any).createProjectionDeps = createProjectionDeps;
(status as any).buildProjectionBuilder = buildProjectionBuilder;
export default status;
export { status, parseWorktreeList, findStaleMissionWorktrees, createProjectionDeps, buildProjectionBuilder };

// CJS compat: ensure require() returns the function directly
declare const module: { exports: any } | undefined;
if (typeof module !== 'undefined') { module.exports = status; }
