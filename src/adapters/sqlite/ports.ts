/**
 * Asynchronous repository ports for operator-local SQLite state.
 *
 * These interfaces define the application-facing contracts that any
 * operator-state adapter (SQLite, JSON/CSV fallback) must satisfy.
 * All methods return `Promise` values so the adapter layer can route
 * database work to a worker thread without changing callers.
 *
 * Only files under `src/adapters/sqlite/` may import `node:sqlite`.
 */

// ---------------------------------------------------------------------------
// Agent blocklist domain
// ---------------------------------------------------------------------------

/** A single entry in the operator's agent blocklist. */
export interface AgentBlockEntry {
  /** Agent identifier (family or launcher name). */
  readonly agent: string;
  /** Whether the agent is currently blocked. */
  readonly blocked: boolean;
  /** Optional expiry timestamp in "YYYY-MM-DD HH" format. */
  readonly until?: string;
  /** Optional human-readable reason. */
  readonly reason?: string;
}

/**
 * Application port for the operator-local agent blocklist.
 *
 * Authority: `PARALLIX_HOME/agents.local.json` is the source of truth.
 * The adapter may cache the blocklist in SQLite, but the repository
 * file remains authoritative — callers fall back to the file reader
 * when the adapter is disabled.
 *
 * Maps to TASK-2294 domain entity: `AgentBlock` in `src/domain/agents.ts`.
 */
export interface AgentBlocklistRepository {
  /**
   * Return all current blocklist entries.
   * Returns an empty array when no entries exist.
   */
  findAll(): Promise<readonly AgentBlockEntry[]>;

  /**
   * Return the blocklist entry for a specific agent, or `undefined`.
   */
  findByAgent(_agent: string): Promise<AgentBlockEntry | undefined>;

  /**
   * Save (upsert) a blocklist entry.
   */
  save(_entry: AgentBlockEntry): Promise<void>;

  /**
   * Remove a blocklist entry by agent name.
   */
  deleteByAgent(_agent: string): Promise<void>;

