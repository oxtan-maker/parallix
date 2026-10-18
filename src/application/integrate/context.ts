/**
 * Integration context: every fact the preflight, recovery, and landing steps
 * read, gathered once — mission layout, base target, task metadata, review
 * provider state, and the integration checkout's branch and dirty entries.
 */
import type { IntegrationReviewSnapshot, IntegrationPullRequest, IntegrationApproval, IntegrationMissionFacts } from '../ports/integration-records.js';
import { isDbAdhocIdentity } from '../../domain/mission.js';
import { baseTaskSlug } from './support.js';
import type { MissionStore } from '../domain-ports.js';
import type { IntegrateGitRunner, IntegrateWorkflowPorts } from '../ports/integrate-workflow.js';

export interface IntegrationContext extends IntegrationMissionFacts {
  slug: string; branch: string; currentBranch: string; missionDir: string | null; area: string;
  task: ReturnType<IntegrateWorkflowPorts['backlog']['resolveTaskFile']>;
  reviewState: IntegrationReviewSnapshot | null;
  missionWorktree: string;
  /** The checkout the operation runs from: the resolved mission worktree, else the working directory. */
  executionCheckout?: string;
  promoteBacklogOnCloseout: boolean; taskAssignee: string | null;
  taskStatus?: string;
  forgejoUser: string | null; forgejoToken: string | null; configuredReviewer: string | null; taskAssigneeWarning: string | null;
  pr: IntegrationPullRequest;
  siblingPrs: ReturnType<IntegrateWorkflowPorts['forgejo']['listOpenPrsForSlug']>;
  approval: IntegrationApproval;
  baseBranch: string; baseWorktree: string; mainBranch: string; mainDirtyEntries: string[]; mainDirty: boolean;
}

export interface IntegrationContextOptions {
  baseBranch?: string | null;
  baseWorktree?: string | null;
  /** An explicitly resolved mission checkout replaces the process working directory. */
  missionWorktree?: string | null;
  isForgejoReviewEnabledFn?: (_rootDir: string) => boolean;
  getCurrentBranchFn?: () => string;
  readTokenFn?: (_user: string) => string | null;
  getPrStatusFn?: IntegrateWorkflowPorts['forgejo']['getPrStatus'];
  getLatestReviewDecisionFn?: IntegrateWorkflowPorts['forgejo']['getLatestReviewDecision'];
  readReviewStateFn?: IntegrateWorkflowPorts['review']['readReviewState'];
  missionStore?: MissionStore | null;
  gitFn?: IntegrateGitRunner;
}

function composeIntegrationContextBuilderDependencies(ports: IntegrateWorkflowPorts) {

  const { missionPaths, backlog, forgejo, landing } = ports;
  return { ports, missionPaths, backlog, forgejo, landing };
}

export function createIntegrationContextBuilder(ports: IntegrateWorkflowPorts) {
  return new IntegrationContextBuilder(ports).surface();
}

class IntegrationContextBuilder {
  private readonly dependencies: ReturnType<typeof composeIntegrationContextBuilderDependencies>;
  constructor(ports: IntegrateWorkflowPorts) { this.dependencies = composeIntegrationContextBuilderDependencies(ports); }

  resolveIntegrationBase(slug: string, baseBranch: string | null, baseWorktree: string | null, checkout: string = process.cwd()) {
    let branch = baseBranch;
    if (!branch) {
      try { branch = this.dependencies.missionPaths.resolveMissionBaseBranch(slug, checkout); } catch { branch = this.dependencies.missionPaths.getPrimaryBranch(); }
    }
    let worktree = baseWorktree;
    if (!worktree) {
      try { worktree = this.dependencies.missionPaths.resolveBaseWorktree(slug, { rootDir: checkout }); } catch { worktree = this.dependencies.missionPaths.getPrimaryWorktree(); }
    }
    return { branch, worktree };
  }

