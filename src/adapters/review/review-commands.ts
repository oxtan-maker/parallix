/**
 * Review Commands Module
 * Implements the current review command dispatch and CLI behavior.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as fmt from '../../application/presentation/cli-format.js';
import { run, getCurrentBranch } from '../git/git.js';
import { findMissionDir, findMissionArea, resolveWorktree, missionBranchName } from '../filesystem/mission-utils.js';
import { resolveTaskFile, getTaskStatus, getAcceptanceCriteria, getTaskAssignee, getTaskImplementer, reportTaskResolution, transitionTask } from '../backlog/backlog.js';
import { toVirtual } from '../config/state-map.js';
import { getPrStatus, readToken, postComment, postReview, createPr, getComments, closePr, resolveReviewUser, isProviderEnabled } from './review-adapter.js';
import { buildAutonomousReviewMatrix, formatMatrixSummary } from '../agents/runtime-matrix.js';
import { readReviewState, writeReviewState, resolveReviewIdentity, ReviewState, persistReviewStateOrThrow, backfillReviewFromLegacyState, reconcileInterruptedHandoff } from './review-state.js';
import type { MissionStore } from '../../application/domain-ports.js';
import { createEvent, ALL_EVENT_TYPES, isValidEventType, shouldMirrorToProvider, readAllEvents } from './review-events.js';
import { formatVerificationCommand, runVerificationGate } from '../verification/verification.js';
import { bootstrapReviewSurface } from './setup-review.js';
import { resolveReviewAdapter } from '../config/product-config.js';
import { buildMetadataFooter, postWorkflowComment, postWorkflowReview, consumeReviewerArtifacts, resolveArtifactDir } from './review-artifacts.js';
import { commitSafeMissionArtifacts } from './review-loop.js';
import { flagValue, getHandoff, repeatedFlagValues } from './review-cli-flags.js';
export { REVIEW_FLAGS, REVIEW_VALUE_FLAGS, unknownReviewFlags, flagValue, getHandoff, readTextFlag, repeatedFlagValues, unwrapHandoffModule } from './review-cli-flags.js';
export { formatStaticReviewFindings, formatStaticReviewSuccess, performStaticReview } from './review-static-evidence.js';



async function repairStaleActiveTaskAfterReview(
  slug: string,
  options: {
    log?: (_msg: string) => void;
    error?: (_msg: string) => void;
    getTaskStatusFn?: typeof getTaskStatus;
    resolveTaskFileFn?: typeof resolveTaskFile;
    transitionTaskFn?: typeof transitionTask;
    rootDir?: string;
  } = {}
): Promise<{ repaired: boolean; skipped?: boolean; currentStatus?: string }> {
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const getTaskStatusFn = options.getTaskStatusFn || getTaskStatus;
  const resolveTaskFileFn = options.resolveTaskFileFn || resolveTaskFile;
  const transitionTaskFn = options.transitionTaskFn || transitionTask;
  const rootDir = options.rootDir || process.cwd();

  const taskResolution = resolveTaskFileFn(slug, rootDir);
  if (!taskResolution.ok) {
    return { repaired: false, skipped: true };
  }

  const currentStatus = getTaskStatusFn(taskResolution.taskFile!);
  if (toVirtual(currentStatus || '') !== 'active') {
    return { repaired: false, skipped: true, currentStatus: currentStatus ?? undefined };
  }

  if (!await transitionTaskFn(slug, 'review', { rootDir, log })) {
    error(fmt.status('WARN', `Could not transition backlog task ${slug} to review after recording the review outcome.`));
    return { repaired: false, skipped: false, currentStatus: currentStatus ?? undefined };
  }

  return { repaired: true, currentStatus: currentStatus ?? undefined };
}

async function commitPersistedReviewOutputs(
  slug: string,
  options: { worktree?: string; taskFile?: string | null; log?: (_msg: string) => void; error?: (_msg: string) => void } = {}
): Promise<{ ok: boolean; dirty?: boolean; unsafe?: boolean }> {
  return commitSafeMissionArtifacts(slug, options.worktree || process.cwd(), {
    taskFile: options.taskFile || null,
    log: options.log || fmt.log.plain,
    error: options.error || fmt.log.plainError,
  });
}

export async function postStaticReviewComment(
  slug: string,
  message: string,
  options: {
    log?: (_msg: string) => void;
    error?: (_msg: string) => void;
    resolveTaskFileFn?: typeof resolveTaskFile;
    getTaskStatusFn?: typeof getTaskStatus;
    getTaskImplementerFn?: typeof getTaskImplementer;
    resolveWorktreeFn?: typeof resolveWorktree;
    reconcileInterruptedHandoffFn?: typeof reconcileInterruptedHandoff;
    /** Production composition enables the pre-launch aggregate guard. */
    requireReviewAggregate?: boolean;
    missionStore?: MissionStore | null;
    readTokenFn?: typeof readToken;
    postCommentFn?: typeof postComment;
    resolveReviewUserFn?: typeof resolveReviewUser;
    resolveForgejoUserFn?: typeof resolveReviewUser;
    readReviewStateFn?: typeof readReviewState;
    buildMetadataFooterFn?: typeof buildMetadataFooter;
    rootDir?: string;
  } = {}
): Promise<{ ok: boolean; error?: string }> {
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const resolveTaskFileFn = options.resolveTaskFileFn || resolveTaskFile;
  const getTaskImplementerFn = options.getTaskImplementerFn || getTaskImplementer;
  const resolveWorktreeFn = options.resolveWorktreeFn || resolveWorktree;
  const readTokenFn = options.readTokenFn || readToken;
  const postCommentFn = options.postCommentFn || postComment;
  const resolveReviewUserFn = options.resolveReviewUserFn || options.resolveForgejoUserFn || resolveReviewUser;
  const readReviewStateFn = options.readReviewStateFn || readReviewState;
  const buildMetadataFooterFn = options.buildMetadataFooterFn || buildMetadataFooter;

  const rootDir = options.rootDir || resolveWorktreeFn(slug) || process.cwd();
  const branch = missionBranchName(slug, rootDir);
  const { identityUser } = await resolveReviewIdentity(slug, rootDir, {
    readReviewStateFn,
  });
  let resolvedUser = identityUser;

  if (!resolvedUser) {
    const taskResolution = resolveTaskFileFn(slug, rootDir);
    if (taskResolution.ok) {
      resolvedUser = getTaskImplementerFn(taskResolution.taskFile!);
    }
  }
  if (!resolvedUser) {
    error('Cannot determine review identity. Set FORGEJO_USER, start the review with px handoff, or assign the task implementer.');
    return { ok: false, error: 'missing-user' };
  }
  resolvedUser = resolveReviewUserFn(resolvedUser!);
  const token = readTokenFn(resolvedUser!, { rootDir });
  if (!token) {
    error(`No Forgejo token found for user "${resolvedUser}". Cannot post static review comment.`);
    return { ok: false, error: 'missing-token' };
  }

  const taggedMessage = message + buildMetadataFooterFn(slug, rootDir);
  log(`Posting static review comment on ${fmt.branch(branch)} as ${resolvedUser}...`);
  const result = postCommentFn(branch, token, taggedMessage, { reviewIdentity: resolvedUser, forgejoUser: resolvedUser }) as { ok: boolean; error?: string };

  if (!result.ok) {
    error(`Could not post static review comment: ${result.error || 'API error'}`);
    return result;
  }

  log(fmt.status('PASS', `Static review comment posted on PR for ${fmt.branch(branch)}.`));
  return result;
}

