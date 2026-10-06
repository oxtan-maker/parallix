---
id: TASK-2660
title: checkpoints not investigatable on web
status: done
assignee: [custom]
created_date: '2026-10-06 10:23'
labels: []
dependencies: []
ordinal: 169008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
when clicking on a checkpoint in web, display what it is about and evidence.
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
