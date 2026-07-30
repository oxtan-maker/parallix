-- Migration: 0005-repository-scoped-session-markers
-- Description: Scope SessionMarker identity to its owning repository and make
--   the table strict so SQLite enforces the declared storage classes.
--
-- Migration 0004 may already be present in an operator database. Its rows do
-- not contain enough information to infer their repository safely, so they are
-- preserved under an explicit legacy scope. An explicit legacy import can
-- associate source worktree markers with a checked RepositoryId.

DROP INDEX IF EXISTS idx_session_markers_mission;

ALTER TABLE session_markers RENAME TO session_markers_unscoped;

CREATE TABLE session_markers (
  repository_id TEXT NOT NULL CHECK(length(trim(repository_id)) > 0),
  mission_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('execute', 'draft', 'review')),
  agent TEXT NOT NULL,
  last_launched TEXT NOT NULL,
  session_id TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE(repository_id, mission_id, role)
) STRICT;

INSERT INTO session_markers (
  repository_id,
  mission_id,
  role,
  agent,
  last_launched,
  session_id,
  updated_at
)
SELECT
  'legacy-unscoped',
  mission_id,
  role,
  agent,
  last_launched,
  session_id,
  updated_at
FROM session_markers_unscoped;

DROP TABLE session_markers_unscoped;

CREATE INDEX idx_session_markers_repository_mission
  ON session_markers (repository_id, mission_id);
