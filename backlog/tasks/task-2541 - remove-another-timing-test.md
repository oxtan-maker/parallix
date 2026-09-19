---
id: TASK-2541
title: remove another timing test
status: backlog
assignee: []
created_date: '2026-09-19 10:18'
labels: []
dependencies: []
ordinal: 88007
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
github is a very slow pipeline, remove all tests that check timings from being run on github, example: 
✖ failing tests:

test at test/task-1039-integrate.test.ts:1:10834
✖ integrate aborts before merge when a pre-integration gate fails (1231.664883ms)
  'test timed out after 1000ms'
Error: Process completed with exit code
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
