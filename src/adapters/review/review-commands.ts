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
import { resolveTaskFile, getTaskStatus, getAcceptanceCriteria, getTaskImplementer, reportTaskResolution, transitionTask } from '../backlog/backlog.js';
import { toVirtual } from '../config/state-map.js';
import { getPrStatus, readToken, postComment, postReview, createPr, getComments, closePr, resolveReviewUser, isProviderEnabled } from './review-adapter.js';
import { buildAutonomousReviewMatrix, formatMatrixSummary } from '../agents/runtime-matrix.js';
import { readReviewState, writeReviewState, resolveReviewIdentity, ReviewState, persistReviewStateOrThrow, backfillReviewFromLegacyState, reconcileInterruptedHandoff } from './review-state.js';
import type { MissionStore } from '../../application/domain-ports.js';
import type { MissionLifecycleService } from '../../application/mission-lifecycle-service.js';
import { transitionReviewRepair } from '../../application/review-repair-lifecycle.js';
import { parseReviewFindings, recordRequestedChanges, recordApproval, approvalLegalDiagnostic } from './review-round.js';
import { missionId } from '../../domain/mission.js';
import { currentReviewRound, reviewFindingId, reviewStatus, resumeReview, invalidateBlocker, type Review, type ReviewStatus, type ReviewItemDisposition, type ReviewFindingId } from '../../domain/review.js';
import { createEvent, ALL_EVENT_TYPES, isValidEventType, shouldMirrorToProvider, readAllEvents } from './review-events.js';
import { formatVerificationCommand, runVerificationGate } from '../verification/verification.js';
import { bootstrapReviewSurface } from './setup-review.js';
import { resolveReviewAdapter } from '../config/product-config.js';
import { buildMetadataFooter, postWorkflowComment, postWorkflowReview } from './review-artifacts.js';
import { runPhaseGates } from '../config/repository-gates.js';
import { flagValue, repeatedFlagValues } from './review-cli-flags.js';
import { performHandoff } from '../cli/commands/handoff.js';
export { REVIEW_FLAGS, REVIEW_VALUE_FLAGS, unknownReviewFlags, flagValue, readTextFlag, repeatedFlagValues } from './review-cli-flags.js';
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
    error(`Cannot determine review identity. Set FORGEJO_USER, start the review with px review ${slug} --start, or assign the task implementer.`);
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
// Command: resumeIntervenedReview
// ===============================================================================

/**
 * Recover a review stopped in `human-intervention`.
 *
 * A review stopped by an implementer retry-budget exhaustion, a manual operator
 * stop, or the gate-rebound path carries a `human-intervention` flag that makes
 * every subsequent handoff fail (`A submitted review must be awaiting a reviewer
 * decision`). `resumeReview` is the one domain transition that clears the flag,
 * but it derives the next status from the surviving round rather than forcing
 * `awaiting-review`: a round that already holds an implementer response flows to
 * `ready-for-next-round`, a `changes-requested` round with no response flows to
 * `awaiting-implementation`, and an undecided round flows to `awaiting-review`.
 *
 * This is the explicit "I fixed it manually, resume" path: it requires a named
 * operator, and it deliberately does not re-run the review loop (which would
 * hit the same guard). `--continue` is the parallel path that relaunches the
 * loop after clearing the stop.
 */
export async function resumeIntervenedReview(
  slug: string,
  args: string[],
  options: {
    log?: (_msg: string) => void;
    error?: (_msg: string) => void;
    exit?: (_code: number) => never;
    resolveWorktreeFn?: typeof resolveWorktree;
    missionStore?: MissionStore | null;
    createEventFn?: typeof createEvent;
  } = {}
): Promise<void> {
  const result = await clearHumanInterventionIfPresent(slug, args, {
    ...options,
    requireExplicitActor: true,
  });
  if (!result.cleared) {
    // No intervention to clear. Only surface a message when a review exists but
    // is in another status, so an already-recovered review stays quiet.
    if (result.review && result.status !== 'human-intervention') {
      (options.log || fmt.log.plain)(fmt.status('INFO', `Review for ${slug} is ${result.status}; nothing to resume.`));
    }
    return;
  }
  (options.log || fmt.log.plain)(
    fmt.status('PASS', `Review for ${slug} resumed by ${result.operator}: intervention cleared, status now ${result.status}.`),
  );
}

