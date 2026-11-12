import type { LiveMissionExecutionContext } from './mission-execution-context.js';

interface ReviewWorkflowContextBase {
  readonly slug: string;
  readonly args: string[];
  readonly options: Record<string, unknown>;
}

/** Discovery operations that cannot mutate Mission or review state. */
export interface ReviewReadOnlyWorkflowContext extends ReviewWorkflowContextBase {
  readonly kind: 'read-only';
}

/** Review mutations always carry the checkout identity resolved at entry. */
export interface ReviewMutationWorkflowContext extends ReviewWorkflowContextBase {
  readonly kind: 'mutation';
  readonly executionContext: LiveMissionExecutionContext;
}

/** Application-owned boundary for all review lifecycle operations. */
export type ReviewWorkflowContext = ReviewReadOnlyWorkflowContext | ReviewMutationWorkflowContext;

export interface ReviewWorkflowPort {
  preflight(_args: string[], _options?: Record<string, unknown>): Promise<ReviewWorkflowContext | null> | ReviewWorkflowContext | null;
  verify(_context: ReviewReadOnlyWorkflowContext): Promise<void> | void;
  submit(_context: ReviewMutationWorkflowContext): Promise<void> | void;
  push(_context: ReviewMutationWorkflowContext): Promise<void> | void;
  enter(_context: ReviewMutationWorkflowContext): Promise<void> | void;
  comment(_context: ReviewMutationWorkflowContext): Promise<void> | void;
  readComments(_context: ReviewReadOnlyWorkflowContext): Promise<void> | void;
  submitReview(_context: ReviewMutationWorkflowContext): Promise<void> | void;
  close(_context: ReviewMutationWorkflowContext): Promise<void> | void;
  status(_context: ReviewReadOnlyWorkflowContext): Promise<void> | void;
  reconcileReview(_context: ReviewMutationWorkflowContext): Promise<void> | void;
}
