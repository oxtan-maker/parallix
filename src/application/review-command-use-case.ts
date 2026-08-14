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
    if (flags.has('--status')) { return this.run(context, 'status'); }
    if (flags.has('--verify')) { return this.run(context, 'verify'); }
    if (flags.has('--submit')) { return this.run(context, 'submit'); }
    if (flags.has('--consume-artifacts')) { return this.run(context, 'consumeArtifacts'); }
    if (flags.has('--push')) { return this.run(context, 'push'); }
    if (flags.has('--comments')) { return this.run(context, 'readComments'); }
    if (flags.has('--comment') || flags.has('--comment-file')) { return this.run(context, 'comment'); }
    if (flags.has('--submit-review')) { return this.run(context, 'submitReview'); }
    if (flags.has('--close')) { return this.run(context, 'close'); }
    if (flags.has('--create-event')) { return this.run(context, 'createEvent'); }
    if (flags.has('--import-legacy')) { return this.run(context, 'importLegacy'); }
    if (flags.has('--backfill-review')) { return this.run(context, 'backfillReview'); }
    if (flags.has('--reconcile-review')) { return this.run(context, 'reconcileReview'); }
    if (flags.has('--start')) { return this.run(context, 'start'); }
    if (flags.has('--continue')) { return this.run(context, 'continue'); }
    return this.run(context, 'status');
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
    if (!phase) { return void await this._workflow[operation](context); }

    const publication = {
      missionId: missionId(context.slug),
      operationId: `review:${context.slug}`,
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
  } catch (error) {
    void error;
  }
}
