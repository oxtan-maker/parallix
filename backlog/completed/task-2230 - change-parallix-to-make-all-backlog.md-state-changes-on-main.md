---
id: TASK-2230
title: change parallix to make all backlog.md state changes on main
status: done
assignee: [codex]
created_date: '2026-07-12 04:54'
updated_date: '2026-07-12 11:07'
labels:
  - ai_sdlc
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
backlog.md does not really work well when you are changing a backlog state on a branch, to does not get picked up. Change parallix so all backlog.md task changes are done on main/featurebranch instead and then the mission branch is rebased afterwards.

Be carefule to find all reads and writes or this mission will leave parallix with regressions, which is not the purpose of this mission
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
