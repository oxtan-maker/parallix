---
id: TASK-2774
title: Show the current refinement worker and activity on web cards
status: done
assignee: [custom]
created_date: '2026-10-18 06:02'
labels:
  - bug
  - web
dependencies: []
priority: high
ordinal: 256008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The operator cannot see which agent is refining a mission. IntakeCard renders generic working/certainty text and a fan coloured from card.agent, but omits the current work summary and provider execution details rendered for in-flight cards. Show the worker and current activity using the existing server-owned facts, distinguishing assigned agent, published work and observed provider execution. This is a focused behaviour correction outside TASK-2773 layout work.

Revalidate against the active tree before implementation. Preserve ports/adapters, typed application ports and composition authority; do not introduce a second status authority or change operator-owned verification gates. Read ADR 0057, extend the owning suite, retain a focused parent-red/fix-green reproduction, and run focused checks. Manually exercise the affected web flow with isolated fixtures without mutating operator missions or statistics. New or changed integration tests must finish within 3.5 seconds; unit cases must satisfy the 500 ms headroom requirement. Respect source-size caps.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Refinement cards expose the observed active worker and available current activity; assigned implementer identity is not presented as proof of current execution.
- [ ] #2 Preparing, active provider execution, provider handover, completion, blocked and unavailable-observation states remain understandable without guessing a worker or equating a live coordinator with an executing provider.
- [ ] #3 Focused regression and isolated manual web exercise cover the refinement happy path and missing/stale execution evidence.
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
