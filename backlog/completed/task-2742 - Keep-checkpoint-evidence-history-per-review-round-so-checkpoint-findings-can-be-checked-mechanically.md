---
id: TASK-2742
title: >-
  Keep checkpoint evidence history per review round so checkpoint findings can
  be checked mechanically
status: done
assignee: [codex]
created_date: '2026-10-14 10:05'
labels:
  - ai_sdlc
dependencies: []
priority: medium
ordinal: 237008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`px checkpoint record` replaces a checkpoint's rows by name, and `mission.checkpoint` events in `operational_history` stopped on 2026-09-10. So the checkpoint and Goal Check state that a reviewer saw in a round cannot be recovered afterwards. Only rows that were never re-recorded keep their `recorded_round` tag.

This blocks px-0010 option A: deterministic checks for review findings about process and evidence, not code. Examples:
- the latest checkpoint has no Goal Check row for each success criterion (task-2711 F2, task-2722 F4, px-0010 F3);
- the gate proof cites a commit that is not an ancestor of the reviewed HEAD (task-2622.18 F2);
- the evidence cites a nonexistent commit (task-2622.18 F3);
- there is no passing evidence for the final tree on a declared gate (task-2622.18 F1).

In the px-0010 development split (23 findings re-review rounds, ../parallix-research/px-0010/findings/), about 10 of 32 findings are of this kind. In about 5 rounds every finding is deterministically checkable. None of these can be replayed today, because round-time checkpoint state is lost. (Research notes: ../parallix-research/px-0010/README.md sections 7 (I12) and 12.)

Keep an append-only history of checkpoint records, and bind each review round to the checkpoint state it was judged against. Current-state reads keep their behaviour, so new review rounds produce replayable data for the option A validation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Recording a checkpoint whose name already exists appends a new version instead of overwriting; current-state reads (px status, review packets, handoff checks) still return the latest version of each checkpoint.
- [ ] #2 Each stored checkpoint version keeps its Goal Check rows, the time it was recorded, the review round it was recorded in, and the mission revision it was recorded at.
- [ ] #3 Each review round records which checkpoint versions were current when the round started, so the state that round saw can be read back exactly afterwards.
- [ ] #4 px can show a mission's checkpoint history, and the state at a given review round, read-only without direct DB access.
- [ ] #5 Existing rows migrate without loss: each becomes the first version of its checkpoint, with its known recorded_round.
- [ ] #6 Focused owning-suite tests cover: re-recording keeps the earlier version, latest-state reads are unchanged, a round's start state is reproduced after a later re-record, and migration of existing rows.
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
