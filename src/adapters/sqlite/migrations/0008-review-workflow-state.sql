-- TASK-2322.12: model review-loop workflow state on the Review aggregate.
--
-- Before this migration the workflow phase, per-round retry counters and the
-- stage-launch de-duplication windows lived only in review-state.json, which
-- made review-state.json the durable authority for a concept ADR 0053 assigns
-- to the operator database. These columns close that gap so the JSON path can
-- be retired.
--
-- Additive only: existing rows take the defaults, which reproduce the values a
-- pre-migration review would have had (a round with no recorded retries, in the
-- phase implied by its decision history).

ALTER TABLE mission_review_rounds
  ADD COLUMN phase TEXT NOT NULL DEFAULT 'reviewing'
    CHECK (phase IN ('reviewing', 'fixing', 'pending-approval', 'approved'));

ALTER TABLE mission_review_rounds
  ADD COLUMN disposition TEXT
    CHECK (
      disposition IS NULL
      OR disposition IN (
        'APPROVED', 'REQUEST_CHANGES', 'COMMENT',
        'PUSHBACK_ALL', 'BLOCKED', 'PARKED', 'CHANGES_MADE'
      )
    );

ALTER TABLE mission_review_rounds
  ADD COLUMN reviewer_retry_count INTEGER NOT NULL DEFAULT 0
    CHECK (reviewer_retry_count >= 0);

ALTER TABLE mission_review_rounds
  ADD COLUMN implementer_retry_count INTEGER NOT NULL DEFAULT 0
    CHECK (implementer_retry_count >= 0);

-- Backfill phase and disposition from the decision history already stored, so
-- an upgraded database presents the same loop state a fresh one would.
UPDATE mission_review_rounds
  SET phase = 'approved', disposition = 'APPROVED'
  WHERE decision_kind = 'approved';

UPDATE mission_review_rounds
  SET phase = 'pending-approval', disposition = 'CHANGES_MADE'
  WHERE decision_kind = 'changes-requested' AND responded_at IS NOT NULL;

UPDATE mission_review_rounds
  SET phase = 'fixing', disposition = 'REQUEST_CHANGES'
  WHERE decision_kind = 'changes-requested' AND responded_at IS NULL;

-- Stage-launch windows are cumulative across rounds, so they hang off the
-- review rather than a round. `position` preserves insertion order within a
-- window; the application caps retained fingerprints per window.
CREATE TABLE mission_review_stage_launches (
  mission_id TEXT NOT NULL REFERENCES mission_reviews(mission_id) ON DELETE CASCADE,
  stage_key TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  fingerprint TEXT NOT NULL,
  PRIMARY KEY (mission_id, stage_key, position)
);

CREATE INDEX idx_review_stage_launches_window
  ON mission_review_stage_launches (mission_id, stage_key);
