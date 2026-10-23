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
    exit?: (_code: number) => void;
    resolveWorktreeFn?: typeof resolveWorktree;
    missionStore?: MissionStore | null;
    createEventFn?: typeof createEvent;
    runFn?: typeof run;
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
    error(fmt.status('FAIL', `Mission ${slug} has no review; px review ${slug} begins a review.`));
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

  const operator = explicitActor ?? operatorFromGit(slug, options.resolveWorktreeFn, options.runFn);

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
      worktree: injectedReviewWorktree(slug, options.resolveWorktreeFn),
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

/** Clear an intervention for the direct operator, retaining actor attribution. */
export async function continueReviewClearsIntervention(
  slug: string,
  args: string[],
  options: {
    log?: (_msg: string) => void;
    error?: (_msg: string) => void;
    exit?: (_code: number) => void;
    resolveWorktreeFn?: typeof resolveWorktree;
    missionStore?: MissionStore | null;
    createEventFn?: typeof createEvent;
    runFn?: typeof run;
  } = {}
): Promise<boolean> {
  const result = await clearHumanInterventionIfPresent(slug, args, {
    ...options,
  });
  if (result.cleared) {
    (options.log || fmt.log.plain)(
      fmt.status('PASS', `Review for ${slug}: intervention cleared (attributed to ${result.operator}); continuing review loop.`),
    );
  }
  return result.cleared;
}

/** Clear a resolved BLOCKED/PARKED stop before direct operator review re-entry. */
export async function continueReviewInvalidatesBlocker(
  slug: string,
  args: string[],
  options: {
    log?: (_msg: string) => void;
    error?: (_msg: string) => void;
    exit?: (_code: number) => void;
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
    error(fmt.status('FAIL', `Mission ${slug} has no review; px review ${slug} begins a review.`));
    exit(1);
    return { invalidated: false, operator: '', status: 'awaiting-review' };
  }

  const review = result.mission.review;
  const round = currentReviewRound(review);
  if (round.disposition !== 'BLOCKED' && round.disposition !== 'PARKED') {
    // No implementer stop to clear: an operator review entry on an otherwise-normal
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
      content: `invalidated a ${round.disposition} stop; reviewStatus now ${reviewStatus(invalidated)}. Operator cleared the blocker via px review.`,
      round: currentReviewRound(invalidated).number,
      phase: 'reviewing',
    },
    {
      worktree: injectedReviewWorktree(slug, options.resolveWorktreeFn),
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

function injectedReviewWorktree(slug: string, resolveWorktreeFn: typeof resolveWorktree | undefined): string | undefined {
  return resolveWorktreeFn ? (resolveWorktreeFn(slug) ?? undefined) : undefined;
}

function operatorFromGit(slug: string, resolveWorktreeFn: typeof resolveWorktree | undefined, runFn: typeof run | undefined): string {
  const worktree = injectedReviewWorktree(slug, resolveWorktreeFn) ?? process.cwd();
  try {
    const gitUser = (runFn ?? run)('git', ['-C', worktree, 'config', 'user.name']);
    return (gitUser.stdout || '').trim() || 'operator';
  } catch { return 'operator'; }
}
