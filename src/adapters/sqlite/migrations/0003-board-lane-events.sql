-- Migration: 0003-board-lane-events
-- Description: Dedicated relational table for board lane-transition events.
--   Replaces the JSON-blob pattern (operational_history + event_type filter)
--   with a typed table following the usage_statistics analytical pattern.
--
-- Authority: operator-local telemetry only (ADR 0051). Lane-transition events
--   are the source of truth for the event log itself, never a competing mission
--   lifecycle authority — repository Git/Markdown state still wins.
--
-- Domain alignment:
--   - mission_id maps to MissionId (src/domain/mission.ts)
--   - from_status / to_status map to MissionStatus enum values
--   - trigger maps to MissionCommand['type'] (src/domain/mission-workflow.ts)
--   - agent maps to AgentFamily (src/domain/agents.ts)
--   - occurred_at is the authoritative transition timestamp
--   The row maps 1:1 to LaneTransitionEvent (src/domain/board-event.ts) and
--   converts losslessly to MissionTransition via the domain mapping function.
--
-- Relationship to usage_statistics:
--   board_lane_events records every lifecycle transition (the "when" and
--   "how" of mission movement). usage_statistics records outcome measurements
--   for completed missions (cycle time, tokens, cost, review rounds).
--   Together they feed buildMetrics():
--     - board_lane_events → MissionTransition[] → cumulativeFlow, wipSeries
--     - usage_statistics  → MissionOutcome[]    → throughput, reviewLoopRate
--   Both tables share mission_id as the join key and use the same
--   operator-local authority model.
--
-- Forward-only: this migration has no `down` SQL. The TASK-2295 migration runner
-- takes a pre-migration backup before applying an irreversible migration.

CREATE TABLE IF NOT EXISTS board_lane_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

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
  -- Prevents duplicate rows if the same transition is recorded twice.
  idempotency_key TEXT NOT NULL
);

-- Idempotency backstop: a duplicate emission of the same idempotency key
-- cannot produce a second row. The application recorder also dedups by
-- idempotency key before writing; this UNIQUE index makes the guarantee
-- durable at the storage layer.
CREATE UNIQUE INDEX IF NOT EXISTS idx_board_lane_events_idempotency
  ON board_lane_events (idempotency_key);

-- Query-support index for reading lane transitions by mission id
-- (used by buildMetrics → cumulativeFlow, wipSeries).
CREATE INDEX IF NOT EXISTS idx_board_lane_events_mission
  ON board_lane_events (mission_id, occurred_at);

-- Query-support index for throughput / flow analytics by time window.
CREATE INDEX IF NOT EXISTS idx_board_lane_events_time
  ON board_lane_events (occurred_at);
