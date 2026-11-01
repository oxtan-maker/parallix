import type { ReviewLoopState } from '../../application/ports/review-round.js';
import type { ReviewStatePersistenceResult, ReviewStateData, ReviewStateWriter } from '../../application/ports/review-persistence.js';
export type { ReviewStatePersistenceResult, ReviewStateData, ReviewStateWriter } from '../../application/ports/review-persistence.js';
import { diagnosticFrom, resolveMissionStore } from './review-state-store.js';
export { resetReviewState } from './review-state-store.js';
import { assertReviewPhaseTransition, requireReviewPhase, ReviewPhaseViolation, type ReviewPhase } from '../../domain/review-phase-policy.js';
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
 * Owned by the Node workflow harness (ADR 0037 / architecture migration).
 */


import { resolveWorktree } from '../filesystem/mission-utils.js';
import { missionId } from '../../domain/mission.js';

import { applyReviewStateToReview, reviewStateDataFrom } from './review-state-mapping.js';
import { isStaleWrite, type MissionStore } from '../../application/domain-ports.js';
import type { PullRequestReference } from '../../domain/review.js';

interface ReviewStatePersistenceContext {
  slug: string;
  phase?: ReviewPhase | null;
  round?: number | null;
}

export function assertReviewStatePersisted(
  result: ReviewStatePersistenceResult,
  context: ReviewStatePersistenceContext
): void {
  if (!result || typeof result !== 'object' || !('outcome' in result)) {
    throw new Error(`Review-state persistence failed for mission ${context.slug}: missing persistence result`);
  }
  const persistenceResult = result;
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
 * @param {MissionStore|null|undefined} [missionStore]
 * @returns {Promise<ReviewStatePersistenceResult>}
 */
export async function persistReviewStateOrThrow(
  writeFn: ReviewStateWriter,
  slug: string,
  state: ReviewStateData,
  worktree: string,
  missionStore?: MissionStore | null,
): Promise<ReviewStatePersistenceResult> {
  const result = await writeFn(slug, state, worktree, { missionStore });
  assertReviewStatePersisted(result, {
    slug,
    phase: state.phase,
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
  const store = await resolveMissionStore(rootDir, missionStore);
  if (!store) { return null; }
  const result = await store.load(missionId(slug));
  if (result.kind !== 'found' || !result.mission.review) { return null; }
  return new ReviewState(slug, reviewStateDataFrom(result.mission.review), store);
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
  } catch (error) {
    if (error instanceof ReviewPhaseViolation) { throw error; }
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
export class ReviewState implements ReviewLoopState {
  slug: string;
  reviewer?: string;
  implementer?: string;
  round: number;
  startedAt: string;
  phase: ReviewPhase;
  disposition: string | null;
  metadata: Record<string, unknown>;
  pullRequest: PullRequestReference | null;
  private readonly missionStore: MissionStore | null;

  /**
   * @param {string} slug
   * @param {ReviewStateData} [data]
   */
  constructor(slug: string, data: ReviewStateData = {}, missionStore: MissionStore | null = null) {
    this.slug = slug;
    this.reviewer = data.reviewer;
    this.implementer = data.implementer;
    this.round = data.round || 1;
    this.startedAt = data.startedAt || new Date().toISOString();
    this.phase = data.phase === undefined ? 'reviewing' : requireReviewPhase(data.phase);
    this.disposition = data.disposition || null;
    this.metadata = data.metadata || {};
    this.pullRequest = data.pullRequest ?? null;
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
  transitionTo(nextPhase: ReviewPhase): ReviewState {
    assertReviewPhaseTransition(this.phase, nextPhase);
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

  toJSON(): ReviewStateData {
    const payload: ReviewStateData = {
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
   * @param {string} [worktree]
   * @param {{ missionStore?: MissionStore | null }} [options]
   * @returns {Promise<ReviewStatePersistenceResult>}
   */
  async save(
    worktree: string = resolveWorktree(this.slug) || process.cwd(),
    options: { missionStore?: MissionStore | null } = {},
  ): Promise<ReviewStatePersistenceResult> {
    const opts = options;
    const missionStore = opts.missionStore ?? this.missionStore;
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
        return await this.saveToStore(store);
      } catch (error) {
        // A stale write means someone else committed between our load and save.
        // Reload and reapply once; the review-state fields are last-writer-wins
        // per field, so a replay onto the newer version is well defined.
        const stale = isStaleWrite(error);
        if (stale && attempt === 0) { continue; }
        if (error instanceof ReviewPhaseViolation) {
          return { outcome: 'validation-failed', stage: 'validation', kind: 'validation', diagnostic: error.message };
        }
        return { outcome: 'write-failed', stage: 'write', diagnostic: diagnosticFrom(error, 'Review-state write failed') };
      }
    }

    return { outcome: 'write-failed', stage: 'write', diagnostic: `Review state for ${this.slug} lost a version race twice; another process is writing this mission` };
  }

  private async saveToStore(store: NonNullable<Awaited<ReturnType<typeof resolveMissionStore>>>): Promise<ReviewStatePersistenceResult> {
    requireReviewPhase(this.phase);
    const result = await store.load(missionId(this.slug));
    if (result.kind !== 'found') {
      return { outcome: 'write-failed', stage: 'write', diagnostic: `Mission ${this.slug} is not in the operator database` };
    }
    const mission = result.mission;
    if (!mission.review) {
      return {
        outcome: 'write-failed',
        stage: 'write',
        diagnostic: `Mission ${this.slug} has no review to update; px review ${this.slug} starts the review, then retry the write`,
      };
    }

    if (this.phase === 'approved' && mission.status !== 'integration') {
      throw new ReviewPhaseViolation(`Loop bookkeeping cannot approve the Mission while it is ${mission.status}; record the reviewer decision through the review workflow`);
    }
    const review = applyReviewStateToReview(mission.review, this.toJSON());
    await store.save({ ...mission, review }, result.version);
    return { outcome: 'committed' };
  }

}

/**
 * Persist current-round bookkeeping for a mission.
 *
 * @param {string} slug
 * @param {ReviewState|object} state
 * @param {string} [worktree]
 * @param {{ missionStore?: MissionStore | null }} [options]
 * @returns {Promise<ReviewStatePersistenceResult>}
 */
export async function writeReviewState(
  slug: string,
  state: ReviewStateData,
  worktree: string = resolveWorktree(slug) || process.cwd(),
  options: { missionStore?: MissionStore | null } = {},
): Promise<ReviewStatePersistenceResult> {
  const opts = options;
  try {
    const current = state instanceof ReviewState ? state : await readReviewState(slug, worktree, opts.missionStore);
    const instance = state instanceof ReviewState ? state : new ReviewState(slug, { ...current?.toJSON(), ...state }, opts.missionStore ?? null);
    return await instance.save(worktree, opts);
  } catch (error) {
    if (error instanceof ReviewPhaseViolation) {
      return { outcome: 'validation-failed', stage: 'validation', kind: 'validation', diagnostic: error.message };
    }
    throw error;
  }
}

export type ReviewStateInstanceReader = (...args: Parameters<typeof readReviewState>) => ReviewState | null | Promise<ReviewState | null>;

export type ReviewStateReader = (_s: string, _r?: string, _store?: MissionStore | null) => ReviewState | ReviewStateData | null | Promise<ReviewState | ReviewStateData | null>;
