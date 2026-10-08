import type { OperationLogReadAdapter } from '../../application/projections/board-readers.js';
import type { OperationalHistoryRepository } from '../../application/ports/operation-history.js';

/**
 * How many of the newest operations the board carries. Every consumer shows
 * only a recent tail (the terminal board four entries, the browser at most this
 * many), so reading the whole, ever-growing history on each refresh was pure
 * cost.
 */
export const BOARD_OPERATION_LOG_LIMIT = 256;

// ---------------------------------------------------------------------------
// Concrete OperationLogReadAdapter
// ---------------------------------------------------------------------------

export interface ConcreteOperationLogReadAdapterOptions {
  /** SQLite operational history repository (architecture migration snapshot). */
  readonly historyRepo: OperationalHistoryRepository;
}

/**
 * Concrete `OperationLogReadAdapter` that reads from
 * `SqliteOperationalHistoryRepository.findAll()`, the architecture migration snapshot.
 *
 * Maps operational history entries to the board's `OperationLogEntry` format.
 */
export class ConcreteOperationLogReadAdapter implements OperationLogReadAdapter {
  private readonly historyRepo: OperationalHistoryRepository;

  constructor(options: ConcreteOperationLogReadAdapterOptions) {
    this.historyRepo = options.historyRepo;
  }

  // -----------------------------------------------------------------------
  // OperationLogReadAdapter port
  // -----------------------------------------------------------------------

  async loadOperationLog(): Promise<readonly {
    readonly operationId: string;
    readonly phase: string;
    readonly message: string;
    readonly timestamp: string;
    readonly agent?: string;
  }[]> {
    if (this.historyRepo.findRecentLogEntries) {
      return (await this.historyRepo.findRecentLogEntries(BOARD_OPERATION_LOG_LIMIT)).map((entry) => ({
        operationId: entry.id ? String(entry.id) : `op-${entry.createdAt}`,
        phase: entry.eventType,
        message: entry.message ?? (entry.rawData !== null && entry.rawData !== '{}' ? `${entry.eventType}: ${entry.rawData}` : entry.eventType),
        timestamp: entry.createdAt,
        agent: entry.agent ?? undefined,
      }));
    }
    const entries = (await this.historyRepo.findAll()).slice(-BOARD_OPERATION_LOG_LIMIT);

    return entries.map((entry) => {
      let message = entry.eventType;
      let agent: string | undefined;

      // Try to parse eventData as JSON for richer info
      try {
        const data = JSON.parse(entry.eventData);
        if (typeof data.message === 'string') {
          message = data.message;
        }
        if (typeof data.agent === 'string') {
          agent = data.agent;
        }
      } catch {
        // eventData is not JSON; use as-is
        if (entry.eventData && entry.eventData !== '{}') {
          message = `${entry.eventType}: ${entry.eventData}`;
        }
      }

      return {
        operationId: entry.id ? String(entry.id) : `op-${entry.createdAt}`,
        phase: entry.eventType,
        message,
        timestamp: entry.createdAt,
        agent,
      };
    });
  }
}
