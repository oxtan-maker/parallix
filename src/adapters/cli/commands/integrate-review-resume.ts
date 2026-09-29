// Automatic revbounce review-resume for `px integrate` (TASK-2550).
//
// When the integration-gate repair changed the approved revision, the
// revision-changed route retracts the standing approval (TASK-2528) and this
// module resumes review of the repaired revision through the existing review
// pipeline instead of dead-ending with the human re-review instruction:
//
//  1. The lifecycle rebound has already revoked the approval and opened an
//     undecided round. Handoff binds that round to the committed repair.
//  2. The same `startReviewLoop` + mission-service handoff `px review --start`
//     drives that round, with the loop's process exit mapped to a
//     thrown error so `px integrate` owns the run's failure handling. A named
//     reviewer is selected by handoff and read back from the persisted round.
//
// The dependency direction matches `integrate-gate-rebound.ts`: `integrate.ts`
// imports from here, never the other way round.
import * as reviewLoop from '../../review/review-loop.js';
import { reviewLoopBindings } from '../../review/review-persistence.js';
import { createHandoffPorts } from './handoff.js';
import { HandoffCommandUseCase } from '../../../application/handoff-command-use-case.js';
import type { HandoffMissionServicesPort } from '../../../application/ports/handoff-workflow.js';
import type { MissionStore } from '../../../application/domain-ports.js';
import { missionId } from '../../../domain/mission.js';
import { currentReviewRound, reviewStatus } from '../../../domain/review.js';

/**
 * Require the round opened by rebound-to-active. The handoff owns the actual
 * repaired commit and reviewer assignment; neither is guessed here.
 */
async function pendingRepairRound(
  slug: string,
  store: MissionStore,
): Promise<number> {
  const id = missionId(slug);
  const loaded = await store.load(id);
  if (loaded.kind !== 'found') {
    throw new Error(`automatic re-review of ${slug} cannot load its mission from the operator database`);
  }
  const { mission } = loaded;
  if (mission.status !== 'active' || !mission.review) {
    throw new Error(`automatic re-review of ${slug} requires an active mission with a review`);
  }
  const review = mission.review;
  const current = currentReviewRound(review);
  const previous = review.rounds.at(-2);
  if (reviewStatus(review) !== 'awaiting-review' || current.decision
    || previous?.decision?.kind !== 'approved' || previous.decision.revocation?.revokedBy !== 'workflow'
    || !previous.decision.revocation.reason.startsWith('Integration gates failed')) {
    throw new Error(`automatic re-review of ${slug} requires the undecided round opened by the integration-gate rebound`);
  }
  return current.number;
}

/**
 * The automatic revbounce's review-resume (TASK-2550): resumes the round
 * opened by the rebound through the same `startReviewLoop` + mission-service
 * handoff that `px review --start` drives. Handoff records the
 * committed repair and chooses the reviewer. The loop's process exit maps to
 * an error so `px integrate` owns failure handling.
 */
export async function startAutoReviewRound(
  slug: string,
  options: { worktree: string; revision: string; missionServicesFn: Function },
): Promise<string> {
  const missionServicesFn = options.missionServicesFn as HandoffMissionServicesPort;
  // The factory resolves to the full mission application services (store and
  // lifecycle live directly on it); the handoff seam only needs the factory's
  // structural shape.
  const services: any = await missionServicesFn(options.worktree, {});
  const store: MissionStore | null = services.store ?? null;
  if (!store) {
    throw new Error(`automatic re-review of ${slug} cannot read its mission: operator database unavailable`);
  }
  const roundNumber = await pendingRepairRound(slug, store);
  const performHandoffFn = (handoffSlug: string, handoffOptions: Record<string, unknown> = {}): Promise<any> => new HandoffCommandUseCase({
    ...createHandoffPorts(),
    missionServices: missionServicesFn,
  }).performHandoff(handoffSlug, { ...handoffOptions, missionServicesFn });
  await reviewLoop.startReviewLoop(slug, {
    isContinue: false,
    // This is a fresh invocation with its own review budget, even if the
    // mission's earlier approved round reached the loop's default limit.
    maxAttempts: roundNumber + reviewLoop.DEFAULT_MAX_ATTEMPTS - 1,
    worktree: options.worktree,
    exit: (code: number) => {
      throw new Error(`automatic re-review of ${slug} stopped (exit ${code}) before the repaired revision ${options.revision} was approved`);
    },
    performHandoffFn,
    ...reviewLoopBindings(store, services.lifecycle),
  });
  const completed = await store.load(missionId(slug));
  if (completed.kind !== 'found' || !completed.mission.review) {
    throw new Error(`automatic re-review of ${slug} lost its review after the loop`);
  }
  return currentReviewRound(completed.mission.review).reviewer;
}
