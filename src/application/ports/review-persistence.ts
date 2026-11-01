import type { ReviewPhase } from '../../domain/review-phase-policy.js';
import type { PullRequestReference } from '../../domain/review.js';
import type { MissionStore } from '../domain-ports.js';

export type ReviewStatePersistenceResult =
  | { outcome: 'committed' }
  | { outcome: 'unchanged' }
  | { outcome: 'validation-failed'; stage: 'validation'; kind: 'validation'; diagnostic: string }
  | { outcome: 'write-failed'; stage: 'write'; diagnostic: string };


/** Optional loop bookkeeping fields; phase values are canonical domain values. */
export interface ReviewStateData {
  reviewer?: string;
  implementer?: string;
  round?: number;
  startedAt?: string;
  phase?: ReviewPhase;
  disposition?: string | null;
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
export type ReviewStateWriteOptions = { missionStore?: MissionStore | null };
export type ReviewStateWriter = (slug: string, state: ReviewStateData, worktree?: string, options?: ReviewStateWriteOptions) => Promise<ReviewStatePersistenceResult>;