// ===============================================================================
// Command: verifyReview
// ============================================================================

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

  log(`Reviewer verification for mission: ${fmt.slug(slug)}`);
  if (worktree) {
    log(`Found dedicated worktree: ${fmt.path(worktree)}`);
  } else {
    log('Using current directory as mission root.');
  }

  if (!missionDir) {
    failures.push('mission-dir');
    log(fmt.status('FAIL', `Mission directory not found for slug: ${fmt.slug(slug)}`));
  } else {
    log(fmt.status('PASS', `Mission doc: ${fmt.path(path.join(missionDir, 'MISSION.md'))}`));
  }

  if (current !== branch) {
    failures.push('branch');
    log(fmt.status('FAIL', `Branch: current branch is ${fmt.branch(current)}, expected ${fmt.branch(branch)}`));
  } else {
    log(fmt.status('PASS', `Branch: ${fmt.branch(current)}`));
  }

  let taskStatus: string | null = null;
  let virtualStatus: string | null = null;
  if (!taskResolution.ok) {
    failures.push('task');
    reportTaskResolution(taskResolution, slug, log);
  } else {
    taskStatus = getTaskStatusFn(taskResolution.taskFile!);
    virtualStatus = toVirtualFn(taskStatus || '');
    if (taskStatus === 'review' || virtualStatus === 'approved') {
      log(fmt.status('PASS', `Backlog task: ${path.basename(taskResolution.taskFile!)} (${taskStatus})`));
    } else if (taskStatus === 'done') {
      failures.push('task-status');
      log(fmt.status('FAIL', 'Backlog task: task is already done/integrated'));
    } else if (taskStatus === 'active' || virtualStatus === 'active') {
      warnings.push('task-still-active');
      log(fmt.status('WARN', `Backlog task: ${path.basename(taskResolution.taskFile!)} is still ${taskStatus}`));
    } else {
      failures.push('task-status');
      log(fmt.status('FAIL', `Backlog task: unexpected status ${taskStatus}`));
    }
  }

  const prAny = pr as Record<string, unknown>;
  if (providerEnabled) {
    if (prAny.exists && prAny.state === 'open' && !prAny.merged) {
      log(fmt.status('PASS', `Review PR: PR #${prAny.number} is open`));
    } else if (prAny.exists) {
      failures.push('pr-state');
      log(fmt.status('FAIL', `Review PR: expected an open PR, got state=${prAny.state} merged=${prAny.merged}`));
    } else {
      // No PR exists - check if task is in implementation phase
      if (taskResolution.ok) {
        const isImplementationPhase = taskStatus === 'active' || virtualStatus === 'active';
        if (isImplementationPhase) {
          // Task is still in implementation - emit warning instead of failure
          warnings.push('no-pr-yet');
          log(fmt.status('WARN', `Review PR: no PR found for ${branch}. Task is still ${taskStatus} — complete implementation and submit first: px review ${slug} --push`));
        } else {
          // Task is in post-implementation state or ambiguous - hard fail
          failures.push('pr-missing');
          log(fmt.status('FAIL', `Review PR: ${prAny.raw || 'no PR found'}`));
        }
      } else {
        // Cannot determine task status - safe default to hard fail
        failures.push('pr-missing');
        log(fmt.status('FAIL', `Review PR: ${prAny.raw || 'no PR found'}`));
      }
    }
  } else {
    log(fmt.status('INFO', 'Forgejo PR: skipped (review provider is not forgejo).'));
  }

  if (missionDir) {
    const area = findMissionAreaFn(missionDir);
    const skipGateFlag = Boolean(skipGate || options.skipGate);
    if (skipGateFlag) {
      log(fmt.status('WARN', `Verification gate skipped (--no-gate) for area ${area}`));
    } else {
      log(`Running reviewer gate: ${fmt.command(formatVerificationCommand(area, rootDir))}`);
      const verifyResult = runVerificationGateFn(area, { rootDir, stdio: 'inherit', runFn });
      if (verifyResult.status !== 0) {
        failures.push('gate');
        log(fmt.status('FAIL', 'Reviewer gate failed.'));
      } else {
        log(fmt.status('PASS', 'Reviewer gate passed.'));
      }
    }
  }

  if (taskResolution.ok) {
    const acceptanceCriteria = getAcceptanceCriteriaFn(taskResolution.taskFile!);
    log(fmt.status('INFO', 'Acceptance evidence checklist:'));
    if (acceptanceCriteria.length === 0) {
      log('  - No Acceptance Criteria found on the Backlog task.');
    } else {
      acceptanceCriteria.forEach((line: string) => log(`  ${line}`));
    }
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
    log?: (_msg: string) => void;
  } = {}
): Promise<void> {
  const exit = options.exit || process.exit;
  const resolveTaskFileFn = options.resolveTaskFileFn || resolveTaskFile;
  const getTaskImplementerFn = options.getTaskImplementerFn || getTaskImplementer;
  const resolveWorktreeFn = options.resolveWorktreeFn || resolveWorktree;
  const performHandoffFn = options.performHandoffFn || (await getHandoff()).performHandoff;
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
      log(fmt.status('FAIL', `No review identity resolved for ${slug}. Start the review with px handoff, or set the task implementer, before submitting for review.`));
      exit(1);
      return;
    } else {
      reviewIdentity = 'autonomous';
      log(fmt.status('WARN', `No reviewer/implementer identity resolved for ${slug}; defaulting to "autonomous"`));
    }
  }

  const result = await performHandoffFn(slug, { skipGate, reviewIdentity, forgejoUser: reviewIdentity, worktree, missionServicesFn: options.missionServicesFn });
  if (!result.ok) {
    // Auto-bounce for declared-gate validation failures
    if (result.reason === 'validation-failed') {
      await transitionTaskFn(slug, 'active', { rootDir: worktree, log });
      log(fmt.status('INFO', `Auto-bounced ${slug} to active: declared-gate validation failure. Fix the gate in MISSION.md and retry.`));
    }
    exit(1);
  }
}

