/**
 * Integration context: every fact the preflight, recovery, and landing steps
 * read, gathered once — mission layout, base target, task metadata, review
 * provider state, and the integration checkout's branch and dirty entries.
 */
import { isDbAdhocIdentity } from '../../domain/mission.js';
import { baseTaskSlug } from './support.js';
import type { MissionStore } from '../domain-ports.js';
import type { IntegrateGitRunner, IntegrateWorkflowPorts } from '../ports/integrate-workflow.js';

export interface IntegrationContextOptions {
  baseBranch?: string | null;
  baseWorktree?: string | null;
  isForgejoReviewEnabledFn?: (_rootDir: string) => boolean;
  getCurrentBranchFn?: () => string;
  readTokenFn?: (_user: string) => string | null;
  getPrStatusFn?: Function;
  getLatestReviewDecisionFn?: Function;
  readReviewStateFn?: Function;
  missionStore?: MissionStore | null;
  gitFn?: IntegrateGitRunner;
}

export function createIntegrationContextBuilder(ports: IntegrateWorkflowPorts) {
  const { missionPaths, backlog, forgejo, landing } = ports;

  function resolveIntegrationBase(slug: string, baseBranch: string | null, baseWorktree: string | null) {
    let branch = baseBranch;
    if (!branch) {
      try { branch = missionPaths.resolveMissionBaseBranch(slug, process.cwd()); } catch { branch = missionPaths.getPrimaryBranch(); }
    }
    let worktree = baseWorktree;
    if (!worktree) {
      try { worktree = missionPaths.resolveBaseWorktree(slug, { rootDir: process.cwd() }); } catch { worktree = missionPaths.getPrimaryWorktree(); }
    }
    return { branch, worktree };
  }

  async function forgejoContext(enabled: boolean, taskAssignee: string | null, slug: string, branch: string, integrationRoot: string, reviewState: any, readTokenFn: Function, getPrStatusFn: Function, getLatestReviewDecisionFn: Function) {
    const absent = { forgejoIdentity: { forgejoUser: null, warning: null }, forgejoToken: null, configuredReviewer: null, pr: { exists: false }, siblingPrs: [] as any[], approval: { ok: false, error: 'forgejo-off', reviewState: null } };
    if (!enabled) { return absent; }
    const forgejoIdentity = landing.resolveForgejoUserForIntegration(taskAssignee);
    const forgejoToken = readTokenFn(forgejoIdentity.forgejoUser || 'default');
    // Recovery authority is the reviewer from the persisted current round, not
    // the task assignee. Pass the Mission store because the production reader
    // otherwise cannot resolve that authoritative review state.
    const configuredReviewer = reviewState?.reviewer ? ports.review.resolveForgejoUser(reviewState.reviewer) : null;
    let pr = getPrStatusFn(branch, process.cwd(), { forgejoUser: forgejoIdentity.forgejoUser, token: forgejoToken });
    if (pr.exists && pr.merged === true) { pr = { ...pr, state: 'merged' }; }
    const siblingPrs = pr.exists && slug && forgejoToken
      ? forgejo.listOpenPrsForSlug(baseTaskSlug(slug), forgejoToken).filter((candidate: any) => candidate.head !== branch)
      : [];
    const approval = pr.exists
      ? getLatestReviewDecisionFn(branch, { forgejoUser: forgejoIdentity.forgejoUser, token: forgejoToken, reviewerUser: configuredReviewer, sinceIso: reviewState?.startedAt })
      : { ok: false, error: 'pr-missing', reviewState: undefined };
    return { forgejoIdentity, forgejoToken, configuredReviewer, pr, siblingPrs, approval };
  }

  async function buildIntegrationContext(slug: string, {
    baseBranch = null,
    baseWorktree = null,
    isForgejoReviewEnabledFn = ports.productConfig.isForgejoReviewEnabled,
    getCurrentBranchFn = ports.git.getCurrentBranch,
    readTokenFn = forgejo.readToken,
    getPrStatusFn = forgejo.getPrStatus,
    getLatestReviewDecisionFn = forgejo.getLatestReviewDecision,
    readReviewStateFn = ports.review.readReviewState,
    missionStore = null,
    gitFn = ports.git.git,
  }: IntegrationContextOptions = {}) {
    if (!slug) {
      throw new Error('buildIntegrationContext requires a non-null mission slug.');
    }
    const branch = `mission/${slug}`;
    const currentBranch = getCurrentBranchFn();
    const missionDir = missionPaths.findMissionDir(slug);
    const area = missionDir ? missionPaths.findMissionArea(missionDir) : 'all';

    const { branch: resolvedBaseBranch, worktree: resolvedBaseWorktree } = resolveIntegrationBase(slug, baseBranch, baseWorktree);
    const integrationRoot = resolvedBaseWorktree as string;
    // The mission branch owns the task payload that is about to be integrated.
    // Read task metadata there so integration remains independent of uncommitted
    // or stale files in the primary checkout.
    const missionWorktree = missionPaths.resolveWorktree(slug, { cwd: process.cwd() }) || resolvedBaseWorktree || process.cwd();
    const task = isDbAdhocIdentity(slug)
      ? { ok: false, matches: [], reason: 'adhoc mission has no Backlog task' }
      : backlog.resolveTaskFile(slug, missionWorktree);
    const taskAssignee = task.ok ? backlog.getTaskAssignee(task.taskFile as string) : null;
    const forgejoEnabled = isForgejoReviewEnabledFn(integrationRoot);

    // Lightweight integration-context consumers that have Forgejo disabled do
    // not compose the review reader. Production composition always does; keep
    // the former context-only path compatible while a rebound simply receives
    // an empty state when no review authority is available.
    const reviewState = typeof readReviewStateFn === 'function'
      ? await Promise.resolve(readReviewStateFn(slug, integrationRoot, missionStore))
      : null;
    const forgejoState = await forgejoContext(forgejoEnabled, taskAssignee, slug, branch, integrationRoot, reviewState, readTokenFn, getPrStatusFn, getLatestReviewDecisionFn);
    const approval = !forgejoEnabled || forgejoState.approval.ok
      ? forgejoState.approval
      : reviewState?.phase === 'approved' && reviewState.disposition === 'APPROVED'
        ? { ok: true, reviewState: 'APPROVED', source: 'local-review-state' }
        : forgejoState.approval;

    const mainBranch = gitFn(['-C', integrationRoot, 'branch', '--show-current']).stdout.trim();
    const mainStatus = gitFn(['-C', integrationRoot, 'status', '--short']).stdout.trim();

    return {
      slug,
      branch,
      currentBranch,
      missionDir,
      area,
      task,
      reviewState,
      missionWorktree,
      missionStatus: undefined as string | undefined,
      promoteBacklogOnCloseout: false,
      taskAssignee,
      forgejoUser: forgejoState.forgejoIdentity.forgejoUser,
      forgejoToken: forgejoState.forgejoToken,
      // The login whose provider APPROVED counts as the reviewer's.
      configuredReviewer: forgejoState.configuredReviewer,
      taskAssigneeWarning: forgejoState.forgejoIdentity.warning,
      pr: forgejoState.pr,
      siblingPrs: forgejoState.siblingPrs,
      approval,
      baseBranch: resolvedBaseBranch,
      baseWorktree: resolvedBaseWorktree,
      mainBranch,
      mainDirtyEntries: mainStatus.length > 0 ? mainStatus.split('\n').filter(Boolean) : [],
      mainDirty: mainStatus.length > 0,
    };
  }

  return { buildIntegrationContext };
}
