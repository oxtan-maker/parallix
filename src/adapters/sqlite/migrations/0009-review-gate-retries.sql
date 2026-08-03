-- TASK-2322.12: carry the pre-review gate retry budget on the Review aggregate.
--
-- Migration 0008 modelled the workflow phase, the per-round retry counters and
-- the stage-launch windows. It did not cover `gateFailureRetryCount`, the
-- counter `handleGateFailureAutoBounce` uses to cap auto-bounces at
-- MAX_GATE_RETRY. That counter is the last review-loop value that would have
-- kept review-state.json alive as a durable authority, so it lands here rather
-- than by rewriting 0008, which is already applied.
--
-- Cumulative across rounds like the stage-launch windows: an auto-bounce hands
-- the mission back to the implementer without starting a new round, so a
-- per-round column would reset the budget on every bounce.

ALTER TABLE mission_reviews
  ADD COLUMN gate_failure_retry_count INTEGER NOT NULL DEFAULT 0
    CHECK (gate_failure_retry_count >= 0);