  async forgejoContext(enabled: boolean, taskAssignee: string | null, slug: string, branch: string, integrationRoot: string, reviewState: IntegrationReviewSnapshot | null, readTokenFn: IntegrateWorkflowPorts['forgejo']['readToken'], getPrStatusFn: IntegrateWorkflowPorts['forgejo']['getPrStatus'], getLatestReviewDecisionFn: IntegrateWorkflowPorts['forgejo']['getLatestReviewDecision'], checkout: string = process.cwd()) {
    const absent = { forgejoIdentity: { forgejoUser: null, warning: null }, forgejoToken: null, configuredReviewer: null, pr: { exists: false } as IntegrationPullRequest, siblingPrs: [] as ReturnType<IntegrateWorkflowPorts['forgejo']['listOpenPrsForSlug']>, approval: { ok: false, error: 'forgejo-off', reviewState: null } };
    if (!enabled) { return absent; }
    const forgejoIdentity = this.dependencies.landing.resolveForgejoUserForIntegration(taskAssignee);
    const forgejoToken = readTokenFn(forgejoIdentity.forgejoUser || 'default');
    // Recovery authority is the reviewer from the persisted current round, not
    // the task assignee. Pass the Mission store because the production reader
    // otherwise cannot resolve that authoritative review state.
    const configuredReviewer = reviewState?.reviewer ? this.dependencies.ports.review.resolveForgejoUser(reviewState.reviewer) : null;
    let pr = getPrStatusFn(branch, checkout, { forgejoUser: forgejoIdentity.forgejoUser, token: forgejoToken });
    if (pr.exists && pr.merged === true) { pr = { ...pr, state: 'merged' }; }
    const siblingPrs = pr.exists && slug && forgejoToken
      ? this.dependencies.forgejo.listOpenPrsForSlug(baseTaskSlug(slug), forgejoToken).filter((candidate) => candidate.head !== branch)
      : [];
    const approval: IntegrationApproval = pr.exists
      ? getLatestReviewDecisionFn(branch, { forgejoUser: forgejoIdentity.forgejoUser, token: forgejoToken, reviewerUser: configuredReviewer, sinceIso: reviewState?.startedAt })
      : { ok: false, error: 'pr-missing', reviewState: undefined };
    return { forgejoIdentity, forgejoToken, configuredReviewer, pr, siblingPrs, approval };
  }

  inferMissionWorktree(slug: string, checkout: string, baseWorktree: string | null): string {
    return this.dependencies.missionPaths.resolveWorktree(slug, { cwd: checkout }) || baseWorktree || checkout;
  }

  private resolvedOptions(options: IntegrationContextOptions) {
    const {
    baseBranch = null,
    baseWorktree = null,
    missionWorktree = null,
    isForgejoReviewEnabledFn = this.dependencies.ports.productConfig.isForgejoReviewEnabled,
    getCurrentBranchFn = this.dependencies.ports.git.getCurrentBranch,
    readTokenFn = this.dependencies.forgejo.readToken,
    getPrStatusFn = this.dependencies.forgejo.getPrStatus,
    getLatestReviewDecisionFn = this.dependencies.forgejo.getLatestReviewDecision,
    readReviewStateFn = this.dependencies.ports.review.readReviewState,
    missionStore = null,
    gitFn = this.dependencies.ports.git.git,
  } = options;
    return { baseBranch, baseWorktree, missionWorktree, checkout: missionWorktree ?? process.cwd(), isForgejoReviewEnabledFn, getCurrentBranchFn, readTokenFn, getPrStatusFn, getLatestReviewDecisionFn, readReviewStateFn, missionStore, gitFn };
  }

  async buildIntegrationContext(slug: string, options: IntegrationContextOptions = {}): Promise<IntegrationContext> {
    const { baseBranch, baseWorktree, missionWorktree: explicitWorktree, checkout, isForgejoReviewEnabledFn, getCurrentBranchFn, readTokenFn, getPrStatusFn, getLatestReviewDecisionFn, readReviewStateFn, missionStore, gitFn } = this.resolvedOptions(options);
    if (!slug) {
      throw new Error('buildIntegrationContext requires a non-null mission slug.');
    }
    const branch = `mission/${slug}`;
    const currentBranch = getCurrentBranchFn();
    const missionDir = this.dependencies.missionPaths.findMissionDir(slug);
    const area = missionDir ? this.dependencies.missionPaths.findMissionArea(missionDir) : 'all';

    const { branch: resolvedBaseBranch, worktree: resolvedBaseWorktree } = this.resolveIntegrationBase(slug, baseBranch, baseWorktree, checkout);
    const integrationRoot = resolvedBaseWorktree as string;
    // The mission branch owns the task payload that is about to be integrated.
    // Read task metadata there so integration remains independent of uncommitted
    // or stale files in the primary checkout.
    const missionWorktree = explicitWorktree ?? this.inferMissionWorktree(slug, checkout, resolvedBaseWorktree);
    const task = isDbAdhocIdentity(slug)
      ? { ok: false, matches: [], reason: 'adhoc mission has no Backlog task' }
      : this.dependencies.backlog.resolveTaskFile(slug, missionWorktree);
    const taskAssignee = task.ok ? this.dependencies.backlog.getTaskAssignee(task.taskFile as string) : null;
    const forgejoEnabled = isForgejoReviewEnabledFn(integrationRoot);

    // Lightweight integration-context consumers that have Forgejo disabled do
    // not compose the review reader. Production composition always does; keep
    // the former context-only path compatible while a rebound simply receives
    // an empty state when no review authority is available.
    const reviewState = typeof readReviewStateFn === 'function'
      ? await Promise.resolve(readReviewStateFn(slug, integrationRoot, missionStore))
      : null;
    const forgejoState = await this.forgejoContext(forgejoEnabled, taskAssignee, slug, branch, integrationRoot, reviewState, readTokenFn, getPrStatusFn, getLatestReviewDecisionFn, checkout);
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
      executionCheckout: checkout,
      missionStatus: undefined,
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

  surface() {
    return { buildIntegrationContext: this.buildIntegrationContext.bind(this) };
  }
}
