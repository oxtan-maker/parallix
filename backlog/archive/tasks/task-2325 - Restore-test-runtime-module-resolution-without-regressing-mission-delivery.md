---
id: TASK-2325
title: Restore test-runtime module resolution without regressing mission delivery
status: active
assignee: []
created_date: '2026-07-29 21:10'
labels:
  - bug
  - tests
dependencies: []
priority: high
ordinal: 68000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Diagnose and fix the widespread test failures caused by generated .test-runtime modules resolving domain/mission.js outside the compiled runtime. Preserve production Parallix behavior and mission delivery workflows while restoring isolated, mocked unit tests.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The task-1396 and task-2211 repro tests load the compiled Codex agent without MODULE_NOT_FOUND errors.
- [ ] #2 All currently failing test files caused by the test-runtime packaging regression pass with mocked dependencies and no real Forgejo or agent execution.
- [ ] #3 Mission delivery and Parallix production runtime behavior remain compatible.
- [ ] #4 Required static-analysis and relevant verification gates pass.
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
