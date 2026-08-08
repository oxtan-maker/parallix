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
import * as fmt from '../../../application/presentation/cli-format.js';

// architecture invariant / architecture invariant — projection wiring (dynamic imports for CJS rollback compat)
// These modules are not in the dist/ CJS bundle, so they are loaded lazily.
import type { BoardProjectionBuilder } from '../../../application/projections/board-readers.js';
import type {
  AgentBlocklistRepository,
} from '../../../application/ports/agent-blocklist.js';
import type { OperationalHistoryRepository, BoardLaneEventRepository } from '../../../application/ports/operation-history.js';
import type { UsageRepository } from '../../../application/ports/mission-measurements.js';

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
// Projection access is injected by the production composition root.
// ---------------------------------------------------------------------------

/**
 * Build a lightweight SQLite adapter set for projection reading.
 *
 * Test/rollback helper for callers that do not have operator-state
 * capabilities. Production always injects `buildProjectionFn` from
 * `src/composition/create-cli.ts`.
 */
async function createProjectionDeps(rootDir: string, servicesFn?: Function): Promise<{
  builder: BoardProjectionBuilder | null;
  rootDir: string;
  blocklistRepo: AgentBlocklistRepository;
  historyRepo: OperationalHistoryRepository;
  laneEventRepo: BoardLaneEventRepository;
  usageRepo: UsageRepository;
}> {
  try {
    const services = typeof servicesFn === 'function' ? await servicesFn(rootDir) : null;
    if (services.presentationCapabilities) {
      return {
        builder: services.presentationCapabilities.boardProjection,
        rootDir,
        blocklistRepo: services.operatorState.repositories!.agentBlocklist,
        historyRepo: services.operatorState.repositories!.operationalHistory,
        laneEventRepo: services.operatorState.repositories!.boardLaneEvents,
        usageRepo: services.operatorState.repositories!.usage,
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
    async findByRepositoryId() { return []; },
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
    builder: null,
    rootDir,
    blocklistRepo: emptyBlocklist,
    historyRepo: emptyHistory,
    laneEventRepo: emptyLaneEvents,
    usageRepo: emptyUsage,
  };
}

/** Build BoardProjectionBuilder from production concrete adapters (architecture invariant). */
async function buildProjectionBuilder(rootDir: string): Promise<BoardProjectionBuilder> {
  const composed = await createProjectionDeps(rootDir);
  if (composed.builder) { return composed.builder; }
  throw new Error('status projection builder is not configured');
}

/** @param {string[]} args @param {{exit?: Function, log?: Function, inferSlugFn?: Function, getCurrentBranchFn?: Function, findTaskFileFn?: Function, getTaskStatusFn?: Function, findMissionDirFn?: Function, findCheckpointsFn?: Function, getFirstLineFn?: Function, getPrStatusFn?: Function, findStaleMissionWorktreesFn?: Function, readAgentConfigOrExitFn?: Function, eligibleAgentsForStepFn?: Function, allWorkflowAgentNamesFn?: Function, workflowLauncherStatusFn?: Function, getLastThreeCommitsFn?: Function, getUncommittedCountFn?: Function, detectRebaseStateFn?: Function, buildProjectionFn?: Function}} opts */
async function status(args: string[], opts: {exit?: Function, log?: Function, inferSlugFn?: Function, getCurrentBranchFn?: Function, findTaskFileFn?: Function, getTaskStatusFn?: Function, findMissionDirFn?: Function, findCheckpointsFn?: Function, getFirstLineFn?: Function, getPrStatusFn?: Function, findStaleMissionWorktreesFn?: Function, readAgentConfigOrExitFn?: Function, eligibleAgentsForStepFn?: Function, allWorkflowAgentNamesFn?: Function, workflowLauncherStatusFn?: Function, getLastThreeCommitsFn?: Function, getUncommittedCountFn?: Function, detectRebaseStateFn?: Function, buildProjectionFn?: Function}) {
  const exit = opts.exit || process.exit;
  const log = opts.log || fmt.log.plain;
  const inferSlugFn = opts.inferSlugFn || inferSlug;
  const getCurrentBranchFn = opts.getCurrentBranchFn || getCurrentBranch;
  // findTaskFileFn/getTaskStatusFn/findMissionDirFn/findCheckpointsFn/getFirstLineFn
  // remain on the options type for existing callers, but the architecture migration cutover
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
    // architecture invariant — route mission-specific output through the BoardProjectionBuilder.
    // The projection is the single materialization path; parse primitives are
    // called internally by the concrete adapters, not directly here.
    const projection: Awaited<ReturnType<BoardProjectionBuilder['build']>> | null =
      await buildProjectionFn(process.cwd()).then(
        (builder: BoardProjectionBuilder) => builder.build(),
      ).catch(() => null);

    // architecture invariant: do not fall back to legacy file reads (task frontmatter,
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
        // The review loop's own state, so an agent never has to open a
        // mission-directory file to learn which round or phase it is in.
        if (card.reviewPhase) {
          const disposition = card.reviewDisposition ?? 'none';
          log(`Review: round ${card.reviewRound ?? 1}, phase ${card.reviewPhase}, disposition ${disposition}`);
          // Prior rounds, so a reviewer that did not review the last round —
          // after a usage block reroutes the launch to another agent family —
          // still sees the settled verdicts and the implementer's pushbacks.
          for (const round of card.reviewHistory) {
            log(`  Round ${round.number} [${round.reviewer} -> ${round.implementer}]: ${round.disposition ?? 'pending'}`);
            if (round.comment) { log(`    comment: ${round.comment}`); }
            for (const summary of round.findingSummaries) { log(`    finding: ${summary}`); }
            for (const fix of round.fixes) { log(`    fixed: ${fix}`); }
            for (const pushback of round.pushbacks) { log(`    pushback: ${pushback}`); }
          }
        } else {
          log('Review: not started');
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