// ============================================================================
// Command: readComments
// ============================================================================

export async function readComments(
  slug: string,
  options: {
    log?: (_msg: string) => void;
    error?: (_msg: string) => void;
    exit?: (_code: number) => never;
    readTokenFn?: typeof readToken;
    readReviewStateFn?: typeof readReviewState;
    resolveReviewUserFn?: typeof resolveReviewUser;
    resolveForgejoUserFn?: typeof resolveReviewUser;
    getCommentsFn?: typeof getComments;
    readAllEventsFn?: typeof readAllEvents;
    isReviewProviderEnabledFn?: typeof isProviderEnabled;
    isForgejoReviewEnabledFn?: typeof isProviderEnabled;
    worktree?: string;
  } = {}
): Promise<void> {
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const exit = options.exit || process.exit;
  const readTokenFn = options.readTokenFn || readToken;
  const readReviewStateFn = options.readReviewStateFn || readReviewState;
  const resolveReviewUserFn = options.resolveReviewUserFn || options.resolveForgejoUserFn || resolveReviewUser;
  const getCommentsFn = options.getCommentsFn || getComments;
  const readAllEventsFn = options.readAllEventsFn || readAllEvents;
  const isReviewProviderEnabledFn = options.isReviewProviderEnabledFn || options.isForgejoReviewEnabledFn || isProviderEnabled;
  const worktree = options.worktree || resolveWorktree(slug) || process.cwd();
  const branch = missionBranchName(slug, worktree);

  // Provider-disabled fallback: read persisted local review events instead of polling the PR.
  // Avoids resolving a provider token (which would FAIL/exit) when the provider is off.
  if (!isReviewProviderEnabledFn(worktree)) {
    log(fmt.status('INFO', `Review provider disabled; reading local review events for ${slug}...`));
    const events = await Promise.resolve(readAllEventsFn(slug, { rootDir: worktree, error }));
    if (!events || events.length === 0) {
      log('no comments');
      return;
    }
    for (const e of events as Record<string, unknown>[]) {
      let label = (e.event_type as string) || 'event';
      if (e.round !== null) { label += ` round ${e.round}`; }
      log(`--- ${label} | ${(e.actor as string) || 'unknown'} (${(e.timestamp as string) || (e.fileCreated as string) || ''}) ---`);
      log((e.content as string) || '(no body)');
      log('');
    }
    return;
  }

  let reviewIdentity = (await resolveReviewIdentity(slug, worktree, {
    readReviewStateFn,
  })).identityUser;

  if (!reviewIdentity) {
    error(fmt.status('FAIL', `Cannot determine review identity for ${slug}. Start the review with px handoff, or set FORGEJO_USER.`));
    exit(1);
    return;
  }
  reviewIdentity = resolveReviewUserFn(reviewIdentity);

  const token = readTokenFn(reviewIdentity!, { rootDir: worktree });
  if (!token) {
    error(fmt.status('FAIL', `No Forgejo token found for user "${reviewIdentity}".`));
    exit(1);
    return;
  }

  log(fmt.status('INFO', `Reading PR comments on ${branch} as ${reviewIdentity}...`));
  const comments = await getCommentsFn(branch, token) as unknown[] | null;

  if (comments === null) {
    error(fmt.status('FAIL', `Could not fetch PR comments for ${branch}. The review provider may be unreachable or the PR is missing.`));
    exit(1);
    return;
  }

  if (comments.length === 0) {
    log('no comments');
    return;
  }

  for (const c of comments as Record<string, unknown>[]) {
    let label = c.kind as string;
    if (c.location) { label += ` ${c.location}`; }
    log(`--- ${label} | ${c.user} (${c.created}) ---`);
    log((c.body as string) || '(no body)');
    log('');
  }
}

// ============================================================================
// Command: pushRound
// ============================================================================

