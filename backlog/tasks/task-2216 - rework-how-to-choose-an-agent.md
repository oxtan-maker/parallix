---
id: TASK-2216
title: rework how to choose an agent
status: backlog
assignee: []
created_date: '2026-07-11 04:32'
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
ensure there is a config to set the maximum amount of running custom instances at the same time, guarded with a semaphore and ensure that there is also a reset on that when there are bugs/hangs

when custom reaches its max make the agent selector choose another agent instead. The intent of this mission is to ensure we are getting out of current blocker for mission velocity, which is GPU compute.
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
