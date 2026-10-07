/**
 * Review intervention commands: resume an intervened review, clear human
 * intervention on continue, and invalidate a BLOCKED review.
 */

import * as fmt from '../../application/presentation/cli-format.js';
import { run } from '../git/git.js';
import { resolveWorktree } from '../filesystem/mission-utils.js';
import { resolveTaskFile, getTaskStatus, transitionTask } from '../backlog/backlog.js';
import { toVirtual } from '../config/state-map.js';
import type { MissionStore } from '../../application/domain-ports.js';
import { repairReviewedTask } from '../../application/review-task-mirroring.js';
import type { ReviewTaskMirror } from '../../application/ports/review-task-mirror.js';
import { missionId } from '../../domain/mission.js';
import { currentReviewRound, reviewStatus, resumeReview, invalidateBlocker, type Review, type ReviewStatus } from '../../domain/review.js';
import { createEvent } from './review-events.js';
import { flagValue } from './review-cli-flags.js';

export async function repairStaleActiveTaskAfterReview(
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
  const currentStatus = taskResolution.ok ? getTaskStatusFn(taskResolution.taskFile!) : null;
  const mirror: ReviewTaskMirror = { transition: status => transitionTaskFn(slug, status, { rootDir, log }) };
  const result = await repairReviewedTask(taskResolution.ok, currentStatus, toVirtual(currentStatus || ''), mirror);
  if (!result.repaired && result.skipped === false) {
    error(fmt.status('WARN', `Could not transition backlog task ${slug} to review after recording the review outcome.`));
  }
  return result;
}

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