export async function pushRound(
  slug: string,
  options: {
    log?: (_msg: string) => void;
    error?: (_msg: string) => void;
    exit?: (_code: number) => never;
    resolveWorktreeFn?: typeof resolveWorktree;
    resolveTaskFileFn?: typeof resolveTaskFile;
    getTaskImplementerFn?: typeof getTaskImplementer;
    transitionTaskFn?: typeof transitionTask;
    resolveReviewUserFn?: typeof resolveReviewUser;
    resolveForgejoUserFn?: typeof resolveReviewUser;
    isReviewProviderEnabledFn?: typeof isProviderEnabled;
    isForgejoReviewEnabledFn?: typeof isProviderEnabled;
    readTokenFn?: typeof readToken;
    readReviewStateFn?: typeof readReviewState;
    createPrFn?: typeof createPr;
    bootstrapReviewSurfaceFn?: typeof bootstrapReviewSurface;
    resolveReviewAdapterFn?: typeof resolveReviewAdapter;
    cwdFn?: () => string;
    force?: boolean;
  } = {}
): Promise<void> {
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const exit = options.exit || process.exit;
  const resolveWorktreeFn = options.resolveWorktreeFn || resolveWorktree;
  const resolveTaskFileFn = options.resolveTaskFileFn || resolveTaskFile;
  const getTaskImplementerFn = options.getTaskImplementerFn || getTaskImplementer;
  const transitionTaskFn = options.transitionTaskFn || transitionTask;
  const resolveReviewUserFn = options.resolveReviewUserFn || options.resolveForgejoUserFn || resolveReviewUser;
  const isReviewProviderEnabledFn = options.isReviewProviderEnabledFn || options.isForgejoReviewEnabledFn || isProviderEnabled;
  const readTokenFn = options.readTokenFn || readToken;
  const readReviewStateFn = options.readReviewStateFn || readReviewState;
  const createPrFn = options.createPrFn || createPr;
  const bootstrapReviewSurfaceFn = options.bootstrapReviewSurfaceFn || bootstrapReviewSurface;
  const resolveReviewAdapterFn = options.resolveReviewAdapterFn || resolveReviewAdapter;
  const cwdFn = options.cwdFn || (() => process.cwd());
  const force = options.force || false;
  const worktree = resolveWorktreeFn(slug);
  const rootDir = worktree || cwdFn();
  const branch = missionBranchName(slug, rootDir);
  const providerEnabled = isReviewProviderEnabledFn(rootDir);

  const { identityUser: reviewStateUser } = await resolveReviewIdentity(slug, rootDir, {
    readReviewStateFn,
  });
  let reviewIdentity = reviewStateUser;

  if (!reviewIdentity) {
    // 1. Check backlog task assignee
    const taskResolution = resolveTaskFileFn(slug, rootDir);
    if (taskResolution.ok) {
      reviewIdentity = getTaskImplementerFn(taskResolution.taskFile!);
    }
  }

  // 2. Mode-specific final fallback: named identity (provider-backed) vs "autonomous" (provider=none) (SC 6)
  if (!reviewIdentity) {
    if (providerEnabled) {
      error(fmt.status('FAIL', `No review identity resolved for --push on ${slug}. Start the review with px handoff, or set the task implementer.`));
      exit(1);
      return;
    } else {
      reviewIdentity = 'autonomous';
      log(fmt.status('WARN', `No reviewer/implementer identity resolved for --push; defaulting to "autonomous"`));
    }
  }

  if (!reviewIdentity || (providerEnabled && reviewIdentity === 'autonomous')) {
    error(fmt.status('FAIL', 'No review identity resolved for push.'));
    exit(1);
    return;
  }

  reviewIdentity = resolveReviewUserFn(reviewIdentity);
  const token = readTokenFn(reviewIdentity!, { rootDir: worktree || undefined });
  if (!token) {
    error(fmt.status('FAIL', `No Forgejo token found for user "${reviewIdentity}".`));
    exit(1);
    return;
  }

  // Transition to review before pushing so the state change is included in the PR update
  await transitionTaskFn(slug, 'review', { rootDir, log });

  log(fmt.status('INFO', `Pushing ${branch} to the review provider as ${reviewIdentity}...${force ? ' (force-with-lease)' : ''}`));
  if (worktree) {
    log(fmt.status('INFO', `Found dedicated worktree: ${worktree}`));
  }

  let result = createPrFn(branch, reviewIdentity!, token, { rootDir, forceWithLease: true }) as Record<string, unknown>;
  if (!result.ok && /Repository not found/i.test((result.error as string) || '')) {
    const reviewAdapter = resolveReviewAdapterFn(rootDir) as Record<string, any>;
    const ownerLogin = (reviewAdapter.repo && reviewAdapter.repo.split('/')[0]) || 'human';
    const bootstrap = await bootstrapReviewSurfaceFn(rootDir, {
      baseUrl: reviewAdapter.baseUrl,
      repo: reviewAdapter.repo,
      ownerLogin,
      ownerPassword: '',
      agentPasswords: [],
    }, {
      interactive: false,
      log,
      error,
    });
    if ((bootstrap as Record<string, unknown>).ok) {
      result = createPrFn(branch, reviewIdentity!, token, { rootDir, forceWithLease: true }) as Record<string, unknown>;
    }
  }

  if (!result.ok) {
    error(fmt.status('FAIL', `Push to review provider failed: ${result.error}`));
    exit(1);
    return;
  }

  log(fmt.status('PASS', `Branch pushed and PR updated for ${branch}.`));
}

// ============================================================================
// Command: showReviewStatus
// ============================================================================

export async function showReviewStatus(
  slug: string,
  options: {
    log?: (_msg: string) => void;
    readReviewStateFn?: typeof readReviewState;
    resolveWorktreeFn?: typeof resolveWorktree;
  } = {}
): Promise<void> {
  const log = options.log || fmt.log.plain;
  const readReviewStateFn = options.readReviewStateFn || readReviewState;
  const resolveWorktreeFn = options.resolveWorktreeFn || resolveWorktree;

  const worktree = resolveWorktreeFn(slug) || process.cwd();
  const state = await Promise.resolve(readReviewStateFn(slug, worktree));

  log(fmt.status('INFO', `Review status for mission: ${fmt.slug(slug)}`));

  if (!state) {
    log(fmt.status('INFO', 'No persisted review state found.'));
    return;
  }

  log(`  Round:       ${state.round}`);
  log(`  Phase:       ${state.phase}`);
  log(`  Reviewer:    ${fmt.agent(state.reviewer ?? '')}`);
  log(`  Implementer: ${fmt.agent(state.implementer ?? '')}`);
  log(`  Started at:  ${state.startedAt}`);
  if (state.disposition) {
    log(`  Disposition: ${state.disposition}`);
  }
  if (state.reviewerRetryCount > 0) {
    log(`  Reviewer retries:    ${state.reviewerRetryCount}`);
  }
  if (state.implementerRetryCount > 0) {
    log(`  Implementer retries: ${state.implementerRetryCount}`);
  }
}

// ============================================================================
// Command: commentRound
// ============================================================================

export async function commentRound(
  slug: string,
  message: string,
  options: {
    log?: (_msg: string) => void;
    error?: (_msg: string) => void;
    exit?: (_code: number) => never;
    readReviewStateFn?: typeof readReviewState;
    writeReviewStateFn?: typeof writeReviewState;
    resolveReviewUserFn?: typeof resolveReviewUser;
    resolveForgejoUserFn?: typeof resolveReviewUser;
    rootDir?: string;
    readTokenFn?: typeof readToken;
    postCommentFn?: typeof postComment;
    buildMetadataFooterFn?: typeof buildMetadataFooter;
    missionStore?: MissionStore | null;
  } = {}
): Promise<void> {
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const exit = options.exit || process.exit;
  const readReviewStateFn = options.readReviewStateFn || readReviewState;
  const writeReviewStateFn = options.writeReviewStateFn || writeReviewState;
  const resolveReviewUserFn = options.resolveReviewUserFn || options.resolveForgejoUserFn || resolveReviewUser;
  const rootDir = options.rootDir || resolveWorktree(slug) || process.cwd();
  const missionStore = options.missionStore;

  let reviewIdentity = (await resolveReviewIdentity(slug, rootDir, {
    readReviewStateFn,
  })).identityUser;

  if (!reviewIdentity) {
    error(fmt.status('FAIL', `Cannot determine review identity for ${slug}. Start the review with px handoff, or set FORGEJO_USER.`));
    exit(1);
    return;
  }
  reviewIdentity = resolveReviewUserFn(reviewIdentity);
  const result = await postWorkflowComment(slug, message, {
    rootDir,
    reviewIdentity: reviewIdentity || undefined,
    readTokenFn: options.readTokenFn,
    postCommentFn: options.postCommentFn,
    buildMetadataFooterFn: options.buildMetadataFooterFn,
    log,
    error
  });

  if (!result.ok) {
    exit(1);
    return;
  }

  const currentState = await Promise.resolve(readReviewStateFn(slug, rootDir));
  if (currentState) {
    await persistReviewStateOrThrow(writeReviewStateFn, slug, currentState, rootDir, missionStore);
  }
}

