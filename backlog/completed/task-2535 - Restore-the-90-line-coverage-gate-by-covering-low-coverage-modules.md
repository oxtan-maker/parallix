---
id: TASK-2535
title: Restore-the-90-line-coverage-gate-by-covering-low-coverage-modules
status: done
assignee: [custom]
created_date: '2026-09-17 15:20'
labels: [test, coverage, regression, user_value]
dependencies: []
parent_task_id: null
priority: high
ordinal: 90001
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The coverage gate (`npm run test:coverage`) reports line coverage far below the
90% threshold it has held historically, so `npm run test:coverage -- --lcov`
(the `quality-gate` integration gate) now exits 1. Coverage fell to ~57% on the
current tree. The drop is not a threshold change — `coverage-gate.ts` still
defaults to `threshold = 90` and the default has been 90 since the gate's
introduction (verified in git history). This is an agent regression: the
lowest-coverage production modules were never given focused tests, and the
coverage of several large modules slipped below where they once sat.

Measured coverage per module (from `coverage/lcov.info` produced by the gate),
lowest first — these are the modules dragging the denominator down:

| Module (relative to repo root) | Coverage |
| --- | --- |
| `src/adapters/config/product-config.ts` | ~27% |
| `src/adapters/config/repository-gates.ts` | ~29% |
| `src/adapters/verification/verification.ts` | ~34% |
| `src/adapters/github/github-pr.ts` | ~35% |
| `src/application/presentation/cli-format.ts` | ~35% |
| `src/adapters/review/review-loop.ts` | ~35% |
| `src/adapters/cli/commands/stats.ts` | ~36% |
| `src/adapters/cli/commands/stats-backfill.ts` | ~39% |
| `src/adapters/git/git.ts` | ~39% |

The gate only measures production modules under `src/`; test files, prompts, and
`config/*.json` are excluded by `COVERAGE_INCLUDES`/`COVERAGE_EXCLUDES`
(`src/adapters/verification/coverage-gate.ts`). Raising coverage therefore means
adding focused tests that exercise the uncovered branches in the modules above —
not changing the gate, the threshold, or the include/exclude lists.

<!-- SECTION:DESCRIPTION:END -->

## Root cause

- No focused tests existed for the highest-gap modules, so their branches never
  ran under the coverage reporter.
- Coverage of several mid-size modules has slipped since they were last
  exercised, leaving the aggregate well under 90%.
- The threshold was not lowered; the denominator simply lost coverage. Do not
  fix this by lowering `threshold` or narrowing `COVERAGE_INCLUDES`/
  `COVERAGE_EXCLUDES` — that hides the regression instead of resolving it.

## Recommended systematic fix

<!-- SECTION:FIX:BEGIN -->
Add focused tests under `test/` that drive the uncovered branches of the
highest-gap modules. Prioritise the modules that are pure or cheap to drive
without spawning real CLIs or hitting the network:

- `src/adapters/config/product-config.ts` — validation of `REQUIRED_ADAPTER_KEYS`,
  task-provider allow-list (`SUPPORTED_TASK_PROVIDERS`), integration-mode
  parsing/validation, and the repository-gates delegation. These are pure
  functions over config shapes and are the single biggest lever.
- `src/adapters/config/repository-gates.ts` — gate phase selection and the
  malformed-gates rejection path.
- `src/adapters/git/git.ts` — the pure path helpers and error classification.
- `src/adapters/cli/commands/stats.ts` / `stats-backfill.ts` — the pure
  formatting/mapping helpers, mocking the data source rather than the DB.
- `src/adapters/review/review-loop.ts`, `cli-format.ts`,
  `src/adapters/github/github-pr.ts`, `src/adapters/verification/verification.ts`
  — add targeted assertions for the branches the current suite does not reach.

Rules that keep this honest:

- Do not lower the 90% threshold or change the coverage include/exclude lists.
- Do not add `.only`; do not introduce bare `.skip`.
- Mock external boundaries (real CLIs, forgejo, network, DB). Never call the
  real `sonar-scanner`, forgejo CLI, or spawn real agents.
- Keep each new test under the 500 ms unit-test budget.
- Prefer the highest-gap, purest modules first so every added test moves the
  aggregate the most.

Run `npm run test:coverage -- --lcov` and confirm the aggregate crosses 90% and
the gate exits 0 before closing.
<!-- SECTION:FIX:END -->

## Definition of Done

<!-- DOD:BEGIN -->
- [ ] `npm run test:coverage -- --lcov` reports aggregate line coverage >= 90%
  (across all production modules in the `src/` denominator, not per-file) and
  exits 0.
- [ ] The 90% threshold and the coverage include/exclude lists are unchanged.
- [ ] Aggregate coverage rises versus the pre-mission baseline in
      `coverage/lcov.info`; adding tests to the highest-gap modules is the
      strategy that moves the aggregate fastest, but the target is the whole
      `src/` aggregate, not any single file's coverage.
- [ ] `./scripts/verify-local.sh static-analysis` passes (ESLint + tsc
      --checkJs + test-hygiene).
- [ ] No `.only` or unannotated `.skip` introduced; every new test mocks external
      boundaries and stays under the unit-test budget.
<!-- DOD:END -->
