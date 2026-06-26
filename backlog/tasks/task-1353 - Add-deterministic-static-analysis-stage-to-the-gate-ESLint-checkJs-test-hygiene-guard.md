---
id: TASK-1353
title: >-
  Add deterministic static-analysis stage to the gate (ESLint + checkJs +
  test-hygiene guard)
status: backlog
assignee: []
created_date: '2026-06-26 17:59'
labels:
  - quality
  - guardrail
  - bug-reduction
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Bug-reduction initiative #1. Today the only gate is monolithic `npm test` — there is no ESLint, no Prettier, no TypeScript/`checkJs`, and no guard against disabled/focused tests. This lets the whole class of LLM-produced defects (undefined vars, unused bindings, wrong arity, unreachable code, typos) reach the test phase, and lets `it.only`/`describe.only`/orphan `.skip` silently shrink the suite (cf. TASK-1333, 15 silently-broken tests).

Add a fast deterministic stage that runs BEFORE the test suite and fails closed:
1. ESLint on changed files (no-undef, no-unused-vars, valid arity, no-unreachable), `--max-warnings 0`.
2. `tsc --checkJs --noEmit` driven by JSDoc (gradual adoption; start with lib/core + lib/commands).
3. A test-hygiene guard that fails the gate on `it.only`/`describe.only`/`test.only` and on `.skip`/`xit` without an annotated reason.

This is the cheapest catch in the pipeline: no tokens, no agent, deterministic. Estimated ~15-20% pipeline-wide bug reduction. Keep it diff-scoped so it stays inside the TASK-1133 sub-30s gate budget.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 ESLint runs as part of the verification gate and fails the gate on any error (no-undef, no-unused-vars, arity, no-unreachable) for changed files
- [ ] #2 A test-hygiene check fails the gate when `.only` is present in any test file or when `.skip`/`xit` lacks an annotated reason
- [ ] #3 `tsc --checkJs --noEmit` runs over at least lib/core and lib/commands and fails the gate on type errors
- [ ] #4 The new stage runs before the test suite and the combined gate stays within the TASK-1133 runtime budget
- [ ] #5 Existing repos with no declared gate are unaffected (static analysis is opt-in per repo config)
<!-- AC:END -->
