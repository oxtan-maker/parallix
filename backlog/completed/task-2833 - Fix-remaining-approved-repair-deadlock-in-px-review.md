---
id: TASK-2833
title: Fix remaining approved-repair deadlock in px review
status: done
assignee: [codex]
created_date: '2026-11-03 10:40'
labels:
  - bug
dependencies: []
references:
  - TASK-2829
  - TASK-2831
  - px-0024
priority: high
ordinal: 303016
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Close the remaining direct px review recovery deadlock after TASK-2829 landed. An approved mission with a pending integration gate repair is still routed through ordinary review repair, which tries to transition to active and rejects the existing approval before integration certification/retention can run.

Reproduction: px-0024 is in review with independent round-3 approval, review preparation pending, and outstanding browser-e2e repair CP-7. px review exits 1 with: Mission px-0024 review repair requires an undecided review round; its effective approval must be revoked by the operator. Evidence: px history px-0024 show run:workflow-d672cc15-1198-427b-81b4-a2f178fa1da6:stdout@0+332. The approval is intact. The missing Backlog task warning is expected for DB-owned adhoc missions.

On inspected main and installed px 1.5.473 after TASK-2829, review-loop still calls resumePendingRepair before resumeIntegrationAssessment; retained-repair invokes transitionReviewRepair(active), whose approved-round guard stops recovery. TASK-2829 improved structured failure identity and execute continuation but did not remove this direct-review gap. TASK-2831 documented the same gap and was observed archived; its record is now present in backlog/tasks again. This task explicitly tracks the remaining implementation requested by the operator; reconcile overlapping tracking rather than creating competing implementations.

Reuse the existing owners of exact-check verification, repair certification and revision-pinned integration approval retention. Simply swapping calls can still leave certification outstanding. Route an effective approved integration repair through those owners before generic review-repair transitions; preserve original approval when the patch is equivalent and require independent review through existing authority when the mission patch changes. Preserve immutable failure evidence and truthful structured stop reasons.

Do not revoke approval merely to escape routing, force a lane, manufacture verification receipts, change gates/budgets/tiers, mutate live history/statistics during verification, or create a parallel retention implementation. Keep architectural principles and human-owned landing intact. px-0024 is the blocked dependent mission.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Extend the existing review-start/retained-repair owning suite with a focused parent-red/fix-green reproduction for direct px review: review lane, effective approval, pending integration gate repair and reviewPreparationPending. No approval revocation or reviewer/implementer launch is used merely to escape the deadlock.
- [ ] #2 Direct review resumes authorized exact-check verification and repair certification through existing owners, then performs revision-pinned approval retention before generic review repair. Equivalent-patch success preserves independent approval and exposes the admitted next action; failed or missing verification preserves original structured evidence and stops accurately.
- [ ] #3 Changed mission patches retain the existing independent-review requirement. Ordinary unapproved review repairs, repeated continuation, stale revision/version checks and genuine human-only contract blockers retain their contracts. Extend owning assertions without replacing distinct coverage.
- [ ] #4 Review, execute, integrate, board and lead agree on the admitted next action for this state and reuse the typed failure contracts from TASK-2829. No human-readable diagnostic matching or duplicate retention implementation is introduced.
- [ ] #5 Manually demonstrate the public direct-review continuation and failing control in disposable isolated state; retain command output and focused regression evidence. Preserve real Mission/history/statistics and operator-owned gates, CPU budgets and verification tiers.
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
