import { missionId } from '../../domain/mission.js';
import { changeRevision, currentReviewRound, replaceCurrentRound } from '../../domain/review.js';
import type { LoopContext, ReviewRound } from './round.js';

/**
 * Keep the round's review baseline with its reviewed subject, so a later repair can
 * compare the mission diff this round judged with the one it re-reviews. Best effort:
 * a lost write leaves the round without a baseline, which later comparison declares.
 */
export async function pinReviewBaseline(context: LoopContext, round: ReviewRound): Promise<void> {
  const store = context.ports.missionStore;
  if (!store || !round.reviewBaseline) { return; }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const loaded = await store.load(missionId(context.slug));
      if (loaded.kind !== 'found' || !loaded.mission.review) { return; }
      const { mission, version } = loaded;
      const review = mission.review!;
      const current = currentReviewRound(review);
      if (current.decision || current.number !== context.state.round || current.subject.baseline === round.reviewBaseline) { return; }
      const pinned = { ...current, subject: { ...current.subject, baseline: changeRevision(round.reviewBaseline) } };
      await store.save({ ...mission, review: { ...review, rounds: replaceCurrentRound(review, pinned) } }, version);
      return;
    } catch { /* version moved or the store is unavailable: retry once, then leave the baseline unrecorded */ }
  }
}
