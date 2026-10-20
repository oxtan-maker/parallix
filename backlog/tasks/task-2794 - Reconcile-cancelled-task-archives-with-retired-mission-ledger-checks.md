---
id: TASK-2794
title: Reconcile cancelled task archives with retired mission ledger checks
status: backlog
assignee: []
created_date: '2026-10-20 09:30'
labels:
  - bug
dependencies: []
priority: high
ordinal: 274008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Production archiveTask in src/adapters/backlog/task-transitions.ts:103-122 intentionally writes cancelled task-provider history to backlog/archive/tasks; docs/tui-board.md documents that behavior. test/unit/repository/mission-directory-free-workflow.test.ts rejects all files under backlog/archive. task-2785 CP-4 retains this exact failure for operator-archived task-2767 (commit 2eefe2555d6bc85cb94fd9b10e36431e3b768bfc). This blocks unrelated handoffs. Related historical TASK-2712 prohibited retired ledger roots. Preserve operator archive history, hidden card semantics and verification gates; distinguish legitimate task-provider archives from retired Mission ledgers.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A focused regression demonstrates legitimate cancelled task archives coexist with the retired Mission-ledger prohibition.
- [ ] #2 Archived tasks remain hidden and their history is preserved; retired workflow metadata remains rejected.
- [ ] #3 Owning tests and live guidance agree with the production archive contract without deleting operator data or changing gates.
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
