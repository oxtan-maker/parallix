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
} from './ports.js';

// Repository implementations
export { SqliteBlocklistRepository } from './blocklist-repository.js';
export { SqliteUsageRepository } from './usage-repository.js';
export { SqliteKnownRepositoriesRepository } from './repository-repository.js';
export { SqliteUIPreferencesRepository } from './ui-preferences-repository.js';
export { SqliteOperationalHistoryRepository } from './operational-history-repository.js';
export { SqliteMigrationLedgerRepository } from './migration-ledger-repository.js';

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
} from './authority-map.js';
export type { AuthorityOwner, FieldAuthority } from './authority-map.js';
