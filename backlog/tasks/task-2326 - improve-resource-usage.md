---
id: TASK-2326
title: improve resource usage
status: backlog
assignee: []
created_date: '2026-07-30 07:45'
labels: []
dependencies: []
ordinal: 68000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
parallix SDLC has become slow and is not cleaning up after it.

-check tmp directory for examples of things not getting cleaned up
-ensure that is cleaned up so tmp is not filling up
-inventorize last weeks 'unit tests' for test that are slow and/or not unit tests, move them to integration suite.
-if the unit tests are really hermetic, ensure they run in parallell to increase speed
-but ha hard timing on unit tests so we discover when an agent put an integration test and/or a slow test there again.
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
