---
id: TASK-2613
title: >-
  Restore completed-task archiving on landing and backfill records lost since
  TASK-2521.07
status: backlog
assignee: []
created_date: '2026-09-29 10:26'
labels:
  - bug
  - workflow
  - integration
dependencies: []
references:
  - src/application/integrate/squash.ts
  - src/adapters/backlog/task-transitions.ts
  - src/adapters/backlog/task-file-io.ts
  - src/adapters/config/product-config.ts
  - workflow.config.json
  - docs/config.md
  - README.md
priority: high
ordinal: 141008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

TASK-2521.07 (landed in `ec9ad2eea`, 2026-09-27) added `adapters.tasks.selfHostedCloseout` and turned it on for this repository. Since then, `stageCloseout` in `src/application/integrate/squash.ts` calls `completeTask(..., { retainLegacyRecord: false })`, which deletes the landed task file instead of moving it to `backlog/completed/`. The same mission deleted `backlog/completed/**` and `backlog/archive/**`.

This caused two problems:

1. Closed tasks leave no trace in the Backlog tree. `backlog/tasks/` stopped meaning "not yet landed", and tasks whose work was already on `main` had to be found and removed by hand (TASK-2521.07, TASK-2547.01, TASK-2559, TASK-2571).
2. The stale-copy guards from TASK-2534 went blind. `checkBacklogIntegrity`, `dropStaleBacklogCopies` and the fail-closed "Stale backlog copies remain after closeout" backstop only find a stale `backlog/tasks/` copy when a canonical copy exists in `backlog/completed/` or `backlog/archive/`. Both directories were gone, so a restored or resurrected task file for landed work passed every check.

## Change

A working implementation already exists. The operator stashed it on `main` as "closeout-restore for mission"; it was moved into this mission's worktree.

- Remove the `selfHostedCloseout` option completely: `workflow.config.json`, `config/workflow.config.schema.json`, `product-config.ts` (the default, the validation and `isSelfHostedTaskCloseout`), the integrate port and its wiring, `squash.ts`, and `completeTask`'s `retainLegacyRecord` option. Do not keep a parallel code path.
- `stageCloseout` again moves the task file to `backlog/completed/` with `status: done` and stages both paths in the landed squash. The TASK-2537 handling for task files that never existed on the base branch stays.
- Revert `README.md` and `docs/config.md` to describe the completion move.
- Revert the tests that TASK-2521.07 changed for the deletion mode: `task-2537-squash-closeout-unstaged-task-path`, `backlog.test`, `product-config-validation`, the `task-2595` stub and `e2e-mission-lifecycle`. The e2e test for the deletion mode now asserts that closeout keeps the completed record and still records integration stats.
- Backfill `backlog/completed/` with a `status: done` record, taken from git history, for each task that landed and was deleted since `ec9ad2eea`: 2521.07, 2580, 2581, 2582, 2590, 2593, 2594, 2595, 2596, 2598, 2601. TASK-2604 and TASK-2605 never existed on `main`, so they have no record to restore.
- Remove TASK-2571. TASK-2593 already delivered its behaviour.

## Out of scope

- Restoring the older completed/archive files that TASK-2521.07 deleted.
- The `>-` Mission title bug (TASK-2612).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Landing a mission moves its task file to backlog/completed/ with status done, in the landed squash commit
- [ ] #2 No selfHostedCloseout setting, isSelfHostedTaskCloseout helper or retainLegacyRecord option remains in src, config, docs or tests
- [ ] #3 A backlog/tasks/ copy of a task that has a backlog/completed/ record on the base branch is dropped from the squash or makes landing fail closed (TASK-2534 guards active again)
- [ ] #4 backlog/completed/ holds done records for the tasks landed and deleted since ec9ad2eea
- [ ] #5 README.md and docs/config.md describe the completion move with no opt-out
- [ ] #6 TASK-2571 is removed from backlog/tasks/
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
