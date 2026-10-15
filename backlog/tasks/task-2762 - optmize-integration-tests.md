---
id: TASK-2762
title: optmize integration tests
status: backlog
assignee: []
created_date: '2026-10-15 11:27'
labels: []
dependencies: []
ordinal: 250008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
bring all integration tests and their limits below the limit so they are run on local integration checks.

DO NOT RAISE LIMIT for local integration checks
do not remove any significant test assertion or lower the defences
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