// ============================================================================
// Command: consumeArtifacts
// ============================================================================

export async function consumeArtifacts(
  slug: string,
  options: {
    log?: (_msg: string) => void;
    error?: (_msg: string) => void;
    resolveWorktreeFn?: typeof resolveWorktree;
    transitionTaskFn?: typeof transitionTask;
    consumeReviewerArtifactsFn?: typeof consumeReviewerArtifacts;
    resolveTaskFileFn?: typeof resolveTaskFile;
    getTaskAssigneeFn?: typeof getTaskAssignee;
    getTaskStatusFn?: typeof getTaskStatus;
    resolveArtifactDirFn?: typeof resolveArtifactDir;
    readReviewStateFn?: typeof readReviewState;
    writeReviewStateFn?: typeof writeReviewState;
    createEventFn?: typeof createEvent;
    readArtifactFn?: unknown;
    deleteArtifactFn?: unknown;
    missionStore?: MissionStore | null;
  } = {}
): Promise<{ ok: boolean; consumed: boolean; reviewState?: string | null }> {
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const resolveWorktreeFn = options.resolveWorktreeFn || resolveWorktree;
  const transitionTaskFn = options.transitionTaskFn || transitionTask;
  const consumeReviewerArtifactsFn = options.consumeReviewerArtifactsFn || consumeReviewerArtifacts;
  const resolveTaskFileFn = options.resolveTaskFileFn || resolveTaskFile;
  const getTaskAssigneeFn = options.getTaskAssigneeFn || getTaskAssignee;
  const getTaskStatusFn = options.getTaskStatusFn || getTaskStatus;
  const resolveArtifactDirFn = options.resolveArtifactDirFn || resolveArtifactDir;
  const readReviewStateFn = options.readReviewStateFn || readReviewState;
  const writeReviewStateFn = options.writeReviewStateFn || writeReviewState;

  const worktree = resolveWorktreeFn(slug) || process.cwd();
  const rootDir = worktree;
  const taskResolution = resolveTaskFileFn(slug, rootDir);

  // Resolve artifact directory
  const artifactDir = resolveArtifactDirFn(rootDir);
  log(fmt.status('INFO', `Consuming reviewer artifacts for ${slug} from ${artifactDir}`));

  // Determine reviewer identity from review-state first, then task assignee.
  const { identityUser: stateReviewer } = await resolveReviewIdentity(slug, worktree, {
    readReviewStateFn,
  });
  let reviewer = stateReviewer;
  if (!reviewer && taskResolution.ok) {
    reviewer = getTaskAssigneeFn(taskResolution.taskFile!);
  }
  if (!reviewer) {
    reviewer = 'autonomous';
    log(fmt.status('WARN', `No reviewer identity resolved; defaulting to "${reviewer}"`));
  }

  // Read current state so consumeHumanNotes can merge dedup metadata in-place.
  // Create initial state BEFORE consuming so dedup keys are recorded even on
  // the very first invocation (N1: dedup durable from first run).
  let currentState = await readReviewStateFn(slug, worktree);
  if (!currentState) {
    currentState = new ReviewState(slug, {
      reviewer,
      round: 1,
      phase: 'reviewing',
    });
  }

  // Consume artifacts - this will create reviewer_findings and reviewer_outcome events
  const result = await consumeReviewerArtifactsFn(slug, reviewer, {
    worktree,
    tmpDir: artifactDir,
    log,
    error,
    providerEnabled: false,
    createEventFn: options.createEventFn as any,
    readArtifactFn: options.readArtifactFn as any,
    deleteArtifactFn: options.deleteArtifactFn as any,
    currentState,
  });

  if (!result.consumed) {
    log(fmt.status('WARN', `No reviewer artifact files found at ${artifactDir} for ${slug}.`));
    return { ok: false, consumed: false };
  }

  if (!result.ok) {
    error(fmt.status('FAIL', `Failed to consume reviewer artifacts for ${slug}: ${result.ok === false ? 'missing required fields (findings, outcome, verdict)' : 'unknown failure'}`));
    return { ok: false, consumed: true };
  }

  // Persist state (includes dedup metadata merged by consumeHumanNotes).
  // If this was the first invocation, the initial state is now populated with
  // dedup keys and review data from artifact consumption.
  await persistReviewStateOrThrow(writeReviewStateFn, slug, currentState as any, worktree, options.missionStore);

  // Transition backlog task to review status
  if (taskResolution.ok) {
    const currentStatus = getTaskStatusFn ? getTaskStatusFn(taskResolution.taskFile!) : null;
    if (!currentStatus || currentStatus !== 'review') {
      // The transition is fire-and-forget, and the injected function may be
      // sync or async — normalize before attaching the handler.
      void Promise.resolve(transitionTaskFn(slug, 'review', { rootDir, log })).catch(() => {});
    } else {
      log(fmt.status('INFO', `Backlog task for ${slug} already at review status.`));
    }
  }

  const cleanup = await commitPersistedReviewOutputs(slug, {
    worktree,
    taskFile: taskResolution.ok ? taskResolution.taskFile : null,
    log,
    error
  });
  if (!cleanup.ok) {
    error(fmt.status('FAIL', `Consumed reviewer artifacts for ${slug}, but could not commit the persisted mission artifacts.`));
    return { ok: false, consumed: true };
  }

  log(fmt.status('PASS', `Reviewer artifacts consumed for ${slug}. Backlog task set to review.`));
  return { ok: true, consumed: true, reviewState: result.reviewState };
}

// ============================================================================
// Command: submitReviewRound
// ============================================================================

