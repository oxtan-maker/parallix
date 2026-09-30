import { randomUUID } from 'node:crypto';
import { missionId } from '../domain/mission.js';
import type { ReviewWorkflowContext, ReviewWorkflowPort } from './ports/review-workflow.js';
import {
  NO_CURRENT_WORK_PORT,
  isNestedWorkPublisher,
  reviewLoopPublisher,
  type CurrentWorkPhase,
  type CurrentWorkPort,
} from './recording/current-work-recorder.js';

/**
 * Review operations that keep the board busy, and the phase each publishes.
 *
 * Only the long-running ones appear here. `--status`, `--comments`, and the
 * one-shot maintenance flags finish in milliseconds; publishing current work
 * for them would flicker the board without telling an operator anything.
 */
const PUBLISHED_PHASES: Readonly<Record<string, CurrentWorkPhase>> = {
  start: 'review',
  continue: 'review',
  submit: 'review',
  submitReview: 'review',
};
const REVIEW_FLAG_OPERATIONS: ReadonlyArray<readonly [string, keyof Omit<ReviewWorkflowPort, 'preflight'>]> = [
  ['--status', 'status'], ['--verify', 'verify'], ['--submit', 'submit'], ['--push', 'push'], ['--comments', 'readComments'], ['--comment', 'comment'], ['--comment-file', 'comment'], ['--submit-review', 'submitReview'], ['--close', 'close'], ['--create-event', 'createEvent'], ['--import-legacy', 'importLegacy'], ['--backfill-review', 'backfillReview'], ['--reconcile-review', 'reconcileReview'], ['--start', 'start'], ['--continue', 'continue'], ['--resume', 'resume'],
];

/** CLI-independent policy for choosing a review lifecycle operation. */
export class ReviewCommandUseCase {
  constructor(
    private readonly _workflow: ReviewWorkflowPort,
    private readonly _currentWork: CurrentWorkPort = NO_CURRENT_WORK_PORT,
  ) {}

  async execute(args: string[], options: Record<string, unknown> = {}): Promise<void> {
    const context = await this._workflow.preflight(args, options);
    if (!context) { return; }
    await this.dispatch(context);
  }

  private async dispatch(context: ReviewWorkflowContext): Promise<void> {
    const flags = new Set(context.args.filter(arg => arg.startsWith('--')).map(arg => arg.split('=', 1)[0]));
    const operation = REVIEW_FLAG_OPERATIONS.find(([flag]) => flags.has(flag))?.[1] || 'status';
    return this.run(context, operation);
  }

  /**
   * Run one workflow operation, bracketing the long-running ones with the
   * mission's current work.
   *
   * The bracket is the operation boundary itself, so no UI adapter has to
   * guess that "mission is in the review lane" means "a reviewer is running".
   * Publication never changes the operation's outcome: a recorder outage is
   * swallowed, and a failed operation still clears its current work.
   *
   * A review operation that *throws* did not simply finish: the review loop
   * exhausted what it could do autonomously. Clearing that as a bare `ended`
   * fact throws away the only sentence that tells the operator why they are
   * needed, so the failure is published as `blocked` carrying its reason.
   */
  private async run(
    context: ReviewWorkflowContext,
    operation: keyof Omit<ReviewWorkflowPort, 'preflight'>,
  ): Promise<void> {
    const phase = PUBLISHED_PHASES[operation];
    if (!phase) { await this._workflow[operation](context); return; }

    // A review run inside an outer operation (`px integrate`'s re-review)
    // publishes under that operation and hands the board back to it, whatever
    // the outcome, because the outer process is still working the mission.
    const nested = isNestedWorkPublisher(context.options.nestedWork) ? context.options.nestedWork : null;
    const summary = `px review --${operation} ${context.slug}`;
    const publication = nested?.parent ?? {
      missionId: missionId(context.slug),
      operationId: `review:${context.slug}:${randomUUID()}`,
      phase,
      summary,
      agent: null,
    };
    if (nested) { await nested.running(phase, `${summary} (inside ${nested.parent.summary})`); }
    else { await bestEffort(() => this._currentWork.running(publication)); }
    const exits = exitRecorder(context.options);
    const options = {
      ...context.options,
      ...exits.options,
      ...reviewLoopPublisher(this._currentWork, {
        slug: context.slug,
        operationId: publication.operationId,
      }),
    };
    try {
      await this._workflow[operation]({ ...context, options });
    } catch (error) {
      if (nested) { await nested.resume(); throw error; }
      const reason = error instanceof Error ? error.message : 'review operation cannot continue autonomously';
      await bestEffort(() => this._currentWork.blocked(publication, reason));
      throw error;
    }
    if (nested) { await nested.resume(); return; }
    // An injected exit that does not terminate the process still reports a
    // failure: it is published as one, never as a finished review.
    const failed = exits.failure();
    if (failed !== null) {
      await bestEffort(() => this._currentWork.blocked(publication, `${summary} exited with status ${failed}`));
      return;
    }
    await bestEffort(() => this._currentWork.ended(publication));
  }
}

/** Observe the exit codes an injected, non-terminating exit reports. */
function exitRecorder(options: Record<string, unknown>) {
  let code: number | null = null;
  const observed: Record<string, unknown> = {};
  for (const key of ['exit', 'exitFn'] as const) {
    const exit = options[key];
    if (typeof exit !== 'function') { continue; }
    observed[key] = (value?: number) => {
      if (value) { code = value; }
      return (exit as (_code?: number) => unknown)(value);
    };
  }
  return { options: observed, failure: () => code };
}

async function bestEffort(publish: () => Promise<void>): Promise<void> {
  try {
    await publish();
  } catch {}
}
