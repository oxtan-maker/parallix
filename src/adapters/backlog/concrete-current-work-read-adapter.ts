import type { CurrentWorkReadAdapter } from '../../application/projections/current-work.js';
import type { OperationalHistoryRepository } from '../../application/ports/operation-history.js';
import {
  CURRENT_WORK_EVENT_TYPE,
  parseCurrentWorkEntry,
  type CurrentWorkEvent,
} from '../../application/recording/current-work-recorder.js';
import type { MissionId } from '../../domain/mission.js';

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
    // Read all current-work events, not a bounded window. The reconciler
    // already reduces to one standing fact per mission — a fixed N-latest
    // window was the thing that discarded still-running operations when
    // older operations emitted late terminal events (TASK-2375 AC #2).
    const entries = await this._historyRepo.findByType(CURRENT_WORK_EVENT_TYPE);
    return entries.flatMap((entry) => parseCurrentWorkEntry(entry) ?? []);
  }

  async loadMissionCurrentWork(missionId: MissionId): Promise<readonly CurrentWorkEvent[]> {
    const findByTypeForMission = this._historyRepo.findByTypeForMission;
    if (!findByTypeForMission) { return []; }
    const entries = await findByTypeForMission.call(this._historyRepo, CURRENT_WORK_EVENT_TYPE, missionId);
    return entries.flatMap((entry) => parseCurrentWorkEntry(entry) ?? []);
  }
}
