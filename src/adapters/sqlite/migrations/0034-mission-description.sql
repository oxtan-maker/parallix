-- TASK-2693: a mission captured on the board may carry a description with no
-- reason attached. A brief needs both goal and why, so the description lives on
-- the mission until a refining agent records the brief with `px goal set`.
ALTER TABLE missions ADD COLUMN description TEXT;
