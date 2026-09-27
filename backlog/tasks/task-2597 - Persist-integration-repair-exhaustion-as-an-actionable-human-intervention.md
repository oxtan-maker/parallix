---
id: TASK-2597
title: Persist integration repair exhaustion as an actionable human intervention
status: backlog
assignee: []
created_date: '2026-09-27 20:09'
labels:
  - bug
dependencies: []
priority: high
ordinal: 128008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Observed during task-2580 integration: unit and integration-ci gates failed, automatic implementer repair spent the persisted 2/2 integration-gate rebound budget, and the command printed an exhaustion dossier followed by Aborting before merge and px review task-2580 --continue. The mission then appeared stranded instead of handing an actionable failure to the operator.

Systematic cause: src/application/integrate/gates.ts reactivates the aggregate and withdraws approval before routing a red gate. src/adapters/cli/commands/integrate-gate-rebound.ts returns exhausted, limit-reached, or stranded, but those terminal routes only log diagnostics. gates.ts aborts for every non-fixed route without publishing blocked current work or preserving an actionable intervention dossier. The rebound kernel also returns its dossier, but the integration route drops it and retains only diagnostic. The board derives blockingReason from blocked current-work events; without one it can report only an orphaned active mission and advertise px active instead of the integration repair continuation. Review already has an onAutonomousStop publication seam; integration recovery lacks an equivalent terminal handoff.

This is an orchestration and observability defect, not evidence that the test process itself deadlocked. A finite repair budget is correct; spending it must end in a visible, durable operator handoff. Scope the fix across terminal integration recovery routes and their callers so a returned failure cannot silently strand a mission.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A red integration gate within budget launches the authorized repair and verifies the committed tree using the configured gates.
- [ ] #2 Exhausted, limit-reached, human-only, and stranded integration recovery outcomes publish a blocked operational fact with the failed gate, diagnostic, worktree, spent budget, and exact continuation action; the dossier is not discarded.
- [ ] #3 Board and status surfaces show human intervention and the integration repair continuation rather than a generic orphaned-active action, including after the command exits.
- [ ] #4 Regression tests cover terminal routing, no extra agent launch after exhaustion, retained approval withdrawal, and successful continuation clearing the blocking fact.
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
