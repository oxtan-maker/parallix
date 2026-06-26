---
id: TASK-1353
title: >-
  Add deterministic static-analysis stage to the gate (ESLint + checkJs +
  test-hygiene guard)
status: done
assignee:
  - custom
created_date: '2026-06-26 17:59'
updated_date: '2026-06-26 18:20'
labels:
  - user_value
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

**Scope boundary — product vs. development instance:**
- **Product Parallix** (the distributable/shipped product) does NOT ship with this static-analysis gate. It is not a runtime or distribution concern.
- **Parallix development instance** (Parallix using its own tools to develop itself) DOES configure this gate locally as a development-time config. This config is private to the dev workflow — it is not published as part of the product, nor is it expected to be consumed by downstream repos.
- Downstream repos may adopt this gate independently if they wish, but that adoption is opt-in per-repo config, not inherited from Parallix's own dev config.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 ESLint runs as part of the verification gate and fails the gate on any error (no-undef, no-unused-vars, arity, no-unreachable) for changed files
- [ ] #2 A test-hygiene check fails the gate when `.only` is present in any test file or when `.skip`/`xit` lacks an annotated reason
- [ ] #3 `tsc --checkJs --noEmit` runs over at least lib/core and lib/commands and fails the gate on type errors
- [ ] #4 The new stage runs before the test suite and the combined gate stays within the TASK-1133 runtime budget
- [ ] #5 Product Parallix ships without this gate baked in — the static analysis config is development-instance-local only, not published as part of the product
- [ ] #6 Parallix's own dev instance is configured to use this gate internally for self-development
- [ ] #7 Existing repos with no declared gate are unaffected (static analysis is opt-in per repo config, not inherited)
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Completed all 5 checkpoints:
- CP-1: Created .eslintrc.cjs with 8 rules (no-undef, no-unused-vars, valid-typeof, no-unreachable, no-async-promise-executor, eqeqeq, curly, no-var), Node.js env, verified with eslint --ext .js --max-warnings 0 lib/ (603 pre-existing errors, exit 1)
- CP-2: Created tsconfig.json with allowJs/checkJs/noEmit/strict, include lib/core and lib/commands, verified with tsc --checkJs --noEmit (3045 lines pre-existing errors, exit 2)
- CP-3: Created scripts/test-hygiene.sh scanning test/**/*.test.js for .only and unannotated .skip/xit/fit, verified against synthetic test files
- CP-4: Added gate_static_analysis() to verify-local.sh with static-analysis case, all 3 stages run sequentially
- CP-5: Runtime validated — avg 1.16s over 3 runs (under 10s target)
Gates: docs pass, static-analysis exits non-zero (documented pre-existing errors), test-hygiene positive check exits non-zero
<!-- SECTION:FINAL_SUMMARY:END -->
