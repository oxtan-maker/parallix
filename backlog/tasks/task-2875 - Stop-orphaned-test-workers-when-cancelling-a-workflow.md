---
id: TASK-2875
title: Stop orphaned test workers when cancelling a workflow
status: backlog
assignee: []
created_date: '2026-11-25 16:34'
labels:
  - bug
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Stopping px-0077 left a node:test worker running at more than one CPU for over 10 minutes. Workflow operation 5c678f0a-8f2f-4d64-864a-7e9ff87e9396 settled as stopped at 16:26:14 UTC on 2026-11-25 and fenced generation 1. Its owner and coordinator had exited. PID 3765084 still carried that exact operation and producer generation in its environment, ran policy-action-contract.test.ts from the px-0077 worktree, and was reparented to PID 3787. The worker ignored SIGTERM and exited after a targeted SIGKILL. This is distinct from TASK-2874 and the unfinished verification scheduler patch.

Trace the workflow cancellation and test runner ownership boundaries before choosing the fix. Use an isolated process tree and the existing cancellation contract. Preserve bounds on wall and CPU time and the scope of operation ownership.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 When workflow stop settles, no test worker from the stopped generation remains running, including a worker that has become reparented.
- [ ] #2 Cancellation leaves unrelated workflow generations and processes running.
- [ ] #3 An existing cancellation suite reproduces the leak on the parent and verifies cleanup with the fix.
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
