import { SqliteMissionStore } from '../adapters/sqlite/mission-store.js';
import type { SqliteDatabaseAdapter } from '../adapters/sqlite/database-adapter.js';
import type { MissionTransitionStore, MissionNelRecorder } from '../application/domain-ports.js';

/** Shared Mission authority for application graphs and independent workflow owners. */
export function createMissionStore(db: SqliteDatabaseAdapter): MissionTransitionStore & MissionNelRecorder {
  return new SqliteMissionStore(db);
}
