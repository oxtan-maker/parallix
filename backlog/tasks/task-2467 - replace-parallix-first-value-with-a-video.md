---
id: TASK-2467
title: replace parallix first value with a video
status: backlog
assignee: []
created_date: '2026-09-07 09:26'
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
replace 
--
px draft "create a hello world program"
px active
px integrate
--
in the README.md with a video showing how a user in a new directory can use parallix to create a mission, execute it, have it autoreviewed, check the diff, and integrate.

add typical use cases where the user inspects the mission before starting in the demo, use asciinema to create the recording, and finetune the replay speed of different parts so user gets enough time to observe the interesting parts but fast forward on non-interesting parts (such as when the agent implements). Convert the asciinema to suitable video format (gif/etc) for github viewing in browser with proper accessability tags
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
