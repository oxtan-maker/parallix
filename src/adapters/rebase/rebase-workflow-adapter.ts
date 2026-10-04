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
import { transitionReviewRepair } from '../../application/review-repair-lifecycle.js';
import { describeBranchMove, recordBranchMove } from '../../application/approval-coverage.js';
import { createGitChangeIdentity } from '../git/change-identity.js';
import { missionId } from '../../domain/mission.js';
import { agentFamily } from '../../domain/agents.js';
import { ConfiguredReviewerEligibility } from '../../domain/review.js';
import { CONFIG_PATH } from '../agents/agent-config.js';

/** Legacy `*Fn` seam accepted by `px rebase` and by its tests. */
export interface RebaseCommandOptions {
  inferSlugFn?: Function;
  findMissionDirFn?: Function;
  findMissionAreaFn?: Function;
  getCurrentBranchFn?: Function;
  resolveConflictsFn?: Function;
  startAgentFn?: Function;
  createPrFn?: Function;
  readTokenFn?: Function;
  resolveForgejoUserFn?: Function;
  resolveTaskFileFn?: Function;
  getTaskImplementerFn?: Function;
  resolveReviewIdentityFn?: Function;
  detectRebaseStateFn?: Function;
  resolveMissionBaseBranchFn?: Function;
  resolveWorktreeFn?: Function;
  gitFn?: Function;
  exitFn?: (_code: number) => void;
  isForgejoReviewEnabledFn?: Function;
  fetchReviewBranchFn?: Function;
  missionServicesFn?: Function;
}

const defaultExit = (code: number) => process.exit(code);

