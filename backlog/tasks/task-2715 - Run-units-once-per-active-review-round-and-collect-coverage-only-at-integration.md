---
id: TASK-2715
title: >-
  Run units once per active-review round and collect coverage only at
  integration
status: backlog
assignee: []
created_date: '2026-10-10 09:43'
labels:
  - performance
  - ai-sdlc
dependencies: []
priority: high
ordinal: 216008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Reduce repeated self-development verification, excluding agent execution time. Operator decision: no unit coverage during active/review rounds; one successful full unit run per active-to-review round, reused by downstream verification/reviewer checks for the same candidate. Integration retains a separate covered unit run and coverage merge/Sonar obligations.

Trace execute guidance, declared gates, repository verification, autonomous review verification and handoff proof reuse before implementation. Current gate_all in scripts/verify-local.sh builds and runs uncovered fast units; preIntegration in workflow.config.json runs covered fast units. Existing exact clean-tree proof reuse and integration rebound validation must remain sound. Review prompt already discourages duplicate broad tests. Coordinate with TASK-2707.

Failed runs may retry after repair; changed production/test inputs invalidate old evidence. Focused checks for implementation and concrete review findings remain allowed. Do not satisfy the one-run rule by skipping required validation or accepting another candidate's proof. Keep policy in this repository's tooling/configuration and guidance; preserve generic product behavior and ports/adapters boundaries.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each unchanged active-to-review candidate has exactly one successful broad unit execution across implementer completion, autonomous review preparation, handoff and reviewer checks.
- [ ] #2 Active/review unit executions produce no coverage, even when inherited coverage environment flags would otherwise enable it.
- [ ] #3 Integration runs covered units and merges valid unit/integration coverage for the exact integration candidate; existing validated rebound reuse remains correct.
- [ ] #4 Changes after verification invalidate proof; failed runs can retry and focused tests remain available without causing redundant successful broad runs.
- [ ] #5 Extend owning verification/review contract suites with execution-count and coverage-mode checks; record a safe manual active-review-repair-review-integration rehearsal, static-analysis and applicable docs validation.
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
