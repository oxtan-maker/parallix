-- Migration: 0001-initial-schema
-- Description: Create initial operator-local state tables for all six domains
-- Authority: operator-local only (agent-blocklist, usage-statistics, known-repositories,
--   ui-preferences, operational-history, migration-ledger)
-- No repository artifacts are stored in this schema.

-- Agent blocklist: operator-local agent blocking rules
CREATE TABLE IF NOT EXISTS agent_blocklist (
  agent TEXT PRIMARY KEY NOT NULL,
  blocked INTEGER NOT NULL DEFAULT 0,
  until TEXT,
  reason TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Usage statistics: agent work measurements and completed-mission projections.
-- Types conform to the TASK-2294 domain model (src/domain/usage.ts): token,
-- tool-call and round counts are INTEGER; durations, costs and provider-usage
-- percentages are REAL. NULL means "unavailable" (an unmeasured value), which
-- maps to the domain's `Measurement<'unavailable'>` kind — distinct from a
-- measured 0. Free-text and ISO-8601 timestamp columns remain TEXT (SQLite has
-- no native date type; ISO-8601 text is sortable and idiomatic).
CREATE TABLE IF NOT EXISTS usage_statistics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT,
  repo TEXT NOT NULL DEFAULT '',
  mission TEXT NOT NULL DEFAULT '',
  classification TEXT,
  implementer TEXT,
  pr_fix_rounds INTEGER,
  provider TEXT,
  model TEXT,
  implementer_agent TEXT,
  reviewer_agent TEXT,
  stage TEXT DEFAULT 'default',
  input_tokens INTEGER,
  output_tokens INTEGER,
  cached_tokens INTEGER,
  context_tokens INTEGER,
  tool_calls INTEGER,
  openai_usage_before REAL,
  openai_usage_after REAL,
  openai_usage_delta REAL,
  duration_minutes REAL,
  cost_usd REAL,
  closed TEXT
);

CREATE INDEX IF NOT EXISTS idx_usage_statistics_mission
  ON usage_statistics(repo, mission, stage);

CREATE INDEX IF NOT EXISTS idx_usage_statistics_date
  ON usage_statistics(date);

-- Known repositories: operator-local cache of repository identity
CREATE TABLE IF NOT EXISTS known_repositories (
  id TEXT PRIMARY KEY NOT NULL,
  path TEXT NOT NULL,
  last_accessed TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_known_repositories_path
  ON known_repositories(path);

-- UI preferences: key-value store for operator-local UI settings
CREATE TABLE IF NOT EXISTS ui_preferences (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Operational history: local operational event log
CREATE TABLE IF NOT EXISTS operational_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  event_data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_operational_history_type
  ON operational_history(event_type);

CREATE INDEX IF NOT EXISTS idx_operational_history_created
  ON operational_history(created_at);

-- Migration ledger: records applied migrations with checksums
CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
