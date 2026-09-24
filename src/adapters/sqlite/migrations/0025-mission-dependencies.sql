-- TASK-2521.04: Mission-to-Mission dependencies.
--
-- 0021 dropped the predecessor references it had stored in the execution-context
-- table, saying "the task source owns them". There is no task source: the
-- Mission aggregate is the only self-hosted task record, so a dependency is a
-- reference from one Mission to another and belongs here.
--
-- Nothing enforces it. No lifecycle, activation or scheduling rule reads this
-- table; it records what an operator or agent needs to know about order.
--
-- No data migration: the rows 0021 dropped were never written in production.
CREATE TABLE mission_dependencies (
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  depends_on_mission_id TEXT NOT NULL CHECK (
    length(depends_on_mission_id) BETWEEN 1 AND 128
    AND depends_on_mission_id <> mission_id
  ),
  PRIMARY KEY (mission_id, position),
  UNIQUE (mission_id, depends_on_mission_id)
);
