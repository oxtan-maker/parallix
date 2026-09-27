/**
 * The review loop's round-open handoff boundary (TASK-2582).
 *
 * Every round the autonomous loop opens passes through here. When the Mission
 * is `active` — the shape a request-changes round leaves behind — the
 * boundary moves it back to `review` through the authoritative lifecycle
 * transition, so a later approval can complete the `review → integration`
 * boundary instead of reporting success over an active Mission (the
 * TASK-2579 mismatch). The round's review bookkeeping is persisted on the
 * Review aggregate.
 *
 * The boundary runs before any destination-state work (pre-review rebase,
 * gates, reviewer launch) starts: a transition that cannot commit fails the
 * boundary, and the loop stops the round instead of running a reviewer
 * against a Mission that is not in the review lane. The Backlog task mirror
 * stays at the loop's existing sites: it follows the rebase outcome, while
 * the database lane is the authority.
 *
 * Extracted from `review-loop.ts` so the boundary is testable at the real
 * MissionLifecycleService and review-persistence edges without launching
 * agents.
 */

import * as fmt from '../../application/presentation/cli-format.js';
import type { MissionLifecycleService } from '../../application/mission-lifecycle-service.js';
import type { MissionStore } from '../../application/domain-ports.js';
import { missionId } from '../../domain/mission.js';
import {
  beginNextReviewRound,
  ConfiguredReviewerEligibility,
  currentReviewRound,
  reviewStatus,
} from '../../domain/review.js';
import {
  persistReviewStateOrThrow,
  writeReviewState,
  type ReviewState,
} from './review-state.js';

export interface OpenReviewRoundOptions {
  readonly worktree: string;
  readonly log: (_msg: string) => void;
  readonly error: (_msg: string) => void;
  readonly writeReviewStateFn?: typeof writeReviewState;
  readonly missionStore?: MissionStore | null;
  readonly lifecycleService?: MissionLifecycleService | null;
}

export type OpenReviewRoundResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly diagnostic: string };

/**
 * Open a review round at the loop's handoff boundary.
 *
 * The authoritative `active → review` transition runs first: destination-state
 * work must not start while the Mission is still in the active lane. When the
 * transition cannot commit the boundary fails and the loop stops the round.
 */
export async function openReviewRound(
  slug: string,
  state: ReviewState,
  options: OpenReviewRoundOptions,
): Promise<OpenReviewRoundResult> {
  const {
    worktree,
    log,
    error,
    writeReviewStateFn = writeReviewState,
    missionStore = null,
    lifecycleService = null,
  } = options;

  if (missionStore) {
    const laneResult = await settleReviewLane(slug, state, { missionStore, lifecycleService });
    if (laneResult.ok === false) {
      error(fmt.status('FAIL', laneResult.diagnostic));
      return laneResult;
    }
  }

  state.phase = 'reviewing';
  try {
    await persistReviewStateOrThrow(writeReviewStateFn, slug, state, worktree, missionStore, lifecycleService);
  } catch (err) {
    const diagnostic = `Could not persist the review round for ${slug}: ${err instanceof Error ? err.message : String(err)}`;
    error(fmt.status('FAIL', diagnostic));
    return { ok: false, diagnostic };
  }
  log(fmt.status('INFO', `Review round ${state.round} open for ${slug}.`));
  return { ok: true };
}

/**
 * Move an active Mission back into the review lane through the lifecycle
 * service. A Mission already in `review` (or with no review to advance) needs
 * no lane move; any other active-lane shape fails loudly rather than opening
 * a round over an inconsistent state.
 */
async function settleReviewLane(
  slug: string,
  state: ReviewState,
  ports: { missionStore: MissionStore; lifecycleService: MissionLifecycleService | null },
): Promise<OpenReviewRoundResult> {
  let loaded;
  try {
    loaded = await ports.missionStore.load(missionId(slug));
  } catch (err) {
    return { ok: false, diagnostic: `Cannot open the review round for ${slug}: the operator database is unavailable (${err instanceof Error ? err.message : String(err)})` };
  }
  if (loaded.kind !== 'found') { return { ok: true }; } // no Mission recorded: the Backlog mirror still runs
  const mission = loaded.mission;
  if (mission.status !== 'active' || !mission.review) { return { ok: true }; }
  if (!ports.lifecycleService) {
    return {
      ok: false,
      diagnostic: `Mission ${slug} is active but no lifecycle service is bound; the review round cannot open without the active → review boundary`,
    };
  }

  const status = reviewStatus(mission.review);
  let review = mission.review;
  if (status === 'ready-for-next-round') {
    // Advance to the next round over the resolved revision, the same domain
    // command the handoff and board resume paths use. The round advance stays
    // in memory here: the active → review transition below commits the
    // advanced round and the lane event as one unit (saveWithTransition).
    // Persisting the round first would leave the store with a next round
    // recorded over a still-active Mission if the transition then failed
    // (review round 4, F8).
    const current = currentReviewRound(review);
    const eligibility = ConfiguredReviewerEligibility.fromReviewStep({
      eligible: [current.reviewer],
      strategy: 'random',
    });
    try {
      review = beginNextReviewRound(review, current.reviewer, current.implementer, state.startedAt, eligibility);
    } catch (err) {
      return { ok: false, diagnostic: `Cannot advance the review round for ${slug}: ${err instanceof Error ? err.message : String(err)}` };
    }
  } else if (status !== 'awaiting-review') {
    // `approved` is the TASK-2579 stranded shape (an approval recorded over an
    // active Mission); the loop does not self-heal it — `px integrate` owns
    // that recovery (TASK-2397).
    return {
      ok: false,
      diagnostic: `Cannot open the review round for ${slug}: the Mission is active while its review is ${status}; resolve the review state (px integrate ${slug}) before opening a round`,
    };
  }

  const opened = currentReviewRound(review);
  const transition = await ports.lifecycleService.transition({
    operationId: `round-open:${slug}`,
    missionId: missionId(slug),
    expectedVersion: loaded.version,
    capabilities: new Set(['mission:transition']),
    command: {
      type: 'submit-for-review',
      gatesPassed: true,
      review,
      reviewerEligibility: ConfiguredReviewerEligibility.fromReviewStep({
        eligible: [opened.reviewer],
        strategy: 'random',
      }),
    },
    actor: opened.reviewer,
    occurredAt: state.startedAt,
    // Stable per round: a retried round-open replays the recorded lane event
    // instead of recording a second one.
    idempotencyKey: `round-open:${slug}:round-${opened.number}`,
  });
  if (transition.status !== 'completed') {
    return {
      ok: false,
      diagnostic: `active → review transition failed for ${slug}: ${transition.error?.message ?? 'unknown failure'}`,
    };
  }
  return { ok: true };
}
