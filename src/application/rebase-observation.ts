import type { RebaseContext } from './rebase-context.js';
import type { RebaseObservationInput } from './ports/rebase-workflow.js';

export function completedRebaseOutcome(ctx: RebaseContext, revisionAfter: string | null): RebaseObservationInput['outcome'] {
  if (ctx.rebaseConflicts?.length) { return 'resolved'; }
  return revisionAfter === ctx.movedFrom ? 'no-op' : 'clean';
}

export async function observeRebase(ctx: RebaseContext, outcome: RebaseObservationInput['outcome'], revisionAfter: string | null): Promise<void> {
  if (!ctx.port.observeRebase || !ctx.rebaseObservationId) { return; }
  const attempt = ctx.rebaseAttempt ?? 1;
  const snapshot = `rebase:${ctx.rebaseObservationId}:${attempt}:${outcome}`;
  await ctx.port.observeRebase({ id: ctx.rebaseObservationId, missionId: ctx.slug, root: ctx.executionRoot,
    stage: ctx.port.rebaseObservationStage ?? 'direct-rebase', attempt, outcome,
    baseBranch: ctx.baseBranch, revisionBefore: ctx.movedFrom, revisionAfter,
    conflicts: ctx.rebaseConflicts ?? [], dependencies: ctx.rebaseObservationPredecessor ? [ctx.rebaseObservationPredecessor] : [], occurredAt: new Date().toISOString() });
  ctx.rebaseObservationPredecessor = snapshot;
  if (['no-op', 'clean', 'resolved', 'failed'].includes(outcome)) { ctx.rebaseTerminalObserved = true; }
}

export function currentRevision(ctx: RebaseContext): string | null {
  return (ctx.gitFn(['-C', ctx.executionRoot, 'rev-parse', 'HEAD']).stdout || '').trim() || null;
}
