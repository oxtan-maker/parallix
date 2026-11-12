import type { MissionStore } from './domain-ports.js';
import type { MissionLifecycleService } from './mission-lifecycle-service.js';
import { reviewRepairTransitionDecision, type ReboundCause } from '../domain/mission-workflow.js';
import { agentFamily } from '../domain/agents.js';
import type { WorkflowReturnStage } from '../domain/board-event.js';
import { missionId } from '../domain/mission.js';
import { ConfiguredReviewerEligibility } from '../domain/review.js';

export type ReviewRepairTransition =
  | { readonly destination: 'active'; readonly sourceStage: WorkflowReturnStage;
      readonly cause?: Exclude<ReboundCause, { kind: 'integration-gate-failure' }> }
  | { readonly destination: 'review'; readonly reviewerEligibility?: ConfiguredReviewerEligibility };

/** Persist review repair boundaries before any repair or resumed review work. */
export async function transitionReviewRepair(
  slug: string,
  transition: ReviewRepairTransition,
  implementer: string,
  store: Pick<MissionStore, 'load'>,
  lifecycle: Pick<MissionLifecycleService, 'transition'> | null | undefined,
): Promise<void> {
  const loaded = await store.load(missionId(slug));
  if (loaded.kind !== 'found') { throw new Error(`Mission ${slug} is unavailable for review repair`); }
  const { mission } = loaded;
  const occurredAt = new Date().toISOString();
  const decision = reviewRepairTransitionDecision(mission, transition.destination, agentFamily(implementer), occurredAt,
    transition.destination === 'review' ? transition.reviewerEligibility : undefined,
    transition.destination === 'active' ? transition.cause : undefined);
  if (decision.kind === 'rejected' && decision.reason === 'effective-approval') { throw new Error(decision.message); }
  if (decision.kind === 'unchanged') { return; }
  if (!lifecycle) { throw new Error(`Mission ${slug} has no lifecycle service for review repair`); }
  if (decision.kind === 'rejected') { throw new Error(decision.message); }
  const result = await lifecycle.transition({
    operationId: `review-repair:${slug}:${transition.destination}`,
    missionId: mission.id,
    expectedVersion: loaded.version,
    capabilities: new Set(['mission:transition']),
    command: decision.command,
    actor: decision.actor,
    occurredAt,
    idempotencyKey: `review-repair:${slug}:${transition.destination}:${loaded.version}`,
    ...(transition.destination === 'active' ? { workflowReturn: transition.sourceStage } : {}),
  });
  if (result.status !== 'completed') { throw new Error(result.error?.message ?? `Mission ${slug} review repair transition failed`); }
}
