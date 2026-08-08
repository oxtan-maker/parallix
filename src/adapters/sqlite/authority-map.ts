/**
 * Entity-level authority map for operator-local SQLite state.
 *
 * Each stored field is owned by exactly one authority. This map is exhaustive
 * over the SQLite schema columns defined in `0001-initial-schema.sql` and
 * `0002-import-history.sql`.
 *
 * Authority owners mirror architecture migration `OPERATOR_CONCERN_AUTHORITY`:
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
 * Maps to architecture migration domain entity: `AgentBlock` in `src/domain/agents.ts`.
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
 * Maps to architecture migration domain entities: `AgentRunMeasurement`,
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
 * Maps to architecture migration domain entity: `KnownRepository` in `src/domain/repository.ts`.
 *
 * Note: These are cached values. Repository identity is ultimately
 * owned by the target repository (Git), but the local cache entry is
 * operator-local.
 */
export const KNOWN_REPOSITORIES_AUTHORITY = {
  id: { owner: 'operator-local-cache' } as const,
  path: { owner: 'operator-local-cache' } as const,
  display_name: { owner: 'operator-local-cache' } as const,
  last_accessed: { owner: 'operator-local-cache' } as const,
} as const satisfies Readonly<Record<string, FieldAuthority>>;

/**
 * Exhaustive authority mapping for the `ui_preferences` table.
 * Maps to architecture migration domain: operator-local cache (board projections).
 */
export const UI_PREFERENCES_AUTHORITY = {
  key: { owner: 'operator-local' } as const,
  value: { owner: 'operator-local' } as const,
  updated_at: { owner: 'operator-local' } as const,
} as const satisfies Readonly<Record<string, FieldAuthority>>;

/**
 * Exhaustive authority mapping for the `operational_history` table.
 * Maps to architecture migration domain: local operational history.
 */
export const OPERATIONAL_HISTORY_AUTHORITY = {
  id: { owner: 'operator-local' } as const,
  event_type: { owner: 'operator-local' } as const,
  event_data: { owner: 'operator-local' } as const,
  created_at: { owner: 'operator-local' } as const,
} as const satisfies Readonly<Record<string, FieldAuthority>>;

/**
 * Exhaustive authority mapping for the `schema_migrations` table.
 * Maps to architecture migration domain: migration metadata.
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

/** Exhaustive authority mapping for repository-scoped session markers. */
export const SESSION_MARKERS_AUTHORITY = {
  repository_id: { owner: 'operator-local' } as const,
  mission_id: { owner: 'operator-local' } as const,
  role: { owner: 'operator-local' } as const,
  agent: { owner: 'operator-local' } as const,
  last_launched: { owner: 'operator-local' } as const,
  session_id: { owner: 'operator-local' } as const,
  updated_at: { owner: 'operator-local' } as const,
} as const satisfies Readonly<Record<string, FieldAuthority>>;

/**
 * Exhaustive authority mapping for the `import_mission_versions` table:
 * the per-Mission version snapshot a compatibility import records alongside
 * its `import_history` entry (architecture migration).
 */
export const IMPORT_MISSION_VERSIONS_AUTHORITY = {
  import_id: { owner: 'operator-local' } as const,
  mission_id: { owner: 'operator-local' } as const,
  version: { owner: 'operator-local' } as const,
} as const satisfies Readonly<Record<string, FieldAuthority>>;

/**
 * Exhaustive authority mapping for the `board_lane_events` table.
 *
 * Maps to architecture migration domain entity: `LaneTransitionEvent` in
 * `src/domain/board-event.ts`. Operator-local telemetry only (ADR 0051).
 *
 * Relationship to usage_statistics:
 *   board_lane_events records every lifecycle transition. usage_statistics
 *   records outcome measurements for completed missions. Both share mission_id
 *   as the join key and use operator-local authority.
 */
export const BOARD_LANE_EVENTS_AUTHORITY = {
  id: { owner: 'operator-local' } as const,
  repository_id: { owner: 'operator-local' } as const,
  mission_id: { owner: 'operator-local' } as const,
  from_status: { owner: 'operator-local' } as const,
  to_status: { owner: 'operator-local' } as const,
  trigger: { owner: 'operator-local' } as const,
  agent: { owner: 'operator-local' } as const,
  occurred_at: { owner: 'operator-local' } as const,
  idempotency_key: { owner: 'operator-local' } as const,
} as const satisfies Readonly<Record<string, FieldAuthority>>;

/**
 * Exhaustive authority mapping for the `missions` table.
 *
 * Maps to architecture migration domain entity: `Mission` in `src/domain/mission.ts`.
 * Authority: operator-local source-of-truth after cutover (ADR 0053).
 *
 * `repository_id` is the stable identity reference. Replaceable repository
 * observations remain in the separate known_repositories cache.
 */
export const MISSIONS_AUTHORITY = {
  id: { owner: 'operator-local' } as const,
  repository_id: { owner: 'operator-local' } as const,
  title: { owner: 'operator-local' } as const,
  status: { owner: 'operator-local' } as const,
  raw_status: { owner: 'operator-local' } as const,
  assignee: { owner: 'operator-local' } as const,
  net_engineering_lines: { owner: 'operator-local' } as const,
  closed_at: { owner: 'operator-local' } as const,
  version: { owner: 'operator-local' } as const,
} as const satisfies Readonly<Record<string, FieldAuthority>>;

const MISSION_VALUE_AUTHORITY = { owner: 'operator-local' } as const;

/**
 * Intake traceability recorded with the Mission. Parallix owns the reference it
 * accepted; the external system keeps owning the material it points at.
 */
