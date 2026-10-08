-- Preserve gate-specific criterion obligations across interleaved repairs.
ALTER TABLE mission_checkpoint_goal_checks ADD COLUMN repaired_gates TEXT;
