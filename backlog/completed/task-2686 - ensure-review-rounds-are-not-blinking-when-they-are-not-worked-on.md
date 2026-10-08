---
id: TASK-2686
title: ensure review rounds are not blinking when they are not worked on
status: done
assignee: [codex]
created_date: '2026-10-08 05:36'
labels: []
dependencies: []
ordinal: 191008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
currently in web the blinking indicator for review rounds are blinking even when the rounds are not being worked on, sometimes even when the whole mission is not being worked on. Ensure the review rounds are only blinking when a review round is actually worked on.
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
