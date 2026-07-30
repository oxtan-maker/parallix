export { SqliteDatabaseAdapter } from './database-adapter.js';
export type {
  DatabaseConfig,
  Migration,
  MigrationLedgerEntry as DatabaseMigrationLedgerEntry,
  QueryRow,
} from './database-adapter.js';

export { SqliteMigrationRunner, loadDefaultMigrations } from './migration-runner.js';

export { resolveDatabasePath, verifyDatabasePathIsolation } from './database-path-resolver.js';

export { initOperatorState } from './adapter-factory.js';
export type { AdapterInitOptions, OperatorStateAdapter } from './adapter-factory.js';

// Repository ports
export type {
  AgentBlockEntry,
  AgentBlocklistRepository,
  UsageRecord,
  UsageRepository,
  KnownRepositoryEntry,
  KnownRepositoriesRepository,
  UIPreferenceEntry,
  UIPreferencesRepository,
  OperationalHistoryEntry,
  OperationalHistoryRepository,
  MigrationLedgerEntry,
  MigrationLedgerRepository,
  ImportRecord,
  BoardLaneEventEntry,
  BoardLaneEventRepository,
  SessionMarkerEntry,
  SessionMarkerWrite,
  SessionMarkerRepository,
} from './ports.js';

// Repository implementations
export { SqliteBlocklistRepository } from './blocklist-repository.js';
export { SqliteUsageRepository } from './usage-repository.js';
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
export { hydrateMission } from './mission-serialization.js';
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
