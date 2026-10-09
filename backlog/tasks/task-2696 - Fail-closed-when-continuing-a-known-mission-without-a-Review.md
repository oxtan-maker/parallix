---
id: TASK-2696
title: Fail closed when continuing a known mission without a Review
status: backlog
assignee: []
created_date: '2026-10-09 07:44'
labels:
  - bug
dependencies: []
priority: high
ordinal: 200008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A systematic review-resume control-flow bug explains the task-2668.08 transcript: px review --continue prints two missing-review failures, then selects a reviewer and enters round 1, finally failing to persist because no Review exists.

Confirmed source cause: ReviewRoundUseCase.continue calls clearHumanIntervention and invalidateResolvedBlocker before loading the review. Its guard rejects only when BOTH persisted state is absent AND the mission is unknown; a known mission with no review passes. ReviewWorkflowAdapter discards the helper results. Both helpers report failure via exit(1) and return failure results; the composed CLI supports non-terminating exit callbacks, so reporting failure does not reliably stop dispatch. prepareStart skips handoff on continue unless an existing review qualifies for resume, allowing this invalid state to reach round persistence.

Isolated in-process reproduction against current source (no live DB/provider writes): loadRound returns null, isKnownMission returns true, helper doubles return normally; continue reaches mechanisms rather than missingReviewAggregate. Observed calls: clear, invalidate, loop mechanisms reached without a review.

The subsequent --start rejection is separately consistent with the task record: task-2668.08 is active and all three acceptance criteria are unchecked. This investigation does not establish that review state was lost or that criteria were reset. Do not bypass handoff readiness or invent approval evidence.

Investigate adjacent resume entry points for the same reliance on process termination, and verify production composition with a non-terminating exit callback. Keep the fix within existing ports/adapters; any boundary redesign requires the repository's explicit architecture decision process.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A known mission without a persisted Review is rejected once before intervention/blocker mutation, provider access, reviewer selection, agent launch, or round persistence; guidance directs the operator to --start.
- [ ] #2 Retain a focused red-to-green regression in the owning review-round suite, including non-terminating exit behavior at the CLI adapter boundary; valid existing-review continuation still works.
- [ ] #3 Audit adjacent review resume paths for ignored failure results and document confirmed scope; preserve handoff success-criteria checks and distinguish missing review from state loss.
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
