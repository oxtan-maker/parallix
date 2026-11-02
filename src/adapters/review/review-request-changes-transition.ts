import type { MissionVersion } from '../../application/domain-ports.js';
import { missionId, type Mission } from '../../domain/mission.js';
import { currentReviewRound, type Review } from '../../domain/review.js';
import type { ReviewRoundPorts, ReviewRoundResult } from './review-round.js';

/** Finish the lane boundary using the stored decision, including after an interrupted write. */
export async function settleRequestedChanges(slug: string, mission: Mission & { review: Review }, version: MissionVersion,
  ports: ReviewRoundPorts, operator?: string): Promise<ReviewRoundResult> {
  if (mission.status === 'active') { return { outcome: 'unchanged', reason: 'requested changes and active lane are already recorded' }; }
  if (mission.status !== 'review') { return { outcome: 'failed', diagnostic: `Cannot settle requested changes for ${slug} from ${mission.status}` }; }
  if (!ports.lifecycleService) { return { outcome: 'failed', diagnostic: `Requested changes for ${slug} require the lifecycle service to move review → active` }; }
  const round = currentReviewRound(mission.review);
  if (round.decision?.kind !== 'changes-requested') { return { outcome: 'failed', diagnostic: 'Requested changes require a recorded decision' }; }
  const transition = await ports.lifecycleService.transition({
    operationId: `review-request-changes:${slug}`, missionId: missionId(slug), expectedVersion: version,
    capabilities: new Set(['mission:transition']), command: { type: 'request-changes', review: mission.review },
    actor: operator ?? (round.decision.source?.author || round.reviewer), occurredAt: round.decision.decidedAt,
    idempotencyKey: `request-changes:${slug}:${round.decision.decidedAt}`,
  });
  if (transition.status === 'completed') { return { outcome: 'recorded' }; }
  return { outcome: 'failed', diagnostic: `review → active transition failed for ${slug}: ${transition.error?.message ?? 'unknown failure'}`,
    ...(transition.error?.kind === 'conflict' ? { kind: 'stale-write' as const } : {}) };
}
