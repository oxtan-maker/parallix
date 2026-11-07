import { SqliteMissionStore } from '../adapters/sqlite/mission-store.js';
import type { SqliteDatabaseAdapter } from '../adapters/sqlite/database-adapter.js';
import type { MissionTransitionStore } from '../application/domain-ports.js';
import type { DefectProvenanceBackfillStore } from '../application/ports/defect-provenance-backfill.js';

/** Shared Mission authority for application graphs and independent workflow owners. */
export function createMissionStore(db: SqliteDatabaseAdapter): MissionTransitionStore & DefectProvenanceBackfillStore {
  return new SqliteMissionStore(db);
}
