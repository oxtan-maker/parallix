import type { IdempotentOperationalHistoryRepository, OperationalHistoryEntry } from '../ports/operation-history.js';
import type { MissionId } from '../../domain/mission.js';
import type { HumanReviewWithdrawalInput, ReviewEntryPin, ReviewEntryPinInput, ReviewStartDecision,
  ReviewStartDecisionInput, ReviewStartOutcome, ReviewStartOutcomeInput } from '../ports/verification-policy.js';
import { INTEGRATION_VALIDATION_EVENT_TYPE, INTEGRATION_VALIDATION_FAILED_EVENT_TYPE } from '../integrate/validation-marker.js';
import { HUMAN_REVIEW_WITHDRAWAL_EVENT, REVIEW_ENTRY_PIN_EVENT, REVIEW_START_DECISION_EVENT, humanReviewWithdrawal, reviewEntryPin,
  reviewStartDecision } from '../verification-policy/review-start-decision.js';
import { REVIEW_START_OUTCOME_EVENT, reviewStartOutcome, reviewStartOutcomeKey, reviewerOfStart } from '../verification-policy/review-start-outcome.js';
import { parseReviewAction, reviewActionStarted } from '../review-action-history.js';
import { REVIEW_ACTION_STARTED_EVENT, type ReviewActionStarted,
  type ReviewActionStartedInput } from '../ports/review-action-history.js';


/**
 * Application boundary for operational history recording and querying.
 *
 * Events are appended through application behavior and returned as query
 * results. Current Mission state is never reconstructed from history records.
 * Database failures produce an explicit unavailable result rather than
 * silently returning empty data.
 *
 * Maps to ADR 0053 classification: `database-owned-domain-state`.
 */
export class OperationalHistoryService {
  private readonly repository: IdempotentOperationalHistoryRepository;

  constructor(repository: IdempotentOperationalHistoryRepository) {
    this.repository = repository;
  }

  /**
   * Append an operational history event.
   *
   * The event is recorded with the provided timestamp. If no timestamp is
   * provided, the current ISO timestamp is used.
   */
  async append(
    eventType: string,
    eventData: string,
    createdAt?: string,
  ): Promise<void> {
    const entry: OperationalHistoryEntry = {
      eventType,
      eventData,
      createdAt: createdAt ?? new Date().toISOString(),
    };
    await this.repository.append(entry);
  }

  /**
   * Load all operational history entries in stored order.
   *
   * Returns the full list on success. If the repository is unavailable
   * (database error), the error propagates to the caller so that an
   * unavailable history is explicitly represented rather than silently
   * treated as empty.
   */
  async loadAll(): Promise<readonly OperationalHistoryEntry[]> {
    return this.repository.findAll();
  }

  /**
   * Load history entries filtered by event type.
   *
   * Returns an empty array when no entries match. Repository errors
   * propagate to the caller.
   */
  async loadByType(type: string): Promise<readonly OperationalHistoryEntry[]> {
    return this.repository.findByType(type);
  }

  /**
   * Clear all history entries.
   */
  async clear(): Promise<void> {
    await this.repository.clear();
  }

  /**
   * Record a durable, sha-keyed integration-validation marker (TASK-2625). The
   * marker is appended to operational_history as an `integration.integration-
   * validation` row whose `event_data` carries { missionId, sha, hooks }.
   */
  async recordIntegrationValidation(marker: {
    missionId: string;
    sha: string;
    hooks: readonly string[];
    baseline?: string;
    failed?: boolean;
  }): Promise<void> {
    await this.append(
      marker.failed ? INTEGRATION_VALIDATION_FAILED_EVENT_TYPE : INTEGRATION_VALIDATION_EVENT_TYPE,
      JSON.stringify({ missionId: marker.missionId, sha: marker.sha, hooks: [...marker.hooks], ...(marker.baseline ? { baseline: marker.baseline } : {}), ...(marker.failed ? { failed: true } : {}) }),
    );
  }

