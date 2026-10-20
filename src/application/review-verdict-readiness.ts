import type { MissionStore } from './domain-ports.js';
import { missionId } from '../domain/mission.js';
import { type Review, reviewStatus } from '../domain/review.js';

export interface VerdictBlock {
  readonly cause: string;
  readonly diagnostic: string;
  readonly nextAction: string;
}

/** Read-only workflow facts; only an operator can acknowledge an intervention. */
export async function reviewVerdictBlock(slug: string, store?: MissionStore | null): Promise<VerdictBlock | null> {
  if (!store) { return null; }
  const loaded = await store.load(missionId(slug));
  if (loaded.kind !== 'found' || !loaded.mission.review) { return null; }
  return verdictBlockForReview(slug, loaded.mission.review);
}

export function verdictBlockForReview(slug: string, review: Review): VerdictBlock | null {
  const status = reviewStatus(review);
  if (status === 'approved' || status === 'awaiting-review') { return null; }
  const cause = review.intervention?.reason ?? status;
  const nextAction = review.intervention
    ? `Operator recovery: px review ${slug} --continue`
    : `Resolve the outstanding findings, then px review ${slug} --start`;
  return { cause, diagnostic: `Verdict blocked: review is ${status}; cause=${cause}. ${nextAction}`, nextAction };
}
