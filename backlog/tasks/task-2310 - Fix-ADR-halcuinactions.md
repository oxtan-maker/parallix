---
id: TASK-2310
title: Fix ADR halcuinactions
status: refined
assignee: [custom]
created_date: '2026-07-24 04:44'
labels: []
dependencies: []
ordinal: 66000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The future direction of the terminal ui is all terminal commands have the same stack (Ink), so we don't have 2 competing terminal frameworks that will be tech debt.

Change the ADR:s to reflect this, make the ADR:s reflect current forwardlooking statements rather than accumulate slop history.
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
