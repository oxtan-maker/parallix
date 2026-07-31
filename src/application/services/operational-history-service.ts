import type { OperationalHistoryEntry, OperationalHistoryRepository } from '../../adapters/sqlite/ports.js';

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
}
