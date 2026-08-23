---
id: TASK-2406
title: px draft is not detected in ui
status: refined
assignee: [custom]
created_date: '2026-08-23 07:50'
labels: [user_value, bug]
dependencies: []
ordinal: 115917
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
when we start px draft that is not detected in px ui. Also if you start from a worktree not everything may be detected, which is needed because when I use parallix to develop paralllix I need to test the code for total ui from within the worktree before merging (potentially broken) code to main.
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