/** Build the shared-file conflict-resolution prompt with the real mission resolvers. */
export function buildRebasePrompt({ slug, area, worktreePath, missionSpecificFiles, sharedFiles, gitFn = undefined as Function | undefined }: {
  slug: string; area: string; worktreePath: string; missionSpecificFiles: string[]; sharedFiles: string[]; gitFn?: Function;
}): string {
  return buildRebasePromptPolicy({
    slug,
    area,
    worktreePath,
    missionSpecificFiles,
    sharedFiles,
    resolveBaseBranch: (promptSlug, promptRoot) => resolvePromptBaseBranch(promptSlug, promptRoot, gitFn as GitRunner | undefined),
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
      return getPrimaryBranch(worktreePath, gitFn as Function);
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
export function createRebaseWorkflowPort(options: RebaseCommandOptions = {}): RebaseWorkflowPort {
  const {
    inferSlugFn = inferSlug,
    findMissionDirFn = findMissionDir,
    findMissionAreaFn = findMissionArea,
    getCurrentBranchFn = getCurrentBranch,
    resolveConflictsFn = (integrate as any).resolveConflictsForMission,
    startAgentFn = startAgent,
    createPrFn = createPr,
    readTokenFn = readToken,
    resolveForgejoUserFn = resolveForgejoUser,
    resolveTaskFileFn = resolveTaskFile,
    getTaskImplementerFn = getTaskImplementer,
    resolveReviewIdentityFn = resolveReviewIdentity,
    detectRebaseStateFn = detectRebaseState,
    resolveMissionBaseBranchFn = resolveMissionBaseBranch,
    resolveWorktreeFn = resolveWorktree,
    gitFn = git,
    exitFn = defaultExit as (_code: number) => void,
    isForgejoReviewEnabledFn = isForgejoReviewEnabled,
    fetchReviewBranchFn = fetchReviewBranch,
    missionServicesFn,
  } = options;

  return {
    git: gitFn as GitRunner,
    detectRebaseState: detectRebaseStateFn as RebaseWorkflowPort['detectRebaseState'],
    getCurrentBranch: getCurrentBranchFn as RebaseWorkflowPort['getCurrentBranch'],

    cwd: () => process.cwd(),
    inferSlug: inferSlugFn as RebaseWorkflowPort['inferSlug'],
    findMissionDir: findMissionDirFn as RebaseWorkflowPort['findMissionDir'],
    findMissionArea: findMissionAreaFn as RebaseWorkflowPort['findMissionArea'],
    resolveWorktree: resolveWorktreeFn as RebaseWorkflowPort['resolveWorktree'],
    conventionalWorktreePath,
    missionBranchName,
    resolveMissionBaseBranch: resolveMissionBaseBranchFn as RebaseWorkflowPort['resolveMissionBaseBranch'],
    missionConflictPathPrefix,
    resolvePromptBaseBranch,

    startAgent: startAgentFn as RebaseWorkflowPort['startAgent'],
    selectAgent: selectAgent as unknown as RebaseWorkflowPort['selectAgent'],
    workflowLauncherStatus: workflowLauncherStatus as unknown as RebaseWorkflowPort['workflowLauncherStatus'],
    applyAgentFallback: applyAgentFallback as unknown as RebaseWorkflowPort['applyAgentFallback'],

    createPr: createPrFn as unknown as RebaseWorkflowPort['createPr'],
    readToken: readTokenFn as unknown as RebaseWorkflowPort['readToken'],
    resolveForgejoUser: resolveForgejoUserFn as unknown as RebaseWorkflowPort['resolveForgejoUser'],
    fetchReviewBranch: fetchReviewBranchFn as unknown as RebaseWorkflowPort['fetchReviewBranch'],

    resolveTaskFile: resolveTaskFileFn as unknown as RebaseWorkflowPort['resolveTaskFile'],
    getTaskImplementer: getTaskImplementerFn as unknown as RebaseWorkflowPort['getTaskImplementer'],
    transitionTask: async (slug, status, transitionOptions) => {
      if (missionServicesFn && status === 'active') {
        const root = (transitionOptions?.rootDir as string) || process.cwd();
        const services = await missionServicesFn(root);
        const loaded = await services.store.load(missionId(slug));
        if (loaded.kind !== 'found') { throw new Error(`Mission ${slug} is unavailable for rebase repair`); }
        // Integration rebase repair is part of integration completion.
        if (loaded.mission.status === 'integration') {
          return transitionTask(slug, 'ready-for-integration', transitionOptions as any);
        }
        const implementer = loaded.mission.assignee ?? loaded.mission.review?.rounds.at(-1)?.implementer;
        if (!implementer) { throw new Error(`Mission ${slug} has no implementer for rebase repair`); }
        await transitionReviewRepair(slug, 'active', implementer, services.store, services.lifecycle, undefined, { kind: 'rebase-repair' });
      }
      return transitionTask(slug, status, transitionOptions as any);
    },
    resumeReviewAfterRepair: async (slug, root, implementer) => {
      if (!missionServicesFn) { return; }
      const services = await missionServicesFn(root);
      const loaded = await services.store.load(missionId(slug));
      if (loaded.kind !== 'found') { throw new Error(`Mission ${slug} is unavailable after rebase repair`); }
      if (loaded.mission.status === 'active' && loaded.mission.review && !loaded.mission.review.rounds.at(-1)?.decision) {
        // AC12: reviewer eligibility always comes from the configured review step
        // of THIS mission's worktree, never from the prior round's reviewer.
        const reviewerEligibility = ConfiguredReviewerEligibility.fromReviewStep({
          eligible: eligibleAgentsForStep('review', { configPath: path.join(root, CONFIG_PATH) }).map(agentFamily),
          strategy: 'random',
        });
        await transitionReviewRepair(slug, 'review', implementer, services.store, services.lifecycle, reviewerEligibility);
        await transitionTask(slug, 'review', { rootDir: root });
      }
    },

    recordBranchMove: missionServicesFn ? async (slug, root, movedFrom) => {
      const head = (gitFn as GitRunner)(['-C', root, 'rev-parse', 'HEAD']);
      const landedRevision = head.status === 0 ? head.stdout.trim() : '';
      if (!landedRevision || landedRevision === movedFrom) { return null; }
      try {
        const services = await missionServicesFn(root);
        return describeBranchMove(slug, await recordBranchMove({
          store: services.store, slug, identity: createGitChangeIdentity(root, gitFn as GitRunner),
          landedRevision, movedFrom, recordedBy: 'px rebase', occurredAt: new Date().toISOString(),
        }));
      } catch (error) {
        // The rebase itself succeeded; px status still computes the staleness.
        return `The rebase moved ${slug}, but whether its approval still covers the branch was not recorded: ${error instanceof Error ? error.message : String(error)}`;
      }
    } : undefined,

    resolveReviewIdentity: resolveReviewIdentityFn as unknown as RebaseWorkflowPort['resolveReviewIdentity'],
    readReviewState,
    writeReviewState,
    persistReviewState: (slug, state, worktree, missionStore) =>
      persistReviewStateOrThrow(writeReviewState as any, slug, state as any, worktree, missionStore as any),

    isForgejoReviewEnabled: isForgejoReviewEnabledFn as RebaseWorkflowPort['isForgejoReviewEnabled'],

    formatVerificationCommand,

    resolveConflictsForMission: resolveConflictsFn as unknown as RebaseWorkflowPort['resolveConflictsForMission'],

    missionServices: typeof missionServicesFn === 'function'
      ? missionServicesFn as (_root: string) => Promise<{ store: unknown }>
      : null,
    // No hook-bounce seam: `runRebaseWorkflow` bounces hook failures through the
    // rebound kernel (TASK-2377.05), using the `startAgent` port above.
    exit: exitFn,
  };
}
