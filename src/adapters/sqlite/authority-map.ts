/**
 * Entity-level authority map for operator-local SQLite state.
 *
 * Each stored field is owned by exactly one authority. This map is exhaustive
 * over the SQLite schema columns defined in `0001-initial-schema.sql` and
 * `0002-import-history.sql`.
 *
 * Authority owners mirror TASK-2294 `OPERATOR_CONCERN_AUTHORITY`:
 * - `operator-local` — source of truth for operator-local state
 * - `operator-local-cache` — cached projection (repository state wins on conflict)
 *
 * This map describes the currently implemented operator-state schema. ADR 0053
 * owns the target persistence boundary; new domain tables require their own
 * checked mappings rather than being inferred from this legacy inventory.
 */

export type AuthorityOwner = 'operator-local' | 'operator-local-cache';

export interface FieldAuthority {
  /** Which subsystem owns this field's authoritative value. */
  readonly owner: AuthorityOwner;
}

/**
 * Exhaustive authority mapping for the `agent_blocklist` table.
 * Maps to TASK-2294 domain entity: `AgentBlock` in `src/domain/agents.ts`.
 */
export const AGENT_BLOCKLIST_AUTHORITY = {
  agent: { owner: 'operator-local' } as const,
  blocked: { owner: 'operator-local' } as const,
  until: { owner: 'operator-local' } as const,
  reason: { owner: 'operator-local' } as const,
  updated_at: { owner: 'operator-local' } as const,
} as const satisfies Readonly<Record<string, FieldAuthority>>;

/**
 * Exhaustive authority mapping for the `usage_statistics` table.
 * Maps to TASK-2294 domain entities: `AgentRunMeasurement`,
 * `CompletedMissionStatistics` in `src/domain/usage.ts`.
 */
export const USAGE_STATISTICS_AUTHORITY = {
  id: { owner: 'operator-local' } as const,
  date: { owner: 'operator-local' } as const,
  repo: { owner: 'operator-local' } as const,
  mission: { owner: 'operator-local' } as const,
  classification: { owner: 'operator-local' } as const,
  implementer: { owner: 'operator-local' } as const,
  pr_fix_rounds: { owner: 'operator-local' } as const,
  provider: { owner: 'operator-local' } as const,
  model: { owner: 'operator-local' } as const,
  implementer_agent: { owner: 'operator-local' } as const,
  reviewer_agent: { owner: 'operator-local' } as const,
  stage: { owner: 'operator-local' } as const,
  input_tokens: { owner: 'operator-local' } as const,
  output_tokens: { owner: 'operator-local' } as const,
  cached_tokens: { owner: 'operator-local' } as const,
  context_tokens: { owner: 'operator-local' } as const,
  tool_calls: { owner: 'operator-local' } as const,
  openai_usage_before: { owner: 'operator-local' } as const,
  openai_usage_after: { owner: 'operator-local' } as const,
  openai_usage_delta: { owner: 'operator-local' } as const,
  duration_minutes: { owner: 'operator-local' } as const,
  cost_usd: { owner: 'operator-local' } as const,
  closed: { owner: 'operator-local' } as const,
} as const satisfies Readonly<Record<string, FieldAuthority>>;

/**
 * Exhaustive authority mapping for the `known_repositories` table.
 * Maps to TASK-2294 domain entity: `KnownRepository` in `src/domain/repository.ts`.
 *
 * Note: These are cached values. Repository identity is ultimately
 * owned by the target repository (Git), but the local cache entry is
 * operator-local.
 */
export const KNOWN_REPOSITORIES_AUTHORITY = {
  id: { owner: 'operator-local-cache' } as const,
  path: { owner: 'operator-local-cache' } as const,
  last_accessed: { owner: 'operator-local-cache' } as const,
} as const satisfies Readonly<Record<string, FieldAuthority>>;

