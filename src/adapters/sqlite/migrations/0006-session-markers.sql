-- Migration: 0006-session-markers
-- Description: Dedicated relational table for SessionMarker domain concept.
--   Replaces the file-backed `.workflow/sessions/<slug>-<role>.json` path as
--   the sole live authority for resumable agent-session markers (TASK-2322.09).
--
-- Authority: operator-local domain state (ADR 0053 classification:
--   `database-owned-domain-state`). Session identity must survive worktree
--   cleanup and must not be confused with an inferred Attempt aggregate.
--
-- Domain alignment:
--   - mission_id maps to MissionId (src/domain/mission.ts)
--   - role maps to SessionRole enum ('execute' | 'draft' | 'review')
--   - agent maps to AgentFamily (src/domain/agents.ts)
--   - last_launched is the ISO-8601 timestamp of the last agent launch
--   - session_id is the optional provider session identifier
--   - updated_at is the authoritative modification timestamp
--   The row maps 1:1 to SessionMarker (src/domain/session.ts).
--
-- Forward-only: this migration has no `down` SQL. The TASK-2295 migration runner
-- takes a pre-migration backup before applying an irreversible migration.

CREATE TABLE IF NOT EXISTS session_markers (
  mission_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('execute', 'draft', 'review')),
  agent TEXT NOT NULL,
  last_launched TEXT NOT NULL,
  session_id TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE(mission_id, role)
);

-- Query-support index for reading markers by mission (e.g. import dedup,
-- bulk clear by mission, or operator-local status queries).
CREATE INDEX IF NOT EXISTS idx_session_markers_mission
  ON session_markers (mission_id);
