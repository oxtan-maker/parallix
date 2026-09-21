import { randomUUID } from 'node:crypto';
import { missionId } from '../domain/mission.js';
import type { ReviewWorkflowContext, ReviewWorkflowPort } from './ports/review-workflow.js';
import {
  NO_CURRENT_WORK_PORT,
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
  // The implementer answering the reviewer's findings. Same mission, same
  // review loop, different phase — which is why the board needs it named.
  consumeArtifacts: 'review-response',
};
const REVIEW_FLAG_OPERATIONS: ReadonlyArray<readonly [string, keyof Omit<ReviewWorkflowPort, 'preflight'>]> = [
  ['--status', 'status'], ['--verify', 'verify'], ['--submit', 'submit'], ['--consume-artifacts', 'consumeArtifacts'], ['--push', 'push'], ['--comments', 'readComments'], ['--comment', 'comment'], ['--comment-file', 'comment'], ['--submit-review', 'submitReview'], ['--close', 'close'], ['--create-event', 'createEvent'], ['--import-legacy', 'importLegacy'], ['--backfill-review', 'backfillReview'], ['--reconcile-review', 'reconcileReview'], ['--start', 'start'], ['--continue', 'continue'], ['--resume', 'resume'],
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

    const publication = {
      missionId: missionId(context.slug),
      operationId: `review:${context.slug}:${randomUUID()}`,
      phase,
      summary: `px review --${operation === 'consumeArtifacts' ? 'consume-artifacts' : operation} ${context.slug}`,
      agent: null,
    };
    await bestEffort(() => this._currentWork.running(publication));
    const options = {
      ...context.options,
      ...reviewLoopPublisher(this._currentWork, {
        slug: context.slug,
        operationId: publication.operationId,
      }),
    };
    try {
      await this._workflow[operation]({ ...context, options });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'review operation cannot continue autonomously';
      await bestEffort(() => this._currentWork.blocked(publication, reason));
      throw error;
    }
    await bestEffort(() => this._currentWork.ended(publication));
  }
}

async function bestEffort(publish: () => Promise<void>): Promise<void> {
  try {
    await publish();
  } catch {}
}
