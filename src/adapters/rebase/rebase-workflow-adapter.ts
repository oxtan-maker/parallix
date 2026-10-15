import type { ParallixConfiguration } from '../../application/ports/configuration.js';
/**
 * Concrete `RebaseWorkflowPort` implementation (TASK-2332.12).
 *
 * This module is the single place where the rebase workflow is bound to real
 * adapters (git, agents, forgejo, backlog, review, config, mission filesystem,
 * verification) and to the integrate conflict-resolution contract. The CLI
 * command adapter imports only this module plus the application use case, and
 * the composition root reaches the same port through the CLI interface.
 *
 * The legacy `*Fn` option seam is preserved verbatim so existing callers and
 * tests keep injecting the same doubles they always did.
 */
import path from 'node:path';
import { detectRebaseState, git, getCurrentBranch } from '../git/git.js';
import integrate from '../cli/commands/integrate.js';
import {
  findMissionDir, findMissionArea, inferSlug, resolveWorktree, conventionalWorktreePath,
  getPrimaryBranch, resolveMissionBaseBranch, missionBranchName, missionDirForSlug,
} from '../filesystem/mission-utils.js';
import { startAgent, selectAgent, workflowLauncherStatus, eligibleAgentsForStep } from '../agents/agents.js';
import { applyAgentFallback } from '../review/review-agent-fallback.js';
import { createPr, readToken, resolveForgejoUser, fetchReviewBranch } from '../forgejo/forgejo.js';
import { resolveTaskFile, getTaskImplementer, transitionTask } from '../backlog/backlog.js';
import { resolveReviewIdentity, readReviewState, writeReviewState, persistReviewStateOrThrow } from '../review/review-state.js';
import { isForgejoReviewEnabled } from '../config/product-config.js';
import { formatVerificationCommand } from '../verification/verification.js';
import { buildRebasePrompt as buildRebasePromptPolicy } from '../../application/rebase-workflow.js';
import type { GitRunner, RebaseWorkflowPort } from '../../application/ports/rebase-workflow.js';
import { transitionRebaseRepair, resumeRebaseReview } from '../../application/rebase-repair-lifecycle.js';
import { describeBranchMove, recordBranchMove } from '../../application/approval-coverage.js';
import { createGitChangeIdentity } from '../git/change-identity.js';
import { agentFamily } from '../../domain/agents.js';
import { ConfiguredReviewerEligibility } from '../../domain/review.js';
import { CONFIG_PATH } from '../agents/agent-config.js';

/** Legacy `*Fn` seam accepted by `px rebase` and by its tests. */
export interface RebaseCommandOptions {
  configuration?: ParallixConfiguration;
  inferSlugFn?: typeof inferSlug;
  findMissionDirFn?: typeof findMissionDir;
  findMissionAreaFn?: typeof findMissionArea;
  getCurrentBranchFn?: typeof getCurrentBranch;
  resolveConflictsFn?: (...args: Parameters<typeof integrate.resolveConflictsForMission>) => ReturnType<RebaseWorkflowPort['resolveConflictsForMission']>;
  startAgentFn?: (step: string, options: NonNullable<Parameters<typeof startAgent>[1]>) => ReturnType<RebaseWorkflowPort['startAgent']>;
  createPrFn?: typeof createPr;
  readTokenFn?: typeof readToken;
  resolveForgejoUserFn?: typeof resolveForgejoUser;
  resolveTaskFileFn?: typeof resolveTaskFile;
  getTaskImplementerFn?: typeof getTaskImplementer;
  resolveReviewIdentityFn?: typeof resolveReviewIdentity;
  detectRebaseStateFn?: (...args: Parameters<typeof detectRebaseState>) => ReturnType<RebaseWorkflowPort['detectRebaseState']>;
  resolveMissionBaseBranchFn?: typeof resolveMissionBaseBranch;
  resolveWorktreeFn?: typeof resolveWorktree;
  gitFn?: GitRunner;
  exitFn?: (_code: number) => void;
  isForgejoReviewEnabledFn?: typeof isForgejoReviewEnabled;
  fetchReviewBranchFn?: typeof fetchReviewBranch;
  missionServicesFn?: (_root: string) => Promise<import('../../application/ports/rebase-workflow.js').RebaseMissionServices>;
}

