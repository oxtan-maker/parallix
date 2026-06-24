---
id: TASK-1343
title: >-
  Reorder/board operations re-create completed tasks in backlog/tasks as
  status=backlog
status: backlog
assignee: []
created_date: '2026-06-24 17:02'
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

Tasks that have been integrated and moved to `backlog/completed/` (status: done) reappear in `backlog/tasks/` with `status: backlog`, so the board shows already-shipped work as un-started.

## Evidence

- TASK-1323, TASK-1335, TASK-1336 each had a `mission/task-NNNN` integration commit on `main` that **renamed** the file `backlog/tasks/... -> backlog/completed/...` (status set to `done`). Verified: each has a mission commit on main and a canonical done copy in `backlog/completed/`.
- A later commit `261e5acb "Reorder tasks in backlog"` (2026-06-23 18:37) **added** (`git status A`) fresh `backlog/tasks/task-1323/1335/1336/1333` files with `status: backlog`, duplicating the done copies already present in `backlog/completed/`.
- Result: the same task id exists in both `backlog/tasks/` (backlog) and `backlog/completed/` (done). `task_list` reports the backlog copy, hiding the fact the work is shipped.
- This is the same class of defect as the already-completed TASK-1327 ("sometimes the backlog.md task is in the wrong state").

## Root cause (hypothesis)

The reorder/board operation enumerates tasks and rewrites them into `backlog/tasks/` without accounting for parallix's `backlog/completed/` convention (`markTaskDone` in `lib/tools/backlog.js` moves a file there and sets status=done). The reorder regenerates a backlog-state copy for tasks whose canonical record now lives in `completed/`, instead of leaving completed tasks untouched.

## Fix direction

- Make reorder/any board mutation `completed/`+`archive/`-aware: never emit a `backlog/tasks/` file for a task id that already exists in `backlog/completed/` or `backlog/archive/`.
- On detection of a (tasks/, completed/) duplicate for the same id, treat the completed copy as canonical and drop the stale backlog copy.
- Consider a guard/lint in the workflow gate that fails when a task id appears in both `backlog/tasks/` and `backlog/completed/`, so this can't silently recur.

## Already remediated by hand (this change)

Removed the 3 stale duplicates from `backlog/tasks/` (1323, 1335, 1336); canonical done copies remain in `backlog/completed/`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Reorder / board mutations never create a backlog/tasks file for a task id that already exists in backlog/completed or backlog/archive
- [ ] #2 When a duplicate (tasks/ + completed/) is detected for the same id, the completed copy is treated as canonical and the stale backlog copy is removed
- [ ] #3 A workflow gate or guard fails when any task id appears in both backlog/tasks and backlog/completed
- [ ] #4 Regression test reproduces the reorder-recreates-completed-task scenario and passes after the fix
<!-- AC:END -->
