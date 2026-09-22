-- TASK-2521.03: the red-to-green reproduction test becomes Mission state.
--
-- `redgreen.ts` located the test by reading a `Reproduction-Test:` line out of
-- MISSION.md or a checkpoint document, so the draft prompt had to tell agents to
-- write that file. The gate is a live consumer; the file was only its transport.
ALTER TABLE missions ADD COLUMN reproduction_test TEXT;
