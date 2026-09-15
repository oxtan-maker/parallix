---
id: TASK-2519
title: Shift rigth
status: done
assignee: [claude]
created_date: '2026-09-15 10:46'
labels: [ai_sdlc]
dependencies: []
ordinal: 81007
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
while having a way to run codeQL locally and fixing and wiring it up on the local integration steps was the correct call the time it has slowed down the development A LOT, remove the automatic codeQL check from the scripts that parallix runs when developing itself upon integration
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