  /**
   * Clear all blocklist entries.
   */
  clear(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Usage statistics domain
// ---------------------------------------------------------------------------

/**
 * A single usage-statistics row.
 *
 * Mirrors the columns stored in `PARALLIX_HOME/stats.csv`.
 * All fields are optional because legacy rows may be incomplete.
 *
 * Maps to TASK-2294 domain entities: `AgentRunMeasurement`,
 * `CompletedMissionStatistics` in `src/domain/usage.ts`.
 */
export interface UsageRecord {
  readonly id?: string;
  readonly date?: string;
  readonly repo?: string;
  readonly mission?: string;
  readonly classification?: string;
  readonly implementer?: string;
  /** Numeric measurements: `undefined` means unavailable (stored as SQL NULL). */
  readonly pr_fix_rounds?: number;
  readonly provider?: string;
  readonly model?: string;
  readonly implementer_agent?: string;
  readonly reviewer_agent?: string;
  readonly stage?: string;
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly cached_tokens?: number;
  readonly context_tokens?: number;
  readonly tool_calls?: number;
  readonly openai_usage_before?: number;
  readonly openai_usage_after?: number;
  readonly openai_usage_delta?: number;
  readonly duration_minutes?: number;
  readonly cost_usd?: number;
  readonly closed?: string;
}

/**
 * Application port for the operator-local usage statistics.
 *
 * Authority: `PARALLIX_HOME/stats.csv` is the source of truth.
 *
 * Maps to TASK-2294 domain entities: `AgentRunMeasurement`,
 * `CompletedMissionStatistics` in `src/domain/usage.ts`.
 */
export interface UsageRepository {
  /**
   * Return all usage records.
   */
  findAll(): Promise<readonly UsageRecord[]>;

  /**
   * Find records matching the given predicate.
   */
  findWhere(_predicate: (_record: UsageRecord) => boolean): Promise<readonly UsageRecord[]>;

  /**
   * Save (upsert) a single usage record.
   */
  save(_record: UsageRecord): Promise<void>;

  /**
   * Save multiple usage records in a single transaction.
   */
  saveAll(_records: readonly UsageRecord[]): Promise<void>;

  /**
   * Clear all usage records.
   */
  clear(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Known repositories domain
// ---------------------------------------------------------------------------

/**
 * A known repository entry cached locally.
 *
 * Maps to TASK-2294 domain entity: `KnownRepository` in `src/domain/repository.ts`.
 * Authority: operator-local cache (not source-of-truth for repository identity).
 */
export interface KnownRepositoryEntry {
  /** Stable repository identifier. */
  readonly id: string;
  /** Filesystem path of the repository. */
  readonly path: string;
  /** ISO timestamp of last access. */
  readonly lastAccessed: string;
}

/**
 * Application port for the operator-local known repositories cache.
 *
 * Authority: operator-local cache. Repository identity is ultimately
 * owned by the target repository (Git).
 *
 * Maps to TASK-2294 domain entity: `KnownRepository` in `src/domain/repository.ts`.
 */
export interface KnownRepositoriesRepository {
  /**
   * Return all known repositories.
   */
  findAll(): Promise<readonly KnownRepositoryEntry[]>;

  /**
   * Find a repository by its stable ID.
   */
  findById(_id: string): Promise<KnownRepositoryEntry | undefined>;

  /**
   * Save (upsert) a known repository entry.
   */
  save(_entry: KnownRepositoryEntry): Promise<void>;

  /**
   * Remove a known repository by ID.
   */
  deleteById(_id: string): Promise<void>;

  /**
   * Clear all known repositories.
   */
  clear(): Promise<void>;
}

// ---------------------------------------------------------------------------
// UI preferences domain
// ---------------------------------------------------------------------------

/**
 * A single UI preference entry.
 *
 * Maps to TASK-2294 domain: operator-local cache (board projections).
 * Authority: operator-local source-of-truth for UI settings.
 */
export interface UIPreferenceEntry {
  /** Preference key (e.g. "board-lane-order", "theme"). */
  readonly key: string;
  /** Preference value (stored as text/JSON). */
  readonly value: string;
  /** ISO timestamp of last update. */
  readonly updatedAt: string;
}

/**
 * Application port for the operator-local UI preferences.
 *
 * Maps to TASK-2294 domain: operator-local cache (board projections).
 */
export interface UIPreferencesRepository {
  /**
   * Return all UI preferences.
   */
  findAll(): Promise<readonly UIPreferenceEntry[]>;

  /**
   * Find a preference by key.
   */
  findByKey(_key: string): Promise<UIPreferenceEntry | undefined>;

  /**
   * Save (upsert) a preference.
   */
  save(_entry: UIPreferenceEntry): Promise<void>;

  /**
   * Remove a preference by key.
   */
  deleteByKey(_key: string): Promise<void>;

  /**
   * Clear all preferences.
   */
  clear(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Operational history domain
// ---------------------------------------------------------------------------

/**
 * A single operational history event.
 *
 * Maps to TASK-2294 domain: local operational history (operator-local source-of-truth).
 */
export interface OperationalHistoryEntry {
  /** Auto-incrementing row ID. */
  readonly id?: number;
  /** Event type (e.g. "migration-applied", "import-completed", "adapter-initialized"). */
  readonly eventType: string;
  /** JSON-encoded event data. */
  readonly eventData: string;
  /** ISO timestamp of creation. */
  readonly createdAt: string;
}

/**
 * Application port for the operator-local operational history log.
 */
export interface OperationalHistoryRepository {
  /**
   * Return all operational history entries.
   */
  findAll(): Promise<readonly OperationalHistoryEntry[]>;

  /**
   * Find entries by event type.
   */
  findByType(_type: string): Promise<readonly OperationalHistoryEntry[]>;

  /**
   * Append a new history entry.
   */
  append(_entry: OperationalHistoryEntry): Promise<void>;

  /**
   * Clear all history entries.
   */
  clear(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Migration metadata domain
// ---------------------------------------------------------------------------

/** A record of an applied migration in the ledger. */
export interface MigrationLedgerEntry {
  readonly id: string;
  readonly checksum: string;
  readonly appliedAt: string;
}

/**
 * Application port for the migration ledger.
 *
 * Maps to TASK-2294 domain: migration metadata (operator-local source-of-truth).
 */
export interface MigrationLedgerRepository {
  /**
   * Return all applied migrations from the ledger.
   */
  findAll(): Promise<readonly MigrationLedgerEntry[]>;

  /**
   * Find a specific migration by ID.
   */
  findById(_id: string): Promise<MigrationLedgerEntry | undefined>;
}

// ---------------------------------------------------------------------------
// Import domain
// ---------------------------------------------------------------------------

/** Digest and metadata recorded for each import source. */
export interface ImportRecord {
  /** Absolute path of the source file. */
  readonly sourcePath: string;
  /** SHA-256 digest of the source file at import time. */
  readonly digest: string;
  /** Number of records successfully imported. */
  readonly importedCount: number;
  /** Number of malformed records skipped. */
  readonly skippedCount: number;
  /** ISO timestamp of the import. */
  readonly importedAt: string;
  /** Path of the backup file created before import. */
  readonly backupPath?: string;
}
