---
id: TASK-2873
title: Operator px review leaves an exhausted action budget unchanged
status: done
assignee: [codex]
created_date: '2026-11-24 07:29'
labels:
  - bug
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Observed behavior

On 2026-11-24, an operator ran plain `px review` from the worktree of DB-owned mission `px-0066` using Parallix 1.5.619. Forgejo PR #951 was reachable and open. The command selected the persisted reviewer and resumed approved round 13, then stopped with `action limit 40 reached at action 40. Hand off to human review.` The mission remained in integration. A read-only inspection confirmed 40 retained actions against a configured limit of 40.

## Investigation

On main, the owned CLI dispatch conveys operator identity to the review loop. The loop calls `loadReviewActionCount` before starting review rounds. That function reloads the durable count and stops at the configured limit without considering the operator invocation. A focused in-process reproduction at main commit c06aaf6aa passed `operatorInvocation: true` and a retained count of 40. It returned false and emitted the same action-limit handoff before any action could run.

Earlier continuation behavior in TASK-2867.06 F3 (8a8860f27) reopened the review window only for an operator invocation. The review-window replacement (1f2a46789, fdb5dd0d7) uses a durable action limit and has no equivalent operator allowance.

## Expected behavior

An explicit operator invocation of action-taking `px review` ensures at least five executable review actions remain, regardless of why the operator invoked review or which review phase is persisted. At a retained count of 40 with no remaining budget, the next five actions can run if otherwise eligible. Preserve the lifetime action ledger, existing review admission and obligations, and any remaining allowance above five. The same invocation keeps one fixed allowance through internal restarts. Autonomous resumes and read-only commands acquire no additional allowance.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An explicit operator px review provides at least five runnable actions at the effective ceiling, including the integration/approved continuation from the reproduction.
- [ ] #2 A direct operator invocation tops up one to four remaining executable actions to five and preserves any larger remaining allowance. The existing stop convention still permits all five granted actions to run.
- [ ] #3 An autonomous resume, an internal restart of the same invocation, and read-only review commands do not grant additional headroom. The durable count and consumed actions are preserved.
- [ ] #4 Retain a focused regression in the owning review action-limit and command-admission contracts that fails on the current main behavior and passes with the fix. Exercise the operator invocation through the normal CLI entry point with isolated state.
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
