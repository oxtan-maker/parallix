/**
 * Review verification and submission commands: verify a mission is ready
 * for review and submit it.
 */

import * as path from 'path';
import * as fmt from '../../application/presentation/cli-format.js';
import { run, getCurrentBranch } from '../git/git.js';
import { findMissionDir, findMissionArea, resolveWorktree, missionBranchName } from '../filesystem/mission-utils.js';
import { resolveTaskFile, getTaskStatus, getAcceptanceCriteria, getTaskImplementer, reportTaskResolution, transitionTask } from '../backlog/backlog.js';
import { toVirtual } from '../config/state-map.js';
import { getPrStatus, isProviderEnabled } from './review-adapter.js';
import { buildAutonomousReviewMatrix, formatMatrixSummary } from '../agents/runtime-matrix.js';
import { readReviewState, resolveReviewIdentity } from './review-state.js';
import type { MissionStore } from '../../application/domain-ports.js';
import type { MissionLifecycleService } from '../../application/mission-lifecycle-service.js';
import { reboundRejectedHandoff } from '../../application/review-task-mirroring.js';
import type { ReviewHandoffFailurePort } from '../../application/ports/review-task-mirror.js';
import { transitionReviewRepair } from '../../application/review-repair-lifecycle.js';
import { formatVerificationCommand, runVerificationGate } from '../verification/verification.js';
import { performHandoff } from '../cli/commands/handoff.js';

type ReviewVerdict = { failures: string[]; warnings: string[] };

/** Check the Backlog task exists and sits in a status a review can start from. */
function verifyBacklogTask(taskResolution: any, slug: string, verdict: ReviewVerdict, deps: {
  getTaskStatusFn: typeof getTaskStatus; toVirtualFn: typeof toVirtual; log: (_msg: string) => void;
}): { taskStatus: string | null; virtualStatus: string | null } {
  const { getTaskStatusFn, toVirtualFn, log } = deps;
  if (!taskResolution.ok) {
    verdict.failures.push('task');
    reportTaskResolution(taskResolution, slug, log);
    return { taskStatus: null, virtualStatus: null };
  }
  const taskStatus = getTaskStatusFn(taskResolution.taskFile!);
  const virtualStatus = toVirtualFn(taskStatus || '');
  const name = path.basename(taskResolution.taskFile!);
  if (taskStatus === 'review' || virtualStatus === 'approved') {
    log(fmt.status('PASS', `Backlog task: ${name} (${taskStatus})`));
  } else if (taskStatus === 'done') {
    verdict.failures.push('task-status');
    log(fmt.status('FAIL', 'Backlog task: task is already done/integrated'));
  } else if (taskStatus === 'active' || virtualStatus === 'active') {
    verdict.warnings.push('task-still-active');
    log(fmt.status('WARN', `Backlog task: ${name} is still ${taskStatus}`));
  } else {
    verdict.failures.push('task-status');
    log(fmt.status('FAIL', `Backlog task: unexpected status ${taskStatus}`));
  }
  return { taskStatus, virtualStatus };
}

/**
 * Check the review pull request. A missing PR is only a warning while the task
 * is still being implemented; in any post-implementation or unknown state it is
 * a hard failure (fail closed).
 */
function verifyReviewPullRequest(pr: unknown, context: {
  providerEnabled: boolean; taskResolution: any; taskStatus: string | null;
  virtualStatus: string | null; branch: string; slug: string;
}, verdict: ReviewVerdict, log: (_msg: string) => void): void {
  const { providerEnabled, taskResolution, taskStatus, virtualStatus, branch, slug } = context;
  if (!providerEnabled) {
    log(fmt.status('INFO', 'Forgejo PR: skipped (review provider is not forgejo).'));
    return;
  }
  const prAny = pr as Record<string, unknown>;
  if (prAny.exists && prAny.state === 'open' && !prAny.merged) {
    log(fmt.status('PASS', `Review PR: PR #${prAny.number} is open`));
    return;
  }
  if (prAny.exists) {
    verdict.failures.push('pr-state');
    log(fmt.status('FAIL', `Review PR: expected an open PR, got state=${prAny.state} merged=${prAny.merged}`));
    return;
  }
  if (taskResolution.ok && (taskStatus === 'active' || virtualStatus === 'active')) {
    verdict.warnings.push('no-pr-yet');
    log(fmt.status('WARN', `Review PR: no PR found for ${branch}. Task is still ${taskStatus} — complete implementation and submit first: px review ${slug} --push`));
    return;
  }
  verdict.failures.push('pr-missing');
  log(fmt.status('FAIL', `Review PR: ${prAny.raw || 'no PR found'}`));
}

