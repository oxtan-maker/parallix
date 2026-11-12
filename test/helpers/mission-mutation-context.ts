import type { RebaseCommandOptions } from '../../src/adapters/rebase/rebase-workflow-adapter.js';
import type { createReviewWorkflowAdapter } from '../../src/adapters/review/review-commands.js';
import { missionExecutionContext } from '../fixtures/mission-execution-context.js';

type ReviewCommandOptions = NonNullable<Parameters<typeof createReviewWorkflowAdapter>[0]>;

/** Give direct adapter tests the checked context that production composition supplies. */
export function withReviewMutationContext(options: ReviewCommandOptions): ReviewCommandOptions {
  if (options.resolveExecutionContextFn) { return options; }
  return {
    ...options,
    resolveExecutionContextFn: (slug, root) => ({ ok: true, context: missionExecutionContext({
      missionId: slug,
      missionWorktree: options.rootDir ?? root,
      baseWorktree: options.rootDir ?? root,
    }) }),
  };
}

/** Give direct rebase-adapter tests an explicit context without invoking ambient Git discovery. */
export function withRebaseMutationContext(options: RebaseCommandOptions): RebaseCommandOptions {
  if (options.executionContext || options.resolveExecutionContextFn) { return options; }
  return {
    ...options,
    resolveExecutionContextFn: (slug, root) => {
      const missionWorktree = options.resolveWorktreeFn?.(slug, { cwd: root }) ?? options.rootDir ?? root;
      const baseBranch = options.resolveMissionBaseBranchFn?.(slug, missionWorktree, { gitFn: options.gitFn }) ?? 'main';
      return { ok: true, context: missionExecutionContext({
        missionId: slug, missionWorktree, baseWorktree: root, baseBranch,
      }) };
    },
  };
}
