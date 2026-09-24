---
id: TASK-2556
title: improve the speed of px status
status: backlog
assignee: []
created_date: '2026-09-23 04:53'
labels: []
dependencies: []
ordinal: 93008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
I expect px status <slug> to run on <200ms on a normal mission, profile npm run dev -- status <this slug> to find out what is blocking that and fix it without breaking any functionality or parallix
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
