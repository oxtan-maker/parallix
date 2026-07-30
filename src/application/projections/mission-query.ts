/** Mission-facing projection query. Interfaces supply this query, never a file reader. */
import type { MissionId } from '../../domain/mission.js';
import type { MissionDetail } from './mission-detail.js';
import { projectMissionDetail } from './mission-detail.js';
import type { MissionReadAdapter } from './board-readers.js';

export class MissionProjectionQuery {
  constructor(private readonly _missions: MissionReadAdapter) {}

  async detail(missionId: MissionId): Promise<MissionDetail | null> {
    const mission = await this._missions.loadMission(missionId);
    return mission === null ? null : projectMissionDetail(mission, null);
  }

  async allDetails(): Promise<ReadonlyMap<MissionId, MissionDetail>> {
    const missions = await this._missions.loadAllMissions();
    return new Map(missions.map((mission) => [mission.id, projectMissionDetail(mission, null)]));
  }
}
