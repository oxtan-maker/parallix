---
id: TASK-2511
title: clean up repo noice
status: done
assignee: [custom]
created_date: '2026-09-14 13:56'
labels:
  - user_value
dependencies: []
ordinal: 77007
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
while agents really like having access to all information about missions, the way we have implemented leaves a LOT of files on disk, a significant part of the repo is now meta-data.

Revisit that trust marker and all the files that currently create disk footprints as parallix does it currently to create an updated proposal and changed ADR:s for a total migration of most of the footprint that can be defendible into db. This is an investigation mission only, no implementation.
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
