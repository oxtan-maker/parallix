---
id: TASK-2666
title: minor ux issues web
status: backlog
assignee: []
created_date: '2026-10-06 11:30'
labels: []
dependencies: []
ordinal: 174008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
review color boxes should be yellow if the review did not pass green if its completed, and blinking green if this is the round that is running.

there is some agent that has halucinated some idle/work running inside the web card, we have the fans for that indication (they work do not agent slop them unless you find a confirmed bug).
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
