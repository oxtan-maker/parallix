---
id: TASK-2768
title: Remove unintended recurring focused review test execution
status: backlog
assignee: []
created_date: '2026-10-15 16:44'
labels:
  - bug
dependencies: []
priority: high
ordinal: 255008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Operator reports repeated execution of: npm test -- test/unit/application/review-gate-repair-contract.test.ts test/unit/application/review-loop/review-start-contract.test.ts. Trace the exact caller and configuration or hook authority, then remove unintended automatic execution of this focused pair. TASK-2622.08 authorized test consolidation while preserving verification obligations; TASK-2647 authorized an architecture migration with behavioral parity. Neither authorizes installing a permanent extra gate for these two suites. Initial inspection found no literal pair in production source, repository workflow configuration, or installed Git hooks; do not assume a hardcoded product dependency without evidence. Keep Parallix generic for arbitrary repositories. Preserve the suites and their normal discovery membership. Respect operator-owned gate configuration; do not add or restore gates.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Identify the exact source of the reported repeated command and document whether it is a hook, configuration, retained mission command, or production invocation.
- [ ] #2 Remove unintended recurring execution of the focused pair without deleting regression coverage or changing unrelated operator-configured gates.
- [ ] #3 Prove with a focused reproduction and a safe manual lifecycle check that the affected flow no longer launches the extra command and still honors repository-configured verification.
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
