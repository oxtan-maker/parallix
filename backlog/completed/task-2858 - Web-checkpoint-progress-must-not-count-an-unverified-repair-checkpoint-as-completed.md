---
id: TASK-2858
title: >-
  Web checkpoint progress must not count an unverified repair checkpoint as
  completed
status: done
assignee: [codex]
created_date: '2026-11-16 07:14'
labels:
  - bug
dependencies: []
priority: high
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When an integration gate fails and the mission returns to active, Parallix opens repair checkpoint(s) for the failure. The web checkpoint progress bar does not change: a mission that reached integration shows N/N completed, and after the repair checkpoint opens it shows (N+k)/(N+k) with the completion check mark, so the operator sees no sign that repair work is outstanding.

Observed cause: a newly opened repair checkpoint is seeded with Goal Check rows carried from the last verified checkpoint (TASK-2755). The board projection (checkpointEvidence in src/application/projections/mission-board.ts) decides completion from isPlannedCheckpoint (src/domain/checkpoint.ts), which only checks for the absence of Goal Check rows. A repair checkpoint with carried rows is therefore projected as `completed` the moment it opens, although its repair is neither evidenced nor verified (repair.evidenceRecorded and repair.verified are false). It is never projected as `current` or `future`, and the web track (web/src/checkpoint-pips.tsx) counts only `completed`. The domain half was reproduced with a scratch script: one carried row, isPlannedCheckpoint returns false.

Desired outcome: a repair checkpoint counts toward completion only once its repair is verified. While the mission is active and the repair is open it is shown as the current checkpoint; in other lanes it is shown as not yet completed. The progress bar therefore drops below full and the current-checkpoint label names the repair when a gate failure returns the mission to active, and returns to full only after certification.

Scope notes: fix the projection derivation, not the carried-row seeding, which other consumers rely on (evidence coverage, repair certification). Other callers of isPlannedCheckpoint (latestEvidencedCheckpoint, missing-evidence checks) must keep their behavior unless the reproduction proves otherwise. Related earlier work: TASK-2773.04 (progress track), TASK-2776 (checkpoint labels and current work agree), TASK-2755 (carried rows). Independent of TASK-2857, which unifies the repair-checkpoint opening path.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A focused reproduction fails on current behavior: a mission with N evidenced checkpoints plus a newly opened unverified repair checkpoint carrying carried Goal Check rows projects that repair checkpoint as completed
- [ ] #2 With the fix, the same mission projects the open repair checkpoint as current when the mission is active and as not completed in other lanes
- [ ] #3 The web progress track for that mission shows fewer completed checkpoints than planned and names the repair checkpoint as current
- [ ] #4 After the repair is verified, the checkpoint projects as completed and the track returns to full
- [ ] #5 A single failed gate and a multi-gate failure both project every open repair checkpoint as not completed until its own repair is verified
- [ ] #6 A repair checkpoint with a recorded blocker is not projected as completed
- [ ] #7 Existing checkpoint projection behavior for non-repair checkpoints, legacy documents and the other isPlannedCheckpoint callers is unchanged
- [ ] #8 The reproduction is retained in the existing board projection suite and the web board rendering suite that own these assertions
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
