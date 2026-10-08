---
id: TASK-2678
title: improve integration testing speed
status: done
assignee: [codex]
created_date: '2026-10-07 08:50'
labels: []
dependencies: []
ordinal: 190008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Improve the speed of the 10 largest CPU consuming integration tests (check the CPU limits), do not reduce the checks on what the test should actually check but its integration tests not e2e tests.
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
