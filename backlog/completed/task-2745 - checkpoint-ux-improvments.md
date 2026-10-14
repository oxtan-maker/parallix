---
id: TASK-2745
title: checkpoint ux improvments
status: done
assignee: [codex]
created_date: '2026-10-14 12:43'
labels: []
dependencies: []
ordinal: 240008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
ensure that checkpoint show (all of them directly, not just when they are implemented), that the checkpoint we are working on is blinking (same as review) IFF the card is being worked on, and the the z-axis placement is correct (so its not over dialogs such as tmux or mission edit)
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
