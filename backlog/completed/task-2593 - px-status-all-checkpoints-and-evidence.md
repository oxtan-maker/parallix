---
id: TASK-2593
title: px status all checkpoints and evidence
status: done
assignee: []
created_date: '2026-09-27 15:38'
labels: []
dependencies: []
ordinal: 124008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
currently px status just shows latest checkpoint when a mission is active+, fix that so human has a good ux to review the missions.
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
