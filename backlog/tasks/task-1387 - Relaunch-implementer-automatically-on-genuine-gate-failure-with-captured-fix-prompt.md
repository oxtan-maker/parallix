---
id: TASK-1387
title: >-
  Relaunch implementer automatically on genuine gate failure with captured fix
  prompt
status: backlog
assignee: []
created_date: '2026-06-28 11:30'
updated_date: '2026-06-29 05:01'
labels:
  - harness
  - auto-repair
dependencies:
  - TASK-1389
references:
  - docs/adr/0048-fail-closed-harness-defense-against-agent-hallucinations.md
  - lib/commands/handoff.js
  - lib/commands/repair-handoff.js
  - lib/commands/active.js
parent_task_id: TASK-1384
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
ADR 0048 Control C2 (implement now): When the verification gate fails at handoff time (handoff.js:200-209), capture gate stdout/stderr, classify the error as "genuine gate failure — code issue", and relaunch the implementer with the captured output as a fix prompt. Limit relaunch attempts to 2 to prevent infinite loops.

This is the highest-ROI single control because it eliminates the most common human-intervention scenario: manually copying gate output and re-invoking the agent.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 On verification gate failure at handoff, gate stdout/stderr is captured and included in a relaunch prompt
- [ ] #2 The implementer agent is relaunched automatically with the captured fix prompt
- [ ] #3 Relaunch attempts are limited to 2 to prevent infinite loops
- [ ] #4 The error classifier (TASK-1389) classifies gate failures as auto-send-back
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
