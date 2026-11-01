import type { MissionId } from '../../domain/mission.js';
import type { ExecutionActivity, ExecutionActivitySnapshot } from '../../domain/execution-activity.js';

/** Current checked snapshots. Audit history is never an activity read source. */
export interface ExecutionActivityReadPort {
  loadCurrentWork(): Promise<readonly ExecutionActivitySnapshot[]>;
  loadMissionCurrentWork(_missionId: MissionId): Promise<readonly ExecutionActivitySnapshot[]>;
}

/** Persistence of the execution model's activity dimension, on its owning connection. */
export interface ExecutionActivityStore extends ExecutionActivityReadPort {
  publish(_event: ExecutionActivity, _sourceId: string): Promise<void>;
}
