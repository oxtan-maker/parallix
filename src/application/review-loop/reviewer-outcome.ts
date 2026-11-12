import type { LoopContext, ReviewRound, RoundStep } from './round.js';

/** Read only a decision for the exact loop round represented by `state`. */
export function persistedReviewerOutcome(
  state: Pick<LoopContext['state'], 'round'>,
  persisted: Awaited<ReturnType<LoopContext['ports']['state']['read']>>,
): string | null {
  if (!persisted || persisted.round !== state.round) { return null; }
  if (persisted.phase === 'approved' && persisted.disposition === 'APPROVED') { return 'APPROVED'; }
  if (persisted.phase === 'fixing' && persisted.disposition === 'REQUEST_CHANGES') { return 'REQUEST_CHANGES'; }
  return null;
}

/** Apply only an authoritative reviewer outcome to loop state and task mirroring. */
export async function applyReviewerOutcome(context: LoopContext, round: ReviewRound, reviewState: unknown): Promise<RoundStep> {
  const { ports, state, slug } = context;
  if (reviewState !== 'APPROVED') {
    state.transitionTo('fixing');
    state.disposition = reviewState as string;
    return null;
  }
  const authoritative = await ports.state.read();
  if (persistedReviewerOutcome(state, authoritative) === 'APPROVED') {
    state.phase = 'approved';
    state.disposition = 'APPROVED';
    if (authoritative?.reviewer) {
      state.reviewer = authoritative.reviewer;
      context.identities.reviewer = authoritative.reviewer;
    }
    context.emit({ kind: 'review-verdict', disposition: state.disposition, findings: [], verbose: context.verbose, round: state.round });
    context.emit({ kind: 'reviewer-approved' });
    await ports.task.mirrorApproved();
    return 'stop';
  }
  state.transitionTo('approved');
  state.disposition = reviewState;
  try {
    await ports.state.recordApproval(state, round.providerApproval);
  } catch (err) {
    context.emit({ kind: 'approval-transition-failed', slug, diagnostic: err instanceof Error ? err.message : String(err) });
    context.emit({ kind: 'approval-recovery-guidance', slug });
    context.exit(1);
    return 'stop';
  }
  context.emit({ kind: 'review-verdict', disposition: state.disposition, findings: [], verbose: context.verbose, round: state.round });
  context.emit({ kind: 'reviewer-approved' });
  await ports.task.mirrorApproved();
  return 'stop';
}
