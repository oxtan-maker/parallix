/**
 * Integration context: every fact the preflight, recovery, and landing steps
 * read, gathered once — mission layout, base target, task metadata, review
 * provider state, and the integration checkout's branch and dirty entries.
 */
import type { IntegrationReviewSnapshot, IntegrationPullRequest, IntegrationApproval, IntegrationMissionFacts } from '../ports/integration-records.js';
import { backlogMirrorOwnership, missionId, type BacklogMirrorOwnership } from '../../domain/mission.js';
import { baseTaskSlug } from './support.js';
import type { MissionStore } from '../domain-ports.js';
import type { LiveMissionExecutionContext } from '../ports/mission-execution-context.js';
import type { IntegrateGitRunner, IntegrateWorkflowPorts } from '../ports/integrate-workflow.js';

export interface IntegrationContext extends IntegrationMissionFacts {
  slug: string; branch: string; currentBranch: string; missionDir: string | null; area: string;
  task: ReturnType<IntegrateWorkflowPorts['backlog']['resolveTaskFile']>;
  /** Whether Backlog Markdown is a required lifecycle mirror for this persisted Mission. */
  mirrorOwnership: BacklogMirrorOwnership;
  reviewState: IntegrationReviewSnapshot | null;
  missionWorktree: string;
  /** The resolved checkout identity for this Mission; mutation steps consume it instead of re-deriving one. */
  executionContext: LiveMissionExecutionContext;
  /** The checkout the operation runs from: the mission checkout resolved from Mission identity. */
  executionCheckout: string;
  promoteBacklogOnCloseout: boolean; taskAssignee: string | null;
  taskStatus?: string;
  forgejoUser: string | null; forgejoToken: string | null; configuredReviewer: string | null; taskAssigneeWarning: string | null;
  pr: IntegrationPullRequest;
  siblingPrs: ReturnType<IntegrateWorkflowPorts['forgejo']['listOpenPrsForSlug']>;
  approval: IntegrationApproval;
  baseBranch: string; baseWorktree: string; mainBranch: string; mainDirtyEntries: string[]; mainDirty: boolean;
}

export interface IntegrationContextOptions {
  /**
   * Required. The checkouts resolved from Mission identity; the builder never
   * re-derives a base branch, base worktree or mission checkout from the
   * working directory of the process that admitted the run.
   */
  executionContext: LiveMissionExecutionContext;
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

  async forgejoContext(enabled: boolean, taskAssignee: string | null, slug: string, branch: string, reviewState: IntegrationReviewSnapshot | null, readTokenFn: IntegrateWorkflowPorts['forgejo']['readToken'], getPrStatusFn: IntegrateWorkflowPorts['forgejo']['getPrStatus'], getLatestReviewDecisionFn: IntegrateWorkflowPorts['forgejo']['getLatestReviewDecision'], checkout: string) {
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

  private resolvedOptions(options: IntegrationContextOptions) {
    const {
    executionContext,
    isForgejoReviewEnabledFn = this.dependencies.ports.productConfig.isForgejoReviewEnabled,
    getCurrentBranchFn = this.dependencies.ports.git.getCurrentBranch,
    readTokenFn = this.dependencies.forgejo.readToken,
    getPrStatusFn = this.dependencies.forgejo.getPrStatus,
    getLatestReviewDecisionFn = this.dependencies.forgejo.getLatestReviewDecision,
    readReviewStateFn = this.dependencies.ports.review.readReviewState,
    missionStore = null,
    gitFn = this.dependencies.ports.git.git,
  } = options;
    return { executionContext, isForgejoReviewEnabledFn, getCurrentBranchFn, readTokenFn, getPrStatusFn, getLatestReviewDecisionFn, readReviewStateFn, missionStore, gitFn };
  }

  private async resolveMirrorOwnership(slug: string, missionStore: MissionStore | null): Promise<BacklogMirrorOwnership> {
    const fallback = backlogMirrorOwnership({ id: missionId(slug), waveParentId: null });
    if (!missionStore) { return fallback; }
    const loaded = await missionStore.load(missionId(slug));
    return loaded.kind === 'found' ? backlogMirrorOwnership(loaded.mission) : fallback;
  }

  async buildIntegrationContext(slug: string, options: IntegrationContextOptions): Promise<IntegrationContext> {
    if (!slug) {
      throw new Error('buildIntegrationContext requires a non-null mission slug.');
    }
    if (!options?.executionContext) {
      throw new Error(`buildIntegrationContext requires the execution context resolved for mission ${slug}.`);
    }
    const { executionContext, isForgejoReviewEnabledFn, getCurrentBranchFn, readTokenFn, getPrStatusFn, getLatestReviewDecisionFn, readReviewStateFn, missionStore, gitFn } = this.resolvedOptions(options);
    if (executionContext.missionId !== slug) {
      throw new Error(`Execution context for ${executionContext.missionId} cannot integrate mission ${slug}.`);
    }
    const { missionWorktree, baseWorktree: resolvedBaseWorktree, baseBranch: resolvedBaseBranch } = executionContext;
    const checkout = missionWorktree;
    const branch = `mission/${slug}`;
    const currentBranch = getCurrentBranchFn();
    const missionDir = this.dependencies.missionPaths.findMissionDir(slug);
    const area = missionDir ? this.dependencies.missionPaths.findMissionArea(missionDir) : 'all';

    // The mission branch owns the task payload that is about to be integrated.
    // Read task metadata there so integration remains independent of uncommitted
    // or stale files in the primary checkout.
    const mirrorOwnership = await this.resolveMirrorOwnership(slug, missionStore);
    const task = mirrorOwnership.kind === 'none'
      ? { ok: false, matches: [], reason: 'adhoc mission has no Backlog task' }
      : this.dependencies.backlog.resolveTaskFile(slug, missionWorktree);
    const taskAssignee = task.ok ? this.dependencies.backlog.getTaskAssignee(task.taskFile as string) : null;
    const forgejoEnabled = isForgejoReviewEnabledFn(resolvedBaseWorktree);

    // Lightweight integration-context consumers that have Forgejo disabled do
    // not compose the review reader. Production composition always does; keep
    // the former context-only path compatible while a rebound simply receives
    // an empty state when no review authority is available.
    const reviewState = typeof readReviewStateFn === 'function'
      ? await Promise.resolve(readReviewStateFn(slug, resolvedBaseWorktree, missionStore))
      : null;
    const forgejoState = await this.forgejoContext(forgejoEnabled, taskAssignee, slug, branch, reviewState, readTokenFn, getPrStatusFn, getLatestReviewDecisionFn, checkout);
    const approval = !forgejoEnabled || forgejoState.approval.ok
      ? forgejoState.approval
      : reviewState?.phase === 'approved' && reviewState.disposition === 'APPROVED'
        ? { ok: true, reviewState: 'APPROVED', source: 'local-review-state' }
        : forgejoState.approval;

    const mainBranch = gitFn(['-C', resolvedBaseWorktree, 'branch', '--show-current']).stdout.trim();
    const mainStatus = gitFn(['-C', resolvedBaseWorktree, 'status', '--short']).stdout.trim();

    return {
      slug,
      branch,
      currentBranch,
      missionDir,
      area,
      task,
      mirrorOwnership,
      reviewState,
      missionWorktree,
      executionContext,
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