const defaultExit = (code: number) => process.exit(code);

/** Build the shared-file conflict-resolution prompt with the real mission resolvers. */
export function buildRebasePrompt({ slug, area, worktreePath, missionSpecificFiles, sharedFiles, gitFn = undefined as GitRunner | undefined }: {
  slug: string; area: string; worktreePath: string; missionSpecificFiles: string[]; sharedFiles: string[]; gitFn?: GitRunner;
}): string {
  return buildRebasePromptPolicy({
    slug,
    area,
    worktreePath,
    missionSpecificFiles,
    sharedFiles,
    resolveBaseBranch: (promptSlug, promptRoot) => resolvePromptBaseBranch(promptSlug, promptRoot, gitFn),
    formatVerificationCommand,
  });
}

/**
 * Base branch shown in the conflict-resolution prompt. Never throws: a mission
 * without a recorded base falls back to the primary branch and then to `main`.
 */
function resolvePromptBaseBranch(slug: string, worktreePath: string, gitFn?: GitRunner): string {
  try {
    return resolveMissionBaseBranch(slug, worktreePath, { gitFn });
  } catch (_) {
    try {
      return getPrimaryBranch(worktreePath, gitFn);
    } catch (_e) {
      return 'main';
    }
  }
}

/**
 * Repository-relative prefix marking a conflicted path as mission-owned.
 * Resolved from the real mission layout (matching the pre-extraction command,
 * which did not route this lookup through the `findMissionDirFn` seam).
 */
function missionConflictPathPrefix(slug: string, worktreePath: string): string {
  const missionAbsDir = findMissionDir(slug, worktreePath);
  return missionAbsDir
    ? (path.relative(worktreePath, missionAbsDir) + '/')
    : path.relative(worktreePath, missionDirForSlug(worktreePath, slug)).split(path.sep).join('/') + '/';
}

/** Bind the rebase workflow to the concrete adapters, honoring the legacy seams. */
function rebaseWorkspaceBindings(options: RebaseCommandOptions) {
  const {
    inferSlugFn = inferSlug,
    findMissionDirFn = findMissionDir,
    findMissionAreaFn = findMissionArea,
    getCurrentBranchFn = getCurrentBranch,
    resolveConflictsFn = integrate.resolveConflictsForMission,
    startAgentFn = (step: string, launch: NonNullable<Parameters<typeof startAgent>[1]>) => startAgent(step, { ...launch, configuration: options.configuration }),
    createPrFn = (branch: string, user: string, token: string, opts: Record<string, unknown> = {}) => createPr(branch, user, token, { ...opts, configuration: options.configuration }),
    readTokenFn = (user: string) => readToken(user, undefined, options.configuration),
    resolveForgejoUserFn = (user?: string | null) => resolveForgejoUser(user, options.configuration),
    resolveTaskFileFn = resolveTaskFile,
  } = options;
  return { inferSlugFn, findMissionDirFn, findMissionAreaFn, getCurrentBranchFn, resolveConflictsFn, startAgentFn, createPrFn, readTokenFn, resolveForgejoUserFn, resolveTaskFileFn };
}

function rebaseRepairBindings(options: RebaseCommandOptions) {
  const {
    getTaskImplementerFn = getTaskImplementer,
    resolveReviewIdentityFn = resolveReviewIdentity,
    detectRebaseStateFn = detectRebaseState,
    resolveMissionBaseBranchFn = resolveMissionBaseBranch,
    resolveWorktreeFn = resolveWorktree,
    gitFn = git,
    exitFn = defaultExit,
    isForgejoReviewEnabledFn = isForgejoReviewEnabled,
    fetchReviewBranchFn = fetchReviewBranch,
    missionServicesFn,
  } = options;
  return { getTaskImplementerFn, resolveReviewIdentityFn, detectRebaseStateFn, resolveMissionBaseBranchFn, resolveWorktreeFn, gitFn, exitFn, isForgejoReviewEnabledFn, fetchReviewBranchFn, missionServicesFn };
}

