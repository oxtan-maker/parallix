import type { OperationalHistoryEntry, OperationalHistoryRepository } from '../ports/operation-history.js';
import { INTEGRATION_VALIDATION_EVENT_TYPE } from '../integrate/validation-marker.js';

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
  private readonly repository: OperationalHistoryRepository;

  constructor(repository: OperationalHistoryRepository) {
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
  }): Promise<void> {
    await this.append(
      INTEGRATION_VALIDATION_EVENT_TYPE,
      JSON.stringify({ missionId: marker.missionId, sha: marker.sha, hooks: [...marker.hooks] }),
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
}
