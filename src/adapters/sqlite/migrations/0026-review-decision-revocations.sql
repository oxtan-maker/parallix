-- An approval withdrawal is an audit fact on the original decision.  It is
-- deliberately additive: the approved decision and its reviewed revision stay
-- in place, while a new round records subsequent review work.
ALTER TABLE mission_review_rounds ADD COLUMN revoked_at TEXT;
ALTER TABLE mission_review_rounds ADD COLUMN revoked_by TEXT;
ALTER TABLE mission_review_rounds ADD COLUMN revoked_reason TEXT;

CREATE INDEX idx_review_round_revocation
  ON mission_review_rounds (mission_id, revoked_at);
