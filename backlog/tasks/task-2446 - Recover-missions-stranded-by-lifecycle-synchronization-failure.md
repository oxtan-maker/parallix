---
id: TASK-2446
title: Recover missions stranded by lifecycle synchronization failure
status: backlog
assignee: []
created_date: '2026-08-30 17:05'
labels:
  - ai_sdlc
  - bug
  - workflow
  - persistence
dependencies: []
priority: high
---

## Description

TASK-2438 completed its implementation and verification in its mission
worktree, but its execute operation ended with `legacy task lifecycle
synchronization failed`. The worktree task is `active`; the operator database
has the same mission persisted as closed `done` (version 18). The main task
record was left at a different lifecycle state.

Parallix has no supported mission restart or reopen command. The domain rejects
all commands after a closed mission, so an operator cannot recover this state
without editing SQLite directly. Provide an explicit, audited recovery path or
reconcile the conflicting task and aggregate states safely. It must preserve
history and never silently reopen an actually integrated mission.

## Acceptance Criteria

- [ ] #1 A detected task/aggregate lifecycle conflict reports the exact conflicting states and a supported recovery action.
- [ ] #2 An interrupted, non-integrated mission can resume its existing lifecycle without direct database edits.
- [ ] #3 A genuinely closed and integrated mission cannot be reopened by recovery.
- [ ] #4 TASK-2438's worktree and durable aggregate reconcile through the supported path.

## Definition of Done

- [ ] #1 A red-to-green reproduction creates the conflicting task/aggregate states.
- [ ] #2 Focused lifecycle and persistence tests pass.
- [ ] #3 Static-analysis passes.
