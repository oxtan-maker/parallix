import { failureReason, recognizedFailureReason } from '../domain/failure-reason.js';
import type { OperationalHistoryEntry } from './ports/operation-history.js';
import {
  REVIEW_ACTION_STARTED_EVENT,
  type ReviewActionFacts,
  type ReviewActionStarted,
  type ReviewActionStartedInput,
} from './ports/review-action-history.js';

function required(value: string, field: string): string {
  if (!value.trim()) { throw new Error(`${field} is required`); }
  return value;
}

export function reviewActionKey(input: Pick<ReviewActionStarted,
  'repositoryId' | 'missionId' | 'actionSequence'>): string {
  if (!Number.isSafeInteger(input.actionSequence) || input.actionSequence < 1) {
    throw new Error('actionSequence must be a positive safe integer');
  }
  return ['review-action', required(input.repositoryId, 'repositoryId'),
    required(input.missionId, 'missionId'), String(input.actionSequence)]
    .map(encodeURIComponent).join(':');
}

export function reviewActionStarted(input: ReviewActionStartedInput,
  actionSequence: number, recordedAt = new Date().toISOString()): ReviewActionStarted {
  if (!Number.isSafeInteger(input.configuredLimit) || input.configuredLimit < 1) {
    throw new Error('configuredLimit must be a positive safe integer');
  }
  required(input.correlation, 'correlation');
  const limitReached = actionSequence >= input.configuredLimit;
  return {
    ...input,
    schemaVersion: 1,
    actionSequence,
    configuredLimit: input.configuredLimit,
    failureReason: limitReached
      ? failureReason('review-action-limit', 'lifecycle', { count: actionSequence, limit: input.configuredLimit })
      : null,
    idempotencyKey: reviewActionKey({ repositoryId: input.repositoryId, missionId: input.missionId, actionSequence }),
    recordedAt,
  };
}

export function parseReviewAction(entry: OperationalHistoryEntry, readingRepositoryId: string): ReviewActionStarted | null {
  if (entry.eventType !== REVIEW_ACTION_STARTED_EVENT) { return null; }
  try {
    const value = JSON.parse(entry.eventData) as ReviewActionStarted;
    const storedRepositoryId: unknown = value?.repositoryId;
    // Rows written before repository scoping belong to the repository whose bounded read returned them.
    const repositoryId = storedRepositoryId === undefined || storedRepositoryId === null
      ? readingRepositoryId : storedRepositoryId;
    return value?.schemaVersion === 1 && typeof repositoryId === 'string' && repositoryId !== ''
      && typeof value.missionId === 'string'
      && typeof value.correlation === 'string' && Number.isSafeInteger(value.actionSequence)
      ? { ...value, repositoryId } : null;
  } catch { return null; }
}

/** A limit hit is only the stored record that carries the review-action-limit reason; a count never implies one. */
export function isReviewActionLimitHit(action: ReviewActionStarted): boolean {
  return recognizedFailureReason(action.failureReason)?.code === 'review-action-limit';
}

/** Actions used and the latest stored limit hit per Mission, read from the recorded starts only. */
export function reviewActionFactsByMission(actions: readonly ReviewActionStarted[],
  limit: number | null): ReadonlyMap<string, ReviewActionFacts> {
  const byMission = new Map<string, ReviewActionFacts>();
  for (const action of actions) {
    const prior = byMission.get(action.missionId);
    const hit = isReviewActionLimitHit(action) ? action : null;
    const latestHit = hit && (!prior?.limitHit || hit.actionSequence > prior.limitHit.actionSequence)
      ? { actionSequence: hit.actionSequence, limit: hit.configuredLimit, recordedAt: hit.recordedAt }
      : prior?.limitHit ?? null;
    byMission.set(action.missionId, { used: Math.max(prior?.used ?? 0, action.actionSequence), limit, limitHit: latestHit });
  }
  return byMission;
}

/** A Mission whose history was read and holds no action start has used none; that is known, not missing. */
export const noReviewActions = (limit: number | null): ReviewActionFacts => ({ used: 0, limit, limitHit: null });