/**
 * Exhaustive authority mapping for the `ui_preferences` table.
 * Maps to TASK-2294 domain: operator-local cache (board projections).
 */
export const UI_PREFERENCES_AUTHORITY = {
  key: { owner: 'operator-local' } as const,
  value: { owner: 'operator-local' } as const,
  updated_at: { owner: 'operator-local' } as const,
} as const satisfies Readonly<Record<string, FieldAuthority>>;

/**
 * Exhaustive authority mapping for the `operational_history` table.
 * Maps to TASK-2294 domain: local operational history.
 */
export const OPERATIONAL_HISTORY_AUTHORITY = {
  id: { owner: 'operator-local' } as const,
  event_type: { owner: 'operator-local' } as const,
  event_data: { owner: 'operator-local' } as const,
  created_at: { owner: 'operator-local' } as const,
} as const satisfies Readonly<Record<string, FieldAuthority>>;

/**
 * Exhaustive authority mapping for the `schema_migrations` table.
 * Maps to TASK-2294 domain: migration metadata.
 */
export const SCHEMA_MIGRATIONS_AUTHORITY = {
  id: { owner: 'operator-local' } as const,
  checksum: { owner: 'operator-local' } as const,
  applied_at: { owner: 'operator-local' } as const,
} as const satisfies Readonly<Record<string, FieldAuthority>>;

/**
 * Exhaustive authority mapping for the `import_history` table.
 */
export const IMPORT_HISTORY_AUTHORITY = {
  id: { owner: 'operator-local' } as const,
  source_path: { owner: 'operator-local' } as const,
  digest: { owner: 'operator-local' } as const,
  imported_count: { owner: 'operator-local' } as const,
  skipped_count: { owner: 'operator-local' } as const,
  imported_at: { owner: 'operator-local' } as const,
  backup_path: { owner: 'operator-local' } as const,
} as const satisfies Readonly<Record<string, FieldAuthority>>;

/**
 * Exhaustive authority mapping for the `board_lane_events` table.
 *
 * Maps to TASK-2303 domain entity: `LaneTransitionEvent` in
 * `src/domain/board-event.ts`. Operator-local telemetry only (ADR 0051).
 *
 * Relationship to usage_statistics:
 *   board_lane_events records every lifecycle transition. usage_statistics
 *   records outcome measurements for completed missions. Both share mission_id
 *   as the join key and use operator-local authority.
 */
export const BOARD_LANE_EVENTS_AUTHORITY = {
  id: { owner: 'operator-local' } as const,
  mission_id: { owner: 'operator-local' } as const,
  from_status: { owner: 'operator-local' } as const,
  to_status: { owner: 'operator-local' } as const,
  trigger: { owner: 'operator-local' } as const,
  agent: { owner: 'operator-local' } as const,
  occurred_at: { owner: 'operator-local' } as const,
  idempotency_key: { owner: 'operator-local' } as const,
} as const satisfies Readonly<Record<string, FieldAuthority>>;

/**
 * Complete entity-level authority map for all SQLite tables.
 *
 * Each table and its fields are mapped to exactly one authority owner.
 * This is the contract that prevents dual-write: if a field appears here,
 * SQLite is the only writer; if it doesn't, the field belongs to another
 * authority (Git, tool-owned assets).
 */
export const SQLITE_ENTITY_AUTHORITY = {
  agent_blocklist: AGENT_BLOCKLIST_AUTHORITY,
  usage_statistics: USAGE_STATISTICS_AUTHORITY,
  known_repositories: KNOWN_REPOSITORIES_AUTHORITY,
  ui_preferences: UI_PREFERENCES_AUTHORITY,
  operational_history: OPERATIONAL_HISTORY_AUTHORITY,
  schema_migrations: SCHEMA_MIGRATIONS_AUTHORITY,
  import_history: IMPORT_HISTORY_AUTHORITY,
  board_lane_events: BOARD_LANE_EVENTS_AUTHORITY,
} as const;