  /**
   * Load the newest operational-history row of a single type for one mission.
   * Returns null when the mission has no row of that type. Repository errors
   * propagate so an unreadable history is explicit rather than silently empty.
   */
  async loadLatestByTypeForMission(
    type: string,
    missionId: string,
  ): Promise<OperationalHistoryEntry | null> {
    const findByTypeForMission = this.repository.findByTypeForMission;
    if (!findByTypeForMission) {
      throw new Error('operational history repository does not support per-mission lookup');
    }
    const entries = await findByTypeForMission.call(this.repository, type, missionId);
    return entries.length === 0 ? null : entries[entries.length - 1];
  }

  /** Every row of a single type for one mission, oldest first. Repository errors propagate. */
  async loadAllByTypeForMission(type: string, missionId: string): Promise<readonly OperationalHistoryEntry[]> {
    const findByTypeForMission = this.repository.findByTypeForMission;
    if (!findByTypeForMission) {
      throw new Error('operational history repository does not support per-mission lookup');
    }
    return await findByTypeForMission.call(this.repository, type, missionId);
  }

  private async reviewStartDecisions(missionId: string): Promise<readonly ReviewStartDecision[]> {
    const rows = await this.loadAllByTypeForMission(REVIEW_START_DECISION_EVENT, missionId);
    return rows.map(entry => JSON.parse(entry.eventData) as ReviewStartDecision);
  }

  private sameReviewStart(left: ReviewStartDecision, right: ReviewStartDecisionInput): boolean {
    if (left.changeIdentity !== right.changeIdentity || left.actualAction !== right.actualAction) { return false; }
    if (right.actualAction === 'tests') { return right.gateRunId !== null && left.gateRunId === right.gateRunId; }
    if (right.actualAction === 'agent' && right.agentRunId !== null) { return left.agentRunId === right.agentRunId; }
    if (right.actualAction === 'human') { return left.verdictCorrelation === right.verdictCorrelation; }
    return left.verdictCorrelation === right.verdictCorrelation && left.operationId === right.operationId;
  }

  private async missionPin(input: Pick<ReviewEntryPinInput, 'missionId' | 'repositoryId'>): Promise<ReviewEntryPin | null> {
    const rows = await this.loadAllByTypeForMission(REVIEW_ENTRY_PIN_EVENT, input.missionId);
    return rows.map(entry => JSON.parse(entry.eventData) as ReviewEntryPin)
      .find(entry => entry.repositoryId === input.repositoryId) ?? null;
  }

  /** Resolve the one pilot pin; shadow reads an existing pin but never creates one. */
  async resolveReviewEntryPin(input: ReviewEntryPinInput): Promise<ReviewEntryPin | null> {
    const existing = await this.missionPin(input);
    if (existing) { return existing; }
    if (input.configuredMode !== 'pilot') { return null; }
    if ((await this.reviewStartDecisions(input.missionId)).length > 0) { return null; }
    const pin = reviewEntryPin(input);
    // The idempotent append elects one writer; a loser re-reads and adopts the winner's pin.
    if (await this.repository.appendIdempotent({
      eventType: REVIEW_ENTRY_PIN_EVENT,
      eventData: JSON.stringify(pin),
      createdAt: pin.recordedAt,
    }, pin.idempotencyKey)) { return pin; }
    return await this.missionPin(input);
  }

  /** Record a concurrent human-request cancellation once for its round and change identity. */
  async recordHumanReviewWithdrawal(input: HumanReviewWithdrawalInput): Promise<boolean> {
    const withdrawal = humanReviewWithdrawal(input);
    return await this.repository.appendIdempotent({
      eventType: HUMAN_REVIEW_WITHDRAWAL_EVENT,
      eventData: JSON.stringify(withdrawal),
      createdAt: withdrawal.recordedAt,
    }, withdrawal.idempotencyKey);
  }

  /** Refuse a later human verdict only for the exact request that was cancelled. */
  async isHumanReviewWithdrawn(input: Pick<HumanReviewWithdrawalInput, 'missionId' | 'changeIdentity' | 'round'>): Promise<boolean> {
    const rows = await this.loadAllByTypeForMission(HUMAN_REVIEW_WITHDRAWAL_EVENT, input.missionId);
    return rows.some(row => {
      const withdrawal = JSON.parse(row.eventData) as HumanReviewWithdrawalInput;
      return withdrawal.changeIdentity === input.changeIdentity && withdrawal.round === input.round;
    });
  }

