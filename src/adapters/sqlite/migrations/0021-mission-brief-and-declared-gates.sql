-- TASK-2521.03: replace the execution-context blob with the concepts it held.
--
-- 0020 stored constraints, refinement drivers, declared gates and predecessor
-- references in one `mission_execution_context_items` table discriminated by a
-- `kind` string. ADR 0053 asks the model to represent these concepts directly,
-- so each surviving one gets its own table and the rest are dropped:
--
--   * brief (goal, why, scope, constraints) -> mission_briefs (+ constraints)
--   * declared gates                        -> mission_declared_gates
--   * predicted NEL bucket                  -> dropped; missions.net_engineering_lines
--                                              plus classifyNelBucket() already model this
--   * confidence, selection note, drivers   -> dropped; no consumer, no rule
--   * dependencies                          -> dropped; the task source owns them
--
-- No data migration: 0020 shipped with no production writer, and the only row
-- ever written was a manual test of the command surface.
DROP TABLE IF EXISTS mission_execution_context_items;
DROP TABLE IF EXISTS mission_execution_contexts;

CREATE TABLE mission_briefs (
  mission_id TEXT PRIMARY KEY REFERENCES missions(id) ON DELETE CASCADE,
  goal TEXT NOT NULL CHECK (length(goal) BETWEEN 1 AND 4000),
  why_text TEXT NOT NULL CHECK (length(why_text) BETWEEN 1 AND 4000),
  scope_text TEXT CHECK (scope_text IS NULL OR length(scope_text) BETWEEN 1 AND 4000)
);

CREATE TABLE mission_brief_constraints (
  mission_id TEXT NOT NULL REFERENCES mission_briefs(mission_id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  constraint_text TEXT NOT NULL CHECK (length(constraint_text) BETWEEN 1 AND 512),
  PRIMARY KEY (mission_id, position)
);

-- Gates are a Mission attribute, not part of the brief: handoff runs exactly
-- these commands, and they change during execution while the brief does not.
CREATE TABLE mission_declared_gates (
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  command TEXT NOT NULL CHECK (length(command) BETWEEN 1 AND 512),
  PRIMARY KEY (mission_id, position),
  UNIQUE (mission_id, command)
);
