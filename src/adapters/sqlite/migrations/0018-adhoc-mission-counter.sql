-- Migration: 0018-adhoc-mission-counter
-- DB-owned, repository-scoped identity for free-text adhoc intakes (task-2468).
--
-- Backlog-backed missions keep their identity in a Backlog task file. Adhoc
-- missions have no such file in an adhoc-only repository, so their identity is
-- minted here instead: a monotonic counter owned per repository, allocated
-- atomically, so `parallix-adhoc-<NNNN>` can never collide with, or be confused
-- for, Backlog.md task numbering. No content hash in the identity: slug,
-- mission id, branch, and worktree suffix all derive from this counter.
--
-- The counter row is intentionally sparse — only repository identity and the
-- last allocated number — because the adhoc identity is fully derivable from
-- it. It carries no status, assignee, or lifecycle column: a second lifecycle
-- authority must not be reachable by adding columns here.

CREATE TABLE IF NOT EXISTS adhoc_mission_counters (
  repository_id TEXT PRIMARY KEY,
  counter INTEGER NOT NULL DEFAULT 0 CHECK (counter >= 0)
);
