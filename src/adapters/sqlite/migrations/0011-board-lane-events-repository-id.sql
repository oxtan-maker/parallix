-- Migration: 0011-board-lane-events-repository-id
-- Description: Add repository_id to board_lane_events and scope the
--   idempotency UNIQUE index and mission lookup index by repository.
--   Existing rows are backfilled with the explicit 'legacy-unscoped'
--   sentinel following the precedent in 0005-repository-scoped-session-markers.
--
-- Authority: operator-local telemetry only (ADR 0051).
-- Domain alignment: repository_id maps to RepositoryId (src/domain/repository.ts).
--
-- Forward-only: uses rename-copy-drop pattern. The TASK-2295 migration runner
-- takes a pre-migration backup before applying an irreversible migration.

-- Drop indexes that will be recreated with repository_id prefix
DROP INDEX IF EXISTS idx_board_lane_events_idempotency;
DROP INDEX IF EXISTS idx_board_lane_events_mission;
DROP INDEX IF EXISTS idx_board_lane_events_time;

-- Rename existing table
ALTER TABLE board_lane_events RENAME TO board_lane_events_unscoped;

-- Create new table with repository_id and CHECK constraint
CREATE TABLE board_lane_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Stable repository identifier (scoped, non-empty)
  repository_id TEXT NOT NULL CHECK(length(trim(repository_id)) > 0),

  -- Domain identity: which mission transitioned
  mission_id TEXT NOT NULL,

  -- Lifecycle states (MissionStatus vocabulary:
  --   backlog, refined, active, review, integration, done)
  from_status TEXT,
  to_status TEXT NOT NULL,

  -- Which MissionCommand caused the transition
  --   (activate, submit-for-review, request-changes, approve, integrate)
  trigger TEXT NOT NULL,

  -- Agent family that performed the transition
  agent TEXT NOT NULL DEFAULT 'unknown',

  -- ISO-8601 timestamp of the authoritative transition
  occurred_at TEXT NOT NULL,

  -- Idempotency key: application-generated, unique per emission attempt.
  -- Scoped by repository_id so the same key can exist in different repos.
  idempotency_key TEXT NOT NULL
);

-- Backfill: existing rows get explicit legacy sentinel
INSERT INTO board_lane_events (
  id,
  repository_id,
  mission_id,
  from_status,
  to_status,
  trigger,
  agent,
  occurred_at,
  idempotency_key
)
SELECT
  id,
  'legacy-unscoped',
  mission_id,
  from_status,
  to_status,
  trigger,
  agent,
  occurred_at,
  idempotency_key
FROM board_lane_events_unscoped;

-- Drop the old table
DROP TABLE board_lane_events_unscoped;

-- Idempotency: scoped by (repository_id, idempotency_key) so the same key
-- can exist in different repositories without collision.
CREATE UNIQUE INDEX IF NOT EXISTS idx_board_lane_events_repo_idempotency
  ON board_lane_events (repository_id, idempotency_key);

-- Query-support index for reading lane transitions by repository + mission
CREATE INDEX IF NOT EXISTS idx_board_lane_events_repo_mission
  ON board_lane_events (repository_id, mission_id, occurred_at);

-- Query-support index for throughput / flow analytics by time window
CREATE INDEX IF NOT EXISTS idx_board_lane_events_time
  ON board_lane_events (occurred_at);
