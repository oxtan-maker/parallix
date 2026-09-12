---
id: TASK-2483
title: update review instructions
status: done
assignee: [claude]
created_date: '2026-09-11 08:03'
labels:
  - ai_sdlc
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
we have a lot of guards and checkpoints in parallix and in the mission.md section that gets validated automatically + dynamic config related to the test pyramid. Ensure that reviewer agents gets that information in their promts in a token efficient manner so they do not re-run the controls again when they are already completed.
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
