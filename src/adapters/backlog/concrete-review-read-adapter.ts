import type { MissionId } from '../../domain/mission.js';
import type { Review, ReviewedRevision } from '../../domain/review.js';
import { requireReviewPhase } from '../../domain/review-phase-policy.js';
import type { ReviewProjectionFact, ReviewReadAdapter } from '../../application/projections/board-readers.js';
import type { MissionStore } from '../../application/domain-ports.js';

export interface ConcreteReviewReadAdapterOptions {
  readonly missionStore: MissionStore | null;
  readonly projectionReader?: Pick<ReviewReadAdapter, 'loadReviews'> | null;
}

/** Read authoritative Reviews without reconstructing decisions from loop scratch. */
export class ConcreteReviewReadAdapter implements ReviewReadAdapter {
  constructor(private readonly options: ConcreteReviewReadAdapterOptions) {}

  async loadReviews(missionIds: readonly MissionId[]): Promise<ReadonlyMap<MissionId, ReviewProjectionFact>> {
    if (this.options.projectionReader) { return this.options.projectionReader.loadReviews(missionIds); }
    return new Map(await Promise.all(missionIds.map(async id => {
      const review = await this.loadReview(id);
      return [id, { review, approval: this.approval(review) }] as const;
    })));
  }

  async loadReview(id: MissionId): Promise<Review | null> {
    if (!this.options.missionStore) { return null; }
    const result = await this.options.missionStore.load(id);
    const review = result.kind === 'found' ? result.mission.review : null;
    if (review) { for (const round of review.rounds) { requireReviewPhase(round.phase); } }
    return review ?? null;
  }

  async loadReviewApproval(id: MissionId): Promise<{ subject: ReviewedRevision; approvedAt: string | null } | null> {
    return this.approval(await this.loadReview(id));
  }

  private approval(review: Review | null) {
    const current = review?.rounds[review.rounds.length - 1];
    return current?.phase === 'approved' && current.decision?.kind === 'approved'
      ? { subject: current.subject, approvedAt: current.decision.decidedAt }
      : null;
  }
}
