---
id: TASK-2777
title: Resolve mission integration context for web commands in the backend
status: ready-for-integration
assignee: []
created_date: '2026-10-18 06:02'
labels:
  - bug
  - web
dependencies: []
priority: high
ordinal: 259008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Web-triggered integration of TASK-2772 failed on 2026-10-18 at 05:52:59 UTC. Retained coordinator output reports: "Mission branch: current branch is main, expected mission/task-2772 (or a branch with a suffix)" and then "Integration preflight failed." It stopped before pushing; the web card exposed only a generic integration-workflow exit-code failure.

The browser supplies a mission identity. Backend workflow admission/execution must resolve and validate that mission's worktree, branch and receiving base context instead of inheriting the web host checkout as though an operator had invoked the terminal command there. Preserve terminal invocation semantics where appropriate; the operator must not need to restart the web host from each mission directory. Trace supervisor/executor launch and integration context construction to fix the owning boundary. Resolve per operation without changing the long-lived web host process working directory. Keep existing branch, approval, identity, locking and preflight safeguards. Surface an actionable reason when context cannot be resolved. TASK-2773.07 owns inline outcome placement, not execution-context correctness.

Revalidate against the active tree before implementation. Preserve ports/adapters, typed application ports and composition authority; do not introduce a second status authority or change operator-owned verification gates. Read ADR 0057, extend the owning suite, retain a focused parent-red/fix-green reproduction, and run focused checks. Manually exercise the affected web flow with isolated fixtures without mutating operator missions or statistics. New or changed integration tests must finish within 3.5 seconds; unit cases must satisfy the 500 ms headroom requirement. Respect source-size caps.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Integration admitted from a web host running on main resolves the selected mission execution context and passes valid branch/context preflight without requiring the operator to change directories.
- [ ] #2 Concurrent commands for different missions do not share mutable process cwd or execute against another mission/base; existing integration ownership and preflight checks remain intact.
- [ ] #3 Missing/removed worktrees, mismatched branches and invalid mission context fail clearly before merge/push and expose a useful reason through the command outcome.
- [ ] #4 A retained parent-red/fix-green reproduction exercises the web/backend execution boundary, and an isolated manual web integration completes through its intended local landing using disposable repositories/remotes; terminal entry behaviour remains covered.
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
