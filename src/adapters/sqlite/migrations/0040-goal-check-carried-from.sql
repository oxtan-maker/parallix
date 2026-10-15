-- Provenance of Goal Check rows carried into a repair checkpoint; NULL for recorded rows.
ALTER TABLE mission_checkpoint_goal_checks ADD COLUMN carried_from TEXT;
