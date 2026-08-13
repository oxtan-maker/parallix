---
id: TASK-2374
title: bubblewrap guard
status: active
assignee: [claude]
created_date: '2026-08-13 18:31'
labels: [user_value]
dependencies: []
ordinal: 93912
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
currently agents have no sandboxing. This is by intent since standard agent sanboxing destroys flow. However, lets ensure we have some sanboxing forcing agent to only work in the directories they should in worktrees + other dirs mentioned by the prompts when bubblewrap is availibe. If bubblewrap is not availible post a warning.
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
