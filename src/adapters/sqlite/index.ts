export { SqliteDatabaseAdapter } from './database-adapter.js';
export type {
  DatabaseConfig,
  Migration,
  MigrationLedgerEntry as DatabaseMigrationLedgerEntry,
  QueryRow,
} from './database-adapter.js';

export { SqliteMigrationRunner, loadDefaultMigrations } from './migration-runner.js';

export { resolveDatabasePath, verifyDatabasePathIsolation } from './database-path-resolver.js';

export { initOperatorState, clearOperatorStateCache } from './adapter-factory.js';
export type { AdapterInitOptions, OperatorStateAdapter } from './adapter-factory.js';

export type {
  AgentBlockEntry,
  AgentBlocklistRepository,
} from '../../application/ports/agent-blocklist.js';
export type {
  UsageRecord,
  UsageRepository,
} from '../../application/ports/mission-measurements.js';
export type {
  KnownRepositoryEntry,
  KnownRepositoriesRepository,
} from '../../application/ports/repository-catalog.js';
export type {
  UIPreferenceEntry,
  UIPreferencesRepository,
} from '../../application/ports/operator-preferences.js';
export type {
  OperationalHistoryEntry,
  OperationalHistoryRepository,
  BoardLaneEventEntry,
  BoardLaneEventRepository,
} from '../../application/ports/operation-history.js';
export type {
  SessionMarkerEntry,
  SessionMarkerWrite,
  SessionMarkerRepository,
} from '../../application/ports/mission-store.js';
export type { MigrationLedgerEntry, MigrationLedgerRepository, ImportRecord } from './ports.js';

// Repository implementations
export { SqliteBlocklistRepository } from './blocklist-repository.js';
export { SqliteUsageRepository } from './usage-repository.js';
export {
  SqliteMeasurementStore,
  resolveMeasurementStore,
  closeMeasurementStores,
} from './measurement-store.js';
export { SqliteKnownRepositoriesRepository } from './repository-repository.js';
export { SqliteUIPreferencesRepository } from './ui-preferences-repository.js';
export { SqliteOperationalHistoryRepository } from './operational-history-repository.js';
export { SqliteMigrationLedgerRepository } from './migration-ledger-repository.js';
export { SqliteBoardLaneEventRepository } from './board-lane-event-repository.js';
export { SqliteSessionMarkerRepository } from './session-marker-repository.js';
export { SqliteSessionMarkerAdapter } from './session-marker-adapter.js';
export { importSessionMarkers } from './session-marker-import.js';
export type {
  FileSessionMarker,
  ImportConflict,
  ImportEntry,
  ImportResult,
} from './session-marker-import.js';

// Mission aggregate
export { SqliteMissionStore, MissionStaleWriteError } from './mission-store.js';
export type { KnownRepositoryObservation } from './mission-store.js';
export { hydrateMission, hydrateReviewProjection } from './mission-serialization.js';
export { SqliteReviewProjectionReader } from './review-projection-reader.js';
export type {
  HydratedMission,
  MissionAggregateRecords,
  MissionRecord,
} from './mission-serialization.js';

// Authority map
export {
  SQLITE_ENTITY_AUTHORITY,
  AGENT_BLOCKLIST_AUTHORITY,
  USAGE_STATISTICS_AUTHORITY,
  KNOWN_REPOSITORIES_AUTHORITY,
  UI_PREFERENCES_AUTHORITY,
  OPERATIONAL_HISTORY_AUTHORITY,
  SCHEMA_MIGRATIONS_AUTHORITY,
  IMPORT_HISTORY_AUTHORITY,
  MISSIONS_AUTHORITY,
  MISSION_LABELS_AUTHORITY,
  MISSION_CHECKPOINTS_AUTHORITY,
  MISSION_CHECKPOINT_GOAL_CHECKS_AUTHORITY,
  MISSION_REVIEWS_AUTHORITY,
  MISSION_REVIEW_ROUNDS_AUTHORITY,
  MISSION_REVIEW_FINDINGS_AUTHORITY,
  MISSION_REVIEW_RESOLUTIONS_AUTHORITY,
} from './authority-map.js';
export type { AuthorityOwner, FieldAuthority } from './authority-map.js';
