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

import * as fs from 'fs';
import * as path from 'path';
import { findMissionDir, getPrimaryBranch, resolveWorktree } from '../filesystem/mission-utils.js';
import { missionId } from '../../domain/mission.js';
import { applyReviewStateToReview, reviewStateDataFrom } from './review-state-mapping.js';
import type { MissionStore } from '../../application/domain-ports.js';
import type { PullRequestReference } from '../../domain/review.js';

export type ReviewStatePersistenceResult =
  | { outcome: 'committed' }
  | { outcome: 'unchanged' }
  | { outcome: 'write-failed'; stage: 'write'; diagnostic: string }
  | { outcome: 'add-failed'; stage: 'add'; diagnostic: string }
  | { outcome: 'commit-failed-dirty'; stage: 'commit'; diagnostic: string };


interface ReviewStatePersistenceContext {
  slug: string;
  phase?: string | null;
  round?: number | null;
}

function diagnosticFrom(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) { return error.message.trim(); }
  const text = String(error || '').trim();
  return text || fallback;
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
 * @param {MissionStore|null|undefined} [missionStore]
 * @returns {Promise<ReviewStatePersistenceResult>}
 */
export async function persistReviewStateOrThrow(
  writeFn: typeof writeReviewState,
  slug: string,
  state: ReviewState | Record<string, unknown>,
  worktree: string,
  missionStore?: MissionStore | null,
): Promise<ReviewStatePersistenceResult> {
  const result = await writeFn(slug, state, worktree, missionStore);
  assertReviewStatePersisted(result, {
    slug,
    phase: state instanceof ReviewState ? state.phase : String(state.phase || 'unknown'),
    round: state instanceof ReviewState ? state.round : (typeof state.round === 'number' ? state.round : null)
  });
  return result;
}

/**
 * Return the mission directory for a slug, or null when it is not resolvable.
 *
 * The review loop reports the mission directory in its diagnostics, and the
 * event log still lives under it. Review state itself no longer has a file.
 *
 * @param {string} slug
 * @param {string} [rootDir]
 * @returns {string|null}
 */
export function reviewStateFile(slug: string, rootDir = process.cwd()): string | null {
  const missionDir = findMissionDir(slug, rootDir);
  if (!missionDir) { return null; }
  return path.join(missionDir, 'review-state.json');
}

/**
 * Resolve the Mission authority supplied by composition. The adapter knows
 * only the application port and never opens or caches a database connection.
 *
 * @param {string} rootDir
 */
