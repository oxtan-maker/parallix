import type { ReviewStatePersistenceResult } from './review-state.js';

/** Operator Mission-store access and review reset. Composition supplies the store; this adapter does not open databases. */



import { resolveWorktree } from '../filesystem/mission-utils.js';

import { missionId } from '../../domain/mission.js';

import type { MissionStore, SessionMarkerPort } from '../../application/domain-ports.js';

export function diagnosticFrom(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) { return error.message.trim(); }
  const text = String(error || '').trim();
  return text || fallback;
}

/**
 * Resolve the Mission authority supplied by composition. The adapter knows
 * only the application port and never opens or caches a database connection.
 *
 * @param {string} rootDir
 */
export async function resolveMissionStore(_rootDir: string, store?: MissionStore | null) {
  return store ?? null;
}

/**
 * Clear the loop's bookkeeping for a mission (used by `--reset`).
 *
 * Resets the current round to `reviewing` with no disposition, and drops the
 * review-level scratch: stage-launch windows and any human-intervention
 * request. The round's historical retry counts are left as recorded: the loop
 * no longer writes them (TASK-2377.04 deleted the persisted retry state that
 * fed them).
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
  sessionMarkerPort?: SessionMarkerPort | null,
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
      // A reset retries an undecided round. Start a new observation window so
      // its earlier provider verdict cannot be mistaken for the retry's verdict.
      ...(!rounds[rounds.length - 1].decision ? { startedAt: new Date().toISOString() } : {}),
      phase: 'reviewing',
      disposition: null,
    };

    await store.save({
      ...result.mission,
      review: {
        ...review,
        rounds: [rounds[0], ...rounds.slice(1)],
        intervention: null,
        stageLaunches: [],
      },
    }, result.version);
    await sessionMarkerPort?.delete(missionId(slug), 'review');
    return { outcome: 'committed' };
  } catch (error) {
    return { outcome: 'write-failed', stage: 'write', diagnostic: diagnosticFrom(error, 'Review-state reset failed') };
  }
}