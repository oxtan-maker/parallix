---
id: TASK-2842
title: Collapse historical double-collected lane transitions in lifecycle reads
status: done
assignee: [codex]
created_date: '2026-11-06 08:53'
labels:
  - bug
  - ai_sdlc
dependencies: []
priority: low
ordinal: 308016
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
board_lane_events holds some lifecycle transitions twice: the same mission, from status, to status and trigger, at the same timestamp, under two idempotency keys. Observed pairs are handoff-<mission> with round-open:<mission>:round-N or active-review:<mission>:<timestamp>.

Measured on an isolated copy of the operator database (2026-11-05 snapshot), pairing rows within five seconds: 111 active->review submit-for-review, 27 review->active request-changes and 3 review->integration approve. By month: 2026-08 has 102, 27 and 3; 2026-09 has 8 submit-for-review; 2026-10 has 1. The newest is task-2709 on 2026-10-10. This looks like an older writer overlap that has stopped, so it is lower priority than the live double counts handled in TASK-2836.

Effect: older cohorts can gain extra human handoff episodes from duplicate approve rows, extra lifecycle moves and zero-length dwell intervals. Reads that key on idempotency keys treat the pair as two events.

Collapse the pairs at the shared lifecycle read so board and px stats agree. Do not rewrite or delete the live operator database as part of this mission. First confirm no current writer still emits both keys; if one does, fix that writer too. Discovered during adversarial review of TASK-2836.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A focused reproduction is red on parent behavior and green with the fix, retained in the owning suite: one transition stored under two keys counts once.
- [ ] #2 Board FLOW and px stats read the same collapsed lifecycle history; distinct transitions at nearby times stay separate.
- [ ] #3 No current writer emits two rows for one transition, proven from source and fresh data.
- [ ] #4 No live database rewrite; before and after counts for affected historical cohorts are recorded as mission evidence on an isolated copy.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
