---
id: TASK-2461
title: implement a better claude output visualizer
status: backlog
assignee: []
created_date: '2026-09-06 17:35'
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
claude has been running in json mode since we needed that to get telemetry. But the user experience is really crappy, its hardly possible to understand what its doing when its producing json output when its running.

Do research on how to implement this properly using in priority:

-generalized agent library so we do not have to have seperate codebases for each agent
-claude library
-hand rolled 

ensure we have functionality for displaying most things a user expect, i.e. output, tool calls, parallel agents, progress spinners, thinking etc. Do not make a minimal implementation such as the pi agent that feels like its only outputting 1/3 of the activity.

Also, we NEED to keep the telemetry and evertything else parallix needs working
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
