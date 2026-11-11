import type { Mission } from './mission.js';
import { currentReviewRound, decidedRevisionOf, reviewStatus, type Review, type ReviewRevocationCause, type ReviewRound } from './review.js';

type WithdrawnApproval = ReviewRound & {
  readonly decision: Extract<NonNullable<ReviewRound['decision']>, { kind: 'approved' }>;
};

export type CurrentIntegrationRepair =
  | { readonly kind: 'review-required'; readonly withdrawn: WithdrawnApproval }
  | { readonly kind: 'approval-retention'; readonly round: ReviewRound };

/** Approvals a red integration gate withdrew, oldest first. */
export function integrationGateWithdrawals(mission: Pick<Mission, 'review'>): readonly WithdrawnApproval[] {
  const rounds: readonly ReviewRound[] = mission.review?.rounds ?? [];
  return rounds.filter((round): round is WithdrawnApproval => round.decision?.kind === 'approved'
    && round.decision.revocation?.cause?.kind === 'integration-gate-failure');
}

/**
 * Routing fails closed on a typed gate withdrawal even when its decided revision
 * is unknown. Display facts below require that revision to avoid inventing a
 * repair range; missing display facts never waive the review requirement.
 */
export function integrationRepairNeedsReview(mission: Mission): boolean {
  return currentIntegrationRepair(mission)?.kind === 'review-required';
}

/** A subsequent approval closes this repair even if a later correction withdraws it. */
function repairApproval(review: Review, withdrawn: WithdrawnApproval): ReviewRound | undefined {
  return review.rounds.find(round => round.number > withdrawn.number && round.decision?.kind === 'approved');
}

/** The one current integration-repair obligation, excluding resolved history. */
export function currentIntegrationRepair(mission: Pick<Mission, 'review' | 'status'>): CurrentIntegrationRepair | null {
  if (!['active', 'review'].includes(mission.status) || !mission.review) { return null; }
  if (reviewStatus(mission.review) === 'approved') {
    const round = currentReviewRound(mission.review);
    return round.integrationRepairAssessment?.repair ? { kind: 'approval-retention', round } : null;
  }
  const withdrawn = integrationGateWithdrawals(mission).at(-1);
  return withdrawn && !repairApproval(mission.review, withdrawn) ? { kind: 'review-required', withdrawn } : null;
}

/**
 * What the latest integration repair was, read from typed review facts: the
 * red gate, the approved revision A it withdrew, the repair range A..B, and
 * how the repaired revision's re-review stands (TASK-2620). Its first subsequent
 * approval resolves the repair; later corrections do not rewrite that outcome.
 */
export interface IntegrationRepairFacts {
  readonly gate: string | null;
  readonly command: string | null;
  readonly log: string | null;
  readonly approvedRevision: string;
  /** Baseline the approved revision's mission diff was measured from; null when that round recorded none. */
  readonly approvedBaseline: string | null;
  /** Baseline of the resolving or latest pending repair round; null while unrecorded. */
  readonly repairedBaseline: string | null;
  /** The revision under re-review; null while it still names A (repair not handed off yet). */
  readonly repairedRevision: string | null;
  readonly withdrawnAt: string;
  readonly reReview: 'pending' | 'approved' | 'changes-requested';
  /** Revision-bound events used by every repair presentation. */
  readonly timeline: readonly IntegrationRepairTimelineEvent[];
}

export type IntegrationRepairTimelineEvent =
  | { readonly kind: 'validation'; readonly actor: 'parallix gates'; readonly revision: string; readonly at: string; readonly reference: string; readonly carriedTo?: string }
  | { readonly kind: 'assessment'; readonly actor: 'parallix'; readonly revision: string; readonly at: string; readonly outcome: string }
  | { readonly kind: 'withdrawal'; readonly actor: string; readonly revision: string; readonly at: string }
  | { readonly kind: 'review-handoff'; readonly actor: string; readonly revision: string; readonly at: string; readonly round: number }
  | { readonly kind: 'changes-requested'; readonly actor: string; readonly revision: string; readonly at: string; readonly round: number }
  | { readonly kind: 'fix'; readonly actor: string; readonly revision: string; readonly at: string; readonly round: number }
  | { readonly kind: 'integration-handoff'; readonly actor: string; readonly revision: string; readonly at: string; readonly round: number };

