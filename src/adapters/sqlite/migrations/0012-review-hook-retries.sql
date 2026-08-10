-- TASK-2340: carry the hook-failure retry budget on the Review aggregate.
--
-- Mirrors migration 0009 (gate_failure_retry_count). Hook auto-bounces happen
-- during rebase/integrate operations, not during the pre-review gate, so the
-- counter is separate. Cumulative across rounds like gate retries: a hook
-- bounce hands the mission back to the implementer without starting a new
-- round, so a per-round column would reset the budget on every bounce.

ALTER TABLE mission_reviews
  ADD COLUMN hook_failure_retry_count INTEGER NOT NULL DEFAULT 0
    CHECK (hook_failure_retry_count >= 0);
