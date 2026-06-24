---
id: TASK-1343
title: >-
  Reorder writes status=backlog copies of completed tasks back into
  backlog/tasks
status: done
assignee: [mistral]
created_date: '2026-06-24 17:02'
updated_date: '2026-06-24 17:08'
labels:
  - ai_sdlc
  - workflow
  - bug
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

A task that has been integrated and moved to `backlog/completed/` (status: `done`) reappears in `backlog/tasks/` with `status: backlog`. The board then shows already-shipped work as un-started, and `task_list` reports the stale backlog copy instead of the canonical done copy.

## Evidence

- TASK-1323, TASK-1335, TASK-1336 each have a `mission/task-NNNN` integration commit on `main` that **renamed** `backlog/tasks/… -> backlog/completed/…` and set `status: done`. Each has a canonical done copy in `backlog/completed/`.
- A later commit `261e5acb "Reorder tasks in backlog"` (2026-06-23 18:37) **added** (`git status A`) fresh `backlog/tasks/task-1323/1335/1336/1333` files with `status: backlog` and an `ordinal:` field — duplicating the done copies already in `backlog/completed/`. Example: the recreated `task-1323` file carries `status: backlog` and `ordinal: 43000`.
- Result: the same task id exists in both `backlog/tasks/` (backlog) and `backlog/completed/` (done). `task_list` surfaces the backlog copy, hiding that the work is shipped.
- "Reorder tasks in backlog" is a recurring operation — there are many such commits in history, so the recreate can keep happening.
- Same class of defect as the already-completed TASK-1327 ("sometimes the backlog.md task is in the wrong state").

## Root cause

The reorder/ordinal write path (the operation that produces the "Reorder tasks in backlog" commits and stamps `ordinal:` frontmatter) enumerates tasks and writes them into `backlog/tasks/` without honoring parallix's `backlog/completed/` + `backlog/archive/` convention. It regenerates a `status: backlog` copy for task ids whose canonical record now lives in `completed/`.

Note: parallix's own `lib/tools/backlog.js` already scans `completed/` and `archive/` for lookups (it is completed-aware), so the recreate does **not** come from that wrapper — it comes from the reorder write path. The fix must make that write path completed/archive-aware, and/or add a gate so a recurrence cannot ship silently.

## Fix direction

- Make reorder / any board mutation `completed/`- and `archive/`-aware: never emit a `backlog/tasks/` file for a task id that already exists in `backlog/completed/` or `backlog/archive/`.
- When a (`tasks/`, `completed/`) duplicate is detected for the same id, treat the completed copy as canonical and drop the stale backlog copy.
- Add a workflow-gate guard that fails when a task id appears in both `backlog/tasks/` and `backlog/completed/` (or `archive/`), so this cannot silently recur.

## Already remediated by hand

The stale `backlog/tasks/` duplicates for 1323, 1335, 1336 were removed; canonical done copies remain in `backlog/completed/`. This task is about preventing recurrence, not re-doing that cleanup.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Reorder / board mutations never create a backlog/tasks file for a task id that already exists in backlog/completed or backlog/archive
- [ ] #2 When a (tasks/ + completed/) duplicate is detected for the same id, the completed copy is treated as canonical and the stale backlog/tasks copy is removed
- [ ] #3 A workflow gate or guard fails when any task id appears in both backlog/tasks and backlog/completed (or backlog/archive)
- [ ] #4 Automated regression test reproduces the reorder-recreates-completed-task scenario (recreated status=backlog copy alongside a completed copy) and passes after the fix
- [ ] #5 Behavior is documented where the reorder/board operation and the workflow gate are described
<!-- AC:END -->
