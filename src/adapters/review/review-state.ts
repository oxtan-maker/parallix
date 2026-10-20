import type { ReviewStatePersistenceResult, ReviewStateData, ReviewStateWriter } from '../../application/ports/review-persistence.js';
export type { ReviewStatePersistenceResult, ReviewStateData, ReviewStateWriter } from '../../application/ports/review-persistence.js';
import { diagnosticFrom, resolveMissionStore } from './review-state-store.js';
export { resetReviewState } from './review-state-store.js';
export { reviewStateFile, readExportedReviewEvents, reconcileInterruptedHandoff, backfillReviewFromLegacyState, type ReviewBackfillResult, type InterruptedHandoffInputs, type InterruptedHandoffReconciliationResult } from './review-legacy-import.js';
import { REVIEW_PHASES as VALID_PHASES, normalizeReviewPhase, reviewPhaseTransition } from '../../domain/review-phase-policy.js';
/**
 * Reviewer-family persistence for the autonomous review loop.
 *
 * After the architecture migration cutover the `Review` aggregate in the operator
 * database is the sole write authority for review-loop state (ADR 0053).
 * `ReviewState` is the loop's flat view of that aggregate; the field-by-field
 * correspondence lives in `review-state-mapping.ts`.
 *
 * `review-state.json` is no longer written, and the loop never reads it. A
 * mission's Review is created by `px handoff` (`startReview`), so a loop that
 * finds no Review is reported as a failure rather than inventing one without a
 * reviewed revision or a configured reviewer eligibility.
 *
 * Missions handed off before the cutover are the exception: they carry a
 * `review-state.json` and no Review, and fail closed forever without a way
 * across. `backfillReviewFromLegacyState` is that way — an explicit operator
 * command (`px review <slug> --backfill-review`), so the loop itself keeps
 * failing closed rather than self-healing behind the operator's back.
 *
 * Owned by the Node workflow harness (ADR 0037 / architecture migration).
 */


import { resolveWorktree } from '../filesystem/mission-utils.js';
import { missionId } from '../../domain/mission.js';

import { applyReviewStateToReview, reviewStateDataFrom } from './review-state-mapping.js';
import type { MissionLifecycleService } from '../../application/mission-lifecycle-service.js';
import type { MissionStore } from '../../application/domain-ports.js';
import { requireReviewIdentity } from '../../domain/mission-workflow.js';
import type { PullRequestReference } from '../../domain/review.js';

interface ReviewStatePersistenceContext {
  slug: string;
  phase?: string | null;
  round?: number | null;
}

export function assertReviewStatePersisted(
  result: ReviewStatePersistenceResult | boolean | void | unknown,
  context: ReviewStatePersistenceContext
): void {
  if (result === true || result === undefined) { return; }
  if (result === false) {
    throw new Error(`Review-state persistence failed for mission ${context.slug}, phase ${context.phase || 'unknown'}, round ${context.round ?? 'unknown'}: persistence returned false`);
  }
  if (!result || typeof result !== 'object' || !('outcome' in result)) { return; }
  const persistenceResult = result as ReviewStatePersistenceResult;
  if (persistenceResult.outcome === 'committed' || persistenceResult.outcome === 'unchanged') { return; }
  throw new Error(
    `Review-state persistence failed for mission ${context.slug}, phase ${context.phase || 'unknown'}, round ${context.round ?? 'unknown'}, stage ${persistenceResult.stage}: ${persistenceResult.diagnostic}`
  );
}

/**
 * Persist review state, throwing when persistence did not commit.
 *
 * @param {typeof writeReviewState} writeFn
 * @param {string} slug
 * @param {ReviewState|Record<string, unknown>} state
 * @param {string} worktree
 * @param {MissionStore|null|undefined} [missionStore]  backward-compat positional arg
 * @param {MissionLifecycleService|null|undefined} [lifecycleService]  TASK-2376 approval boundary
 * @returns {Promise<ReviewStatePersistenceResult>}
 */
