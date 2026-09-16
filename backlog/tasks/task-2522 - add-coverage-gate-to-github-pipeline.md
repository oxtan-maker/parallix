---
id: TASK-2522
title: add coverage gate to github pipeline
status: backlog
assignee: []
created_date: '2026-09-16 10:13'
labels: []
dependencies: []
ordinal: 83007
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
parallix has a local coverage gate already, but no check on gitbhub actions, implement one with minimal duplicated code in a way a senior engineer would approve and ideally where coverage numbers are clearly visible when checking the github pipeline
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
