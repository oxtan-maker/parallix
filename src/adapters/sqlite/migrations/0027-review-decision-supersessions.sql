-- A branch move recorded against an approval (TASK-2555).  Like a revocation
-- it is an additive audit fact on the original decision: the approval and its
-- reviewed revision stay in place, and the superseding revision is named.
ALTER TABLE mission_review_rounds ADD COLUMN superseded_at TEXT;
ALTER TABLE mission_review_rounds ADD COLUMN superseding_revision TEXT;
ALTER TABLE mission_review_rounds ADD COLUMN superseded_by TEXT;
