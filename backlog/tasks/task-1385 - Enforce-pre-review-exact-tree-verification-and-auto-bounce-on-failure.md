---
id: TASK-1385
title: Enforce pre-review exact-tree verification and auto-bounce on failure
status: backlog
assignee: []
created_date: '2026-06-28 11:30'
updated_date: '2026-07-01 20:13'
labels:
  - harness
  - workflow
dependencies:
  - TASK-1389
references:
  - docs/adr/0048-fail-closed-harness-defense-against-agent-hallucinations.md
  - backlog/tasks/task-1268 - Shift-left.md
  - lib/core/verification.js
  - lib/review/review-commands.js
parent_task_id: TASK-1384
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
ADR 0048 Control C1: Run the configured verification gate mechanically before each review round. On gate failure, auto-bounce to the implementer with the gate output as a fix prompt and asking the implementer to fix with max retry =2. No reviewer cycle consumed.

This closes the fail-open path where an agent can hand off with a green gate, receive review feedback, "fix" the code, and re-submit without the gate re-running. The gate exit code on a pinned tree is the sole trusted signal — agent textual claims are never trusted.

Depends on TASK-1389 (error classifier) for clean dispatch integration. Implements the task-1268 shift-left concept.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The verification gate runs mechanically before each review round and its exit code is the sole trusted signal
- [ ] #2 On gate failure the workflow auto-bounces to the implementer with captured gate output as a fix prompt without consuming a reviewer cycle
- [ ] #3 Gate scope is selected from the mission area (diff-scoped) rather than always running 'all'
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
