import type { MissionStore } from './domain-ports.js';
import type { MissionLifecycleService } from './mission-lifecycle-service.js';
import type { MissionCommand, ReboundCause } from '../domain/mission-workflow.js';
import { agentFamily } from '../domain/agents.js';
import { missionId } from '../domain/mission.js';
import { ConfiguredReviewerEligibility, currentReviewRound, reviewStatus } from '../domain/review.js';

/** Persist review repair boundaries before any repair or resumed review work. */
export async function transitionReviewRepair(
  slug: string,
  destination: 'active' | 'review',
  implementer: string,
  store: MissionStore,
  lifecycle: MissionLifecycleService | null,
  reviewerEligibility?: ConfiguredReviewerEligibility,
  cause: Exclude<ReboundCause, { kind: 'integration-gate-failure' }> = { kind: 'review-repair' },
): Promise<void> {
  const loaded = await store.load(missionId(slug));
  if (loaded.kind !== 'found') { throw new Error(`Mission ${slug} is unavailable for review repair`); }
  const { mission } = loaded;
  if (mission.review && reviewStatus(mission.review) === 'approved' && mission.status !== 'integration') {
    throw new Error(`Mission ${slug} review repair requires an undecided review round; its effective approval must be revoked by the operator`);
  }
  if (mission.status === destination) { return; }
  if (!lifecycle) { throw new Error(`Mission ${slug} has no lifecycle service for review repair`); }
  if (!mission.review) { throw new Error(`Mission ${slug} has no review for repair`); }
  const round = currentReviewRound(mission.review);
  // AC12: reviewer eligibility always comes from the configured review step.
  // A review repair must never inherit the prior round's reviewer as the only
  // eligible reviewer, so the caller passes the configured eligibility and this
  // path throws when it is absent instead of falling back to [round.reviewer].
  const command: MissionCommand = destination === 'active'
    ? { type: 'rebound-to-active', agent: agentFamily(implementer), cause, occurredAt: new Date().toISOString() }
    : reviewerEligibility
      ? { type: 'submit-for-review', gatesPassed: true, review: mission.review, reviewerEligibility }
      : (() => { throw new Error('transitionReviewRepair requires the configured review step reviewerEligibility for a review repair'); })();
  const result = await lifecycle.transition({
    operationId: `review-repair:${slug}:${destination}`,
    missionId: mission.id,
    expectedVersion: loaded.version,
    capabilities: new Set(['mission:transition']),
    command,
    actor: destination === 'active' ? implementer : round.reviewer,
    occurredAt: new Date().toISOString(),
    idempotencyKey: `review-repair:${slug}:${destination}:${loaded.version}`,
  });
  if (result.status !== 'completed') { throw new Error(result.error?.message ?? `Mission ${slug} review repair transition failed`); }
}
