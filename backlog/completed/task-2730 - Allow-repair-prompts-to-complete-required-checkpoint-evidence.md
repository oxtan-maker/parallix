---
id: TASK-2730
title: Allow repair prompts to complete required checkpoint evidence
status: done
assignee: [claude]
created_date: '2026-10-12 08:10'
labels:
  - bug
dependencies: []
priority: high
ordinal: 228008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-2726 recovered its implementation and passed all declared gates, but handoff stopped at Version 38: original CP-3 was missing while the dedicated repair prompt authorized writes only to harness-created CP-5. The prompt simultaneously required every remaining planned checkpoint before handoff, forcing an unnecessary operator authority decision. Update repair prompt generation so agents can complete evidence for required existing checkpoints within the locked mission scope and affected criteria. Keep explicit operator-only decisions, gate invariants, evidence freshness and independent approval requirements intact. Reproduction source: src/application/rebound-prompts.ts, the Write only authorized repair evidence instruction; recovery guidance: src/application/typed-mission-recovery-advice.ts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A repair launch with an unfinished original checkpoint and a harness repair checkpoint gives consistent instructions authorizing the evidence writes needed for handoff within the locked scope.
- [ ] #2 Repair guidance preserves earlier valid criterion evidence and requires fresh verifiable evidence for affected criteria without unnecessary restatement.
- [ ] #3 No permission is granted to weaken gates, modify locked criteria or scope, self-approve review, or bypass genuine operator-only decisions.
- [ ] #4 The owning prompt and repair contract suites retain a focused red-to-green regression for the TASK-2726 CP-3 versus CP-5 conflict.
- [ ] #5 Focused checks and static analysis pass; manually exercise generated recovery guidance through the public workflow with isolated fixtures.
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
