---
id: TASK-2602
title: ensure additions in the non-core prompts work
status: backlog
assignee: []
created_date: '2026-09-28 04:49'
labels: []
dependencies: []
ordinal: 133008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
recently I added something on the line:
"
Do not run large test coverage batched, those are run automatically by parallix at appropriate times, you running it will just double validation already done by parallix.
"

to the review prompt on main, parallel missions running by agents immediatly removed it (likely because it broke something).

Ensure adding stuff to the non-core prompts actually work and readd the addition so review agent do not run tests that parallix have already done or is opmized to run at a later stage depending on the current shift-left/shift-right optimizations that is active.
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
