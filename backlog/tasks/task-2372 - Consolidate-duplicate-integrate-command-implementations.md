---
id: TASK-2372
title: Consolidate duplicate integrate command implementations
status: ready-for-integration
assignee: [custom]
created_date: '2026-08-13 17:12'
labels: [user_value]
dependencies: []
priority: medium
ordinal: 92912
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The production CLI composes src/adapters/cli/commands/integrate.ts, while src/adapters/cli/commands/integrate-command.ts contains a second, diverging implementation of the same orchestration. TASK-2371 corrected the inactive copy first, leaving the production path wrong. Consolidate to one implementation (or make the unused module a thin delegating adapter) so lifecycle and integration changes have one source of truth.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The production CLI and all callers execute one canonical integration orchestration implementation.
- [ ] #2 No duplicated promotion or lifecycle-transition logic remains between integrate.ts and integrate-command.ts.
- [ ] #3 Focused integration regression tests pass, including review-origin approval and failed landing.
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
