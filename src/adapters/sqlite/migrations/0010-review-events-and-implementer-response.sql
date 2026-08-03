-- TASK-2322.12: store review events and implementer response details in SQLite.
--
-- The review-events .md files (missions/<slug>/review-events/*.md) are workflow
-- audit records that supplement the Review aggregate. After this migration they
-- are stored in the operator database so the file-backed paths can be retired.
--
-- Two concerns land here:
--
-- 1. mission_review_events — full audit trail for all event types
--    (reviewer findings/outcomes, implementer summaries/dispositions,
--    human notes, blocked/parked publication records). This replaces the
--    .md files under missions/<slug>/review-events/.
--
-- 2. Implementer response columns on mission_review_rounds — the implementer's
--    round summary includes workflow metadata (fixed_items, pushed_back_items,
--    parked_items, blocked_reason) that is not captured by the structured
--    FindingResolution collection. These columns store that metadata directly
--    on the round so stats.ts and the review loop can access it without
--    scanning event files.
--
-- Additive only: existing rows take NULL defaults. The application backfills
-- from .md files on first read (compatibility path).

-- Full audit trail for review events (replaces missions/<slug>/review-events/*.md)
CREATE TABLE mission_review_events (
  mission_id TEXT NOT NULL REFERENCES mission_reviews(mission_id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'reviewer_findings', 'reviewer_outcome',
      'implementer_round_summary', 'implementer_disposition',
      'neutral_discussion', 'human_note',
      'blocked_publication', 'parked_followup'
    )
  ),
  round_number INTEGER CHECK (round_number IS NULL OR round_number >= 1),
  phase TEXT,
  actor TEXT,
  content TEXT NOT NULL DEFAULT '',
  disposition TEXT,
  verdict TEXT,
  /** JSON array of {kind: 'fixed'|'pushed_back'|'parked', findingId: string} */
  item_dispositions TEXT,
  blocked_reason TEXT,
  followup_reference TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S', 'now')),
  PRIMARY KEY (mission_id, position)
);

CREATE INDEX idx_review_events_mission_type
  ON mission_review_events (mission_id, event_type);

CREATE INDEX idx_review_events_round
  ON mission_review_events (mission_id, round_number);

-- Implementer response metadata on the round (supplements FindingResolution)
ALTER TABLE mission_review_rounds
  ADD COLUMN implementer_response_content TEXT;

ALTER TABLE mission_review_rounds
  ADD COLUMN item_dispositions TEXT;

ALTER TABLE mission_review_rounds
  ADD COLUMN blocked_reason TEXT;
