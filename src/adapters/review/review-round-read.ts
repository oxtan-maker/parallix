import type { MissionStore, MissionVersion } from '../../application/domain-ports.js';
import { missionId, type Mission } from '../../domain/mission.js';
import type { Review } from '../../domain/review.js';
import type { ReviewRoundResult } from './review-round.js';

export function staleWrite(slug: string, expected: number | undefined, actual: number): string | null {
  if (expected === undefined) { return null; }
  if (expected === actual) { return null; }
  return `stale write for ${slug}: expected version ${expected}, found ${actual}. Re-read \`px status ${slug}\` and retry.`;
}

type ReviewDecisionRead = { kind: 'ready'; mission: Mission & { review: Review }; version: MissionVersion }
  | { kind: 'failed'; result: ReviewRoundResult };

function hasStoredReview(mission: Mission): mission is Mission & { review: Review } {
  return 'review' in mission && Boolean(mission.review);
}

/** Read the recorded round before deciding it; stale writes retain the caller's operation diagnostic. */
export async function readReviewForDecision(slug: string, store: MissionStore, expectedVersion: number | undefined, action: 'decide' | 'approve'): Promise<ReviewDecisionRead> {
  const loaded = await store.load(missionId(slug));
  if (loaded.kind !== 'found') { return { kind: 'failed', result: { outcome: 'failed', diagnostic: `Mission ${slug} is not in the operator database` } }; }
  const stale = staleWrite(slug, expectedVersion, loaded.version);
  if (stale) { return { kind: 'failed', result: { outcome: 'failed', diagnostic: stale } }; }
  if (!hasStoredReview(loaded.mission)) {
    return { kind: 'failed', result: { outcome: 'failed', diagnostic: `Mission ${slug} has no review to ${action}; px review ${slug} --start starts the review` } };
  }
  return { kind: 'ready', mission: loaded.mission, version: loaded.version };
}