export const MISSION_EXTERNAL_TASK_REFS_AUTHORITY = {
  mission_id: MISSION_VALUE_AUTHORITY,
  source: MISSION_VALUE_AUTHORITY,
  external_id: MISSION_VALUE_AUTHORITY,
  url: MISSION_VALUE_AUTHORITY,
} as const satisfies Readonly<Record<string, FieldAuthority>>;

export const MISSION_LABELS_AUTHORITY = {
  mission_id: MISSION_VALUE_AUTHORITY,
  position: MISSION_VALUE_AUTHORITY,
  label: MISSION_VALUE_AUTHORITY,
} as const satisfies Readonly<Record<string, FieldAuthority>>;

export const MISSION_CHECKPOINTS_AUTHORITY = {
  mission_id: MISSION_VALUE_AUTHORITY,
  position: MISSION_VALUE_AUTHORITY,
  checkpoint_mission_id: MISSION_VALUE_AUTHORITY,
  name: MISSION_VALUE_AUTHORITY,
  raw_filename: MISSION_VALUE_AUTHORITY,
  first_line: MISSION_VALUE_AUTHORITY,
  next_action_text: MISSION_VALUE_AUTHORITY,
} as const satisfies Readonly<Record<string, FieldAuthority>>;

export const MISSION_CHECKPOINT_GOAL_CHECKS_AUTHORITY = {
  mission_id: MISSION_VALUE_AUTHORITY,
  checkpoint_position: MISSION_VALUE_AUTHORITY,
  position: MISSION_VALUE_AUTHORITY,
  criterion: MISSION_VALUE_AUTHORITY,
  evidence: MISSION_VALUE_AUTHORITY,
} as const satisfies Readonly<Record<string, FieldAuthority>>;

export const MISSION_REVIEWS_AUTHORITY = {
  mission_id: MISSION_VALUE_AUTHORITY,
  intervention_requested_at: MISSION_VALUE_AUTHORITY,
  intervention_requested_by: MISSION_VALUE_AUTHORITY,
  intervention_reason: MISSION_VALUE_AUTHORITY,
} as const satisfies Readonly<Record<string, FieldAuthority>>;

export const MISSION_REVIEW_ROUNDS_AUTHORITY = {
  mission_id: MISSION_VALUE_AUTHORITY,
  position: MISSION_VALUE_AUTHORITY,
  round_number: MISSION_VALUE_AUTHORITY,
  change_kind: MISSION_VALUE_AUTHORITY,
  provider: MISSION_VALUE_AUTHORITY,
  provider_change_id: MISSION_VALUE_AUTHORITY,
  provider_url: MISSION_VALUE_AUTHORITY,
  source_branch: MISSION_VALUE_AUTHORITY,
  target_branch: MISSION_VALUE_AUTHORITY,
  revision: MISSION_VALUE_AUTHORITY,
  reviewer: MISSION_VALUE_AUTHORITY,
  implementer: MISSION_VALUE_AUTHORITY,
  started_at: MISSION_VALUE_AUTHORITY,
  decision_kind: MISSION_VALUE_AUTHORITY,
  decided_at: MISSION_VALUE_AUTHORITY,
  decision_comment: MISSION_VALUE_AUTHORITY,
  approval_source_kind: MISSION_VALUE_AUTHORITY,
  approval_source_provider: MISSION_VALUE_AUTHORITY,
  responded_at: MISSION_VALUE_AUTHORITY,
  resulting_revision: MISSION_VALUE_AUTHORITY,
} as const satisfies Readonly<Record<string, FieldAuthority>>;

export const MISSION_REVIEW_FINDINGS_AUTHORITY = {
  mission_id: MISSION_VALUE_AUTHORITY,
  round_position: MISSION_VALUE_AUTHORITY,
  position: MISSION_VALUE_AUTHORITY,
  finding_id: MISSION_VALUE_AUTHORITY,
  summary: MISSION_VALUE_AUTHORITY,
  location: MISSION_VALUE_AUTHORITY,
} as const satisfies Readonly<Record<string, FieldAuthority>>;

export const MISSION_REVIEW_RESOLUTIONS_AUTHORITY = {
  mission_id: MISSION_VALUE_AUTHORITY,
  round_position: MISSION_VALUE_AUTHORITY,
  position: MISSION_VALUE_AUTHORITY,
  finding_id: MISSION_VALUE_AUTHORITY,
  kind: MISSION_VALUE_AUTHORITY,
  explanation: MISSION_VALUE_AUTHORITY,
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
  session_markers: SESSION_MARKERS_AUTHORITY,
  import_mission_versions: IMPORT_MISSION_VERSIONS_AUTHORITY,
  board_lane_events: BOARD_LANE_EVENTS_AUTHORITY,
  missions: MISSIONS_AUTHORITY,
  mission_labels: MISSION_LABELS_AUTHORITY,
  mission_external_task_refs: MISSION_EXTERNAL_TASK_REFS_AUTHORITY,
  mission_checkpoints: MISSION_CHECKPOINTS_AUTHORITY,
  mission_checkpoint_goal_checks: MISSION_CHECKPOINT_GOAL_CHECKS_AUTHORITY,
  mission_reviews: MISSION_REVIEWS_AUTHORITY,
  mission_review_rounds: MISSION_REVIEW_ROUNDS_AUTHORITY,
  mission_review_findings: MISSION_REVIEW_FINDINGS_AUTHORITY,
  mission_review_resolutions: MISSION_REVIEW_RESOLUTIONS_AUTHORITY,
} as const;
