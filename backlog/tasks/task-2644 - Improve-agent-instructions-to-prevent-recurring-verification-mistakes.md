---
id: TASK-2644
title: Improve agent instructions to prevent recurring verification mistakes
status: backlog
assignee: []
created_date: '2026-10-04 06:07'
labels: []
dependencies: []
priority: high
ordinal: 162008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Missions repeatedly reach integration with avoidable verification failures. TASK-2637.02 exposed a nested passing-suite CPU guard regression: a real TypeScript child used 407 ms CPU against a 350 ms case budget. Improve the instructions agents actually receive so they identify owning suites, measure complete child-process CPU cost, retain explicit margin, and validate the affected contract before submitting work. Audit other recurring mission failures and consolidate guidance around their demonstrated causes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Audit recent mission and integration failures; identify recurring agent mistakes and distinguish missing guidance from ignored or conflicting guidance.
- [ ] #2 Update authoritative repository instructions and relevant generated mission/review prompts so agents receive concise actionable guidance at the point of work; avoid duplicate inventories.
- [ ] #3 CPU budget guidance requires current plain and covered profiles where applicable, waited-child and teardown accounting, explicit measured margin, finite budgets, and focused nested-runner checks; prohibit arbitrary increases and disabling guards.
- [ ] #4 Verification guidance requires owning-suite regression reproduction, focused checks before broader gates, correct tier classification, and case-owned fixture and child cleanup.
- [ ] #5 Verify instruction delivery and documentation using existing owning contracts and docs checks; demonstrate how the TASK-2637.02 failure would be caught before integration.
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
