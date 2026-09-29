---
id: TASK-2609
title: px classification set has bad ux
status: backlog
assignee: []
created_date: '2026-09-29 04:44'
labels: []
dependencies: []
ordinal: 137008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
px classification set --value <type> --expected-version <n>

--expected-version is a parameter that is creating friction, remove that and all reference to it and discover that automatically
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
