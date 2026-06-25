---
id: TASK-1328
title: >-
  Integration recovery should detect in-progress mission rebases instead of
  reporting generic local changes
status: done
assignee: [qwen]
created_date: '2026-06-22 03:47'
updated_date: '2026-06-23 16:37'
labels:
  - bug
  - ai_sdlc
dependencies: []
references:
  - >-
    backlog/tasks/task-1327 -
    sometimes-the-backlog.md-task-is-in-the-wrong-state.md
priority: high
ordinal: 37750
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Task-1322 integration recovery exposed a workflow bug in the mission-side rebase/integration path. `px integrate task-1322 --dry-run` correctly reported a merge-conflict blocker, but the follow-up operator flow was misleading: `px status` reported only one uncommitted file, `px rebase` failed with the generic git message for local changes, and the worktree was actually on detached HEAD in the middle of an interactive rebase with unresolved mission-local metadata conflicts (`backlog/tasks/task-1322 - prevent-backlog-task-id-recycling-collision.md`, `missions/task-1322/review-state.json`, `missions/task-1322/CP-4.md`). Recovery should detect and explain that state directly instead of making the operator infer it from raw git behavior. Related context: TASK-1327 covers wrong backlog state after review; this follow-up is specifically about the misleading rebase/integration recovery diagnostics.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `px status` reports when a mission worktree is on detached HEAD because a rebase is still in progress, and it lists unmerged files accurately instead of collapsing the state to a generic uncommitted-file count.
- [ ] #2 `px rebase <slug>` detects an in-progress rebase or unmerged index entries before attempting a fresh rebase and prints the exact conflicted paths plus recovery commands instead of surfacing only git's generic dirty-worktree error.
- [ ] #3 A regression test reproduces the task-1322 recovery state (detached mission worktree, active rebase metadata, and mission-local conflicts in the backlog task file, review-state, and CP-4) and verifies the improved diagnostics.
<!-- AC:END -->
