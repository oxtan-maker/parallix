import type { LoopContext, ReviewRound, RoundStep } from './round.js';
import { startReviewAction } from './action-limit.js';
import { persistedReviewerOutcome } from './reviewer-outcome.js';
import { recordedPendingApproval, stopForQuotaLaunchResult } from './reviewer-policy.js';

/** A workflow rejection cannot be repaired by waiting for provider output. */
export async function stopForVerdictBlock(context: LoopContext): Promise<boolean> {
  const block = await context.ports.state.verdictBlock?.();
  if (!block) { return false; }
  context.ports.output.error(block.diagnostic);
  context.exit(1);
  return true;
}

/** Admit a counted reviewer launch, or stop before starting its mechanism. */
export async function admitReviewerLaunch(
  context: LoopContext,
  round: ReviewRound,
): Promise<'launch' | 'stop' | 'autonomous'> {
  const { ports, identities } = context;
  if (await stopForVerdictBlock(context)) { return 'stop'; }
  if (identities.reviewer === 'autonomous' && !ports.provider) {
    context.emit({ kind: 'autonomous-reviewer', attempt: round.attempt });
    return 'autonomous';
  }
  return await startReviewAction(context, 'agent',
    `review:${round.attempt}:agent:${identities.reviewer}:${round.used}`,
    round.verifiedRevision ?? ports.preReview.head() ?? 'unknown') ? 'launch' : 'stop';
}

/** Reuse durable output recorded while the reviewer launch was in flight. */
export async function completedReviewerOutput(context: LoopContext, round: ReviewRound): Promise<{
  step: RoundStep; reviewState?: unknown;
} | null> {
  const persistedOutcome = persistedReviewerOutcome(context.state, await context.ports.state.read());
  if (persistedOutcome) { return { step: null, reviewState: persistedOutcome }; }
  if (await recordedPendingApproval(context, round)) { return { step: null, reviewState: 'APPROVED' }; }
  if (await stopForVerdictBlock(context)) { return { step: 'stop' }; }
  if (await stopForQuotaLaunchResult(context, round)) { return { step: 'stop' }; }
  return null;
}
