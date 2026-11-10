-- TASK-2846.03: correlate an agent-derived measurement with its retained run.
-- The existing measurement identity remains (repo, mission, stage, actor_key):
-- repeated launches still accumulate into the same reporting row, whose run_id
-- names the latest contributing launch. Historical and non-agent rows stay NULL.
ALTER TABLE usage_statistics ADD COLUMN run_id TEXT;

CREATE INDEX idx_usage_statistics_run_id
  ON usage_statistics(run_id);
