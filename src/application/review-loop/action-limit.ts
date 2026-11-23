import type { ReviewStepAction } from '../ports/review-action-history.js';
import type { LoopContext } from './round.js';

/** Internal control-flow signal: the escalation was already persisted and emitted. */
export class ReviewActionLimitReached extends Error {
  readonly reviewActionLimitReached = true;

  constructor(limit: number) {
    super(actionLimitDetail(limit));
    this.name = 'ReviewActionLimitReached';
  }
}

export function isReviewActionLimitReached(error: unknown): error is ReviewActionLimitReached {
  return (error as { reviewActionLimitReached?: unknown } | null)?.reviewActionLimitReached === true;
}

export function actionLimitDetail(limit: number): string {
  return `action limit ${limit} reached`;
}

/** Reload the lifetime count at entry; an unavailable history is never treated as zero. */
export async function loadReviewActionCount(context: LoopContext): Promise<boolean> {
  if (context.dryRun) { return true; }
  try {
    context.actionCount = await context.ports.actionHistory.count();
  } catch (error) {
    await context.escalateToHumanReview(`ACTION_HISTORY_UNAVAILABLE: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
  if (context.actionCount < context.actionLimit) { return true; }
  await stopAtLimit(context, context.actionCount);
  return false;
}

/**
 * Commit one action start before its mechanism runs. The limit action is retained
 * as action N and hands off without launching the mechanism, so action N+1 can
 * never begin after restart.
 */
export async function startReviewAction(context: LoopContext, action: ReviewStepAction,
  correlation: string, changeIdentity = context.ports.preReview.head() ?? 'unknown'): Promise<boolean> {
  if (context.dryRun) { return true; }
  if (context.actionCount >= context.actionLimit) {
    await stopAtLimit(context, context.actionCount);
    return false;
  }
  try {
    const record = await context.ports.actionHistory.record({
      action, correlation, changeIdentity, configuredLimit: context.actionLimit,
    });
    context.actionCount = Math.max(context.actionCount, record.actionSequence);
  } catch (error) {
    await context.escalateToHumanReview(`ACTION_HISTORY_UNAVAILABLE: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
  if (context.actionCount < context.actionLimit) { return true; }
  await stopAtLimit(context, context.actionCount);
  return false;
}

async function stopAtLimit(context: LoopContext, count: number): Promise<void> {
  const detail = actionLimitDetail(context.actionLimit);
  await context.escalateToHumanReview(detail);
  context.emit({ kind: 'action-limit-reached', count, limit: context.actionLimit });
}
