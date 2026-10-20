---
id: DRAFT-001
title: Resume retained review repairs correctly from active
status: backlog
assignee: []
created_date: '2026-10-20 09:30'
updated_date: '2026-10-20 09:34'
labels: []
dependencies: []
priority: high
ordinal: 275008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Review repairs intentionally transition review to active. The advertised px active command must resume that retained repair and progress through verification and independent review. Observed px lead --once invokes px active for px-0008 and task-2785, but active stops immediately at retained invalid-contract checkpoints; explicit px review --continue enters the retained repair workflow. Determine whether these are appropriately human-only blockers or an active-flow continuation defect, and retain actionable diagnostics in either case. Preserve review-to-active semantics, shared board action display/dispatch ownership, explicit operator acknowledgment, independent review and gates. Existing TASK-2759 concerns explicit continuation acknowledgment; verify overlap with that and px-0017 before implementation. Operator clarified that active is the intended repair lane; changing board routing to review is not the requested fix.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An owning regression proves a retained review repair can resume from active and complete its required checks and independent review.
- [ ] #2 Active handles repair context and supported operator acknowledgments correctly; genuine human-only blockers remain explicit and automation never synthesizes acknowledgment.
- [ ] #3 Review-to-active transitions and shared board/lead actions remain intact; fresh execution, checkpoints, approvals and gate requirements retain their contracts.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Documentation review: README core workflow and docs/operator-setup.md explicitly require direct operator continuation to acknowledge invalid-contract stops; automatic/nested continuation must not acknowledge. Observations so far are explained by recorded human-only blockers, not proof of an active recovery defect. Withdraw confirmed-bug classification pending a focused reproduction of a valid acknowledged repair that px active cannot resume. Keep review-to-active design unchanged.
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
