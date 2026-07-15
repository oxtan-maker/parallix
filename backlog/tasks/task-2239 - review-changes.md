---
id: TASK-2239
title: review changes
status: refined
assignee: [codex]
created_date: '2026-07-13 03:09'
labels: []
dependencies: []
ordinal: 39000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
when an agent pushes back on all review comments the review should proceed to the reviewer agent to see if it can now approve. Only if the reviewer agent does not agree (or max-attempts is reached) we can stop and invoke human reviewer.
<!-- SECTION:DESCRIPTION:END -->

## Codex Pre-Draft

**Goal:** after an implementer responds to review findings, return the mission to the reviewer for another formal decision before escalating to a human.

**Scope and proof:** map the review-loop state transitions after `REQUEST_CHANGES`; preserve findings and round history; relaunch/select the reviewer for the next round; define the maximum-attempt boundary and the exact human-escalation state. Add deterministic tests for approve-after-fix, repeat-request-changes, reviewer failure, and exhaustion.

**Checkpoints:** (1) red state-transition tests; (2) implement re-review routing and durable round updates; (3) verify the escalation boundary and lifecycle evidence.

**Stop rule:** do not auto-approve an agent rebuttal, discard prior findings, or send work to a human before the configured reviewer retry budget is genuinely exhausted.

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
