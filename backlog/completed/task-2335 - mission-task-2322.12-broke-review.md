---
id: TASK-2335
title: mission/task-2322.12 broke review
status: backlog
assignee: [codex]
created_date: '2026-08-03 09:13'
updated_date: '2026-08-03 16:39'
labels:
  - ai_sdlc
  - bug
dependencies: []
ordinal: 70900
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
read the use cases on how review should work, and then ensure the bug that 2322.12 introduced that now every agent reviews its own PR all the time is fixed so we are back to applying the config and randomly selecting a reviewer agent from a different family except in corner cases is restored
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