export async function persistReviewStateOrThrow(
  writeFn: ReviewStateWriter,
  slug: string,
  state: ReviewState | ReviewStateData | Record<string, unknown>,
  worktree: string,
  missionStore?: MissionStore | null,
  lifecycleService?: Pick<MissionLifecycleService, 'transition'> | null,
): Promise<ReviewStatePersistenceResult> {
  const result = await writeFn(slug, state, worktree, { missionStore, lifecycleService });
  assertReviewStatePersisted(result, {
    slug,
    phase: state instanceof ReviewState ? state.phase : String(state.phase || 'unknown'),
    round: state instanceof ReviewState ? state.round : (typeof state.round === 'number' ? state.round : null)
  });
  return result;
}

/**
 * Read the persisted review state for a mission from the operator database.
 *
 * Returns null when the mission has no Review yet — the loop treats that as
 * "no round has started", which is what an absent `review-state.json` used to
 * mean.
 *
 * @param {string} slug
 * @param {string} [rootDir]  Directory to resolve the mission from (defaults to process.cwd())
 * @returns {Promise<ReviewState|null>}
 */
export async function readReviewState(slug: string, rootDir = process.cwd(), missionStore?: MissionStore | null): Promise<ReviewState | null> {
  try {
    const store = await resolveMissionStore(rootDir, missionStore);
    if (!store) { return null; }
    const result = await store.load(missionId(slug));
    if (result.kind !== 'found' || !result.mission.review) { return null; }
    return new ReviewState(slug, reviewStateDataFrom(result.mission.review), store);
  } catch {
    return null;
  }
}

/** One completed round, flattened for consumers that need round history. */
export interface ReviewRoundSummary {
  readonly startRevision?: string;
  readonly decidedRevision?: string | null;
  readonly number: number;
  readonly reviewer: string;
  readonly implementer: string;
  readonly decision: 'approved' | 'changes-requested' | null;
  readonly disposition: string | null;
}

/**
 * Read every review round for a mission from the operator database.
 *
 * The statistics projection needs the whole conversation, not just the current
 * round: "pr fix rounds" is a count over rounds the reviewer sent back. Before
 * the architecture migration cutover that count was reconstructed by parsing the mission's
 * `review-events/*.md` files and `review-state(...)` commit subjects; the
 * aggregate records it directly.
 *
 * @param {string} slug
 * @param {string} [rootDir]
 * @returns {Promise<readonly ReviewRoundSummary[]>}  Empty when there is no review.
 */
export async function readReviewRounds(slug: string, rootDir = process.cwd(), missionStore?: MissionStore | null): Promise<readonly ReviewRoundSummary[]> {
  try {
    const store = await resolveMissionStore(rootDir, missionStore);
    if (!store) { return []; }
    const result = await store.load(missionId(slug));
    if (result.kind !== 'found' || !result.mission.review) { return []; }
    return result.mission.review.rounds.map((round) => ({
      number: round.number,
      startRevision: round.subject.revision,
      decidedRevision: round.decision?.revision ?? null,
      reviewer: round.reviewer,
      implementer: round.implementer,
      decision: round.decision ? round.decision.kind : null,
      disposition: round.disposition,
    }));
  } catch {
    return [];
  }
}

/**
 * Resolve the review-provider identity for a review workflow path.
 *
 * @param {string} slug
 * @param {string} [rootDir]
 * @param {{readReviewStateFn?: Function}} [options]
 * @returns {Promise<{ identityUser: string|null, commentIdentityUser: string|null, forgejoUser: string|null, commentForgejoUser: string|null, reviewState: ReviewState|null, source: 'review-state'|null }>}
 */
export async function resolveReviewIdentity(
  slug: string,
  rootDir = process.cwd(),
  options: { readReviewStateFn?: ReviewStateReader } = {}
): Promise<{
  identityUser: string | null;
  commentIdentityUser: string | null;
  forgejoUser: string | null;
  commentForgejoUser: string | null;
  reviewState: ReviewState | ReviewStateData | null;
  source: 'review-state' | null;
}> {
  const readReviewStateFn = options.readReviewStateFn || readReviewState;
  const reviewState = await Promise.resolve(readReviewStateFn(slug, rootDir));
  const reviewerUser = reviewState ? (reviewState.reviewer || reviewState.implementer || null) : null;
  const implementerUser = reviewState ? (reviewState.implementer || reviewState.reviewer || null) : null;

  return {
    identityUser: reviewerUser || null,
    commentIdentityUser: implementerUser || null,
    forgejoUser: reviewerUser || null,
    commentForgejoUser: implementerUser || null,
    reviewState,
    source: reviewerUser ? 'review-state' : null
  };
}

