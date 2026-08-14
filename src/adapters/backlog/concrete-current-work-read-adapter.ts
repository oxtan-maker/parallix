import type { CurrentWorkReadAdapter } from '../../application/projections/current-work.js';
import type { OperationalHistoryRepository } from '../../application/ports/operation-history.js';
import {
  CURRENT_WORK_EVENT_TYPE,
  parseCurrentWorkEntry,
  type CurrentWorkEvent,
} from '../../application/recording/current-work-recorder.js';

/**
 * Concrete `CurrentWorkReadAdapter` over the operational-history authority.
 *
 * It reads only the current-work event type and hands the parsed events on
 * unfiltered — deciding which one is still true is `reconcileCurrentWork`'s
 * job, not the adapter's. An entry that does not parse is dropped rather than
 * guessed at: a malformed row must not become a claim that a mission is being
 * worked on.
 */
export class ConcreteCurrentWorkReadAdapter implements CurrentWorkReadAdapter {
  constructor(private readonly _historyRepo: OperationalHistoryRepository) {}

  async loadCurrentWork(): Promise<readonly CurrentWorkEvent[]> {
    const entries = this._historyRepo.findLatestByTypePerMission
      ? await this._historyRepo.findLatestByTypePerMission(CURRENT_WORK_EVENT_TYPE, 2)
      : await this._historyRepo.findByType(CURRENT_WORK_EVENT_TYPE);
    return entries.flatMap((entry) => parseCurrentWorkEntry(entry) ?? []);
  }
}
