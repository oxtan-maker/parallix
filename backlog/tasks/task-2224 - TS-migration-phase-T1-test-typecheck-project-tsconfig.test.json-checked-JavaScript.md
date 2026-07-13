---
id: TASK-2224
title: >-
  TS migration phase T1: test typecheck project (tsconfig.test.json checked
  JavaScript)
status: active
assignee: [custom]
created_date: '2026-07-11 13:45'
labels:
  - typescript
  - migration
  - adr-0044
dependencies: []
references:
  - docs/adr/0044-workflow-distribution-model.md
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implements phase T1 of the repository-wide TypeScript model accepted in the 2026-07-11 update to ADR 0044 (docs/adr/0044-workflow-distribution-model.md, §9). Add a check-only compiler project that brings all test/**/*.js files into the type boundary as checked JavaScript, and wire it into the static-analysis gate. No runtime or layout change.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 tsconfig.test.json exists with noEmit, allowJs, checkJs and includes test/**/*.js
- [ ] #2 ./scripts/verify-local.sh static-analysis runs the test typecheck as a named stage and passes
- [ ] #3 npm test passes unchanged
- [ ] #4 Revealed test-type defects are fixed or annotated with @ts-expect-error plus a reason
- [ ] #5 Rollback: reverting the phase commit restores the previous static-analysis behavior with no runtime impact
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
