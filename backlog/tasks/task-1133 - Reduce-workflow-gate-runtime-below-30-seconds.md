---
id: TASK-1133
title: Reduce workflow gate runtime below 30 seconds
status: backlog
assignee: []
created_date: '2026-05-23 06:52'
updated_date: '2026-06-13 18:13'
labels:
  - workflow
  - performance
  - testing
dependencies: []
priority: low
ordinal: 7500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The workflow verification gate is taking far longer than 30 seconds in practice. Spot-checks show this is not introduced solely by task-1063: `workflow/test/active.test.js` takes about 16.0s on `main` and about 18.5s on `mission/task-1063`. The full `workflow/lib/coverage-gate.js` run is timing out locally while executing the covered test suite. This follow-up should profile the slowest workflow shards, separate baseline cost from recent regressions, and reduce authoritative workflow verification to a sub-30-second target or explicitly redesign the gate if that target is unrealistic.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Measure current workflow gate runtime on main and on the latest mission branches using reproducible local commands
- [ ] #2 Identify the top contributors to workflow gate time including slow test files and coverage-gate overhead
- [ ] #3 Fix any clear regressions in workflow runtime introduced after the known green baseline
- [ ] #4 Reduce the authoritative workflow verification path to under 30 seconds on a representative developer machine or document and implement a narrower gate that meets the same confidence bar
- [ ] #5 Document the before and after timing evidence and any remaining tradeoffs
<!-- AC:END -->