/**
 * Manager class for mission review state.
 * Expanded to include phase, disposition, and metadata for canonical state ownership.
 */
export { REVIEW_PHASES as VALID_PHASES, normalizeReviewPhase } from '../../domain/review-phase-policy.js';

function reviewPersistenceOptions(options: { missionStore?: MissionStore | null; lifecycleService?: Pick<MissionLifecycleService, 'transition'> | null } | MissionStore | null) {
  const opts: { missionStore?: MissionStore | null; lifecycleService?: Pick<MissionLifecycleService, 'transition'> | null } =
    options && typeof options === 'object' && 'save' in options
      ? { missionStore: options as MissionStore }
      : (options as { missionStore?: MissionStore | null; lifecycleService?: Pick<MissionLifecycleService, 'transition'> | null } ?? {});
  return opts;
}

export class ReviewState {
  slug: string;
  reviewer?: string;
  implementer?: string;
  round: number;
  startedAt: string;
  phase: string;
  disposition: string | null;
  metadata: Record<string, unknown>;
  pullRequest: PullRequestReference | null;
  phaseOriginal: string | null;
  private readonly missionStore: MissionStore | null;

  /**
   * @param {string} slug
   * @param {ReviewStateData} [data]
   */
  constructor(slug: string, data: ReviewStateData = {}, missionStore: MissionStore | null = null) {
    const phaseInfo = normalizeReviewPhase(data.phase || '', data.disposition || '');
    this.slug = slug;
    this.reviewer = data.reviewer;
    this.implementer = data.implementer;
    this.round = data.round || 1;
    this.startedAt = data.startedAt || new Date().toISOString();
    this.phase = phaseInfo.phase;
    this.disposition = data.disposition || null;
    this.metadata = data.metadata || {};
    this.pullRequest = data.pullRequest ?? null;
    this.phaseOriginal = phaseInfo.normalized ? phaseInfo.original : null;
    this.missionStore = missionStore;
  }

  /**
   * @param {string} slug
   * @param {ReviewState|ReviewStateData} dataOrInstance
   * @returns {ReviewState}
   */
  static from(slug: string, dataOrInstance: ReviewState | ReviewStateData): ReviewState {
    if (dataOrInstance instanceof ReviewState) {
      if (dataOrInstance.slug !== slug) {
        throw new Error(`ReviewState slug mismatch: expected "${slug}", got "${dataOrInstance.slug}"`);
      }
      return dataOrInstance;
    }
    return new ReviewState(slug, dataOrInstance || {});
  }

  /**
   * @param {string} nextPhase
   * @returns {ReviewState}
   */
  transitionTo(nextPhase: string): ReviewState {
    const transition = reviewPhaseTransition(this.phase, nextPhase);
    if (!transition.valid) {
      throw new Error(`Invalid phase: "${nextPhase}". Valid: ${(VALID_PHASES as readonly string[]).join(', ')}`);
    }
    const allowedArr = transition.allowed;
    if (!transition.permitted) {
      throw new Error(`Cannot transition from "${this.phase}" to "${nextPhase}". Allowed: ${(allowedArr || []).join(', ') || 'none'}`);
    }
    this.phase = nextPhase;
    return this;
  }

  advanceRound(): ReviewState {
    this.round += 1;
    this.phase = 'reviewing';
    this.disposition = null;
    this.startedAt = new Date().toISOString();
    return this;
  }

  /**
   * @returns {{reviewer?: string, implementer?: string, round?: number, startedAt?: string, phase?: string, disposition?: string, metadata?: {[key: string]: unknown}}}
   */
  toJSON(): {
    reviewer?: string;
    implementer?: string;
    round?: number;
    startedAt?: string;
    phase?: string;
    disposition?: string;
    metadata?: Record<string, unknown>;
    pullRequest?: PullRequestReference | null;
  } {
    const payload: {
      reviewer?: string;
      implementer?: string;
      round?: number;
      startedAt?: string;
      phase?: string;
      disposition?: string;
      metadata?: Record<string, unknown>;
      pullRequest?: PullRequestReference | null;
    } = {
      reviewer: this.reviewer,
      implementer: this.implementer,
      round: this.round,
      startedAt: this.startedAt,
      phase: this.phase,
      disposition: this.disposition || undefined
    };

    if (Object.keys(this.metadata || {}).length > 0) { payload.metadata = this.metadata; }
    if (this.pullRequest) { payload.pullRequest = this.pullRequest; }

    return payload;
  }

