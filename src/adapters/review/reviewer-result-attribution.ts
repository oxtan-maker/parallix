import { agentFamily } from '../../domain/agents.js';
import {
  changeRevision,
  currentReviewRound,
  recordReviewerResult,
  type Review,
  type ReviewFinding,
  type ReviewerResultAttribution,
} from '../../domain/review.js';

export interface ReviewerProcessResult {
  readonly status?: number | null;
  readonly sessionId?: string | null;
}

/** Translate one native agent run into the attribution accepted by Review authority. */
export function reviewerResultAttribution(
  reviewer: string,
  processResult: ReviewerProcessResult | null | undefined,
): ReviewerResultAttribution {
  return {
    ...(processResult?.sessionId ? { publicationId: processResult.sessionId } : {}),
    reviewerId: reviewer,
    outcome: 'completed',
    status: processResult?.status ?? 0,
  };
}

/** Attach the attributed publication to the exact revision the decision judged. */
export function attachReviewerResult(
  review: Review,
  decision: 'approved' | 'changes-requested',
  input: { revision?: string | null; decidedAt: string; result?: ReviewerResultAttribution },
  findings: readonly ReviewFinding[],
): Review {
  if (typeof input.revision !== 'string') { return review; }
  const round = currentReviewRound(review);
  const revision = changeRevision(input.revision);
  if (decision === 'approved' && round.decision?.kind === 'approved'
    && round.decision.revision && round.decision.revision !== revision) {
    throw new Error(`Approved replay must target decided revision ${round.decision.revision}; replay revision ${revision} is not reviewed`);
  }
  // The aggregate owns the authorized reviewer family. Adapter-facing actor
  // aliases remain attributable identities but cannot mint another family.
  const family = round.reviewer;
  return recordReviewerResult(review, {
    publicationId: input.result?.publicationId ?? `round-${round.number}:${family}:${revision}:${decision}`,
    reviewerId: input.result?.reviewerId ?? family,
    agentFamily: agentFamily(family),
    revision,
    decision,
    findings,
    outcome: input.result?.outcome ?? 'completed',
    status: input.result?.status === undefined ? 0 : input.result.status,
    publishedAt: input.decidedAt,
  });
}
