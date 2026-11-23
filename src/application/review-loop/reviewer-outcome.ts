import type { LoopContext, ReviewRound, RoundStep } from './round.js';
import { observeHumanReviewStart } from './review-start-observation.js';

/** `approved` means the approval is durable and the next-action decision owner decides what follows it. */
export type ReviewerOutcomeStep = RoundStep | 'ignored' | 'approved';

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
export async function applyReviewerOutcome(context: LoopContext, round: ReviewRound, reviewState: unknown): Promise<ReviewerOutcomeStep> {
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
    announceApproval(context);
    return 'approved';
  }
  const previousPhase = state.phase;
  const previousDisposition = state.disposition;
  state.transitionTo('approved');
  state.disposition = reviewState;
  try {
    const recorded = await ports.state.recordApproval(state, round.providerApproval);
    if (recorded === 'ignored') {
      state.phase = previousPhase;
      state.disposition = previousDisposition;
      round.providerApproval = undefined;
      return 'ignored';
    }
  } catch (err) {
    context.emit({ kind: 'approval-transition-failed', slug, diagnostic: err instanceof Error ? err.message : String(err) });
    context.emit({ kind: 'approval-recovery-guidance', slug });
    context.exit(1);
    return 'stop';
  }
  announceApproval(context);
  return 'approved';
}

function announceApproval(context: LoopContext): void {
  context.emit({ kind: 'review-verdict', disposition: context.state.disposition, findings: [], verbose: context.verbose, round: context.state.round });
  context.emit({ kind: 'reviewer-approved' });
}

/**
 * Begin the human turn once the next-action decision owner has nothing
 * automatic left to dispatch: record the human start and mirror the approved
 * lane. An approval alone never moves the lane.
 */
export async function beginHumanTurn(context: LoopContext, round?: ReviewRound): Promise<boolean> {
  if (!await observeHumanReviewStart(context, round)) { return false; }
  if (!context.dryRun) { await context.ports.task.mirrorApproved(); }
  return true;
}