  /**
   * Persist review state to the operator database.
   *
   * Retries once on a version conflict: several loop paths read, mutate and
   * write in quick succession, and losing a phase transition to a concurrent
   * bookkeeping write would strand the loop. A second conflict is reported
   * rather than retried forever, so a genuinely contended mission fails loudly.
   *
   * When `lifecycleService` is supplied and the review becomes approved,
   * the `review → integration` lifecycle transition fires at this boundary
   * using `ReviewerDecision.decidedAt` as the occurrence time (TASK-2376).
   *
   * @param {string} [worktree]
   * @param {{ missionStore?: MissionStore | null; lifecycleService?: Pick<MissionLifecycleService, 'transition'> | null } | MissionStore | null} [options]
   * @returns {Promise<ReviewStatePersistenceResult>}
   */
  async save(
    worktree: string = resolveWorktree(this.slug) || process.cwd(),
    options: { missionStore?: MissionStore | null; lifecycleService?: Pick<MissionLifecycleService, 'transition'> | null } | MissionStore | null = {},
  ): Promise<ReviewStatePersistenceResult> {
    // Backward-compat: accept MissionStore as positional 2nd arg
    const opts = reviewPersistenceOptions(options);
    const missionStore = opts.missionStore ?? this.missionStore;
    const lifecycleService = opts.lifecycleService ?? null;
    let store: Awaited<ReturnType<typeof resolveMissionStore>>;
    try {
      store = await resolveMissionStore(worktree, missionStore);
    } catch (error) {
      return { outcome: 'write-failed', stage: 'write', diagnostic: diagnosticFrom(error, 'Operator database unavailable') };
    }
    if (!store) {
      return { outcome: 'write-failed', stage: 'write', diagnostic: `Operator database unavailable for ${this.slug}` };
    }

    for (let attempt = 0;attempt < 2;attempt += 1) {
      try {
        return await this.saveToStore(store, lifecycleService);
      } catch (error) {
        // A stale write means someone else committed between our load and save.
        // Reload and reapply once; the review-state fields are last-writer-wins
        // per field, so a replay onto the newer version is well defined.
        const stale = error instanceof Error && error.name === 'MissionStaleWriteError';
        if (stale && attempt === 0) { continue; }
        return { outcome: 'write-failed', stage: 'write', diagnostic: diagnosticFrom(error, 'Review-state write failed') };
      }
    }

    return { outcome: 'write-failed', stage: 'write', diagnostic: `Review state for ${this.slug} lost a version race twice; another process is writing this mission` };
  }

  private async saveToStore(store: NonNullable<Awaited<ReturnType<typeof resolveMissionStore>>>, lifecycleService: Pick<MissionLifecycleService, 'transition'> | null): Promise<ReviewStatePersistenceResult> {
    const result = await store.load(missionId(this.slug));
    if (result.kind !== 'found') {
      return { outcome: 'write-failed', stage: 'write', diagnostic: `Mission ${this.slug} is not in the operator database` };
    }
    const mission = result.mission;
    if (!mission.review) {
      return {
        outcome: 'write-failed',
        stage: 'write',
        diagnostic: `Mission ${this.slug} has no review to update; px review ${this.slug} --start starts the review, or px review ${this.slug} --backfill-review migrates a pre-cutover review-state.json`,
      };
    }

    const review = applyReviewStateToReview(mission.review, this.toJSON());
    if (this.phase === 'approved') { requireReviewIdentity(mission, review); }
    const nextVersion = await store.save({ ...mission, review }, result.version);
    return await this.approveLifecycle(review, mission, nextVersion, lifecycleService) || { outcome: 'committed' };
  }

