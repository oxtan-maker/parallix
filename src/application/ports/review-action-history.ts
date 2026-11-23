import type { MissionId } from '../../domain/mission.js';
import type { FailureReason } from '../../domain/failure-reason.js';

export const REVIEW_ACTION_STARTED_EVENT = 'review.action-started';
export const DEFAULT_REVIEW_ACTION_LIMIT = 40;

export type ReviewStepAction = 'agent' | 'tests' | 'human' | 'repair';

/** One restart-safe review-step action. The sequence is lifetime-scoped per Mission. */
export interface ReviewActionStarted {
  readonly schemaVersion: 1;
  readonly repositoryId: string;
  readonly missionId: MissionId;
  readonly changeIdentity: string;
  readonly action: ReviewStepAction;
  readonly correlation: string;
  readonly actionSequence: number;
  readonly configuredLimit: number;
  readonly failureReason: FailureReason | null;
  readonly idempotencyKey: string;
  readonly recordedAt: string;
}

export type ReviewActionStartedInput = Pick<ReviewActionStarted,
  'repositoryId' | 'missionId' | 'changeIdentity' | 'action' | 'correlation' | 'configuredLimit'>;

/** Application-facing lifetime action counter; storage and idempotency stay behind this port. */
export interface ReviewActionHistoryPort {
  count(): Promise<number>;
  record(_input: Omit<ReviewActionStartedInput, 'repositoryId' | 'missionId'>): Promise<ReviewActionStarted>;
}

/** The stored record of one action-limit hit: the action that reached the limit and the limit then configured. */
export interface ReviewActionLimitHit {
  readonly actionSequence: number;
  readonly limit: number;
  readonly recordedAt: string;
}

/**
 * Server-owned action facts for one Mission. `limit` is the configured limit and is
 * null when it could not be read; `limitHit` exists only when a stored record says so.
 */
export interface ReviewActionFacts {
  readonly used: number;
  readonly limit: number | null;
  readonly limitHit: ReviewActionLimitHit | null;
}

/** Read side for projections: the recorded action starts and the configured limit, both from their owners. */
export interface ReviewActionReadAdapter {
  readonly limit: number | null;
  loadActions(): Promise<readonly ReviewActionStarted[]>;
}