  private async reviewActions(missionId: string, repositoryId: string): Promise<readonly ReviewActionStarted[]> {
    const rows = this.repository.findByTypesForMissions
      ? await this.repository.findByTypesForMissions([REVIEW_ACTION_STARTED_EVENT], [missionId], repositoryId)
      : await this.loadAllByTypeForMission(REVIEW_ACTION_STARTED_EVENT, missionId);
    const parsed = rows.map(row => parseReviewAction(row, repositoryId));
    if (parsed.some(entry => entry === null)) {
      throw new Error(`review action history for ${missionId} contains an invalid record`);
    }
    return parsed.filter((entry): entry is ReviewActionStarted => entry?.repositoryId === repositoryId);
  }

  /** Lifetime review-step action count, reconstructed only from durable start records. */
  async countReviewActions(missionId: string, repositoryId: string): Promise<number> {
    return (await this.reviewActions(missionId, repositoryId))
      .reduce((highest, action) => Math.max(highest, action.actionSequence), 0);
  }

  /**
   * Record one action start. A replay returns its existing record; concurrent
   * sequence allocation is elected by the repository's idempotent append.
   */
  async recordReviewAction(input: ReviewActionStartedInput): Promise<ReviewActionStarted> {
    for (;;) {
      const records = await this.reviewActions(input.missionId, input.repositoryId);
      const existing = records.find(record => record.action === input.action
        && record.correlation === input.correlation && record.changeIdentity === input.changeIdentity);
      if (existing) { return existing; }
      const actionSequence = records.reduce((highest, record) => Math.max(highest, record.actionSequence), 0) + 1;
      const action = reviewActionStarted(input, actionSequence);
      if (await this.repository.appendIdempotent({
        eventType: REVIEW_ACTION_STARTED_EVENT,
        eventData: JSON.stringify(action),
        createdAt: action.recordedAt,
      }, action.idempotencyKey)) { return action; }
    }
  }

  /**
   * Append one review start and allocate its sequence at the writer. Parallel
   * starts may race on a candidate sequence; the idempotent append elects one
   * and the loser re-reads before claiming the next number.
   */
  async recordReviewStartDecision(input: ReviewStartDecisionInput): Promise<boolean> {
    for (;;) {
      const records = await this.reviewStartDecisions(input.missionId);
      if (records.some(record => this.sameReviewStart(record, input))) { return false; }
      const actionSequence = records
        .filter(record => record.changeIdentity === input.changeIdentity)
        .reduce((highest, record) => Math.max(highest, record.actionSequence), 0) + 1;
      // Change identity is the revision notion the policy history uses; an unknown identity cannot say.
      // A re-run is the same reviewer starting the same action again; an independent co-reviewer is not one.
      const sameRevisionRerun = input.changeIdentity === null ? null
        : records.some(record => record.changeIdentity === input.changeIdentity && record.actualAction === input.actualAction
          && reviewerOfStart(record.verdictCorrelation) === reviewerOfStart(input.verdictCorrelation));
      const decision = reviewStartDecision(input, actionSequence, sameRevisionRerun);
      if (await this.repository.appendIdempotent({
        eventType: REVIEW_START_DECISION_EVENT,
        eventData: JSON.stringify(decision),
        createdAt: decision.recordedAt,
      }, decision.idempotencyKey)) { return true; }
    }
  }

  /**
   * Append the outcome of every start the builder settles and that has none yet.
   * The idempotent append makes a replay, or a competing writer, add nothing.
   */
  async settleReviewStartOutcomes(missionId: MissionId,
    build: (_start: ReviewStartDecision, _later: readonly ReviewStartDecision[], _all: readonly ReviewStartDecision[]) => ReviewStartOutcomeInput | null): Promise<number> {
    const starts = await this.reviewStartDecisions(missionId);
    let appended = 0;
    for (const [index, start] of starts.entries()) {
      const input = build(start, starts.slice(index + 1), starts);
      if (input === null) { continue; }
      const outcome: ReviewStartOutcome = reviewStartOutcome(input);
      if (await this.repository.appendIdempotent({ eventType: REVIEW_START_OUTCOME_EVENT,
        eventData: JSON.stringify(outcome), createdAt: outcome.recordedAt }, reviewStartOutcomeKey(start.idempotencyKey))) {
        appended += 1;
      }
    }
    return appended;
  }
}
