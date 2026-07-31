-- 0007-usage-statistics-identity
--
-- TASK-2322.08: make `usage_statistics` the sole authority for
-- `AgentRunMeasurement` / `MissionOutcome` data (ADR 0053), replacing the
-- former `<PARALLIX_HOME>/stats.csv` file authority.
--
-- Identity: TASK-2322.02 excluded `Attempt`, so a measurement has NO per-run
-- identity. The valid identity is the grouping the domain already models —
-- (repo, mission, stage, actor) — where `actor_key` is the normalized agent
-- family the row is attributed to. `actor_key` is supplied by the caller that
-- owns the attribution rule; the adapter never infers it, and no per-launch
-- row is created.
--
-- Irreversible (no `down`): the unique index collapses pre-existing duplicate
-- rows that the file authority allowed. The migration runner takes a
-- pre-migration backup for irreversible migrations.

ALTER TABLE usage_statistics ADD COLUMN actor_key TEXT NOT NULL DEFAULT '';

-- Backfill `actor_key` with the same rule the statistics command applies:
-- review rows are attributed to the reviewer, every other stage to the
-- implementer; the value is trimmed, stripped of one leading '@', lowercased.
UPDATE usage_statistics
SET actor_key = lower(
  CASE
    WHEN substr(
      CASE
        WHEN lower(trim(COALESCE(NULLIF(trim(stage), ''), 'default'))) = 'review'
          THEN COALESCE(NULLIF(trim(reviewer_agent), ''), NULLIF(trim(implementer_agent), ''), NULLIF(trim(implementer), ''), '')
        ELSE COALESCE(NULLIF(trim(implementer_agent), ''), NULLIF(trim(implementer), ''), '')
      END, 1, 1) = '@'
    THEN substr(
      CASE
        WHEN lower(trim(COALESCE(NULLIF(trim(stage), ''), 'default'))) = 'review'
          THEN COALESCE(NULLIF(trim(reviewer_agent), ''), NULLIF(trim(implementer_agent), ''), NULLIF(trim(implementer), ''), '')
        ELSE COALESCE(NULLIF(trim(implementer_agent), ''), NULLIF(trim(implementer), ''), '')
      END, 2)
    ELSE
      CASE
        WHEN lower(trim(COALESCE(NULLIF(trim(stage), ''), 'default'))) = 'review'
          THEN COALESCE(NULLIF(trim(reviewer_agent), ''), NULLIF(trim(implementer_agent), ''), NULLIF(trim(implementer), ''), '')
        ELSE COALESCE(NULLIF(trim(implementer_agent), ''), NULLIF(trim(implementer), ''), '')
      END
  END
);

-- Normalize `stage` so the identity key cannot split on '' vs 'default'.
UPDATE usage_statistics
SET stage = lower(trim(COALESCE(NULLIF(trim(stage), ''), 'default')));

-- Collapse duplicates the file authority permitted, keeping the newest row
-- (highest rowid) for each identity.
DELETE FROM usage_statistics
WHERE id NOT IN (
  SELECT MAX(id) FROM usage_statistics
  GROUP BY repo, mission, stage, actor_key
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_statistics_identity
  ON usage_statistics(repo, mission, stage, actor_key);