export async function submitReviewRound(
  slug: string,
  outcome: string,
  message: string,
  options: {
    log?: (_msg: string) => void;
    error?: (_msg: string) => void;
    exit?: (_code: number) => never;
    transitionTaskFn?: typeof transitionTask;
    readReviewStateFn?: typeof readReviewState;
    writeReviewStateFn?: typeof writeReviewState;
    isReviewProviderEnabledFn?: typeof isProviderEnabled;
    isForgejoReviewEnabledFn?: typeof isProviderEnabled;
    resolveReviewUserFn?: typeof resolveReviewUser;
    resolveForgejoUserFn?: typeof resolveReviewUser;
    resolveTaskFileFn?: typeof resolveTaskFile;
    getTaskStatusFn?: typeof getTaskStatus;
    worktree?: string;
    readTokenFn?: typeof readToken;
    postReviewFn?: typeof postReview;
    getPrAuthorFn?: unknown;
    createEventFn?: typeof createEvent;
    buildMetadataFooterFn?: typeof buildMetadataFooter;
    missionStore?: MissionStore | null;
  } = {}
): Promise<void> {
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const exit = options.exit || process.exit;
  const transitionTaskFn = options.transitionTaskFn || transitionTask;
  const readReviewStateFn = options.readReviewStateFn || readReviewState;
  const writeReviewStateFn = options.writeReviewStateFn || writeReviewState;
  const isReviewProviderEnabledFn = options.isReviewProviderEnabledFn || options.isForgejoReviewEnabledFn || isProviderEnabled;
  const resolveReviewUserFn = options.resolveReviewUserFn || options.resolveForgejoUserFn || resolveReviewUser;
  const resolveTaskFileFn = options.resolveTaskFileFn || resolveTaskFile;
  const getTaskStatusFn = options.getTaskStatusFn || getTaskStatus;
  const VALID_OUTCOMES = ['approve', 'request-changes', 'comment'];
  if (!VALID_OUTCOMES.includes(outcome)) {
    error(fmt.status('FAIL', `Unknown review outcome "${outcome}". Valid: ${VALID_OUTCOMES.join(', ')}.`));
    exit(1);
    return;
  }

  const worktree = options.worktree || resolveWorktree(slug) || process.cwd();
  const providerEnabled = isReviewProviderEnabledFn(worktree);

  // For provider=none (standalone), skip provider posting and only update review-state
  if (!providerEnabled) {
    log(fmt.status('INFO', `Review provider is none — skipping provider posting, updating review-state only for ${slug}.`));
    const currentState = await Promise.resolve(readReviewStateFn(slug, worktree));

    let stateToWrite: ReviewState;
    if (currentState) {
      stateToWrite = currentState;
      if (outcome === 'approve') {
        stateToWrite.disposition = 'APPROVED';
        try { stateToWrite.transitionTo('approved'); } catch (_) { /* ignore */ }
      } else if (outcome === 'request-changes') {
        stateToWrite.disposition = 'REQUEST_CHANGES';
        try { stateToWrite.transitionTo('fixing'); } catch (_) { /* ignore */ }
      }
    } else {
      // No existing state, create minimal state for tracking
      const phaseForOutcome = outcome === 'approve' ? 'approved' : 'fixing';
      stateToWrite = new ReviewState(slug, {
        disposition: outcome === 'approve' ? 'APPROVED' : outcome === 'request-changes' ? 'REQUEST_CHANGES' : undefined,
        reviewer: 'autonomous',
        implementer: process.env.WORKFLOW_AGENT || 'autonomous',
        round: 1,
        phase: phaseForOutcome,
      });
    }
    await persistReviewStateOrThrow(writeReviewStateFn, slug, stateToWrite, worktree, options.missionStore);

    // Also transition the backlog task for provider=none so integrate preflight passes
    const backlogStatusMap: Record<string, string> = {
      'approve': 'approved',
      'request-changes': 'review',
      'comment': 'review'
    };
    const backlogStatus = backlogStatusMap[outcome];
    if (backlogStatus) {
      void Promise.resolve(transitionTaskFn(slug, backlogStatus, { rootDir: worktree, log })).catch(() => {
        log(fmt.status('WARN', `Could not transition backlog task ${slug} to ${backlogStatus}.`));
      });
    }

    log(fmt.status('PASS', `Review outcome "${outcome}" recorded locally for ${slug}.`));
    return;
  }

  // For provider-backed reviews, post through the adapter. Review-state is the normal source.
  let reviewIdentity = (await resolveReviewIdentity(slug, worktree, {
    readReviewStateFn,
  })).identityUser;

  if (!reviewIdentity) {
    error(fmt.status('FAIL', `Cannot determine review identity for ${slug}. Start the review with px handoff, or set FORGEJO_USER.`));
    exit(1);
    return;
  }
  reviewIdentity = resolveReviewUserFn(reviewIdentity);
  const result = await postWorkflowReview(slug, outcome, message, {
    worktree,
    reviewIdentity: reviewIdentity || undefined,
    readTokenFn: options.readTokenFn,
    postReviewFn: options.postReviewFn,
    getPrAuthorFn: options.getPrAuthorFn as any,
    writeReviewStateFn: options.writeReviewStateFn,
    createEventFn: options.createEventFn as any,
    readReviewStateFn: options.readReviewStateFn,
    buildMetadataFooterFn: options.buildMetadataFooterFn,
    log,
    error,
    missionStore: options.missionStore,
  });

  // Self-author skip: postWorkflowReview intentionally did not POST to the provider
  // (reviewer == PR author) and already persisted the verdict locally. This is
  // a legitimate same-agent-reviewer fallback, not a failure — do NOT exit(1).
  if (result.ok && result.skipped) {
    await repairStaleActiveTaskAfterReview(slug, {
      rootDir: worktree,
      resolveTaskFileFn,
      getTaskStatusFn,
      transitionTaskFn,
      log,
      error
    });
    log(fmt.status('WARN', `Review outcome "${outcome}" recorded locally for ${slug} (self-approval POST skipped). A different agent or a human must post the formal provider approval.`));
    return;
  }

  if (!result.ok) {
    exit(1);
    return;
  }

  const currentState = await Promise.resolve(readReviewStateFn(slug, worktree));
  if (currentState) {
    if (outcome === 'approve') {
      currentState.disposition = 'APPROVED';
      try { currentState.transitionTo('approved'); } catch (_) { /* ignore */ }
    } else if (outcome === 'request-changes') {
      currentState.disposition = 'REQUEST_CHANGES';
      try { currentState.transitionTo('fixing'); } catch (_) { /* ignore */ }
    }
    await persistReviewStateOrThrow(writeReviewStateFn, slug, currentState, worktree, options.missionStore);
  }

  const taskResolution = resolveTaskFileFn(slug, worktree);
  const currentStatus = taskResolution.ok ? getTaskStatusFn(taskResolution.taskFile!) : null;
  let backlogStatus: string | null = null;

  if (outcome === 'approve') {
    backlogStatus = currentStatus === 'active' ? 'review' : 'approved';
  } else if (outcome === 'request-changes' || outcome === 'comment') {
    backlogStatus = 'review';
  }

  if (backlogStatus) {
    void Promise.resolve(transitionTaskFn(slug, backlogStatus, { rootDir: worktree, log })).catch(() => {
      log(fmt.status('WARN', `Could not transition backlog task ${slug} to ${backlogStatus}.`));
    });
  }
}

