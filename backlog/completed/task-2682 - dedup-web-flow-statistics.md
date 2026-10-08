---
id: TASK-2682
title: dedup web flow statistics
status: done
assignee: [codex]
created_date: '2026-10-07 13:26'
labels: []
dependencies: []
ordinal: 193008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
on web there are lead time measuments on how much time a task spends in each lifecycle part. Problem is when a mission is sent back it can be several times in each part, current statistics do not represent this well since it then does not add up.

Example, when a mission is in active 3 times it should contribute with the sum of those 3 times to the active stats in flow
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
