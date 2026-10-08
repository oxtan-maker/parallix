import type { Mission } from './mission.js';
import { reviewStatus, type ReviewRevocationCause, type ReviewRound } from './review.js';

type WithdrawnApproval = ReviewRound & {
  readonly decision: Extract<NonNullable<ReviewRound['decision']>, { kind: 'approved' }>;
};

/** Approvals a red integration gate withdrew, oldest first. */
export function integrationGateWithdrawals(mission: Mission): readonly WithdrawnApproval[] {
  const rounds: readonly ReviewRound[] = mission.review?.rounds ?? [];
  return rounds.filter((round): round is WithdrawnApproval => round.decision?.kind === 'approved'
    && round.decision.revocation?.cause?.kind === 'integration-gate-failure');
}

/** A repair that stopped between commands still owes review before landing. */
export function hasIntegrationRepairHistory(mission: Mission): boolean {
  return integrationGateWithdrawals(mission).length > 0;
}

export function integrationRepairNeedsReview(mission: Mission): boolean {
  return (mission.status === 'active' || mission.status === 'review') && Boolean(mission.review
    && reviewStatus(mission.review) !== 'approved' && hasIntegrationRepairHistory(mission));
}

/**
 * What the latest integration repair was, read from typed review facts: the
 * red gate, the approved revision A it withdrew, the repair range A..B, and
 * how the repaired revision's re-review stands (TASK-2620).
 */
export interface IntegrationRepairFacts {
  readonly gate: string | null;
  readonly command: string | null;
  readonly log: string | null;
  readonly approvedRevision: string;
  /** The revision under re-review; null while it still names A (repair not handed off yet). */
  readonly repairedRevision: string | null;
  readonly withdrawnAt: string;
  readonly reReview: 'pending' | 'approved' | 'changes-requested';
}

export function latestIntegrationRepair(mission: Mission): IntegrationRepairFacts | null {
  const withdrawn = integrationGateWithdrawals(mission).at(-1);
  const current = mission.review?.rounds.at(-1);
  if (!withdrawn || !current || current.number <= withdrawn.number) { return null; }
  const cause = withdrawn.decision.revocation!.cause as Extract<ReviewRevocationCause, { kind: 'integration-gate-failure' }>;
  const approvedRevision = String(withdrawn.subject.revision);
  const latest = String(current.subject.revision);
  return {
    gate: cause.gate,
    command: cause.command ?? null,
    log: cause.log ?? null,
    approvedRevision,
    repairedRevision: latest === approvedRevision ? null : latest,
    withdrawnAt: withdrawn.decision.revocation!.revokedAt,
    reReview: current.decision?.kind === 'approved' && !current.decision.revocation ? 'approved'
      : current.decision?.kind === 'changes-requested' ? 'changes-requested' : 'pending',
  };
}

