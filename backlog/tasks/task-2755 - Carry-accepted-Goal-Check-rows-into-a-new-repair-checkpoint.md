---
id: TASK-2755
title: Carry accepted Goal Check rows into a new repair checkpoint
status: backlog
assignee: []
created_date: '2026-10-15 11:00'
labels:
  - ai_sdlc
dependencies: []
priority: medium
ordinal: 245008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`RepairCheckpointService.open` (`repair-checkpoint-service.ts`) creates a new repair checkpoint with an empty Goal Check, unless the same incident already has one. The implementer then records only the repair evidence. The new checkpoint becomes the latest one, so it covers one criterion while the complete Goal Check accepted in the previous round sits on an older checkpoint.

The general reviewer then requests changes for this alone. task-2722 r7 and r9 were both sent back with "latest checkpoint CP-n contains only criterion 1 ... carry the applicable CP-m rows into the latest checkpoint; no implementation change is requested". A text search over the general-reviewer findings decided since 2026-10-01 matched latest-checkpoint gaps in 17 rounds; not every match is necessarily this cause. Each such round costs an implementer and reviewer cycle. It is also the most common cause of classifier clears that the reviewer would send back on integration repairs (px-0010 `nf/`, README section 18).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Opening a new repair checkpoint copies the Goal Check rows of the latest non-repair (or last verified) checkpoint. Each copied row is marked as carried from its source checkpoint name and keeps its evidence unchanged.
- [ ] #2 Repair evidence recorded on the checkpoint adds rows or replaces the row for the same criterion. It does not delete other carried rows. The checkpoint shows which rows are carried and which are fresh.
- [ ] #3 Repair verification still requires fresh authorized repair evidence; carried rows alone never satisfy `verify`.
- [ ] #4 Reopening the same incident keeps its existing rows (today's behaviour).
- [ ] #5 Focused owning-suite tests cover: carry on open; replacing a row for the same criterion; verify refusing when only carried rows exist; and reopening the same incident.
- [ ] #6 Manual end-to-end check: after a real or fixture integration repair, `px status <mission> --json` shows a latest checkpoint covering every success criterion.
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
