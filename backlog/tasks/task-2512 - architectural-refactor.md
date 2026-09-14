---
id: TASK-2512
title: architectural refactor
status: backlog
assignee: []
created_date: '2026-09-14 14:02'
labels: []
dependencies: []
ordinal: 78007
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
turn that 100 KB integrate.ts into a genuinely thin adapter and eliminate the application→adapter exception
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
