-- TASK-2665: a Goal Check row records the review round it was written in, so a
-- repair round can tell its fresh fix evidence from rows kept from earlier
-- rounds. Existing rows carry no round: nothing recorded when they were written.
ALTER TABLE mission_checkpoint_goal_checks ADD COLUMN recorded_round INTEGER CHECK (recorded_round IS NULL OR recorded_round >= 1);
