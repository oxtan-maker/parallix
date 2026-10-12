---
id: TASK-2729
title: Fall back after agent SIGTERM without persisting an agent block
status: done
assignee: [claude]
created_date: '2026-10-12 07:18'
labels:
  - bug
dependencies: []
priority: high
ordinal: 227008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When an agent receives SIGTERM during startup or execution, continue with the next eligible agent in the same session. Treat the termination as an invocation failure, not evidence of provider quota or availability failure, and keep the terminated agent eligible on the next run. Observed on 2026-10-12: custom was persisted in agent_blocklist at 07:13:07 UTC until 10:00 UTC with reason "sigint: process terminated by SIGTERM"; the operator requested and received removal of that block. Apply the behavior consistently across agent adapters. Preserve intentional operator cancellation and application shutdown semantics.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 SIGTERM during agent startup or execution selects the next eligible agent and continues the current session with its existing context, within existing retry limits.
- [ ] #2 The terminated agent is excluded from further retries in that session, but SIGTERM alone creates or extends no persistent agent block and the agent remains eligible on a subsequent run.
- [ ] #3 Fallback exhaustion reports a clear failure without introducing a persistent block; positively identified provider quota or availability failures retain their existing block behavior.
- [ ] #4 Intentional operator cancellation or application shutdown stops work and does not launch a fallback agent.
- [ ] #5 Retain a focused regression in the existing owning suite that fails on the parent behavior and passes with the fix, covering session fallback and next-run eligibility.
- [ ] #6 Manually verify the behavior end to end using isolated fixtures and a deliberately SIGTERM-terminated agent process, and run focused contract checks plus required static analysis.
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
