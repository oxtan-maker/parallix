import type { StaticReviewWorkflowPort } from './ports/static-review-workflow.js';

/** Application-owned choice of what follows a static review of a mission branch. */
export class StaticReviewUseCase {
  constructor(private readonly _workflow: StaticReviewWorkflowPort) {}

  async run(slug: string): Promise<void> {
    const outcome = await this._workflow.review(slug);
    if (outcome.findings.length) {
      // Findings go back to the implementer; the review loop never starts on a
      // branch that static review already rejected.
      const implementer = await this._workflow.resolveImplementer(slug);
      if (!implementer) { this._workflow.implementerUnresolved(slug, outcome.findings); return; }
      await this._workflow.relaunchImplementer(slug, implementer, outcome.findings);
      return;
    }
    if (!outcome.ok) { return; }
    this._workflow.reportClean(slug);
    if (!(await this._workflow.hasOpenPr(slug))) { await this._workflow.submitForReview(slug); }
    await this._workflow.postSuccess(slug);
  }
}
