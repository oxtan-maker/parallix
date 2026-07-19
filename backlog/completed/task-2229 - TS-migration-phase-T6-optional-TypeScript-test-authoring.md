---
id: TASK-2229
title: 'TS migration phase T6 (optional): TypeScript test authoring'
status: done
assignee: [codex]
created_date: '2026-07-11 13:47'
labels:
  - typescript
  - migration
  - adr-0044
  - user_value
dependencies:
  - TASK-2224
  - TASK-2227
references:
  - docs/adr/0044-workflow-distribution-model.md
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implements optional phase T6 of the repository-wide TypeScript model accepted in the 2026-07-11 update to ADR 0044 (docs/adr/0044-workflow-distribution-model.md, §5, §9). Depends on T1 (task-2224) and T4 (task-2227). Allow new tests to be authored in TypeScript and/or convert selected high-value suites; extend tsconfig.test.json accordingly. Explicitly deferred: the accepted model is complete without this phase (tests remain checked JavaScript), and it can stay in the backlog indefinitely without affecting T1–T5.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 tsconfig.test.json (and the runner, if needed) supports TypeScript test files
- [ ] #2 npm test and ./scripts/verify-local.sh static-analysis pass with at least one TypeScript-authored test
- [ ] #3 Rollback: reverting the phase commit restores the JavaScript-only test tree
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
