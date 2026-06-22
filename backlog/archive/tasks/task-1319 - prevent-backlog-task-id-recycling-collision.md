---
id: TASK-1319
title: prevent backlog task id recycling collision
status: backlog
assignee: []
created_date: '2026-06-16'
labels: ["ai_sdlc", "infra"]
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
### What happened
backlog.md minted the id `TASK-1317` twice for two unrelated missions:

1. **task-1317 (original)** — "Forgejo PR creation fails on first push when branch
   has no remote tracking ref." Completed and merged; mission record in
   `missions/task-1317/`, backlog record in `backlog/completed/`.
2. **task-1317 (duplicate)** — "audit stats for bugs", minted later while the
   original task-1317 lived only on its mission branch / had already been moved
   to `backlog/completed/`. The draft then overwrote `missions/task-1317/MISSION.md`,
   leaving that folder mixing the stats mission with the Forgejo checkpoints and
   review-state. The duplicate also displaced the Forgejo task's backlog record
   on `main` (the completed entry had to be restored by hand).

(The duplicate mission has since been renumbered to **task-1318** to unblock work;
this task tracks the underlying minting bug so it cannot recur.)

### Root cause
backlog.md computes the next id from a scan that did **not** account for an id
that had left the active `backlog/tasks/` directory. With this repo's
`backlog/config.yml` settings (`check_active_branches: true`,
`active_branch_days: 30`), the uniqueness scan is driven by `backlog/tasks/`
plus *active* branches. A task that:
  - has been moved to `backlog/completed/` (outside the `tasks/` scan), AND
  - exists only on a mission branch that wasn't merged to `main` / wasn't
    visible to the active-branch scan at mint time,
becomes invisible to the next-id calculation, so its id gets reissued. Minting
the new task from a *different* branch/worktree than the one carrying the
completed task compounds it.

### Proposed direction (to be refined)
- Make next-id allocation scan **all** id sources: `backlog/tasks/`,
  `backlog/completed/`, and `backlog/archive/**` — never just the active dir.
- Consider deriving the high-water mark from a monotonic counter persisted in
  repo config (e.g. a `last_id` in `backlog/config.yml`) so a deleted/moved/
  branch-only task can never lower the next id.
- Audit how/where parallix triggers `backlog_task_create` (it can be invoked
  from any mission worktree); ensure id minting reads a `main`-anchored view of
  used ids, not just the current branch's working tree.
- Add a guard that refuses to create a task whose id already exists in
  `completed/` or `archive/` on `main`.

### Acceptance criteria (draft)
1. Creating a new task when the highest id currently lives in
   `backlog/completed/` (not `backlog/tasks/`) mints `max+1`, not a recycled id.
2. Creating a new task when the highest id lives only on an unmerged mission
   branch mints `max+1`, not a recycled id.
3. A regression test reproduces the task-1317 double-mint scenario and asserts
   no collision.
4. `npm test` passes.
<!-- SECTION:DESCRIPTION:END -->
