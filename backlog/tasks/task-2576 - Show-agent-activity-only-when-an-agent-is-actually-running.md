---
id: TASK-2576
title: Show agent activity only when an agent is actually running
status: backlog
assignee: []
created_date: '2026-09-25 12:07'
labels:
  - bug
  - web
  - workflow
dependencies: []
priority: high
ordinal: 108008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On 2026-09-25 the web board showed TASK-2554, TASK-2560, and TASK-2574 as live `px integrate` work with a blinking dot and "no implementer". The board snapshot reported `agent: null` for all three. A process check found a Codex child running under TASK-2560; the other two sampled coordinator trees showed no agent child. The board therefore needs to distinguish Parallix's deterministic integration work from actual agent execution, and to report a live agent accurately when one is launched during integration.

Trace the current-work publications, nested gate-repair/agent launches, reconciliation, and web card rendering for these missions. Determine why the TASK-2560 agent is not reflected in the board, and check whether the other two missions really have no running agent. Preserve an honest unknown state when agent liveness or identity cannot be observed; do not infer an active agent from a live `px` coordinator alone.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A blinking activity dot appears only while an agent is confirmed running. Deterministic Parallix work, including integration gates and merge steps, has a clear non-agent status and no blinking dot.
- [ ] #2 "No implementer" appears only while an agent is confirmed running but its identity cannot be resolved. Idle, unassigned, deterministic, and merely uncertain states use accurate distinct wording.
- [ ] #3 A nested agent launched during `px integrate` is shown as agent activity with its family when known, including the TASK-2560 repair path; the display returns to deterministic integration status after that agent exits.
- [ ] #4 Investigate and record the cause for each of TASK-2554, TASK-2560, and TASK-2574, including process and published-work evidence, then add red-to-green regression coverage for deterministic integration, known agent, and unknown-identity agent states.
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
