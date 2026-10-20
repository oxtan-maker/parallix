---
id: TASK-2791
title: >-
  Serialize verification gates across worktrees with shared leases and enable
  for Parallix
status: backlog
assignee: []
created_date: '2026-10-20 02:21'
labels: []
dependencies: []
priority: high
ordinal: 272008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-2781 integration failed when workflow process cases exceeded their unchanged 3500 ms wall deadlines during concurrent covered gate runs. A focused covered run of both suites passed all three cases (2127.887173 ms, 2551.733129 ms, 1404.821198 ms). Contention is a plausible contributor, not a proven root cause. Add an operator configuration option for exclusive gate execution across concurrent Parallix processes and mission worktrees, reusing the existing shared lease infrastructure and process identity/liveness handling. Enable the option in the Parallix repository configuration so Parallix develops itself with isolated gate runs.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Expose a validated operator configuration option for exclusive gate execution; preserve current behavior when disabled and document its scope and waiting behavior.
- [ ] #2 When enabled, all configured verification gate entry points acquire the same shared exclusive lease across mission worktrees and concurrent px processes before starting gate children. Other gate invocations wait without overlapping; independent implementation work can continue.
- [ ] #3 Reuse the existing lease infrastructure and typed application ports with composition-owned wiring. Use a shared resource scope that covers all Parallix self-development worktrees; do not introduce a competing lock implementation or reuse agent capacity in a way that blocks agents needed by a running gate.
- [ ] #4 Release ownership only after gate descendants settle on success, failure, cancellation and interruption; reclaim abandoned ownership using existing process identity and liveness rules. Nested gate invocation must not deadlock or bypass isolation.
- [ ] #5 Enable the new option in Parallix own repository configuration and verify that inherited mission worktree configuration uses it. Preserve operator gate commands, membership, deadlines and CPU budgets.
- [ ] #6 Extend existing owning suites to prove cross-process exclusion, waiting progress, cancellation, stale-owner recovery and disabled behavior. Keep each modified integration test within 3.5 seconds and follow ADR 0057.
- [ ] #7 Manually exercise two concurrent public gate invocations using disposable repositories and shared lease state; show non-overlap and progress after release, then clean up without changing real operator data.
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