/**
 * Clear a persisted mission review's `human-intervention` stop, if present.
 *
 * Shared by `px review --resume` (explicit operator, no relaunch) and
 * `px review --continue` (operator-attributed, then relaunch). `resumeReview`
 * is the sole domain transition that clears the flag; the Review aggregate is
 * the sole write authority (ADR 0053), so we persist the recovered review
 * directly via `store.save` rather than merging over the escalated state that
 * would resurrect the intervention.
 *
 * Attribution is to the operator (the human at the terminal), never to the
 * review's own reviewer/implementer — that is the agent that got stuck, and
 * crediting it would let a stuck review resume itself. Identity resolution
 * order:
 *   1. an explicit `--actor`;
 *   2. the current git user (`user.name`), which is the human at the terminal;
 *   3. when `requireExplicitActor` is set, a FAIL; otherwise `operator`.
 *
 * Returns `cleared:false` (no exit) when there is no intervention to clear, so
 * callers can proceed without treating a no-op as an error. An `exit`-style
 * failure (no bound store, no review, or a missing required actor) exits.
 */
interface InterventionClearResult {
  cleared: boolean;
  operator: string;
  review: Review | null;
  status: ReviewStatus | null;
}

async function clearHumanInterventionIfPresent(
  slug: string,
  args: string[],
  options: {
    log?: (_msg: string) => void;
    error?: (_msg: string) => void;
    exit?: (_code: number) => never;
    resolveWorktreeFn?: typeof resolveWorktree;
    missionStore?: MissionStore | null;
    createEventFn?: typeof createEvent;
    runFn?: typeof run;
    requireExplicitActor?: boolean;
  },
): Promise<InterventionClearResult> {
  const error = options.error || fmt.log.plainError;
  const exit = options.exit || process.exit;
  const store = options.missionStore ?? null;

  if (!store) {
    error(fmt.status('FAIL', `No Mission authority bound for ${slug}; cannot clear the intervention.`));
    exit(1);
    return { cleared: false, operator: '', review: null, status: null };
  }

  let result;
  try {
    result = await store.load(missionId(slug));
  } catch (loadError) {
    const diagnostic = loadError instanceof Error ? loadError.message : String(loadError);
    error(fmt.status('FAIL', `Could not load review for ${slug}: ${diagnostic}`));
    exit(1);
    return { cleared: false, operator: '', review: null, status: null };
  }

  if (result.kind !== 'found' || !result.mission.review) {
    error(fmt.status('FAIL', `Mission ${slug} has no review; px review ${slug} --start begins a review.`));
    exit(1);
    return { cleared: false, operator: '', review: null, status: null };
  }

  const review = result.mission.review;
  // Accept recovery only for human-intervention: reviewStatus reports 'approved'
  // ahead of a stale intervention, so an approved review is never a candidate
  // and every other status retains its normal guards. No exit here: a review
  // that is simply not stopped is a no-op, not an error.
  if (reviewStatus(review) !== 'human-intervention') {
    return { cleared: false, operator: '', review, status: reviewStatus(review) };
  }

  const explicitActor = (() => {
    const actor = flagValue(args, '--actor');
    return actor && actor.trim() ? actor.trim() : null;
  })();

  // Attribution is to the operator, never to the review's own reviewer/
  // implementer — that is the agent that got stuck, and crediting it would let a
  // stuck review resume itself. Resolve the operator identity: the explicit
  // --resume path requires a named --actor (no git fallback, so a stuck review
  // cannot be cleared by anyone the operator did not explicitly name); the
  // zero-ceremony --continue path prefers --actor, then the current git user,
  // then a generic `operator` attribution.
  let operator: string;
  if (explicitActor) {
    operator = explicitActor;
  } else if (options.requireExplicitActor) {
    error(fmt.status('FAIL', `px review ${slug} requires --actor <name>; only an authorized operator may clear a human-intervention stop.`));
    exit(1);
    return { cleared: false, operator: '', review, status: reviewStatus(review) };
  } else {
    const worktree = options.resolveWorktreeFn ? (options.resolveWorktreeFn(slug) ?? process.cwd()) : process.cwd();
    try {
      const gitUser = (options.runFn ?? run)('git', ['-C', worktree, 'config', 'user.name']);
      const resolved = (gitUser.stdout || '').trim();
      operator = resolved || 'operator';
    } catch {
      operator = 'operator';
    }
  }

  // The domain transition clears the intervention and derives the surviving
  // round status; it does not force awaiting-review.
  const recovered = resumeReview(review);
  // Persist the recovered domain review directly: the Review aggregate is the
  // sole write authority (ADR 0053), so writing it clears the mission store's
  // intervention columns and regenerates state from the recovered review
  // (metadataFromReview omits the escalation keys when intervention is null)
  // rather than merging over the escalated state that would resurrect it.
  await store.save({ ...result.mission, review: recovered }, result.version);
  // Attribute the override as a review event the way createEventHandler does for
  // every operator action. Recorded on the Review aggregate, so an operator
  // inspecting review-events/ can see that a human-intervention stop was raised
  // and cleared — not only that the console PASS line said so.
  const createEventFn = options.createEventFn ?? createEvent;
  await createEventFn(
    slug,
    'human_note',
    {
      actor: operator,
      content: `cleared a human-intervention stop; reviewStatus now ${reviewStatus(recovered)}. Override attributed to ${operator}.`,
      round: currentReviewRound(recovered).number,
      phase: 'reviewing',
    },
    {
      worktree: options.resolveWorktreeFn ? (options.resolveWorktreeFn(slug) ?? undefined) : undefined,
      skipGit: false,
      log: options.log,
      error,
      missionStore: options.missionStore,
    },
  ).catch((writeError) => {
    error(fmt.status('WARN', `Cleared the intervention for ${slug}, but could not record the override event: ${writeError instanceof Error ? writeError.message : String(writeError)}`));
  });

  return { cleared: true, operator, review: recovered, status: reviewStatus(recovered) };
}