/** The mission directory and the branch it must be reviewed from. */
function verifyMissionLocation(missionDir: string | null, slug: string, current: string, branch: string, verdict: ReviewVerdict, log: (_msg: string) => void): void {
  if (missionDir) {
    log(fmt.status('PASS', `Mission doc: ${fmt.path(path.join(missionDir, 'MISSION.md'))}`));
  } else {
    verdict.failures.push('mission-dir');
    log(fmt.status('FAIL', `Mission directory not found for slug: ${fmt.slug(slug)}`));
  }
  if (current === branch) {
    log(fmt.status('PASS', `Branch: ${fmt.branch(current)}`));
    return;
  }
  verdict.failures.push('branch');
  log(fmt.status('FAIL', `Branch: current branch is ${fmt.branch(current)}, expected ${fmt.branch(branch)}`));
}

function runReviewerGate(area: string, rootDir: string, skipped: boolean, verdict: ReviewVerdict, deps: { runVerificationGateFn: Function; runFn: unknown; log: (_msg: string) => void }): void {
  const { runVerificationGateFn, runFn, log } = deps;
  if (skipped) {
    log(fmt.status('WARN', `Verification gate skipped (--no-gate) for area ${area}`));
    return;
  }
  log(`Running reviewer gate: ${fmt.command(formatVerificationCommand(area, rootDir))}`);
  if (runVerificationGateFn(area, { rootDir, stdio: 'inherit', runFn }).status === 0) {
    log(fmt.status('PASS', 'Reviewer gate passed.'));
    return;
  }
  verdict.failures.push('gate');
  log(fmt.status('FAIL', 'Reviewer gate failed.'));
}

function logAcceptanceChecklist(acceptanceCriteria: string[], log: (_msg: string) => void): void {
  log(fmt.status('INFO', 'Acceptance evidence checklist:'));
  if (acceptanceCriteria.length === 0) {
    log('  - No Acceptance Criteria found on the Backlog task.');
    return;
  }
  acceptanceCriteria.forEach((line: string) => log(`  ${line}`));
}

