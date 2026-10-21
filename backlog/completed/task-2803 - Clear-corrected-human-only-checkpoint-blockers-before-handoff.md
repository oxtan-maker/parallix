---
id: TASK-2803
title: Clear corrected human-only checkpoint blockers before handoff
status: done
assignee: [codex]
created_date: '2026-10-20 19:36'
labels:
  - bug
dependencies: []
priority: high
ordinal: 282008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-2802 reproduced a circular workflow failure. An implementer correctly stopped at a planned CP-2 requiring an operator coverage-design decision. The operator recorded that decision with px checkpoint record. A fresh repair read stale prior run output, falsely reported the decision absent with px checkpoint report-invalid-contract, and created CP-5 repair.blocker. The documented supported correction is px checkpoint record --force, but recording CP-5 is rejected because it is treated as the final checkpoint and demands all unfinished CP-3/CP-4 criteria. The operator cannot clear the false blocker until the blocked implementation is already complete. Existing TASK-2799 only covers visibility of human blockers, not correcting a resolved or false blocker; TASK-2802 owns repair supersession, not checkpoint-blocker clearing. Preserve real human-only blockers, evidence validation, and repair truth. No history rewrite, gate or budget change.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Focused parent-red/fix-green coverage proves a recorded operator correction can clear a false human-only repair blocker before unfinished later planned checkpoints exist, while the blocker history remains durable and visible.
- [ ] #2 The clearing action requires operator authority and fresh Mission version checks; it must not clear an unresolved blocker, mark a repair verified, manufacture checkpoint success or bypass evidence and handoff validation.
- [ ] #3 After a cleared blocker, normal implementation can resume from the first incomplete planned checkpoint; genuine missing evidence remains reported and automatic recovery does not invent an operator decision.
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
