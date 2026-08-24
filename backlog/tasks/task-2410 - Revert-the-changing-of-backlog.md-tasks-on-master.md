---
id: TASK-2410
title: Revert the changing of backlog.md tasks on master
status: backlog
assignee: []
created_date: '2026-08-24 15:13'
labels: []
dependencies: []
ordinal: 117917
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
there is a task (and some folluwup tasks to fix halucinations) to ensure all changes in the parallix workflow when it comes to backlog.md task states are done on primarybranch. This is good since backlog.md has a lot of bugs when it comes to handling changes on worktrees but now that the px ui is working well we don't need workarounds for that anymore (its also very bad since the main branch contains massive amount of backlog.md noice). Find the tasks that changed this behaviour, revert them in git if applicable, otherwise make the changes to rollback with the current code. Do not forget to ensure all new code (ui for example) that did not exist back then is working in the new state where most of the backlog.md transitions are performed in the worktree only. That should work even if the ui is started from a worktree (which is a common scenario when testing ui changes for agent halucinations before merging a mission).
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