export async function verifyReview(
  slug: string,
  skipGate: boolean | string,
  options: {
    log?: (_msg: string) => void;
    error?: (_msg: string) => void;
    exit?: (_code: number) => never;
    resolveWorktreeFn?: typeof resolveWorktree;
    findMissionDirFn?: typeof findMissionDir;
    getCurrentBranchFn?: typeof getCurrentBranch;
    resolveTaskFileFn?: typeof resolveTaskFile;
    getPrStatusFn?: typeof getPrStatus;
    getTaskStatusFn?: typeof getTaskStatus;
    toVirtualFn?: typeof toVirtual;
    findMissionAreaFn?: typeof findMissionArea;
    runVerificationGate?: typeof runVerificationGate;
    runFn?: typeof run;
    getAcceptanceCriteriaFn?: typeof getAcceptanceCriteria;
    formatMatrixSummaryFn?: typeof formatMatrixSummary;
    buildAutonomousReviewMatrixFn?: typeof buildAutonomousReviewMatrix;
    readReviewStateFn?: typeof readReviewState;
    isReviewProviderEnabledFn?: typeof isProviderEnabled;
    isForgejoReviewEnabledFn?: typeof isProviderEnabled;
    cwdFn?: () => string;
    missionPath?: string;
    skipGate?: boolean;
  } = {}
): Promise<void> {
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const exit = options.exit || process.exit;
  const resolveWorktreeFn = options.resolveWorktreeFn || resolveWorktree;
  const findMissionDirFn = options.findMissionDirFn || findMissionDir;
  const getCurrentBranchFn = options.getCurrentBranchFn || getCurrentBranch;
  const resolveTaskFileFn = options.resolveTaskFileFn || resolveTaskFile;
  const getPrStatusFn = options.getPrStatusFn || getPrStatus;
  const getTaskStatusFn = options.getTaskStatusFn || getTaskStatus;
  const toVirtualFn = options.toVirtualFn || toVirtual;
  const findMissionAreaFn = options.findMissionAreaFn || findMissionArea;
  const runVerificationGateFn = options.runVerificationGate || runVerificationGate;
  const runFn = options.runFn || run;
  const getAcceptanceCriteriaFn = options.getAcceptanceCriteriaFn || getAcceptanceCriteria;
  const formatMatrixSummaryFn = options.formatMatrixSummaryFn || formatMatrixSummary;
  const buildAutonomousReviewMatrixFn = options.buildAutonomousReviewMatrixFn || buildAutonomousReviewMatrix;
  const readReviewStateFn = options.readReviewStateFn || readReviewState;
  const isReviewProviderEnabledFn = options.isReviewProviderEnabledFn || options.isForgejoReviewEnabledFn || isProviderEnabled;
  const cwdFn = options.cwdFn || (() => process.cwd());

  const worktree = resolveWorktreeFn(slug);
  const rootDir = worktree || cwdFn();

  const missionDir = findMissionDirFn(slug, rootDir, { missionPath: options.missionPath });
  const branch = missionBranchName(slug, rootDir);
  const current = getCurrentBranchFn(rootDir);
  const taskResolution = resolveTaskFileFn(slug, rootDir);
  const providerEnabled = isReviewProviderEnabledFn(rootDir);
  const pr = providerEnabled ? getPrStatusFn(branch, rootDir) : { exists: false };
  const failures: string[] = [];
  const warnings: string[] = [];

  const verdict = { failures, warnings };
  log(`Reviewer verification for mission: ${fmt.slug(slug)}`);
  log(worktree ? `Found dedicated worktree: ${fmt.path(worktree)}` : 'Using current directory as mission root.');
  verifyMissionLocation(missionDir, slug, current, branch, verdict, log);

  const { taskStatus, virtualStatus } = verifyBacklogTask(taskResolution, slug, verdict, { getTaskStatusFn, toVirtualFn, log });
  verifyReviewPullRequest(pr, { providerEnabled, taskResolution, taskStatus, virtualStatus, branch, slug }, verdict, log);

  if (missionDir) {
    runReviewerGate(findMissionAreaFn(missionDir), rootDir, Boolean(skipGate || options.skipGate), verdict, { runVerificationGateFn, runFn, log });
  }
  if (taskResolution.ok) {
    logAcceptanceChecklist(getAcceptanceCriteriaFn(taskResolution.taskFile!), log);
  }

  log(fmt.status('INFO', 'Autonomous review runtime matrix:'));
  formatMatrixSummaryFn(buildAutonomousReviewMatrixFn()).forEach((line: string) => log(line));

  // Show persisted reviewer state if present
  const persisted = await Promise.resolve(readReviewStateFn(slug, rootDir));
  if (persisted) {
    log(`Persisted reviewer state: reviewer=${fmt.agent(persisted.reviewer ?? '')} implementer=${fmt.agent(persisted.implementer ?? '')} round=${persisted.round} startedAt=${persisted.startedAt}`);
  }
  if (warnings.length > 0) {
    log(fmt.status('WARN', `Review verification warnings: ${warnings.join(', ')}`));
  }
  if (failures.length > 0) {
    error('\n' + fmt.status('INFO', 'Review verification failed. Resolve the blockers above before starting review.'));
    exit(1);
    return;
  }
  log('\n' + fmt.status('PASS', 'Review verification complete.'));
}