// ============================================================================
// Command: closeMissionPr
// ============================================================================

export async function closeMissionPr(
  slug: string,
  options: {
    log?: (_msg: string) => void;
    error?: (_msg: string) => void;
    exit?: (_code: number) => never;
    readTokenFn?: typeof readToken;
    readReviewStateFn?: typeof readReviewState;
    resolveReviewUserFn?: typeof resolveReviewUser;
    resolveForgejoUserFn?: typeof resolveReviewUser;
    closePrFn?: typeof closePr;
    worktree?: string;
  } = {}
): Promise<void> {
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const exit = options.exit || process.exit;
  const readTokenFn = options.readTokenFn || readToken;
  const readReviewStateFn = options.readReviewStateFn || readReviewState;
  const resolveReviewUserFn = options.resolveReviewUserFn || options.resolveForgejoUserFn || resolveReviewUser;
  const closePrFn = options.closePrFn || closePr;
  const worktree = options.worktree || resolveWorktree(slug) || process.cwd();
  const branch = missionBranchName(slug, worktree);

  let reviewIdentity = (await resolveReviewIdentity(slug, worktree, {
    readReviewStateFn,
  })).identityUser;

  if (!reviewIdentity) {
    error(fmt.status('FAIL', `Cannot determine review identity for ${slug}. Start the review with px handoff, or set FORGEJO_USER.`));
    exit(1);
    return;
  }
  reviewIdentity = resolveReviewUserFn(reviewIdentity);

  const token = readTokenFn(reviewIdentity!, { rootDir: worktree });
  if (!token) {
    error(fmt.status('FAIL', `No Forgejo token found for user "${reviewIdentity}".`));
    exit(1);
    return;
  }

  log(fmt.status('INFO', `Closing PR for ${branch} as ${reviewIdentity}...`));
  const result = await closePrFn(branch, token, reviewIdentity!) as Record<string, unknown>;

  if (!result.ok) {
    exit(1);
  }
}

// ============================================================================
// Event CLI Handlers
// ============================================================================

export async function createEventHandler(
  slug: string,
  args: string[],
  options: {
    log?: (_msg: string) => void;
    error?: (_msg: string) => void;
    exit?: (_code: number) => never;
    resolveWorktreeFn?: typeof resolveWorktree;
    readReviewStateFn?: typeof readReviewState;
  } = {}
): Promise<void> {
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const exit = options.exit || process.exit;
  const resolveWorktreeFn = options.resolveWorktreeFn || resolveWorktree;

  const eventType = flagValue(args, '--type');
  const inputFile = flagValue(args, '--input-file');
  const actor = flagValue(args, '--actor');
  const roundRaw = flagValue(args, '--round');
  const phase = flagValue(args, '--phase');
  const disposition = flagValue(args, '--disposition');
  const verdict = flagValue(args, '--verdict');

  if (!eventType) {
    error(fmt.status('FAIL', '--create-event requires --type <classification>'));
    exit(1);
    return;
  }

  // Validate event type first
  if (!isValidEventType(eventType)) {
    error(fmt.status('FAIL', `Invalid event type "${eventType}". Valid: ${(ALL_EVENT_TYPES as unknown as string[]).join(', ')}`));
    exit(1);
    return;
  }

  // Read content from input file or stdin
  let content = '';
  if (inputFile) {
    try {
      content = fs.readFileSync(inputFile, 'utf8');
      log(fmt.status('INFO', `Read event content from: ${inputFile}`));
    } catch (err) {
      error(fmt.status('FAIL', `Failed to read input file: ${(err as Error).message}`));
      exit(1);
      return;
    }
  }

  const round = roundRaw ? parseInt(roundRaw, 10) : undefined;
  if (roundRaw && isNaN(round!)) {
    error(fmt.status('FAIL', `--round must be a number, got "${roundRaw}"`));
    exit(1);
    return;
  }

  const worktree = resolveWorktreeFn(slug) || process.cwd();

  const params: Record<string, unknown> = { content };
  if (round !== undefined) { params.round = round; }
  if (phase) { params.phase = phase; }
  if (actor) { params.actor = actor; }
  if (disposition) { params.disposition = disposition; }
  if (verdict) { params.verdict = verdict; }

  const readReviewStateFn = options.readReviewStateFn || readReviewState;
  const { identityUser: stateReviewIdentity } = await resolveReviewIdentity(slug, worktree, {
    readReviewStateFn,
  });
  const reviewIdentity = actor || stateReviewIdentity;

  // SC 4: For mirrored event types, a provider identity is required before creating the event.
  if (shouldMirrorToProvider(eventType) && !reviewIdentity) {
    error(fmt.status('FAIL', 'Cannot determine review identity for a mirrored event. Start the review with px handoff, or use --actor.'));
    exit(1);
    return;
  }

  // Extract fields from content if structured
  const itemDispositions: import('../../domain/review.js').ReviewItemDisposition[] = [];
  if (content.includes('fixed_items:') || content.includes('fixedItems:')) {
    try {
      const frontmatterMatch = content.match(/fixed_items:\s*(\[[^\]]*\])/i);
      if (frontmatterMatch) {
        const ids = JSON.parse(frontmatterMatch[1]) as string[];
        itemDispositions.push(...ids.map((id) => ({ kind: 'fixed' as const, findingId: id as import('../../domain/review.js').ReviewFindingId })));
      }
    } catch (_) { /* ignore */ }
    try {
      const frontmatterMatch = content.match(/pushed_back_items:\s*(\[[^\]]*\])/i);
      if (frontmatterMatch) {
        const ids = JSON.parse(frontmatterMatch[1]) as string[];
        itemDispositions.push(...ids.map((id) => ({ kind: 'pushed_back' as const, findingId: id as import('../../domain/review.js').ReviewFindingId })));
      }
    } catch (_) { /* ignore */ }
    try {
      const frontmatterMatch = content.match(/parked_items:\s*(\[[^\]]*\])/i);
      if (frontmatterMatch) {
        const ids = JSON.parse(frontmatterMatch[1]) as string[];
        itemDispositions.push(...ids.map((id) => ({ kind: 'parked' as const, findingId: id as import('../../domain/review.js').ReviewFindingId })));
      }
    } catch (_) { /* ignore */ }
    try {
      const frontmatterMatch = content.match(/blocked_reason:\s*"([^"]*)"/i);
      if (frontmatterMatch) { params.blockedReason = frontmatterMatch[1]; }
    } catch (_) { /* ignore */ }
  }
  if (itemDispositions.length > 0) {
    (params as Record<string, unknown>).itemDispositions = itemDispositions;
  }

  // Create the event
  const createEventFn = (options as any).createEventFn || createEvent;
  const result = await createEventFn(slug, eventType, params as any, {
    worktree,
    skipGit: false,
    log,
    error
  });

  if (!result.ok) {
    error(fmt.status('FAIL', `Could not create event: ${result.error}`));
    exit(1);
    return;
  }

  log(fmt.status('PASS', `Created review event at: ${result.path}`));
}

