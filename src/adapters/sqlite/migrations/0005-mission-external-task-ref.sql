-- Migration: 0005-mission-external-task-ref
-- Intake traceability for accepted external material (ADR 0053: external task
-- catalogs are excluded as aggregates; only the reference is stored).
--
-- Modelled as an aggregate-owned value collection with at most one row per
-- mission, exactly like the other nested Mission values. It deliberately has no
-- status, assignee, or lifecycle column: a second lifecycle authority must not
-- be reachable by adding columns to this table.

CREATE TABLE mission_external_task_refs (
  mission_id TEXT PRIMARY KEY REFERENCES missions(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (length(source) > 0 AND length(source) <= 512),
  external_id TEXT NOT NULL CHECK (length(external_id) > 0 AND length(external_id) <= 512),
  url TEXT CHECK (url IS NULL OR (length(url) > 0 AND length(url) <= 512))
);

CREATE INDEX idx_mission_external_task_refs_source
  ON mission_external_task_refs (source, external_id);
