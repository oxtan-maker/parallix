---
id: TASK-2831
title: Resume approved integration repairs through direct review
status: backlog
assignee: []
created_date: '2026-11-02 19:59'
labels:
  - bug
dependencies: []
references:
  - TASK-2829
  - px-0024
priority: high
ordinal: 302016
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Fix direct px review continuation for an approved mission with an outstanding integration gate repair. Preserve the existing independent approval while the authorized exact check is certified and approval retention is assessed through the existing integration owners.

Observed on px-0024 on 2026-11-02: mission lane review, round 3 approved by custom, pending browser-e2e repair at CP-7, review preparation pending. Running px review exits 1 with: Mission px-0024 review repair requires an undecided review round; its effective approval must be revoked by the operator. Retained public evidence: px history px-0024 show run:workflow-d672cc15-1198-427b-81b4-a2f178fa1da6:stdout@0+332. The existing approval remains intact; the missing Backlog-file warning is expected for this DB-owned identity.

The review loop calls resumePendingRepair before resumeIntegrationAssessment. Generic retained repair invokes transitionReviewRepair(active), which rejects the still-approved review before integration retention can run. Merely reversing the calls may still leave certification unproven: reuse the owners of exact-check verification, repair certification and revision-pinned approval retention, with correct ordering and admission. Inspect current implementations before changing them.

Related TASK-2829 covers structured failure propagation and pending repair continuation, especially execute. Its inspected worktree still retains this direct-review ordering. Coordinate with its final implementation and reuse its structured contracts; this task owns the uncovered direct px review regression and routing. DRAFT-001 concerns active review repairs and invalid-contract acknowledgments, a distinct case.

Scope excludes px-0024 success-exit/closed-card implementation, forced lane changes, revoking approval merely to escape routing, fabricated gate receipts, live Mission/history/statistics edits, operator gate or CPU-budget changes, and architectural-principle changes. Preserve independent review when the mission patch actually changes and human-owned landing.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An isolated regression in the existing review-start/retained-repair owning suite fails on the parent for direct px review with an approved round, pending integration gate repair, review lane and reviewPreparationPending; it passes with the fix without revoking approval or launching a reviewer merely to escape the deadlock.
- [ ] #2 Direct px review resumes authorized exact-check certification and existing approval-retention assessment before any generic review-repair transition. Successful equivalent-patch recovery preserves the approval and admits the correct next action; missing or failed verification stops accurately with original structured evidence.
- [ ] #3 Changed mission patches still use the existing retention owner to require independent review. Unapproved ordinary review repairs, genuine human-only contract stops, repeated continuation and stale revision/authority checks retain their behavior.
- [ ] #4 Review, execute, integrate, board and lead expose consistent admitted next actions for the affected state; reuse existing typed failure and repair contracts, including TASK-2829 changes, without prose-based failure routing or a parallel retention implementation.
- [ ] #5 Manually demonstrate the public direct-review continuation and a failing control against disposable isolated state. Preserve real Mission/history/statistics, retain focused parent-red/fix-green evidence in owning suites, and leave operator gates, budgets and verification-tier membership unchanged.
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
