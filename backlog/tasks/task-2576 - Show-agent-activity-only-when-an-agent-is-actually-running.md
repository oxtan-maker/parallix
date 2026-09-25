---
id: TASK-2576
title: Show agent activity only when an agent is actually running
status: backlog
assignee: []
created_date: '2026-09-25 12:07'
labels:
  - bug
  - web
  - workflow
dependencies: []
priority: high
ordinal: 108008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The web board currently shows three live px integrate missions (TASK-2554, TASK-2560, TASK-2574) with a blinking dot and no implementer. Distinguish deterministic Parallix work from agent execution, and investigate why a running agent is not identified.
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