export function latestIntegrationRepair(mission: Mission): IntegrationRepairFacts | null {
  const withdrawn = recordedWithdrawal(mission);
  const current = withdrawn && mission.review && (repairApproval(mission.review, withdrawn) ?? mission.review.rounds.at(-1));
  if (!withdrawn || !current || current.number <= withdrawn.number) { return null; }
  const cause = withdrawn.decision.revocation!.cause as Extract<ReviewRevocationCause, { kind: 'integration-gate-failure' }>;
  const approvedRevision = String(withdrawn.decision.revision);
  const latest = repairRevision(current);
  return {
    gate: cause.gate,
    command: cause.command ?? null,
    log: cause.log ?? null,
    approvedRevision,
    approvedBaseline: withdrawn.subject.baseline ? String(withdrawn.subject.baseline) : null,
    repairedBaseline: current.subject.baseline ? String(current.subject.baseline) : null,
    repairedRevision: latest === approvedRevision ? null : latest,
    withdrawnAt: withdrawn.decision.revocation!.revokedAt,
    reReview: repairReviewOutcome(current),
    timeline: integrationRepairTimeline(mission.review!, withdrawn, current),
  };
}

function integrationRepairTimeline(review: Review, withdrawn: WithdrawnApproval, through: ReviewRound): IntegrationRepairTimelineEvent[] {
  const events: IntegrationRepairTimelineEvent[] = [];
  const assessment = withdrawn.integrationRepairAssessment;
  if (assessment?.validation) {
    events.push({ kind: 'validation', actor: 'parallix gates', revision: assessment.validation.sha,
      at: assessment.validation.createdAt, reference: assessment.validation.reference,
      ...(assessment.validation.carried ? { carriedTo: assessment.validation.carried.revision } : {}) });
  }
  if (assessment) {
    events.push({ kind: 'assessment', actor: 'parallix', revision: assessment.candidateRevision,
      at: assessment.assessedAt, outcome: assessment.outcome });
  }
  events.push({ kind: 'withdrawal', actor: withdrawn.decision.revocation!.revokedBy,
    revision: String(withdrawn.decision.revision), at: withdrawn.decision.revocation!.revokedAt });
  for (const round of review.rounds.filter(item => item.number > withdrawn.number && item.number <= through.number)) {
    events.push({ kind: 'review-handoff', actor: String(round.reviewer), revision: String(round.subject.revision),
      at: round.startedAt, round: round.number });
    if (round.decision?.kind === 'changes-requested') {
      events.push({ kind: 'changes-requested', actor: String(round.reviewer), revision: repairRevision(round),
        at: round.decision.decidedAt, round: round.number });
    }
    if (round.response) {
      events.push({ kind: 'fix', actor: String(round.implementer), revision: String(round.response.resultingRevision),
        at: round.response.respondedAt, round: round.number });
    }
    if (round.decision?.kind === 'approved') {
      events.push({ kind: 'integration-handoff', actor: String(round.reviewer), revision: repairRevision(round),
        at: round.decision.decidedAt, round: round.number });
    }
  }
  return events;
}

function repairReviewOutcome(round: ReviewRound): IntegrationRepairFacts['reReview'] {
  return round.decision?.kind === 'approved' ? 'approved' : round.decision?.kind === 'changes-requested' ? 'changes-requested' : 'pending';
}

/** Pending repair rounds still name their submitted start; decisions name judged code. */
function repairRevision(round: ReviewRound): string {
  return String(decidedRevisionOf(round) ?? round.subject.revision);
}

/** Never skip an unknown latest approval in favour of an older known one. */
function recordedWithdrawal(mission: Mission): WithdrawnApproval | undefined {
  const round = integrationGateWithdrawals(mission).at(-1);
  return decidedRevisionOf(round) ? round : undefined;
}

/** Retaining the judgment does not give an active repair permission to land. */
export function pendingIntegrationApproval(mission: Pick<Mission, 'review' | 'status'>): ReviewRound | null {
  const current = currentIntegrationRepair(mission);
  return current?.kind === 'approval-retention' ? current.round : null;
}
