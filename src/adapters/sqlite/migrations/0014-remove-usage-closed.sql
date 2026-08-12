-- 0014-remove-usage-closed
-- Preserve non-empty historical completion markers only for the task-2367
-- one-off repair boundary, then remove the competing telemetry contract.
CREATE TABLE legacy_usage_completion_evidence (
  usage_id INTEGER PRIMARY KEY,
  repo TEXT NOT NULL,
  mission TEXT NOT NULL,
  closed TEXT NOT NULL
);
INSERT INTO legacy_usage_completion_evidence (usage_id, repo, mission, closed)
  SELECT id, repo, mission, closed FROM usage_statistics
  WHERE closed IS NOT NULL AND trim(closed) <> '';

CREATE TABLE usage_statistics_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT, repo TEXT NOT NULL DEFAULT '', mission TEXT NOT NULL DEFAULT '',
  classification TEXT, implementer TEXT, pr_fix_rounds INTEGER, provider TEXT,
  model TEXT, implementer_agent TEXT, reviewer_agent TEXT, stage TEXT DEFAULT 'default',
  input_tokens INTEGER, output_tokens INTEGER, cached_tokens INTEGER,
  context_tokens INTEGER, tool_calls INTEGER, openai_usage_before REAL,
  openai_usage_after REAL, openai_usage_delta REAL, duration_minutes REAL,
  cost_usd REAL, actor_key TEXT NOT NULL DEFAULT '', thoughts_tokens INTEGER
);
INSERT INTO usage_statistics_next SELECT id, date, repo, mission, classification,
  implementer, pr_fix_rounds, provider, model, implementer_agent, reviewer_agent,
  stage, input_tokens, output_tokens, cached_tokens, context_tokens, tool_calls,
  openai_usage_before, openai_usage_after, openai_usage_delta, duration_minutes,
  cost_usd, actor_key, thoughts_tokens FROM usage_statistics;
DROP TABLE usage_statistics;
ALTER TABLE usage_statistics_next RENAME TO usage_statistics;
CREATE INDEX idx_usage_statistics_mission ON usage_statistics(repo, mission, stage);
CREATE INDEX idx_usage_statistics_date ON usage_statistics(date);
CREATE UNIQUE INDEX idx_usage_statistics_identity ON usage_statistics(repo, mission, stage, actor_key);