  private async approveLifecycle(review: import('../../domain/review.js').Review, mission: import('../../domain/mission.js').Mission, nextVersion: import('../../application/domain-ports.js').MissionVersion, lifecycleService: Pick<MissionLifecycleService, 'transition'> | null): Promise<ReviewStatePersistenceResult | null> {
    // TASK-2376: fire review → integration at the approval boundary.
    // TASK-2378: a boundary transition that fails while the Mission is
    // still in the `review` lane is reported in the persistence result
    // instead of swallowed — the review is committed, the Mission stays
    // in review, the approval command surfaces the failure (and withholds
    // Backlog promotion), and px integrate recovery is the repair path.
    // Once the Mission has already moved to `integration`, an approve
    // transition can never legitimately complete, so a bookkeeping
    // re-persist of the approved round (comment, artifact consumption)
    // keeps the historical non-fatal behavior.
    if (lifecycleService && this.phase === 'approved') {
      const currentRound = review.rounds[review.rounds.length - 1];
      const decidedAt = currentRound.decision?.kind === 'approved'
        ? currentRound.decision.decidedAt
        : this.startedAt;
      const approveResult = await lifecycleService.transition({
        operationId: `review-approve:${this.slug}`,
        missionId: missionId(this.slug),
        expectedVersion: nextVersion,
        capabilities: new Set(['mission:transition']),
        command: { type: 'approve', review },
        actor: mission.assignee ?? 'custom',
        occurredAt: decidedAt,
        idempotencyKey: `approve:${this.slug}:round-${currentRound.number}`,
      });
      // TASK-2378: a boundary transition that fails while the Mission is
      // still in the `review` lane is reported in the persistence result
      // instead of swallowed — the review is committed, the Mission stays
      // in review, the approval command surfaces the failure (and withholds
      // Backlog promotion), and px integrate recovery is the repair path.
      // TASK-2582: the same report applies when the Mission is in no lane
      // the approve boundary can leave (for example `active`, the
      // TASK-2579 shape) — reporting `committed` there is what promoted a
      // Backlog task over an active Mission. Once the Mission has already
      // moved to `integration`, an approve transition can never legitimately
      // complete, so a bookkeeping re-persist of the approved round
      // (comment, artifact consumption) keeps the historical non-fatal
      // behavior.
      if (approveResult.status !== 'completed' && mission.status !== 'integration') {
        return {
          outcome: 'boundary-failed',
          stage: 'boundary',
          diagnostic: `review → integration transition failed for ${this.slug} (Mission status: ${mission.status}): ${approveResult.error?.message ?? 'unknown failure'}`,
        };
      }
    }
    return null;
  }

}

/**
 * Write and commit the review state for a mission.
 *
 * @param {string} slug
 * @param {ReviewState|object} state
 * @param {string} [worktree]
 * @param {{ missionStore?: MissionStore | null; lifecycleService?: Pick<MissionLifecycleService, 'transition'> | null } | MissionStore | null} [options]
 * @returns {Promise<ReviewStatePersistenceResult>}
 */
export async function writeReviewState(
  slug: string,
  state: ReviewState | ReviewStateData | Record<string, unknown>,
  worktree: string = resolveWorktree(slug) || process.cwd(),
  options: { missionStore?: MissionStore | null; lifecycleService?: Pick<MissionLifecycleService, 'transition'> | null } | MissionStore | null = {},
): Promise<ReviewStatePersistenceResult> {
  // Backward-compat: accept MissionStore as positional 4th arg
  const opts: { missionStore?: MissionStore | null; lifecycleService?: Pick<MissionLifecycleService, 'transition'> | null } =
    options && typeof options === 'object' && 'save' in options
      ? { missionStore: options as MissionStore }
      : (options as { missionStore?: MissionStore | null; lifecycleService?: Pick<MissionLifecycleService, 'transition'> | null } ?? {});
  const instance = state instanceof ReviewState
    ? state
    : new ReviewState(slug, state as ReviewStateData, opts.missionStore ?? null);
  return instance.save(worktree, opts);
}

export type ReviewStateInstanceReader = (...args: Parameters<typeof readReviewState>) => ReviewState | null | Promise<ReviewState | null>;

export type ReviewStateReader = (_s: string, _r?: string, _store?: MissionStore | null) => ReviewState | ReviewStateData | null | Promise<ReviewState | ReviewStateData | null>;
