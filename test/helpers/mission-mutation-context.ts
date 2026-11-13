import type { createReviewWorkflowAdapter } from '../../src/adapters/review/review-commands.js';
import { missionExecutionContext } from '../fixtures/mission-execution-context.js';

type ReviewCommandOptions = NonNullable<Parameters<typeof createReviewWorkflowAdapter>[0]>;

/** Give direct adapter tests the checked context that production composition supplies. */
export function withReviewMutationContext(options: ReviewCommandOptions): ReviewCommandOptions {
  if (options.resolveExecutionContextFn) { return options; }
  return {
    ...options,
    rootDir: options.rootDir ?? '/fixture',
    resolveExecutionContextFn: (slug, root) => ({ ok: true, context: missionExecutionContext({
      missionId: slug,
      missionWorktree: options.rootDir ?? root,
      baseWorktree: options.rootDir ?? root,
    }) }),
  };
}