/**
 * Clear a persisted mission review's `human-intervention` stop for the
 * `px review --continue` path, then return so the caller relaunches the loop.
 *
 * Unlike `--resume`, `--continue` relaunches the review loop after clearing the
 * stop. Attribution is to the operator (the current git user) with zero
 * ceremony, and a missing operator identity falls back to `operator` rather
 * than failing — the human at the terminal is the one who ran `--continue`, and
 * they are the operator. Returns whether the intervention was cleared.
 */
export async function continueReviewClearsIntervention(
  slug: string,
  args: string[],
  options: {
    log?: (_msg: string) => void;
    error?: (_msg: string) => void;
    exit?: (_code: number) => never;
    resolveWorktreeFn?: typeof resolveWorktree;
    missionStore?: MissionStore | null;
    createEventFn?: typeof createEvent;
    runFn?: typeof run;
  } = {}
): Promise<boolean> {
  const result = await clearHumanInterventionIfPresent(slug, args, {
    ...options,
    requireExplicitActor: false,
  });
  if (result.cleared) {
    (options.log || fmt.log.plain)(
      fmt.status('PASS', `Review for ${slug}: intervention cleared (attributed to ${result.operator}); continuing review loop.`),
    );
  }
  return result.cleared;
}

/**
 * Invalidate a persisted mission review's BLOCKED/PARKED stop for the
 * `px review --continue` path, then return so the caller relaunches the loop.
 *
 * The review loop relaunches the implementer on every `--continue` whenever it
 * finds an existing BLOCKED/PARKED disposition, so a blocker that the operator
 * has resolved by hand (for example the terminal `external-formal-approval-
 * owed` stop on an already-approved mission) spins forever. `--continue` is the
 * operator's declaration that the blocker is resolved, so clear the
 * disposition and reset the round to `reviewing`: the loop re-polls the
 * reviewer on the current tree instead of relaunching the stuck implementer.
 * Attribution is to the operator (the current git user) with zero ceremony,
 * mirroring `continueReviewClearsIntervention`. Returns whether a stop was
 * invalidated.
 */
