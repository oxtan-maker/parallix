---
id: TASK-2746
title: finish typescript migration
status: done
assignee: [custom]
created_date: '2026-10-14 13:52'
labels: []
dependencies: []
ordinal: 237008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
remove all typescript linting exceptions and complete the typescript migration, remove the custom error controls after that (it should be covered by standard linting/static check only).
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