export function createRebaseWorkflowPort(options: RebaseCommandOptions = {}): RebaseWorkflowPort {
  const { inferSlugFn, findMissionDirFn, findMissionAreaFn, getCurrentBranchFn, resolveConflictsFn, startAgentFn, createPrFn, readTokenFn, resolveForgejoUserFn, resolveTaskFileFn, getTaskImplementerFn, resolveReviewIdentityFn, detectRebaseStateFn, resolveMissionBaseBranchFn, resolveWorktreeFn, gitFn, exitFn, isForgejoReviewEnabledFn, fetchReviewBranchFn, missionServicesFn } = { ...rebaseWorkspaceBindings(options), ...rebaseRepairBindings(options) };

  const repairBindings = {
    missionServices: missionServicesFn,
    cwd: () => process.cwd(),
    transitionTask,
    reviewerEligibility: (root: string) => ConfiguredReviewerEligibility.fromReviewStep({
      eligible: eligibleAgentsForStep('review', { configPath: path.join(root, CONFIG_PATH) }).map(agentFamily),
      strategy: 'random',
    }),
  };

  return {
    git: gitFn,
    detectRebaseState: detectRebaseStateFn,
    getCurrentBranch: getCurrentBranchFn,

    cwd: () => process.cwd(),
    inferSlug: inferSlugFn,
    findMissionDir: findMissionDirFn,
    findMissionArea: findMissionAreaFn,
    resolveWorktree: resolveWorktreeFn,
    conventionalWorktreePath,
    missionBranchName,
    resolveMissionBaseBranch: resolveMissionBaseBranchFn,
    missionConflictPathPrefix,
    resolvePromptBaseBranch,

    startAgent: startAgentFn,
    selectAgent: (step, opts) => selectAgent(step, { ...opts, configuration: options.configuration }),
    workflowLauncherStatus: (agent, worktree) => workflowLauncherStatus(agent, worktree, options.configuration),
    applyAgentFallback: applyAgentFallback,

    createPr: createPrFn,
    readToken: readTokenFn,
    resolveForgejoUser: resolveForgejoUserFn,
    fetchReviewBranch: fetchReviewBranchFn,

    resolveTaskFile: resolveTaskFileFn,
    getTaskImplementer: getTaskImplementerFn,
    transitionTask: (slug, status, transitionOptions) => transitionRebaseRepair(slug, status, transitionOptions, repairBindings),
    resumeReviewAfterRepair: (slug, root, implementer) => resumeRebaseReview(slug, root, implementer, repairBindings),

    recordBranchMove: missionServicesFn ? (slug, root, movedFrom) => recordRebaseBranchMove(slug, root, movedFrom, gitFn, missionServicesFn) : undefined,

    resolveReviewIdentity: resolveReviewIdentityFn,
    readReviewState,
    writeReviewState,
    persistReviewState: (slug, state, worktree, missionStore) =>
      persistReviewStateOrThrow(writeReviewState, slug, state, worktree, missionStore),

    isForgejoReviewEnabled: isForgejoReviewEnabledFn,

    formatVerificationCommand,

    resolveConflictsForMission: resolveConflictsFn,

    missionServices: typeof missionServicesFn === 'function'
      ? missionServicesFn
      : null,
    // No hook-bounce seam: `runRebaseWorkflow` bounces hook failures through the
    // rebound kernel (TASK-2377.05), using the `startAgent` port above.
    exit: exitFn,
  };
}

async function recordRebaseBranchMove(slug: string, root: string, movedFrom: string | null, gitFn: GitRunner, missionServicesFn: NonNullable<RebaseCommandOptions['missionServicesFn']>) {

  const head = (gitFn)(['-C', root, 'rev-parse', 'HEAD']);
  const landedRevision = head.status === 0 ? head.stdout.trim() : '';
  if (!landedRevision || landedRevision === movedFrom) { return null; }
  try {
    const services = await missionServicesFn(root);
    return describeBranchMove(slug, await recordBranchMove({
      store: services.store, slug, identity: createGitChangeIdentity(root, gitFn),
      landedRevision, movedFrom, recordedBy: 'px rebase', occurredAt: new Date().toISOString(),
    }));
  } catch (error) {
    // The rebase itself succeeded; px status still computes the staleness.
    return `The rebase moved ${slug}, but whether its approval still covers the branch was not recorded: ${error instanceof Error ? error.message : String(error)}`;
  }

}