export function importLegacyHandler(
  slug: string,
  args: string[],
  options: {
    log?: (_msg: string) => void;
    error?: (_msg: string) => void;
    exit?: (_code: number) => never;
    resolveWorktreeFn?: typeof resolveWorktree;
  } = {}
): void {
  const log = options.log || fmt.log.plain;
  const _error = options.error || fmt.log.plainError;
  const _exit = options.exit || process.exit;
  const resolveWorktreeFn = options.resolveWorktreeFn || resolveWorktree;

  const _tmpDir = flagValue(args, '--tmp-dir') || process.env.WORKFLOW_TMP_DIR || os.tmpdir();
  const _worktree = resolveWorktreeFn(slug) || process.cwd();

  // architecture migration: the legacy /tmp/ artifact import path is removed. Review
  // events remain file-backed under missions/<slug>/review-events/ until the
  // architecture migration cutover moves them onto the SQLite Review aggregate.
  log(fmt.status('INFO', `Legacy /tmp artifact import was removed by architecture migration.`));
  log(fmt.status('PASS', `Legacy import handler completed for ${slug} (no artifacts to migrate).`));
}

/**
 * `px review <slug> --backfill-review [--dry-run]`
 *
 * Seed the Review aggregate for a mission handed off before the architecture migration
 * cutover, so `px review --continue` can resume it. Reports and writes nothing
 * when the mission already has a Review or has no legacy state to migrate.
 */
export async function backfillReviewHandler(
  slug: string,
  args: string[],
  options: {
    log?: (_msg: string) => void;
    error?: (_msg: string) => void;
    exit?: (_code: number) => never;
    resolveWorktreeFn?: typeof resolveWorktree;
    backfillReviewFn?: typeof backfillReviewFromLegacyState;
  } = {}
): Promise<void> {
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const exit = options.exit || process.exit;
  const resolveWorktreeFn = options.resolveWorktreeFn || resolveWorktree;
  const backfillReviewFn = options.backfillReviewFn || backfillReviewFromLegacyState;

  const apply = !args.includes('--dry-run');
  const worktree = resolveWorktreeFn(slug) || process.cwd();
  const result = await backfillReviewFn(slug, worktree, { apply });

  switch (result.outcome) {
  case 'backfilled':
    log(fmt.status('PASS', `Backfilled review for ${slug}: ${result.rounds} round(s), now at round ${result.round} (${result.phase}).`));
    return;
  case 'would-backfill':
    log(fmt.status('INFO', `Would backfill review for ${slug}: ${result.rounds} round(s), resuming at round ${result.round} (${result.phase}).`));
    log(fmt.status('INFO', 'Dry run — re-run without --dry-run to write.'));
    return;
  case 'already-present':
    log(fmt.status('INFO', `Mission ${slug} already has a review; nothing to backfill.`));
    return;
  case 'no-legacy-state':
    log(fmt.status('INFO', `Mission ${slug} has no review-state.json to migrate.`));
    return;
  case 'failed':
    error(fmt.status('FAIL', `Could not backfill review for ${slug}: ${result.diagnostic}`));
    exit(1);
    return;
  }
}

/** Rebuild a missing round-one aggregate from an operator-supplied handoff record. */
export async function reconcileInterruptedHandoffHandler(
  slug: string,
  args: string[],
  options: {
    log?: (_msg: string) => void;
    error?: (_msg: string) => void;
    exit?: (_code: number) => never;
    resolveWorktreeFn?: typeof resolveWorktree;
    resolveTaskFileFn?: typeof resolveTaskFile;
    getTaskStatusFn?: typeof getTaskStatus;
    reconcileInterruptedHandoffFn?: typeof reconcileInterruptedHandoff;
    missionStore?: MissionStore | null;
  } = {},
): Promise<void> {
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const exit = options.exit || process.exit;
  const worktree = (options.resolveWorktreeFn || resolveWorktree)(slug) || process.cwd();
  const taskResolution = (options.resolveTaskFileFn || resolveTaskFile)(slug, worktree);
  if (!taskResolution.ok) {
    error(fmt.status('FAIL', `Cannot reconcile ${slug}: Backlog task is missing or ambiguous. Restore the task in review, then retry.`));
    exit(1);
    return;
  }
  if ((options.getTaskStatusFn || getTaskStatus)(taskResolution.taskFile!) !== 'review') {
    error(fmt.status('FAIL', `Cannot reconcile ${slug}: Backlog task is not in review. Restore its review status before retrying.`));
    exit(1);
    return;
  }
  const result = await (options.reconcileInterruptedHandoffFn || reconcileInterruptedHandoff)(slug, {
    sourceBranch: flagValue(args, '--branch') || '',
    targetBranch: flagValue(args, '--target') || '',
    reviewer: flagValue(args, '--reviewer') || '',
    implementer: flagValue(args, '--implementer') || '',
    revision: flagValue(args, '--revision') || '',
    eligibleReviewers: repeatedFlagValues(args, '--eligible-reviewer'),
    startedAt: new Date().toISOString(),
  }, worktree, { missionStore: options.missionStore });
  if (result.outcome === 'reconciled') {
    log(fmt.status('PASS', `Reconciled round-one review for ${slug}. Re-run px review ${slug} --start to launch the reviewer.`));
    return;
  }
  if (result.outcome === 'already-present') {
    log(fmt.status('INFO', `Mission ${slug} already has a valid Review aggregate; nothing to reconcile.`));
    return;
  }
  error(fmt.status('FAIL', `Cannot reconcile ${slug}: ${result.diagnostic}`));
  exit(1);
}

export { ReviewWorkflowAdapter, createReviewWorkflowAdapter } from './review-workflow-adapter.js';
