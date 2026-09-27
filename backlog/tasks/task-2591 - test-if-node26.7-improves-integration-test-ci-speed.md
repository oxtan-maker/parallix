---
id: TASK-2591
title: test if node26.7 improves integration test ci speed
status: backlog
assignee: []
created_date: '2026-09-27 08:46'
labels: []
dependencies: []
ordinal: 122008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Determine whether Node 26.7+ native coverage with --test-coverage-include-all is semantically equivalent to the historical c8 coverage contract; if so, standardize Parallix verification on that path and eliminate c8/raw V8 machinery. If not, retain only the minimum c8 machinery necessary for the demonstrated gap
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