export async function continueReviewInvalidatesBlocker(
  slug: string,
  args: string[],
  options: {
    log?: (_msg: string) => void;
    error?: (_msg: string) => void;
    exit?: (_code: number) => never;
    resolveWorktreeFn?: typeof resolveWorktree;
    missionStore?: MissionStore | null;
    createEventFn?: typeof createEvent;
    runFn?: typeof run;
  } = {}
): Promise<{ invalidated: boolean; operator: string; status: ReviewStatus }> {
  const error = options.error || fmt.log.plainError;
  const exit = options.exit || process.exit;
  const store = options.missionStore ?? null;

  if (!store) {
    error(fmt.status('FAIL', `No Mission authority bound for ${slug}; cannot invalidate the BLOCKED state.`));
    exit(1);
    return { invalidated: false, operator: '', status: 'awaiting-review' };
  }

  let result;
  try {
    result = await store.load(missionId(slug));
  } catch (loadError) {
    const diagnostic = loadError instanceof Error ? loadError.message : String(loadError);
    error(fmt.status('FAIL', `Could not load review for ${slug}: ${diagnostic}`));
    exit(1);
    return { invalidated: false, operator: '', status: 'awaiting-review' };
  }

  if (result.kind !== 'found' || !result.mission.review) {
    error(fmt.status('FAIL', `Mission ${slug} has no review; px review ${slug} --start begins a review.`));
    exit(1);
    return { invalidated: false, operator: '', status: 'awaiting-review' };
  }

  const review = result.mission.review;
  const round = currentReviewRound(review);
  if (round.disposition !== 'BLOCKED' && round.disposition !== 'PARKED') {
    // No implementer stop to clear: a `--continue` on an otherwise-normal
    // review is a no-op here, not an error. The loop handles it normally.
    return { invalidated: false, operator: '', status: reviewStatus(review) };
  }

  // Attribution is to the operator, never to the stuck implementer. Prefer the
  // explicit --actor, then the current git user, then a bare `operator` label.
  const explicitActor = (() => {
    const actor = flagValue(args, '--actor');
    return actor && actor.trim() ? actor.trim() : null;
  })();
  const operator = explicitActor || (() => {
    const worktree = options.resolveWorktreeFn ? (options.resolveWorktreeFn(slug) ?? process.cwd()) : process.cwd();
    try {
      const gitUser = (options.runFn ?? run)('git', ['-C', worktree, 'config', 'user.name']);
      return (gitUser.stdout || '').trim() || 'operator';
    } catch {
      return 'operator';
    }
  })();

  const invalidated = invalidateBlocker(review, new Date().toISOString());
  // The Review aggregate is the sole write authority (ADR 0053): persisting it
  // clears the round's BLOCKED disposition and resets its phase to `reviewing`,
  // so the relaunched loop re-polls the reviewer instead of relaunching the
  // stuck implementer.
  await store.save({ ...result.mission, review: invalidated }, result.version);

  const createEventFn = options.createEventFn ?? createEvent;
  await createEventFn(
    slug,
    'human_note',
    {
      actor: operator,
      content: `invalidated a ${round.disposition} stop; reviewStatus now ${reviewStatus(invalidated)}. Operator cleared the blocker via --continue.`,
      round: currentReviewRound(invalidated).number,
      phase: 'reviewing',
    },
    {
      worktree: options.resolveWorktreeFn ? (options.resolveWorktreeFn(slug) ?? undefined) : undefined,
      skipGit: false,
      log: options.log,
      error,
      missionStore: options.missionStore,
    },
  ).catch((writeError) => {
    error(fmt.status('WARN', `Invalidated the BLOCKED state for ${slug}, but could not record the override event: ${writeError instanceof Error ? writeError.message : String(writeError)}`));
  });

  return { invalidated: true, operator, status: reviewStatus(invalidated) };
}

// ===============================================================================
// Command: verifyReview
// ============================================================================

/** Failures block the review; warnings only annotate it. */
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
    // Auto-bounce for declared-gate validation failures
    if (result.reason === 'validation-failed' && !result.recoveryAttempted) {
      if (options.missionStore) { await transitionReviewRepair(slug, 'active', reviewIdentity, options.missionStore, options.lifecycleService ?? null); }
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
    error(fmt.status('FAIL', `Cannot determine review identity for ${slug}. Start the review with px review ${slug} --start, or set FORGEJO_USER.`));
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

  const reviewIdentity = await resolvePushReviewIdentity(slug, rootDir, providerEnabled, readReviewStateFn, resolveTaskFileFn, getTaskImplementerFn, log, error, exit);
  if (!reviewIdentity) { return; }
  const resolvedIdentity = resolveReviewUserFn(reviewIdentity) || reviewIdentity;
  const token = readTokenFn(resolvedIdentity, { rootDir: worktree || undefined });
  if (!token) {
    error(fmt.status('FAIL', `No Forgejo token found for user "${resolvedIdentity}".`));
    exit(1);
    return;
  }

  // Transition to review before pushing so the state change is included in the PR update
  await transitionTaskFn(slug, 'review', { rootDir, log });

  log(fmt.status('INFO', `Pushing ${branch} to the review provider as ${resolvedIdentity}...${force ? ' (force-with-lease)' : ''}`));
  if (worktree) {
    log(fmt.status('INFO', `Found dedicated worktree: ${worktree}`));
  }

  let result = createPrFn(branch, resolvedIdentity, token, { rootDir, forceWithLease: true }) as Record<string, unknown>;
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
      result = createPrFn(branch, resolvedIdentity, token, { rootDir, forceWithLease: true }) as Record<string, unknown>;
    }
  }

  if (!result.ok) {
    error(fmt.status('FAIL', `Push to review provider failed: ${result.error}`));
    exit(1);
    return;
  }

  log(fmt.status('PASS', `Branch pushed and PR updated for ${branch}.`));
}

