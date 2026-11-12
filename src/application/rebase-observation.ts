import type { RebaseContext } from './rebase-context.js';
import { isTerminalRebaseOutcome, type RebaseObservationFields, type RebaseObservationInput,
  type RebaseObservationStage } from './ports/rebase-workflow.js';

type ApplicableRebaseOutcome = Exclude<RebaseObservationInput['outcome'], 'inapplicable'>;

export function completedRebaseOutcome(ctx: RebaseContext, revisionAfter: string | null): ApplicableRebaseOutcome {
  if (ctx.rebaseConflicts?.length) { return 'resolved'; }
  return revisionAfter === ctx.movedFrom ? 'no-op' : 'clean';
}

export async function observeRebase(ctx: RebaseContext, outcome: ApplicableRebaseOutcome, revisionAfter: string | null): Promise<void> {
  if (!ctx.port.observeRebase || !ctx.rebaseObservationId) { return; }
  const attempt = ctx.rebaseAttempt ?? 1;
  const snapshot = `rebase:${ctx.rebaseObservationId}:${attempt}:${outcome}`;
  await ctx.port.observeRebase({ id: ctx.rebaseObservationId, missionId: ctx.slug, root: ctx.executionRoot,
    stage: ctx.port.rebaseObservationStage ?? 'direct-rebase', attempt, outcome,
    baseBranch: ctx.baseBranch, revisionBefore: ctx.movedFrom, revisionAfter,
    conflicts: ctx.rebaseConflicts ?? [], dependencies: ctx.rebaseObservationPredecessor ? [ctx.rebaseObservationPredecessor] : [], occurredAt: new Date().toISOString() });
  ctx.rebaseObservationPredecessor = snapshot;
  if (isTerminalRebaseOutcome(outcome)) { ctx.rebaseTerminalObserved = true; }
}

/** Retain diagnostic skip telemetry without making its storage a workflow dependency. */
export async function observeInapplicableRebaseBestEffort(port: RebaseObservationFields | null, stage: RebaseObservationStage, input: {
  readonly missionId: string; readonly root: string; readonly baseBranch: string | null; readonly reason: string;
}, onError: (cause: unknown) => void): Promise<void> {
  if (!port) { return; }
  try {
    const id = port.newRebaseObservationId();
    await port.observeRebase({ id, missionId: input.missionId, root: input.root,
      stage, attempt: 1, outcome: 'inapplicable',
      inapplicability: input.reason, baseBranch: input.baseBranch, revisionBefore: null, revisionAfter: null,
      conflicts: [], dependencies: [], occurredAt: new Date().toISOString() });
  } catch (cause) { onError(cause); }
}

export function formatInapplicableRebaseWarning(stage: 'pre-review' | 'integration', missionId: string,
  cause: unknown): string {
  const continuation = stage === 'pre-review' ? 'review submission' : 'integration';
  return `Could not retain ${stage} rebase inapplicability for ${missionId}: ${cause instanceof Error ? cause.message : String(cause)}. Continuing ${continuation}.`;
}

export function currentRevision(ctx: RebaseContext): string | null {
  return (ctx.gitFn(['-C', ctx.executionRoot, 'rev-parse', 'HEAD']).stdout || '').trim() || null;
}
