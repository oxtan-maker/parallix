---
id: TASK-2469
title: web design tweaks
status: done
assignee: [codex]
created_date: '2026-09-07 19:16'
labels: [user_value]
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
-In the Flow section do not present any numbers with decimals
-In the running agent sections remove command sessions, i.e. 
● codex 0 command sessions => ● codex 0
-Restore X missions/wk after wip 5 · attention X
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
