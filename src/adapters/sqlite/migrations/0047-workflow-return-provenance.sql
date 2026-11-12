-- Review decisions, causes, revisions and senders stay in their existing
-- authorities. Lane history retains only the three facts it did not own.
-- Atomic validation of the identity belongs to the shared repository parser.
ALTER TABLE board_lane_events ADD COLUMN return_stage TEXT
  CHECK (return_stage IS NULL OR return_stage IN ('agent-review', 'human-review', 'declared-gates',
    'integration-gates', 'pre-review-rebase'));
ALTER TABLE board_lane_events ADD COLUMN workflow_operation_id TEXT
  CHECK (workflow_operation_id IS NULL OR length(trim(workflow_operation_id)) > 0);
ALTER TABLE board_lane_events ADD COLUMN workflow_generation INTEGER
  CHECK (workflow_generation IS NULL OR (typeof(workflow_generation) = 'integer' AND workflow_generation >= 1));