async function resolveMissionStore(_rootDir: string, store?: MissionStore | null) {
  return store ?? null;
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
  options: { readReviewStateFn?: (_s: string, _r: string) => Promise<ReviewState | null> | ReviewState | null } = {}
): Promise<{
  identityUser: string | null;
  commentIdentityUser: string | null;
  forgejoUser: string | null;
  commentForgejoUser: string | null;
  reviewState: ReviewState | null;
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

export type ReviewBackfillResult =
  | { outcome: 'backfilled'; rounds: number; round: number; phase: string }
  | { outcome: 'would-backfill'; rounds: number; round: number; phase: string }
  | { outcome: 'already-present' }
  | { outcome: 'no-legacy-state' }
  | { outcome: 'failed'; diagnostic: string };

/**
 * Seed a mission's Review aggregate from a surviving `review-state.json`.
 *
 * A mission handed off before the architecture migration cutover has review-loop state in
 * `missions/<slug>/review-state.json` but no Review in the operator database.
 * `save()` fails closed for those missions rather than inventing a Review, so
 * without a migration path the loop can never be resumed. This is that path:
 * an explicit, operator-invoked one-shot, not an implicit self-heal.
 *
 * The reviewed revision cannot be recovered from the legacy file — it never
 * recorded one — so the subject is reconstructed the way `px handoff` builds it
 * (the mission branch against the primary branch) with a revision marking the
 * change as backfilled. The historical reviewer is taken as eligible: this
 * replays a review that already happened rather than starting a new one.
 *
 * @param {string} slug
 * @param {string} [rootDir]
 * @param {{apply?: boolean}} [options]  `apply: false` reports without writing.
 * @returns {Promise<ReviewBackfillResult>}
 */
export async function backfillReviewFromLegacyState(
  slug: string,
  rootDir = process.cwd(),
  options: { apply?: boolean; missionStore?: MissionStore | null } = {}
): Promise<ReviewBackfillResult> {
  const apply = options.apply !== false;

  const statePath = reviewStateFile(slug, rootDir);
  if (!statePath || !fs.existsSync(statePath)) { return { outcome: 'no-legacy-state' }; }

  let legacy: Record<string, unknown>;
  try {
    legacy = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch (error) {
    return { outcome: 'failed', diagnostic: diagnosticFrom(error, `Could not parse ${statePath}`) };
  }
  if (!legacy || typeof legacy !== 'object') {
    return { outcome: 'failed', diagnostic: `${statePath} is not a review-state object` };
  }

  const reviewer = typeof legacy.reviewer === 'string' ? legacy.reviewer.trim() : '';
  const implementer = typeof legacy.implementer === 'string' ? legacy.implementer.trim() : '';
  const startedAt = typeof legacy.startedAt === 'string' ? legacy.startedAt.trim() : '';
  if (!reviewer || !implementer || !startedAt) {
    return {
      outcome: 'failed',
      diagnostic: `${statePath} is missing reviewer, implementer or startedAt; cannot reconstruct a review round`,
    };
  }

  let store: Awaited<ReturnType<typeof resolveMissionStore>>;
  try {
    store = await resolveMissionStore(rootDir, options.missionStore);
  } catch (error) {
    return { outcome: 'failed', diagnostic: diagnosticFrom(error, 'Operator database unavailable') };
  }
  if (!store) { return { outcome: 'failed', diagnostic: `Operator database unavailable for ${slug}` }; }

  try {
    const result = await store.load(missionId(slug));
    if (result.kind !== 'found') {
      return { outcome: 'failed', diagnostic: `Mission ${slug} is not in the operator database` };
    }
    if (result.mission.review) { return { outcome: 'already-present' }; }

    const { startReview, ConfiguredReviewerEligibility, changeRevision } = await import(
      '../../domain/review.js'
    );
    const { agentFamily } = await import('../../domain/agents.js');
    const reviewerFamily = agentFamily(reviewer);

    let targetBranch = 'main';
    try { targetBranch = getPrimaryBranch(rootDir) || 'main'; } catch { targetBranch = 'main'; }

    const seed = startReview(
      {
        change: {
          kind: 'local-branch' as const,
          sourceBranch: `mission/${slug}`,
          targetBranch,
        },
        revision: changeRevision(`backfill-${slug}`),
      },
      reviewerFamily,
      agentFamily(implementer),
      startedAt,
      // The historical reviewer is eligible by construction: this replays a
      // review that already ran, it does not select a reviewer for a new one.
      ConfiguredReviewerEligibility.fromReviewStep({
        eligible: [reviewerFamily],
        strategy: 'random',
      }),
    );

    const review = applyReviewStateToReview(seed, legacy as never);
    const current = review.rounds[review.rounds.length - 1];
    const summary = { rounds: review.rounds.length, round: current.number, phase: current.phase };

    if (!apply) { return { outcome: 'would-backfill', ...summary }; }
    await store.save({ ...result.mission, review }, result.version);
    return { outcome: 'backfilled', ...summary };
  } catch (error) {
    return { outcome: 'failed', diagnostic: diagnosticFrom(error, 'Review backfill failed') };
  }
}

/**
 * Manager class for mission review state.
 * Expanded to include phase, disposition, and metadata for canonical state ownership.
 */
export const VALID_PHASES = ['reviewing', 'fixing', 'pending-approval', 'approved'] as const;
const PHASE_ALIASES = new Map<string, string>([
  ['review', 'reviewing'],
  ['rewiewing', 'reviewing'],
  ['fix', 'fixing'],
  ['pending_approval', 'pending-approval'],
  ['pending approval', 'pending-approval']
]);

const PHASE_TRANSITIONS: Record<string, string[]> = {
  'reviewing': ['fixing', 'approved'],
  'fixing': ['reviewing', 'pending-approval'],
  'pending-approval': ['reviewing'],
  'approved': []
};

/** @param {string} disposition */
function inferPhaseFromDisposition(disposition: string): string {
  switch (String(disposition || '').trim().toUpperCase()) {
  case 'APPROVED':
    return 'approved';
  case 'REQUEST_CHANGES':
  case 'COMMENT':
  case 'PUSHBACK_ALL':
  case 'BLOCKED':
  case 'PARKED':
    return 'fixing';
  case 'CHANGES_MADE':
    return 'reviewing';
  default:
    return 'reviewing';
  }
}

/** @param {string} phase @param {string} disposition */
export function normalizeReviewPhase(phase: string, disposition: string): { phase: string; original: string | null; normalized: boolean } {
  if (!phase) {
    return { phase: 'reviewing', original: null, normalized: false };
  }

  const raw = String(phase).trim();
  const canonical = raw.toLowerCase().replace(/[_\s]+/g, '-');
  if ((VALID_PHASES as readonly string[]).includes(canonical)) {
    return { phase: canonical, original: raw, normalized: canonical !== raw };
  }

  const alias = PHASE_ALIASES.get(raw.toLowerCase()) || PHASE_ALIASES.get(canonical);
  if (alias) {
    return { phase: alias, original: raw, normalized: true };
  }

  return {
    phase: inferPhaseFromDisposition(disposition),
    original: raw,
    normalized: true
  };
}

/** @typedef {{reviewer?: string, implementer?: string, round?: number, startedAt?: string, phase?: string, disposition?: string | null, reviewerRetryCount?: number, implementerRetryCount?: number, metadata?: {[key: string]: unknown}}} ReviewStateData */
export interface ReviewStateData {
  reviewer?: string;
  implementer?: string;
  round?: number;
  startedAt?: string;
  phase?: string;
  disposition?: string | null;
  reviewerRetryCount?: number;
  implementerRetryCount?: number;
  metadata?: Record<string, unknown>;
  /**
   * The change under review when it is a provider pull request.
   *
   * Typed rather than a `metadata` key: `PullRequestReference` is a checked
   * domain value the Mission store already persists in dedicated round columns,
   * so the board reads the reviewed change instead of inferring one.
   */
  pullRequest?: PullRequestReference | null;
}

export class ReviewState {
  slug: string;
  reviewer?: string;
  implementer?: string;
  round: number;
  startedAt: string;
  phase: string;
  disposition: string | null;
  reviewerRetryCount: number;
  implementerRetryCount: number;
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
    this.reviewerRetryCount = data.reviewerRetryCount || 0;
    this.implementerRetryCount = data.implementerRetryCount || 0;
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
    if (!(VALID_PHASES as readonly string[]).includes(nextPhase)) {
      throw new Error(`Invalid phase: "${nextPhase}". Valid: ${(VALID_PHASES as readonly string[]).join(', ')}`);
    }
    const allowedArr = PHASE_TRANSITIONS[this.phase];
    if (!allowedArr || !allowedArr.includes(nextPhase)) {
      throw new Error(`Cannot transition from "${this.phase}" to "${nextPhase}". Allowed: ${(allowedArr || []).join(', ') || 'none'}`);
    }
    this.phase = nextPhase;
    return this;
  }

  advanceRound(): ReviewState {
    this.round += 1;
    this.phase = 'reviewing';
    this.disposition = null;
    this.reviewerRetryCount = 0;
    this.implementerRetryCount = 0;
    this.startedAt = new Date().toISOString();
    return this;
  }

  /**
   * @returns {{reviewer?: string, implementer?: string, round?: number, startedAt?: string, phase?: string, disposition?: string, reviewerRetryCount?: number, implementerRetryCount?: number, metadata?: {[key: string]: unknown}}}
   */
  toJSON(): {
    reviewer?: string;
    implementer?: string;
    round?: number;
    startedAt?: string;
    phase?: string;
    disposition?: string;
    reviewerRetryCount?: number;
    implementerRetryCount?: number;
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
      reviewerRetryCount?: number;
      implementerRetryCount?: number;
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

    if (this.reviewerRetryCount > 0) { payload.reviewerRetryCount = this.reviewerRetryCount; }
    if (this.implementerRetryCount > 0) { payload.implementerRetryCount = this.implementerRetryCount; }
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
   * @returns {Promise<ReviewStatePersistenceResult>}
   */
  async save(
    worktree = resolveWorktree(this.slug) || process.cwd(),
    missionStore: MissionStore | null = this.missionStore,
  ): Promise<ReviewStatePersistenceResult> {
    let store: Awaited<ReturnType<typeof resolveMissionStore>>;
    try {
      store = await resolveMissionStore(worktree, missionStore);
    } catch (error) {
      return { outcome: 'write-failed', stage: 'write', diagnostic: diagnosticFrom(error, 'Operator database unavailable') };
    }
    if (!store) {
      return { outcome: 'write-failed', stage: 'write', diagnostic: `Operator database unavailable for ${this.slug}` };
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const result = await store.load(missionId(this.slug));
        if (result.kind !== 'found') {
          return { outcome: 'write-failed', stage: 'write', diagnostic: `Mission ${this.slug} is not in the operator database` };
        }
        const mission = result.mission;
        if (!mission.review) {
          return {
            outcome: 'write-failed',
            stage: 'write',
            diagnostic: `Mission ${this.slug} has no review to update; px handoff starts the review, or px review ${this.slug} --backfill-review migrates a pre-cutover review-state.json`,
          };
        }

        const review = applyReviewStateToReview(mission.review, this.toJSON());
        await store.save({ ...mission, review }, result.version);
        return { outcome: 'committed' };
      } catch (error) {
        // A stale write means someone else committed between our load and save.
        // Reload and reapply once; the review-state fields are last-writer-wins
        // per field, so a replay onto the newer version is well defined.
        const stale = error instanceof Error && error.name === 'MissionStaleWriteError';
        if (stale && attempt === 0) { continue; }
        return { outcome: 'write-failed', stage: 'write', diagnostic: diagnosticFrom(error, 'Review-state write failed') };
      }
    }

    return {
      outcome: 'write-failed',
      stage: 'write',
      diagnostic: `Review state for ${this.slug} lost a version race twice; another process is writing this mission`,
    };
  }

}

/**
 * Write and commit the review state for a mission.
 *
 * @param {string} slug
 * @param {ReviewState|object} state
 * @param {string} [worktree]
 * @returns {Promise<ReviewStatePersistenceResult>}
 */
export async function writeReviewState(
  slug: string,
  state: ReviewState | Record<string, unknown>,
  worktree = resolveWorktree(slug) || process.cwd(),
  missionStore?: MissionStore | null,
): Promise<ReviewStatePersistenceResult> {
  const instance = state instanceof ReviewState ? state : new ReviewState(slug, state as ReviewStateData, missionStore);
  return instance.save(worktree, missionStore);
}

/**
 * Clear the loop's bookkeeping for a mission (used by `--reset`).
 *
 * Resets the current round to `reviewing` with no disposition and no retries,
 * and drops the review-level scratch: stage-launch windows, the gate retry
 * budget, and any human-intervention request.
 *
 * It deliberately does not erase the review conversation. Before the cutover,
 * `--reset` deleted a file that only ever held loop scratch; the reviewer's
 * decisions and findings lived in Forgejo. They are now durable domain state on
 * the same aggregate, and discarding a recorded decision is not what "reset the
 * review state" ever meant.
 *
 * @param {string} slug
 * @param {string} [worktree]
 * @returns {Promise<ReviewStatePersistenceResult>}
 */
export async function resetReviewState(
  slug: string,
  worktree = resolveWorktree(slug) || process.cwd(),
  missionStore?: MissionStore | null,
): Promise<ReviewStatePersistenceResult> {
  try {
    const store = await resolveMissionStore(worktree, missionStore);
    if (!store) {
      return { outcome: 'write-failed', stage: 'write', diagnostic: `Operator database unavailable for ${slug}` };
    }
    const result = await store.load(missionId(slug));
    if (result.kind !== 'found' || !result.mission.review) { return { outcome: 'unchanged' }; }

    const review = result.mission.review;
    const rounds = [...review.rounds];
    rounds[rounds.length - 1] = {
      ...rounds[rounds.length - 1],
      phase: 'reviewing',
      disposition: null,
      reviewerRetryCount: 0,
      implementerRetryCount: 0,
    };

    await store.save({
      ...result.mission,
      review: {
        ...review,
        rounds: rounds as unknown as typeof review.rounds,
        intervention: null,
        stageLaunches: [],
        gateFailureRetryCount: 0,
      },
    }, result.version);
    return { outcome: 'committed' };
  } catch (error) {
    return { outcome: 'write-failed', stage: 'write', diagnostic: diagnosticFrom(error, 'Review-state reset failed') };
  }
}
