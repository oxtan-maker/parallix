/** Application-owned boundary for all review lifecycle operations. */
export interface ReviewWorkflowContext {
  readonly slug: string;
  readonly args: string[];
  readonly options: Record<string, unknown>;
}

export interface ReviewWorkflowPort {
  preflight(_args: string[], _options?: Record<string, unknown>): Promise<ReviewWorkflowContext | null> | ReviewWorkflowContext | null;
  verify(_context: ReviewWorkflowContext): Promise<void> | void;
  submit(_context: ReviewWorkflowContext): Promise<void> | void;
  push(_context: ReviewWorkflowContext): Promise<void> | void;
  start(_context: ReviewWorkflowContext): Promise<void> | void;
  continue(_context: ReviewWorkflowContext): Promise<void> | void;
  comment(_context: ReviewWorkflowContext): Promise<void> | void;
  readComments(_context: ReviewWorkflowContext): Promise<void> | void;
  submitReview(_context: ReviewWorkflowContext): Promise<void> | void;
  consumeArtifacts(_context: ReviewWorkflowContext): Promise<void> | void;
  close(_context: ReviewWorkflowContext): Promise<void> | void;
  status(_context: ReviewWorkflowContext): Promise<void> | void;
  createEvent(_context: ReviewWorkflowContext): Promise<void> | void;
  backfillReview(_context: ReviewWorkflowContext): Promise<void> | void;
  reconcileReview(_context: ReviewWorkflowContext): Promise<void> | void;
  importLegacy(_context: ReviewWorkflowContext): Promise<void> | void;
}
