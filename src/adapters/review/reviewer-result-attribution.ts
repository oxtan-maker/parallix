import { agentFamily } from '../../domain/agents.js';
import { isStaleWrite, type MissionStore } from '../../application/domain-ports.js';
import { missionId } from '../../domain/mission.js';
import {
  changeRevision,
  currentReviewRound,
  recordReviewerResult,
  type Review,
  type ReviewFinding,
  type ReviewerResultAttribution,
} from '../../domain/review.js';
import { attributeReviewerRun } from '../../domain/reviewer-result.js';
import { isRoundReviewer } from '../../domain/reviewer-policy.js';

export interface ReviewerProcessResult {
  readonly status?: number | null;
  readonly sessionId?: string | null;
  readonly runId?: string | null;
}

type ReviewerResultInput = {
  revision?: string | null;
  decidedAt: string;
  result?: ReviewerResultAttribution;
};

/** Translate one native agent run into the attribution accepted by Review authority. */
export function reviewerResultAttribution(
  reviewer: string,
  processResult: ReviewerProcessResult | null | undefined,
): ReviewerResultAttribution {
  return {
    ...(processResult?.sessionId ? { publicationId: processResult.sessionId } : {}),
    ...(processResult?.runId ? { runId: processResult.runId } : {}),
    reviewerId: reviewer,
    agentFamily: agentFamily(reviewer),
    outcome: 'completed',
    status: processResult?.status ?? 0,
  };
}

/** Attach the attributed publication to the exact revision the decision judged. */
export function attachReviewerResult(
  review: Review,
  decision: 'approved' | 'changes-requested',
  input: ReviewerResultInput,
  findings: readonly ReviewFinding[],
): Review {
  if (typeof input.revision !== 'string') { return review; }
  const round = currentReviewRound(review);
  const revision = changeRevision(input.revision);
  if (decision === 'approved' && round.decision?.kind === 'approved'
    && round.decision.revision && round.decision.revision !== revision) {
    throw new Error(`Approved replay must target decided revision ${round.decision.revision}; replay revision ${revision} is not reviewed`);
  }
  // The aggregate owns the authorized reviewer families. A policy-selected
  // concurrent reviewer may attribute its own result without rewriting the
  // round's historical primary reviewer; arbitrary actor aliases cannot mint
  // another family.
  const family = authorizedReviewerFamily(round, input);
  const result = attachedResult(input.result, family, round.number, revision, decision);
  return recordReviewerResult(review, {
    // Actor identity survives a launch reroute; the requested family can later
    // publish its own verdict without colliding with the fallback's result.
    publicationId: result.publicationId,
    ...(input.result?.runId ? { runId: input.result.runId } : {}),
    reviewerId: result.reviewerId,
    agentFamily: agentFamily(family),
    revision,
    decision,
    findings,
    outcome: result.outcome,
    status: result.status,
    publishedAt: input.decidedAt,
  });
}

/** Enrich a verdict that committed before its launcher returned the retained run ID. */
export async function persistReviewerRunAttribution(
  slug: string,
  reviewer: string,
  roundNumber: number,
  runId: string,
  store: MissionStore,
): Promise<boolean> {
  const family = agentFamily(reviewer);
  for (let attempt = 0; attempt < 3; attempt++) {
    const loaded = await store.load(missionId(slug));
    if (loaded.kind !== 'found' || !loaded.mission.review) { return false; }
    const review = loaded.mission.review;
    const round = currentReviewRound(review);
    if (round.number !== roundNumber) { return false; }
    const attributed = attributeReviewerRun(review, roundNumber, family, runId);
    if (attributed === review) { return (round.reviewerResults ?? []).some(result => result.agentFamily === family && result.runId === runId); }
    try {
      await store.save({ ...loaded.mission, review: attributed }, loaded.version);
      return true;
    } catch (error) {
      if (!isStaleWrite(error) || attempt === 2) { throw error; }
    }
  }
  return false;
}

function authorizedReviewerFamily(
  round: ReturnType<typeof currentReviewRound>,
  input: ReviewerResultInput,
): string {
  const attributed = input.result?.agentFamily;
  if (!attributed) { return round.reviewer; }
  if (!isRoundReviewer(round, attributed)) { return round.reviewer; }
  return attributed;
}

function attachedResult(result: ReviewerResultAttribution | undefined, family: string, round: number,
  revision: ReturnType<typeof changeRevision>, decision: 'approved' | 'changes-requested') {
  const reviewerId = result?.reviewerId ?? family;
  return {
    publicationId: result?.publicationId ?? `round-${round}:${reviewerId}:${revision}:${decision}`,
    reviewerId,
    outcome: result?.outcome ?? 'completed',
    status: result?.status === undefined ? 0 : result.status,
  };
}