async function resolvePushReviewIdentity(slug: string, rootDir: string, providerEnabled: boolean, readState: typeof readReviewState, resolveTask: typeof resolveTaskFile, getImplementer: typeof getTaskImplementer, log: Function, error: Function, exit: Function): Promise<string | null> {
  const { identityUser } = await resolveReviewIdentity(slug, rootDir, { readReviewStateFn: readState });
  const task = identityUser ? null : resolveTask(slug, rootDir);
  const taskImplementer = task?.ok ? getImplementer(task.taskFile!) : null;
  const fallback = providerEnabled ? null : 'autonomous';
  const identity = identityUser || taskImplementer || fallback;
  if (!identity || (providerEnabled && identity === 'autonomous')) {
    error(fmt.status('FAIL', providerEnabled ? `No review identity resolved for --push on ${slug}. Start the review with px review ${slug} --start, or set the task implementer.` : 'No review identity resolved for push.'));
    exit(1);
    return null;
  }
  if (!identityUser && !taskImplementer && fallback) { log(fmt.status('WARN', 'No reviewer/implementer identity resolved for --push; defaulting to "autonomous"')); }
  return identity;
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
    error(fmt.status('FAIL', `Cannot determine review identity for ${slug}. Start the review with px review ${slug} --start, or set FORGEJO_USER.`));
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
// Command: submitReviewRound
// ============================================================================

type SubmitReviewOptions = {
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
  lifecycleService?: MissionLifecycleService | null;
  recordRequestedChangesFn?: typeof recordRequestedChanges;
  recordApprovalFn?: typeof recordApproval;
};

/** Repository-configured pre-review gates block an approve (TASK-2457). Returns true when the outcome must stop. */
async function runPreReviewApproveGates(slug: string, worktree: string, log: (_msg: string) => void, error: (_msg: string) => void): Promise<boolean> {
  const preReviewResult = await runPhaseGates('review', {
    slug,
    checkoutPath: worktree,
    log: (/** @type {string} */ msg: string) => log(msg),
    error: (/** @type {string} */ msg: string) => error(msg),
  });
  if (!preReviewResult.ok && !preReviewResult.skipped) {
    error(fmt.status('FAIL', `Pre-review gate "${preReviewResult.failedGate?.key}" failed for ${slug}: ${preReviewResult.error}`));
    error(fmt.status('FAIL', `Mission stays in review. Resolve the gate and retry px review ${slug} --submit-review approve.`));
    return true;
  }
  return false;
}

/** Record the request-changes decision on the Review aggregate. Returns true when the outcome must stop. */
async function recordRequestChangesDecision(slug: string, outcome: string, message: string, options: SubmitReviewOptions, log: (_msg: string) => void, error: (_msg: string) => void): Promise<boolean> {
  if (!options.missionStore) {
    log(fmt.status('WARN', `No Mission authority bound for ${slug}; the request-changes decision was not recorded on the Review aggregate.`));
    return false;
  }
  const recordRequestedChangesFn = options.recordRequestedChangesFn || recordRequestedChanges;
  const parsed = parseReviewFindings(message);
  const decision = await recordRequestedChangesFn(slug, {
    // A hand-written message need not use finding headings; the message
    // itself is then the single finding.
    findings: parsed.length > 0 ? parsed : [{
      id: reviewFindingId('F1'),
      summary: (message.split('\n').find((line) => line.trim()) || `Changes requested for ${slug}`).trim(),
      location: null,
    }],
    comment: message || null,
    decidedAt: new Date().toISOString(),
  }, { missionStore: options.missionStore, lifecycleService: options.lifecycleService });
  if (decision.outcome === 'failed') {
    error(fmt.status('FAIL', `Review outcome "${outcome}" could not be recorded for ${slug}: ${decision.diagnostic}`));
    return true;
  }
  if (decision.outcome === 'unchanged') {
    log(fmt.status('INFO', `Review outcome "${outcome}" for ${slug} already recorded (${decision.reason}).`));
  }
  return false;
}

/** Record the authoritative approve on the Review aggregate. Returns true when the outcome must stop. */
async function recordApprovalDecision(slug: string, outcome: string, message: string, options: SubmitReviewOptions, log: (_msg: string) => void, error: (_msg: string) => void): Promise<boolean> {
  if (!options.missionStore) {
    log(fmt.status('WARN', `No Mission authority bound for ${slug}; the approve decision was not recorded on the Review aggregate.`));
    return false;
  }
  const recordApprovalFn = options.recordApprovalFn || recordApproval;
  const decision = await recordApprovalFn(slug, {
    comment: message || null,
    decidedAt: new Date().toISOString(),
    source: { kind: 'local' },
  }, { missionStore: options.missionStore, lifecycleService: options.lifecycleService });
  if (decision.outcome === 'failed') {
    error(fmt.status('FAIL', `Review outcome "${outcome}" could not be recorded for ${slug}: ${decision.diagnostic}`));
    return true;
  }
  if (decision.outcome === 'unchanged') {
    log(fmt.status('INFO', `Review outcome "${outcome}" for ${slug} already recorded (${decision.reason}).`));
  }
  return false;
}

/**
 * provider=none finalization: build or mutate the review state, persist it,
 * transition the Backlog task, and announce the local recording.
 * Returns true when the outcome must stop.
 */
async function applyLocalReviewState(slug: string, outcome: string, message: string, worktree: string, options: SubmitReviewOptions, log: (_msg: string) => void, error: (_msg: string) => void): Promise<boolean> {
  const readReviewStateFn = options.readReviewStateFn || readReviewState;
  const writeReviewStateFn = options.writeReviewStateFn || writeReviewState;
  const transitionTaskFn = options.transitionTaskFn || transitionTask;
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
  try {
    await persistReviewStateOrThrow(writeReviewStateFn, slug, stateToWrite, worktree, options.missionStore);
  } catch (err) {
    // The state write or the review → integration boundary failed. The
    // Mission may still be in review, so the Backlog task must not move —
    // in particular it must not be promoted to approved. px integrate is
    // the repair path.
    error(fmt.status('FAIL', `Review outcome "${outcome}" could not be finalized for ${slug}: ${err instanceof Error ? err.message : String(err)}`));
    error(fmt.status('FAIL', `Recovery: px integrate ${slug}`));
    return true;
  }

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
  return false;
}

/** Check that an approve can legally reach `approved` before the external POST. Returns true when the outcome must stop. */
async function checkProviderApproveLegality(slug: string, options: SubmitReviewOptions, log: (_msg: string) => void, error: (_msg: string) => void): Promise<boolean> {
  if (!options.missionStore) {
    log(fmt.status('WARN', `No Mission authority bound for ${slug}; the approve decision was not recorded on the Review aggregate.`));
    return false;
  }
  const legalDiagnostic = await approvalLegalDiagnostic(slug, { missionStore: options.missionStore });
  if (legalDiagnostic) {
    error(fmt.status('FAIL', `Review outcome "approve" could not be recorded for ${slug}: ${legalDiagnostic}`));
    return true;
  }
  return false;
}

/**
 * provider-backed finalization after a successful POST: mutate and persist the
 * review state, then transition the Backlog task.
 * Returns true when the outcome must stop.
 */
async function finalizeProviderReviewState(slug: string, outcome: string, worktree: string, options: SubmitReviewOptions, log: (_msg: string) => void, error: (_msg: string) => void): Promise<boolean> {
  const readReviewStateFn = options.readReviewStateFn || readReviewState;
  const writeReviewStateFn = options.writeReviewStateFn || writeReviewState;
  const transitionTaskFn = options.transitionTaskFn || transitionTask;
  const resolveTaskFileFn = options.resolveTaskFileFn || resolveTaskFile;
  const getTaskStatusFn = options.getTaskStatusFn || getTaskStatus;

  const currentState = await Promise.resolve(readReviewStateFn(slug, worktree));
  if (currentState) {
    if (outcome === 'approve') {
      currentState.disposition = 'APPROVED';
      try { currentState.transitionTo('approved'); } catch (_) { /* ignore */ }
    } else if (outcome === 'request-changes') {
      currentState.disposition = 'REQUEST_CHANGES';
      try { currentState.transitionTo('fixing'); } catch (_) { /* ignore */ }
    }
    try {
      await persistReviewStateOrThrow(writeReviewStateFn, slug, currentState, worktree, options.missionStore);
    } catch (err) {
      // The state write or the review → integration boundary failed. The
      // Mission may still be in review, so the Backlog task must not be
      // promoted to approved; px integrate is the repair path.
      error(fmt.status('FAIL', `Review outcome "${outcome}" could not be finalized for ${slug}: ${err instanceof Error ? err.message : String(err)}`));
      error(fmt.status('FAIL', `Recovery: px integrate ${slug}`));
      return true;
    }
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
  return false;
}

export async function submitReviewRound(
  slug: string,
  outcome: string,
  message: string,
  options: SubmitReviewOptions = {}
): Promise<void> {
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const exit = options.exit || process.exit;
  const transitionTaskFn = options.transitionTaskFn || transitionTask;
  const readReviewStateFn = options.readReviewStateFn || readReviewState;
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

  // Repository-configured pre-review gates (TASK-2457). The approve is the
  // review -> integration transition; a configured gate that exits non-zero
  // blocks it and leaves the mission in review. Runs from the review checkout
  // with the mission slug, checkout path, and exact phase in its environment.
  if (outcome === 'approve' && await runPreReviewApproveGates(slug, worktree, log, error)) {
    exit(1);
    return;
  }

  // A verdict is a domain decision, not only a provider comment. Recording it
  // is what returns the mission to the implementer and leaves the round able to
  // be resolved and advanced; the flat review-state write below cannot express
  // it, because it carries no findings.
  if (outcome === 'request-changes' && await recordRequestChangesDecision(slug, outcome, message, options, log, error)) {
    exit(1);
    return;
  }

  // An approve is the integration gate itself. It is recorded on the aggregate
  // in exactly one of the two paths below — for provider=none, immediately
  // (there is no external POST to fail); for provider-backed, only after the
  // POST succeeds — so a failed provider POST never leaves an approval behind
  // that `px integrate` would merge with no approval on the pull request. A
  // round that cannot legally reach `approved` (for example still in `fixing`
  // after a request-changes) fails loudly in that branch instead of printing
  // `[PASS]` after a swallowed transition.

  // For provider=none (standalone), skip provider posting and only update review-state
  if (!providerEnabled) {
    log(fmt.status('INFO', `Review provider is none — skipping provider posting, updating review-state only for ${slug}.`));
    // No external POST can fail here, so record the authoritative approve
    // immediately — before the flat review-state write — mirroring the
    // provider-backed post-success recording.
    if (outcome === 'approve' && await recordApprovalDecision(slug, outcome, message, options, log, error)) {
      exit(1);
      return;
    }
    if (await applyLocalReviewState(slug, outcome, message, worktree, options, log, error)) {
      exit(1);
      return;
    }
    return;
  }

  // For provider-backed reviews, post through the adapter. Review-state is the normal source.
  let reviewIdentity = (await resolveReviewIdentity(slug, worktree, {
    readReviewStateFn,
  })).identityUser;

  if (!reviewIdentity) {
    error(fmt.status('FAIL', `Cannot determine review identity for ${slug}. Start the review with px review ${slug} --start, or set FORGEJO_USER.`));
    exit(1);
    return;
  }
  reviewIdentity = resolveReviewUserFn(reviewIdentity);
  // An approve is the integration gate itself: check legality *before* the
  // external POST so an illegal approve (for example still in `fixing` after a
  // request-changes) fails loudly without ever posting, and record the
  // authoritative decision only after the POST succeeds — a failed POST must
  // never leave an approval on the aggregate that `px integrate` would merge
  // with no approval on the pull request. The recording itself happens below,
  // after the `!result.ok` guard.
  if (outcome === 'approve' && await checkProviderApproveLegality(slug, options, log, error)) {
    exit(1);
    return;
  }
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

  // Provider POST succeeded: record the authoritative approve now that the
  // external side-effect is durable, so a failed POST (handled above) never
  // leaves an approval behind. A self-author skip already recorded inside
  // postWorkflowReview and returned early, so reaching here means a real POST
  // went out. Without a bound Mission authority there is nothing to record on
  // the aggregate (the flat review-state write below still mirrors the
  // disposition), matching the no-store WARN taken before the POST.
  if (outcome === 'approve' && options.missionStore && await recordApprovalDecision(slug, outcome, message, options, log, error)) {
    exit(1);
    return;
  }

  if (await finalizeProviderReviewState(slug, outcome, worktree, options, log, error)) {
    exit(1);
    return;
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
    error(fmt.status('FAIL', `Cannot determine review identity for ${slug}. Start the review with px review ${slug} --start, or set FORGEJO_USER.`));
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

/** One `<key>: [ids]` frontmatter list and the disposition kind it records. */
const EVENT_ITEM_LISTS: ReadonlyArray<readonly [RegExp, ReviewItemDisposition['kind']]> = [
  [/fixed_items:\s*(\[[^\]]*\])/i, 'fixed'],
  [/pushed_back_items:\s*(\[[^\]]*\])/i, 'pushed_back'],
  [/parked_items:\s*(\[[^\]]*\])/i, 'parked'],
];

/**
 * Lift the structured item dispositions and blocked reason out of an event body
 * onto `params`. A malformed list is skipped, never fatal: the event body is
 * agent-authored, and a half-parsed list must not lose the event itself.
 */
function applyStructuredEventFields(content: string, params: Record<string, unknown>): void {
  if (!content.includes('fixed_items:') && !content.includes('fixedItems:')) { return; }
  const itemDispositions: ReviewItemDisposition[] = [];
  for (const [pattern, kind] of EVENT_ITEM_LISTS) {
    try {
      const match = content.match(pattern);
      if (!match) { continue; }
      for (const id of JSON.parse(match[1]) as string[]) {
        itemDispositions.push({ kind, findingId: id as ReviewFindingId });
      }
    } catch (_) { /* a malformed list is skipped, not fatal */ }
  }
  const blocked = content.match(/blocked_reason:\s*"([^"]*)"/i);
  if (blocked) { params.blockedReason = blocked[1]; }
  if (itemDispositions.length > 0) { params.itemDispositions = itemDispositions; }
}

