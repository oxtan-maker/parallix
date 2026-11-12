import { observeCommandExits } from './recording/command-exits.js';
import { assertWorkflowControl } from './ports/mission-write-authorization.js';
import { reviewOperation, reviewOperationPhase, reviewOperationRequiresMutationContext, type ReviewOperation } from '../domain/review-command-policy.js';
import { randomUUID } from 'node:crypto';
import { missionId } from '../domain/mission.js';
import type { ReviewWorkflowContext, ReviewWorkflowPort } from './ports/review-workflow.js';
import {
  NO_EXECUTION_ACTIVITY,
  isNestedWorkPublisher,
  reviewLoopPublisher,
  type ExecutionActivityPort,
} from './recording/execution-activity-recorder.js';

/** CLI-independent orchestration of the domain-selected review lifecycle operation. */
export class ReviewCommandUseCase {
  constructor(
    private readonly _workflow: ReviewWorkflowPort,
    private readonly _currentWork: ExecutionActivityPort = NO_EXECUTION_ACTIVITY,
  ) {}

  async execute(args: string[], options: Record<string, unknown> = {}): Promise<void> {
    // Inherited write authority belongs to an agent's evidence/verdict writes,
    // not the coordinator's lifecycle. Refuse before preflight or stop clearing.
    const operation = reviewOperation(args);
    if (['submit', 'enter'].includes(operation)) {
      assertWorkflowControl();
    }
    const context = await this._workflow.preflight(args, options);
    if (!context) { return; }
    await this.dispatch(context);
  }

  private async dispatch(context: ReviewWorkflowContext): Promise<void> {
    const operation = reviewOperation(context.args);
    if (reviewOperationRequiresMutationContext(operation) !== (context.kind === 'mutation')) {
      throw new Error(`Review ${operation} received the wrong execution-context shape.`);
    }
    return this.run(context, operation);
  }

  private async invoke(context: ReviewWorkflowContext, operation: ReviewOperation): Promise<void> {
    if (context.kind === 'read-only') {
      if (operation === 'status') { await this._workflow.status(context); return; }
      if (operation === 'verify') { await this._workflow.verify(context); return; }
      if (operation === 'readComments') { await this._workflow.readComments(context); return; }
      throw new Error(`Review ${operation} requires a mutation execution context.`);
    }
    if (operation === 'submit') { await this._workflow.submit(context); return; }
    if (operation === 'push') { await this._workflow.push(context); return; }
    if (operation === 'enter') { await this._workflow.enter(context); return; }
    if (operation === 'comment') { await this._workflow.comment(context); return; }
    if (operation === 'submitReview') { await this._workflow.submitReview(context); return; }
    if (operation === 'close') { await this._workflow.close(context); return; }
    if (operation === 'reconcileReview') { await this._workflow.reconcileReview(context); return; }
    throw new Error(`Review ${operation} is read-only.`);
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
    operation: ReviewOperation,
  ): Promise<void> {
    const phase = reviewOperationPhase(operation);
    if (!phase) { await this.invoke(context, operation); return; }

    // A review run inside an outer operation (`px integrate`'s re-review)
    // publishes under that operation and hands the board back to it, whatever
    // the outcome, because the outer process is still working the mission.
    const nested = isNestedWorkPublisher(context.options.nestedWork) ? context.options.nestedWork : null;
    const summary = `px review ${context.slug}${operation === 'enter' ? '' : ` --${operation}`}`;
    const publication = nested?.parent ?? {
      missionId: missionId(context.slug),
      operationId: `review:${context.slug}:${randomUUID()}`,
      phase,
      summary,
      agent: null,
    };
    if (nested) { await nested.running(phase, `${summary} (inside ${nested.parent.summary})`); }
    else { await bestEffort(() => this._currentWork.running(publication)); }
    const exits = observeCommandExits(context.options);
    const options = {
      ...context.options,
      ...exits.options,
      ...reviewLoopPublisher(this._currentWork, {
        slug: context.slug,
        operationId: publication.operationId,
      }),
    };
    try {
      await this.invoke({ ...context, options }, operation);
    } catch (error) {
      if (nested) { await nested.resume(); throw error; }
      if (exits.terminatedWith(error)) {
        const failed = exits.failure();
        if (failed === null) { await bestEffort(() => this._currentWork.ended(publication)); }
        else { await bestEffort(() => this._currentWork.blocked(publication, `${summary} exited with status ${failed}`)); }
        throw error;
      }
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

async function bestEffort(publish: () => Promise<void>): Promise<void> {
  try {
    await publish();
  } catch {}
}
