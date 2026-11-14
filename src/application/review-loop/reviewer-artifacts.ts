import type { ReviewerArtifactFacts } from '../ports/review-round.js';
import type { LoopContext, ReviewRound } from './round.js';

/** Describe invalid reviewer artifacts without assigning recovery policy. */
export function reviewerArtifactDiagnostic(context: LoopContext, artifacts: ReviewerArtifactFacts): string {
  return artifacts.diagnostic || `Reviewer ${context.identities.reviewer} produced incomplete or invalid review artifacts`;
}

export function missingReviewerArtifacts(context: LoopContext, round: ReviewRound): string {
  const stopReason = round.reviewerLaunch?.result?.stopReason;
  const cause = stopReason === 'length' ? 'output-token-limit' : stopReason;
  return `Incomplete reviewer artifact: reviewer ${context.identities.reviewer} exited without a recorded verdict or consumable review artifacts${cause ? ` (${cause})` : ''}`;
}

/** A completed process cannot produce a later verdict without a relaunch. */
export function incompleteReviewerDiagnostic(context: LoopContext, round: ReviewRound, artifacts: ReviewerArtifactFacts): string | null {
  if (artifacts.consumed) { return artifacts.ok ? null : reviewerArtifactDiagnostic(context, artifacts); }
  return typeof round.reviewerLaunch?.result?.status === 'number' ? missingReviewerArtifacts(context, round) : null;
}

export function applyReviewerArtifacts(round: ReviewRound, artifacts: ReviewerArtifactFacts): unknown {
  // TASK-2477/F1: recovered findings must accompany the changes-requested summary.
  round.blockingFindings = artifacts.reviewFindings || [];
  return artifacts.reviewState;
}
