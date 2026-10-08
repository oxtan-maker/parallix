-- TASK-2665: a Goal Check row written to repair an integration gate failure
-- remembers that gate, so a later failure of the same gate still owes this
-- criterion fresh proof after the repair replaced the gate-citing reference.
ALTER TABLE mission_checkpoint_goal_checks ADD COLUMN repaired_gate TEXT;
