-- TASK-2521.03: rename the persisted brief boundary from constraints to out-of-scope.
--
-- 0021 is immutable and shipped with the original names, so this forward
-- migration preserves existing rows while bringing those databases to the
-- schema consumed by MissionBrief.outOfScope.
ALTER TABLE mission_brief_constraints RENAME TO mission_brief_out_of_scope;
ALTER TABLE mission_brief_out_of_scope RENAME COLUMN constraint_text TO entry;
