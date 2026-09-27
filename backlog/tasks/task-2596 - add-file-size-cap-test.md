---
id: TASK-2596
title: add file size cap test
status: backlog
assignee: []
created_date: '2026-09-27 16:35'
labels: []
dependencies: []
ordinal: 127008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
add a test that fails for each source file >500 lines in a way the agents understand that when it fails they should not just split the file but do refactoring in such a way that a senior engineer would agree with it. If possible, make it part of the unit test suite (shift left), otherwise the appropriate integration suite. Add exceptions for the files in the repo already failing on this requirement so I in other missions can gradually work off this debt and reduce the exceptions.
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
