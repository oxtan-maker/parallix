import type { PullRequestReference } from '../../domain/review.js';
import type { MissionStore } from '../domain-ports.js';
import type { MissionLifecycleService } from '../mission-lifecycle-service.js';

export type ReviewStatePersistenceResult =
  | { outcome: 'committed' }
  | { outcome: 'unchanged' }
  | { outcome: 'write-failed'; stage: 'write'; diagnostic: string }
  | { outcome: 'add-failed'; stage: 'add'; diagnostic: string }
  | { outcome: 'commit-failed-dirty'; stage: 'commit'; diagnostic: string }
  | { outcome: 'boundary-failed'; stage: 'boundary'; diagnostic: string };

/** @typedef {{reviewer?: string, implementer?: string, round?: number, startedAt?: string, phase?: string, disposition?: string | null, metadata?: {[key: string]: unknown}}} ReviewStateData */
export interface ReviewStateData {
  reviewer?: string;
  implementer?: string;
  round?: number;
  startedAt?: string;
  phase?: string;
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
export type ReviewStateWriteOptions = { missionStore?: MissionStore | null; lifecycleService?: Pick<MissionLifecycleService, 'transition'> | null } | MissionStore | null;
export type ReviewStateWriter = (slug: string, state: ReviewStateData | Record<string, unknown>, worktree?: string, options?: ReviewStateWriteOptions) => Promise<ReviewStatePersistenceResult>;
