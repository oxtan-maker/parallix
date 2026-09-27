import type { MissionStore, MissionTransitionStore } from './domain-ports.js';
import { missionId, type Mission } from '../domain/mission.js';
import { currentReviewRound, reviewStatus, revokeApprovedDecision } from '../domain/review.js';

/** Recover the approval left effective by an older integration-gate rebound. */
export async function recoverLegacyIntegrationRepairReview(store: MissionStore, slug: string): Promise<boolean> {
  const transitions = (store as MissionTransitionStore).findTransitions;
  if (!transitions) { return false; }
  const id = missionId(slug);
  const loaded = await store.load(id);
  if (loaded.kind !== 'found' || loaded.mission.status !== 'active' || !loaded.mission.review
    || reviewStatus(loaded.mission.review) !== 'approved') { return false; }
  const history = await transitions.call(store, id);
  const last = history?.at(-1);
  if (last?.trigger !== 'rebound-to-active' || !last.idempotencyKey?.startsWith(`integration-gate-rebound:${slug}:`)) {
    return false;
  }
  const review = revokeApprovedDecision(loaded.mission.review, currentReviewRound(loaded.mission.review).number, {
    revokedAt: new Date().toISOString(), revokedBy: 'workflow',
    reason: 'Integration gates failed; recovering the approval left effective by a legacy repair rebound.',
  });
  await store.save({ ...loaded.mission, review }, loaded.version);
  return true;
}

/** A repair that stopped between commands still owes review before landing. */
export function hasIntegrationRepairHistory(mission: Mission): boolean {
  return Boolean(mission.review?.rounds.some(round => round.decision?.kind === 'approved'
    && round.decision.revocation?.revokedBy === 'workflow'
    && round.decision.revocation.reason.startsWith('Integration gates failed;')));
}

export function integrationRepairNeedsReview(mission: Mission): boolean {
  return (mission.status === 'active' || mission.status === 'review') && Boolean(mission.review
    && reviewStatus(mission.review) !== 'approved' && hasIntegrationRepairHistory(mission));
}
