# CP-2 — Planner extraction and coverage routing

## Summary of work done

Traced every caller of the test planner, coverage gate, package command, and
`ci-required` workflow and extracted the pure selection authority so there is a
single source of truth for verification-tier membership.

- Extracted `selectTierFiles(executionRoot)` into a new pure module
  `test/lib/test-tier-selection.ts` (no child spawns, no process state; reads
  file contents only for the boundary heuristic). It returns `{ unit,
  integrationCi, integrationLocal, allIntegration }` and selects
  `integrationCi` / `integrationLocal` POSITIVELY from
  `INTEGRATION_CI_TESTS` / `INTEGRATION_LOCAL_TESTS` in
  `test/lib/test-categories.ts`. The CI/local arrays live only there and are
  never copied.
- `test/lib/test-run-plan.ts` re-exports `selectTierFiles` so `test/lib` stays
  the single authority entry point; `buildTestRunPlan()` selects each tier
  through it instead of a local glob.
- `src/adapters/verification/coverage-gate.ts` `coverageTestFiles()` now selects
  `unit ∪ integration-ci` through `selectTierFiles(REPO_ROOT)`, never a
  filesystem glob, so `integration-local` can never leak into coverage.
- Callers traced and confirmed: `test/run-default-tests.ts` (the `npm test`
  runner), `src/adapters/verification/coverage-gate.ts` (the coverage gate),
  `test/lib/test-run-plan.ts` (argv assembly), and
  `.github/workflows/ci-required.yml` (hosted execution).

No coverage-only CI/local membership list, filesystem glob, filename exclusion,
or environment capability classifier remains anywhere outside
`test/lib/test-categories.ts` and `test/lib/test-tier-selection.ts`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC2 — no duplicate membership registry | `test/lib/test-tier-selection.ts` imports only `test/lib/test-categories.ts`; `coverageTestFiles()` routes through `selectTierFiles` | PASS |
| SC6 — tier commands retain their populations | `test/lib/test-run-plan.ts` `--integration-ci` / `--integration-local` / `--integration` selectors | PASS |

## Next action:
Proceed to CP-3: enable Node built-in coverage during the selected `unit` and
`integration-ci` execution, aggregate the per-tier LCOV fragments with correct
LCOV semantics, and update the package commands and workflow so the hosted job
has no second broad test pass and no duplicate `--lcov` argument.
