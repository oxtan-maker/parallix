---
id: TASK-1388
title: Auto-send-back missing mandatory artifacts when gatekeeper blocks handoff
status: backlog
assignee: []
created_date: '2026-06-28 11:30'
updated_date: '2026-07-01 19:24'
labels:
  - harness
  - workflow
dependencies:
  - TASK-1389
references:
  - docs/adr/0048-fail-closed-harness-defense-against-agent-hallucinations.md
  - lib/tools/gatekeeper.js
  - lib/commands/handoff.js
parent_task_id: TASK-1384
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
ADR 0048 Control C5: When gatekeeper detects missing mandatory artifacts and the task strands in 'active', auto-send-back to the implementer with explicit instructions listing which artifacts to create. Relaunch agent if automated execution context is available.

Currently gatekeeper posts pushback and keeps task active (handoff.js:324-339) but does not auto-send-back to the implementer or relaunch the agent. The auto-checkpoint generation at handoff.js:103-126 already handles the most common case (missing CP-*.md), but the remaining cases are still backlog-tracked work rather than a deferred idea.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 When gatekeeper detects missing artifacts, the implementer is auto-sent-back with explicit artifact creation instructions
- [ ] #2 Agent relaunch is attempted if automated execution context is available
- [ ] #3 Relaunch includes a bounded retry limit to avoid loops when artifacts genuinely cannot be created
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
