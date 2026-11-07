---
id: TASK-2843
title: >-
  Complete TASK-2615 checkout-cache lifecycle without losing warm-cache
  performance
status: backlog
assignee: []
created_date: '2026-11-06 13:58'
updated_date: '2026-11-06 14:01'
labels:
  - bug
dependencies: []
priority: high
ordinal: 309016
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Regression provenance is established, but the useful behavior must be preserved. Commit b0cb0710f288fe31ba3f603db773257846ba5931 (TASK-2615, 2026-09-30) replaced one globally shared tsx cache—which had grown to roughly 130,000 entries and made module-cache scans cost more CPU than some tests—with a stable /tmp/px-tmp-<checkout-hash> root per checkout. That isolation and warm-cache reuse are valuable. The defect is that TASK-2615 added creation and reuse without a retirement owner, so every disposable mission worktree can leave its cache forever. Commit d90e1da4448a79e065a396076792474b400c0ded (TASK-2816, 2026-11-03) correctly moved bulky coverage scratch toward disk-backed storage and added owner-aware recovery, but deliberately preserved shared caches and only reclaims registered child scratch. On 2026-11-06, /tmp had 1,784 top-level entries older than 24 hours and only 66 MB free of 16 GB, blocking task-2836 agent-smoke admission. Complete the existing checkout-cache lifecycle: retain isolated warm caches while their checkout is active, remove them through the existing worktree/checkout retirement owner, and recover abandoned cache roots only with durable ownership and liveness proof. Do not roll back to one global tsx cache. Do not add a broad /tmp scavenger, TTL daemon, parallel cleanup subsystem, or deletion authority over unrelated data.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A focused red-to-green reproduction proves repeated creation and retirement of disposable mission worktrees leaves one reusable cache while each checkout is active and no checkout-specific px-tmp root after that checkout is retired.
- [ ] #2 Per-checkout tsx and compile-cache isolation and warm reuse from TASK-2615 remain effective; the implementation does not return to the globally shared cache whose unbounded entry scan caused the original CPU regression.
- [ ] #3 The existing authoritative worktree/checkout cleanup path owns normal cache retirement; cache creation records enough safe identity to resolve its checkout without introducing a second lifecycle owner.
- [ ] #4 Abnormal-exit recovery reclaims an abandoned checkout cache only when current-user ownership, path shape, checkout retirement, process liveness, PID/start identity, and symlink safety prove deletion is safe; uncertain roots remain reported and untouched.
- [ ] #5 TASK-2816's disk-backed placement for bulky coverage and terminal data, registered child-scratch cleanup, unresolved-root reporting, and active-owner protections remain intact.
- [ ] #6 No implementation scans or age-deletes arbitrary /tmp entries, adds a background service or generic TTL policy, changes test membership, or modifies operator-owned gates or budgets.
- [ ] #7 Focused owning tests and a manual disposable-worktree lifecycle prove cache reuse before retirement and space reclamation afterward; existing CPU budgets pass without retuning and measured warm-cache performance does not materially regress.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Add the failing lifecycle reproduction first. Reuse the existing mission-worktree/checkout cleanup authority to remove the deterministic checkout cache during normal retirement. Extend the existing temp-root ownership record and recovery only as needed for crash recovery, preserving TASK-2615 cache isolation/reuse and TASK-2816 bulk-storage and safety contracts. Do not create a standalone cache janitor.
<!-- SECTION:PLAN:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
