-- TASK-2704: the primary-branch revision a round's mission diff is measured from, so a repair
-- compares baseline-relative mission diffs rather than diffs polluted by main.
ALTER TABLE mission_review_rounds ADD COLUMN review_baseline TEXT;
