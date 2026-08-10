import type { ReviewWorkflowContext, ReviewWorkflowPort } from './ports/review-workflow.js';

/** CLI-independent policy for choosing a review lifecycle operation. */
export class ReviewCommandUseCase {
  constructor(private readonly _workflow: ReviewWorkflowPort) {}

  async execute(args: string[], options: Record<string, unknown> = {}): Promise<void> {
    const context = await this._workflow.preflight(args, options);
    if (!context) { return; }
    await this.dispatch(context);
  }

  private async dispatch(context: ReviewWorkflowContext): Promise<void> {
    const flags = new Set(context.args.filter(arg => arg.startsWith('--')).map(arg => arg.split('=', 1)[0]));
    if (flags.has('--status')) { return this._workflow.status(context); }
    if (flags.has('--verify')) { return this._workflow.verify(context); }
    if (flags.has('--submit')) { return this._workflow.submit(context); }
    if (flags.has('--consume-artifacts')) { return this._workflow.consumeArtifacts(context); }
    if (flags.has('--push')) { return this._workflow.push(context); }
    if (flags.has('--comments')) { return this._workflow.readComments(context); }
    if (flags.has('--comment') || flags.has('--comment-file')) { return this._workflow.comment(context); }
    if (flags.has('--submit-review')) { return this._workflow.submitReview(context); }
    if (flags.has('--close')) { return this._workflow.close(context); }
    if (flags.has('--create-event')) { return this._workflow.createEvent(context); }
    if (flags.has('--import-legacy')) { return this._workflow.importLegacy(context); }
    if (flags.has('--backfill-review')) { return this._workflow.backfillReview(context); }
    if (flags.has('--reconcile-review')) { return this._workflow.reconcileReview(context); }
    if (flags.has('--start')) { return this._workflow.start(context); }
    if (flags.has('--continue')) { return this._workflow.continue(context); }
    return this._workflow.status(context);
  }
}