// ============================================================================
// Command: submitForReview
// ============================================================================

export async function submitForReview(
  slug: string,
  skipGate: boolean | string,
  options: {
    exit?: (_code: number) => never;
    resolveTaskFileFn?: typeof resolveTaskFile;
    getTaskImplementerFn?: typeof getTaskImplementer;
    resolveWorktreeFn?: typeof resolveWorktree;
    performHandoffFn?: (_slug: string, _opts?: Record<string, unknown>) => Promise<Record<string, unknown>>;
    readReviewStateFn?: typeof readReviewState;
    transitionTaskFn?: typeof transitionTask;
    isReviewProviderEnabledFn?: typeof isProviderEnabled;
    isForgejoReviewEnabledFn?: typeof isProviderEnabled;
    missionServicesFn?: Function;
    // TASK-2379 review round 1 (F1): authoritative review-entry timestamp
    // for lifecycle recovery; a genuine submit-for-review passes nothing and
    // the handoff keeps the wall clock.
    occurredAt?: string;
    missionStore?: MissionStore | null;
    lifecycleService?: MissionLifecycleService | null;
    log?: (_msg: string) => void;
  } = {}
): Promise<void> {
  const exit = options.exit || process.exit;
  const resolveTaskFileFn = options.resolveTaskFileFn || resolveTaskFile;
  const getTaskImplementerFn = options.getTaskImplementerFn || getTaskImplementer;
  const resolveWorktreeFn = options.resolveWorktreeFn || resolveWorktree;
  const performHandoffFn = options.performHandoffFn || performHandoff;
  const readReviewStateFn = options.readReviewStateFn || readReviewState;
  const transitionTaskFn = options.transitionTaskFn || transitionTask;
  const isReviewProviderEnabledFn = options.isReviewProviderEnabledFn || options.isForgejoReviewEnabledFn || isProviderEnabled;
  const log = options.log || fmt.log.plain;

  const worktree = resolveWorktreeFn(slug) || process.cwd();
  const providerEnabled = isReviewProviderEnabledFn(worktree);

  const { identityUser: reviewStateUser } = await resolveReviewIdentity(slug, worktree, {
    readReviewStateFn,
  });
  let reviewIdentity = reviewStateUser;

  // 2. Check backlog task assignee
  if (!reviewIdentity) {
    const taskResolution = resolveTaskFileFn(slug, worktree);
    if (taskResolution.ok) {
      reviewIdentity = getTaskImplementerFn(taskResolution.taskFile!);
    }
  }

  // 3. Mode-specific final fallback: named identity (provider-backed) vs "autonomous" (provider=none) (SC 6)
  if (!reviewIdentity) {
    if (providerEnabled) {
      log(fmt.status('FAIL', `No review identity resolved for ${slug}. Start the review with px review ${slug} --start, or set the task implementer, before submitting for review.`));
      exit(1);
      return;
    } else {
      reviewIdentity = 'autonomous';
      log(fmt.status('WARN', `No reviewer/implementer identity resolved for ${slug}; defaulting to "autonomous"`));
    }
  }

  const result = await performHandoffFn(slug, { skipGate, reviewIdentity, forgejoUser: reviewIdentity, worktree, missionServicesFn: options.missionServicesFn, occurredAt: options.occurredAt, recoverGateFailure: true });
  if (!result.ok) {
    const failurePort: ReviewHandoffFailurePort = {
      repairMission: async () => {
        if (options.missionStore) { await transitionReviewRepair(slug, 'active', reviewIdentity, options.missionStore, options.lifecycleService ?? null); }
      },
      transition: status => transitionTaskFn(slug, status, { rootDir: worktree, log }),
      reportBounce: () => log(fmt.status('INFO', `Auto-bounced ${slug} to active: declared-gate validation failure. Fix the gate in MISSION.md and retry.`)),
    };
    await reboundRejectedHandoff(result as { ok: unknown; reason?: unknown; recoveryAttempted?: unknown }, failurePort);
    exit(1);
  }
}

// ============================================================================
// Command: readComments
// ============================================================================

