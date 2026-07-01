---
id: TASK-1389
title: >-
  Replace generic not-automatically-repairable strand with an error-classifier
  and dispatch table
status: backlog
assignee: []
created_date: '2026-06-28 11:30'
updated_date: '2026-06-29 05:01'
labels:
  - harness
  - auto-repair
dependencies: []
references:
  - docs/adr/0048-fail-closed-harness-defense-against-agent-hallucinations.md
  - lib/commands/repair-handoff.js
  - lib/commands/active.js
parent_task_id: TASK-1384
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
ADR 0048 Control C3 (implement now, first priority): Replace the binary `isRelaunchableError` / `isDirtyError` / `isBehind` classification in `repair-handoff.js` with a structured error classifier that maps each error message pattern to a failure class and a dispatch action (auto-repair, auto-send-back with prompt, or human-only with clear message).

This is foundational work — TASK-1385 (pre-review gate), TASK-1387 (gate-failure send-back), and TASK-1388 (gatekeeper send-back) all plug into this dispatch table. The 8 failure classes defined in ADR 0048 are the classification schema.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An error classifier maps error patterns to one of 8 failure classes defined in ADR 0048
- [ ] #2 Each failure class dispatches to auto-repair, auto-send-back with prompt, or human-only with clear message
- [ ] #3 The classifier replaces the existing binary isRelaunchableError/isDirtyError/isBehind checks in repair-handoff.js
- [ ] #4 All existing repair-handoff behavior is preserved while adding new dispatch paths
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
