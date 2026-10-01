import type { OperationalHistoryEntry, OperationalHistoryRepository } from '../../src/application/ports/operation-history.js';

export interface InMemoryOperationalHistory {
  readonly repo: OperationalHistoryRepository;
  /** Every appended entry, in append order. */
  readonly appended: OperationalHistoryEntry[];
}

/**
 * A case-owned in-memory OperationalHistoryRepository (TASK-2622.04).
 *
 * By default entries are stored exactly as appended. `assignIds` stores a copy
 * carrying a 1-based sequence id, as the SQLite repository does, for read
 * models that order or deduplicate facts by id.
 */
export function inMemoryOperationalHistory(options: { assignIds?: boolean } = {}): InMemoryOperationalHistory {
  const appended: OperationalHistoryEntry[] = [];
  let sequence = 0;
  const repo: OperationalHistoryRepository = {
    async findAll() { return appended; },
    async findByType(type: string) { return appended.filter((entry) => entry.eventType === type); },
    async append(entry: OperationalHistoryEntry) {
      if (options.assignIds) {
        sequence += 1;
        appended.push({ ...entry, id: sequence });
      } else {
        appended.push(entry);
      }
    },
    async clear() { appended.length = 0; },
  };
  return { repo, appended };
}
