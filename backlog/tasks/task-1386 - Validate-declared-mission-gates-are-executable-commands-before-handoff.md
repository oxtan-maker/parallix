---
id: TASK-1386
title: Validate declared mission gates are executable commands before handoff
status: backlog
assignee: []
created_date: '2026-06-28 11:30'
updated_date: '2026-07-01 19:24'
labels:
  - harness
  - workflow
dependencies: []
references:
  - docs/adr/0048-fail-closed-harness-defense-against-agent-hallucinations.md
  - lib/commands/handoff.js
parent_task_id: TASK-1384
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
ADR 0048 Control C4: Validate that declared mission gate commands in the `## Gates` section of MISSION.md are syntactically valid and reference existing files before executing them. On validation failure, report the specific issue and auto-send-back with a fix instruction.

Currently, `runDeclaredGates` (handoff.js:429-480) executes each gate line as a bash command. Invalid commands fail at execution time with a confusing shell error that is not classified differently from a genuine gate failure.

This remains sequenced after TASK-1389/TASK-1387/TASK-1385 for ROI reasons, but it is explicitly in backlog and not treated as a deferred non-commitment.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Gate commands in ## Gates are validated for file existence and basic syntax before execution
- [ ] #2 Validation failures produce a clear error message distinguishing them from genuine gate failures
- [ ] #3 The validation runs before any gate command is executed so all issues are surfaced at once
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
