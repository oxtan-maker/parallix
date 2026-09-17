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
    const area = missionDir ? missionPaths.findMissionArea(missionDir) : 'docs';

    // The mission integrates back into its recorded base branch/worktree. When no
    // base was recorded (every legacy mission) these resolve to the primary
    // branch/worktree, so the rest of integration is byte-identical to today.
    let resolvedBaseBranch: string | null = baseBranch;
    if (!resolvedBaseBranch) {
      try { resolvedBaseBranch = missionPaths.resolveMissionBaseBranch(slug, process.cwd()); } catch { resolvedBaseBranch = missionPaths.getPrimaryBranch(); }
    }
    let resolvedBaseWorktree: string | null = baseWorktree;
    if (!resolvedBaseWorktree) {
      try { resolvedBaseWorktree = missionPaths.resolveBaseWorktree(slug, { rootDir: process.cwd() }); } catch { resolvedBaseWorktree = missionPaths.getPrimaryWorktree(); }
    }
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

    let forgejoIdentity: { forgejoUser: string | null, warning: string | null } = { forgejoUser: null, warning: null };
    let forgejoToken: string | null = null;
    let configuredReviewer: string | null = null;
    let pr: any = { exists: false };
    let siblingPrs: any[] = [];
    let approval: any = { ok: false, error: 'forgejo-off', reviewState: null };

    if (forgejoEnabled) {
      forgejoIdentity = landing.resolveForgejoUserForIntegration(taskAssignee);
      forgejoToken = readTokenFn(forgejoIdentity.forgejoUser || 'default');
      // TASK-2420 (review round 1, F1): the reviewer login queried for recovery
      // authority must come from the Mission's recorded current review round, not
      // from the task assignee (the implementer). An implementation by `codex`
      // reviewed by `qwen` would otherwise query `codex` as the reviewer and
      // reject qwen's legitimate approval. Derive it from the persisted round
      // (fail-closed, ADR 0048): a mission with no recorded round yields no
      // reviewer, so reviewerUser stays null and recovery falls back to the
      // default user only — it cannot be forged from caller context.
      // TASK-2420 (review round 2, F1): the production `readReviewState` returns
      // null unless its third `missionStore` argument is supplied, so the
      // authoritative store must be passed here or the reviewer lookup always
      // falls back to the default user. The store is the operator Mission
      // authority, never task metadata.
      const reviewState = await Promise.resolve(readReviewStateFn(slug, integrationRoot, missionStore));
      // TASK-2420 (review round 2, F1): the round stores the reviewer as an
      // AgentFamily; the login it posts a provider APPROVED as is
      // resolveForgejoUser(reviewer). Map it the same way so the recovery
      // authority matches the login the reviewer actually used, never a caller
      // value. No recorded reviewer yields null → falls back to the default user.
      configuredReviewer = reviewState?.reviewer ? ports.review.resolveForgejoUser(reviewState.reviewer) : null;
      pr = getPrStatusFn(branch, process.cwd(), { forgejoUser: forgejoIdentity.forgejoUser, token: forgejoToken });
      if (pr.exists && pr.merged === true) {
        pr = { ...pr, state: 'merged' };
      }

      if (pr.exists && slug && forgejoToken) {
        const allOpen = forgejo.listOpenPrsForSlug(baseTaskSlug(slug), forgejoToken);
        siblingPrs = allOpen.filter(p => p.head !== branch);
      }

      approval = pr.exists
        ? getLatestReviewDecisionFn(branch, {
          forgejoUser: forgejoIdentity.forgejoUser,
          token: forgejoToken,
          // TASK-2420 (review round 1, F1): pass the configured reviewer's resolved
          // Forgejo login — derived from the recorded current review round above,
          // never the task assignee/implementer (fail-closed, ADR 0048) — so the
          // recovery authority recognizes an APPROVED by that reviewer too.
          reviewerUser: configuredReviewer,
        })
        : { ok: false, error: 'pr-missing', reviewState: undefined };
    }

    // Local review-state fallback: when forgejo token/API is unavailable but the
    // mission's Review shows approved, populate approval from local state
    // so that integrate can proceed without a live Forgejo connection.
    // Only applies when Forgejo was enabled but approval could not be obtained.
    if (forgejoEnabled && !approval.ok) {
      const localStateFallback = await Promise.resolve(readReviewStateFn(slug, integrationRoot));
      if (localStateFallback && localStateFallback.phase === 'approved' && localStateFallback.disposition === 'APPROVED') {
        approval = { ok: true, reviewState: 'APPROVED', source: 'local-review-state' };
      }
    }

    const mainBranch = gitFn(['-C', integrationRoot, 'branch', '--show-current']).stdout.trim();
    const mainStatus = gitFn(['-C', integrationRoot, 'status', '--short']).stdout.trim();

    return {
      slug,
      branch,
      currentBranch,
      missionDir,
      area,
      task,
      missionWorktree,
      missionStatus: undefined as string | undefined,
      promoteBacklogOnCloseout: false,
      taskAssignee,
      forgejoUser: forgejoIdentity.forgejoUser,
      forgejoToken,
      // The login whose provider APPROVED counts as the reviewer's; carried so
      // a stale approval can be retracted as that same login (TASK-2528).
      configuredReviewer,
      taskAssigneeWarning: forgejoIdentity.warning,
      pr,
      siblingPrs,
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
