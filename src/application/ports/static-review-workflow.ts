/**
 * Focused application boundary for the follow-on action after a static review.
 *
 * Inspecting the branch, resolving the implementer, launching agents, and
 * talking to the forge remain adapter concerns. The application decides which
 * of those effects follows a static review outcome.
 */
export interface StaticReviewOutcome {
  readonly ok: boolean;
  readonly findings: readonly string[];
}

export interface StaticReviewWorkflowPort {
  review(_slug: string): Promise<StaticReviewOutcome> | StaticReviewOutcome;
  resolveImplementer(_slug: string): Promise<string | null> | string | null;
  implementerUnresolved(_slug: string, _findings: readonly string[]): void;
  relaunchImplementer(_slug: string, _implementer: string, _findings: readonly string[]): Promise<void>;
  reportClean(_slug: string): void;
  hasOpenPr(_slug: string): Promise<boolean> | boolean;
  submitForReview(_slug: string): Promise<void>;
  postSuccess(_slug: string): Promise<void>;
}
