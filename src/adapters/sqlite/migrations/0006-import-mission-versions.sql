-- Migration: 0006-import-mission-versions
-- Description: Per-Mission version snapshot captured by a compatibility import.
--              Lets a replay detect a database that diverged after the last
--              import without re-reading the aggregate (TASK-2322.04 SC4).
-- Authority: operator-local only
--
-- Relational, not a serialized blob: one row per (import, mission) with an
-- INTEGER version that carries the same `version >= 1` invariant as
-- missions.version, and foreign keys that delete the snapshot when either the
-- ledger entry or the Mission goes away.

CREATE TABLE import_mission_versions (
  import_id INTEGER NOT NULL REFERENCES import_history(id) ON DELETE CASCADE,
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version >= 1),
  PRIMARY KEY (import_id, mission_id)
);

CREATE INDEX idx_import_mission_versions_mission
  ON import_mission_versions (mission_id);