/**
 * Parse and validate the `--create-event` flags. Returns null once a diagnostic
 * has been reported and the exit code set, so the caller only has to return.
 */
function parseCreateEventArgs(
  args: string[],
  log: (_msg: string) => void,
  error: (_msg: string) => void,
  exit: (_code: number) => void,
): { eventType: string; actor: string | null; content: string; params: Record<string, unknown> } | null {
  const fail = (message: string) => { error(fmt.status('FAIL', message)); exit(1); return null; };
  const eventType = flagValue(args, '--type');
  if (!eventType) { return fail('--create-event requires --type <classification>'); }
  if (!isValidEventType(eventType)) {
    return fail(`Invalid event type "${eventType}". Valid: ${(ALL_EVENT_TYPES as unknown as string[]).join(', ')}`);
  }

  const inputFile = flagValue(args, '--input-file');
  let content = '';
  if (inputFile) {
    try {
      content = fs.readFileSync(inputFile, 'utf8');
      log(fmt.status('INFO', `Read event content from: ${inputFile}`));
    } catch (err) {
      return fail(`Failed to read input file: ${(err as Error).message}`);
    }
  }

  const roundRaw = flagValue(args, '--round');
  const round = roundRaw ? parseInt(roundRaw, 10) : undefined;
  if (roundRaw && Number.isNaN(round!)) { return fail(`--round must be a number, got "${roundRaw}"`); }

  const actor = flagValue(args, '--actor');
  const params: Record<string, unknown> = { content };
  if (round !== undefined) { params.round = round; }
  for (const [flag, key] of [['--phase', 'phase'], ['--actor', 'actor'], ['--disposition', 'disposition'], ['--verdict', 'verdict']] as const) {
    const value = flagValue(args, flag);
    if (value) { params[key] = value; }
  }
  return { eventType, actor, content, params };
}

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

  const parsed = parseCreateEventArgs(args, log, error, exit);
  if (!parsed) { return; }
  const { eventType, actor, content, params } = parsed;

  const worktree = resolveWorktreeFn(slug) || process.cwd();

  const readReviewStateFn = options.readReviewStateFn || readReviewState;
  const { identityUser: stateReviewIdentity } = await resolveReviewIdentity(slug, worktree, {
    readReviewStateFn,
  });
  const reviewIdentity = actor || stateReviewIdentity;

  // SC 4: For mirrored event types, a provider identity is required before creating the event.
  if (shouldMirrorToProvider(eventType) && !reviewIdentity) {
    error(fmt.status('FAIL', `Cannot determine review identity for a mirrored event. Start the review with px review ${slug} --start, or use --actor.`));
    exit(1);
    return;
  }

  applyStructuredEventFields(content, params);

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
  case 'events-backfilled':
    log(fmt.status('PASS', `Backfilled ${result.events} review event(s) for ${slug} from its exported review-events files.`));
    return;
  case 'would-backfill-events':
    log(fmt.status('INFO', `Would backfill ${result.events} review event(s) for ${slug} from its exported review-events files.`));
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
  // The Mission status is the sole authority for reconciliation: a completed
  // native Mission carries no Backlog task file marked review, so the retired
  // task-file check is replaced by the operator-database lane status. The
  // recovery command rebuilds the missing round-one Review in the store without
  // recreating any legacy file.
  const reconcilable = await isReconcilableMission(slug, options.missionStore);
  if (!reconcilable) {
    error(fmt.status('FAIL', `Cannot reconcile ${slug}: no Mission in the operator database is in the review lane. Restore the Mission to review, then retry.`));
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

/**
 * Whether a slug is reconcilable.
 *
 * The operator database holding the Mission in the `review` lane is the only
 * authority `--reconcile-review` accepts. This replaces the retired Backlog
 * task-file check so a completed native Mission with no task file can be
 * recovered. A store read failure is not reconcilable: the loop keeps failing
 * closed rather than inventing a round-one Review behind the operator's back.
 *
 * @param {string} slug
 * @param {MissionStore|null|undefined} store
 */
async function isReconcilableMission(slug: string, store: MissionStore | null | undefined): Promise<boolean> {
  if (!store) { return false; }
  try {
    const loaded = await store.load(missionId(slug));
    return loaded.kind === 'found' && loaded.mission.status === 'review';
  } catch {
    return false;
  }
}

export { ReviewWorkflowAdapter, createReviewWorkflowAdapter } from './review-workflow-adapter.js';
