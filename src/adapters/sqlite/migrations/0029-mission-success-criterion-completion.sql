-- TASK-2631: success criteria carry a completion state, addressed by position.
-- Existing rows migrate as incomplete: nothing recorded them as done, so none
-- may be inferred to be.
ALTER TABLE mission_success_criteria ADD COLUMN completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1));
