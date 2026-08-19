-- TASK-2377.04: drop the persisted review-level retry counters.
--
-- Migrations 0009 and 0012 added `gate_failure_retry_count` and
-- `hook_failure_retry_count` to carry the cumulative auto-bounce budgets of
-- the pre-kernel gate/hook bounces. The review loop now routes every
-- pre-review bounce through the rebound kernel, whose budget is per local
-- failure, in-memory, and persists nothing (ADR 0053: the kernel budget is
-- the only retry state that exists). The two columns are dead weight — a
-- second source of truth for a budget that no longer steers loop behavior —
-- and this forward-only migration drops them.
--
-- The per-round `mission_review_rounds.reviewer_retry_count` /
-- `implementer_retry_count` columns (0008) stay: ADR 0053 describes the
-- retry counters as round columns and historical values round-trip
-- unchanged.
--
-- The pre-review safety commit still records its hook identity for the
-- in-process rebase; nothing reads these columns after this migration.

ALTER TABLE mission_reviews DROP COLUMN gate_failure_retry_count;
ALTER TABLE mission_reviews DROP COLUMN hook_failure_retry_count;
