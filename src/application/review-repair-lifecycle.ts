import type { MissionStore } from './domain-ports.js';
import type { MissionLifecycleService } from './mission-lifecycle-service.js';
import { reviewRepairTransitionDecision, type ReboundCause } from '../domain/mission-workflow.js';
import { agentFamily } from '../domain/agents.js';
import { missionId } from '../domain/mission.js';
import { ConfiguredReviewerEligibility } from '../domain/review.js';

/** Persist review repair boundaries before any repair or resumed review work. */
export async function transitionReviewRepair(
  slug: string,
  destination: 'active' | 'review',
  implementer: string,
  store: Pick<MissionStore, 'load'>,
  lifecycle: Pick<MissionLifecycleService, 'transition'> | null | undefined,
  reviewerEligibility?: ConfiguredReviewerEligibility,
  cause?: Exclude<ReboundCause, { kind: 'integration-gate-failure' }>,
): Promise<void> {
  const loaded = await store.load(missionId(slug));
  if (loaded.kind !== 'found') { throw new Error(`Mission ${slug} is unavailable for review repair`); }
  const { mission } = loaded;
  const occurredAt = new Date().toISOString();
  const decision = reviewRepairTransitionDecision(mission, destination, agentFamily(implementer), occurredAt,
    reviewerEligibility, cause);
  if (decision.kind === 'rejected' && decision.reason === 'effective-approval') { throw new Error(decision.message); }
  if (decision.kind === 'unchanged') { return; }
  if (!lifecycle) { throw new Error(`Mission ${slug} has no lifecycle service for review repair`); }
  if (decision.kind === 'rejected') { throw new Error(decision.message); }
  const result = await lifecycle.transition({
    operationId: `review-repair:${slug}:${destination}`,
    missionId: mission.id,
    expectedVersion: loaded.version,
    capabilities: new Set(['mission:transition']),
    command: decision.command,
    actor: decision.actor,
    occurredAt,
    idempotencyKey: `review-repair:${slug}:${destination}:${loaded.version}`,
  });
  if (result.status !== 'completed') { throw new Error(result.error?.message ?? `Mission ${slug} review repair transition failed`); }
}
