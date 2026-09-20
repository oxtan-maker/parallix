# CP-2: Exclude timing enforcement from GitHub CI selection

## Work done

Traced all callers of the GitHub / test-run-plan selection:

- `test/lib/test-run-plan.ts` `buildTestRunPlan()` — single selection authority.
  Default suite `nodeArgs` attaches `--test-reporter=<unit-test-budget-reporter>`
  for every non-integration run; `--integration-ci` selects from
  `INTEGRATION_CI_TESTS`.
- `test/lib/test-categories.ts` — `INTEGRATION_CI_TESTS` /
  `INTEGRATION_LOCAL_TESTS` registry (positive membership).
- `test/run-default-tests.ts` — the second enforcement point; suite-level budget
  and reporter-accounting are already gated on `onGitHubActions()`.
- `.github/workflows/ci-required.yml` — `npm run test:ci` → `npm test`
  (default suite) and `npm run test:integration:ci` (`--integration-ci`).

Smallest change that excludes only timing checks from GitHub while retaining the
local headroom path:

1. `test/lib/test-categories.ts`: moved
   `unit-test-timeout-guard.test.ts` from `INTEGRATION_CI_TESTS` to
   `INTEGRATION_LOCAL_TESTS` with a written environmental reason in
   `INTEGRATION_LOCAL_REASONS`. It now runs via the required local
   `--integration-local` lane, never the GitHub CI lane. The CI/local lanes
   still partition the integration layer (verified by
   `test/test-categories.test.ts`).
2. `test/lib/test-run-plan.ts`: imported `onGitHubActions()` and dropped the
   `--test-reporter=<unit-test-budget-reporter>` entry from the default plan
   `nodeArgs` when `onGitHubActions()` is true. The per-test `--test-timeout`
   safety net stays; the `--unit-test-headroom` local path is never run with the
   GitHub flag, so its reporter is unaffected.

No production launcher, workflow permission, or runner-image change. No local
`npm test` timeout cap or `--unit-test-headroom` authoring check weakened.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Regression test green after fix | `test/task-2542-repro.test.ts` — `npx tsx --test test/task-2542-repro.test.ts` (pass 4 / fail 0) | PASS |
| GitHub default plan excludes timing reporter; GitHub --integration-ci excludes timing test; local headroom + local --integration-local retain them | `test/task-2542-repro.test.ts` assertions on `buildTestRunPlan` | PASS |
| Local `npm test` budget path preserved | `[unit-test-budget]` line in `npm test` output (elapsed 92712ms < 180000ms) | PASS |
| Categories partition intact | `test/test-categories.test.ts` (pass 7 / fail 0) | PASS |
| Static-analysis gate clean | `./scripts/verify-local.sh static-analysis` | PASS |
| Final verification gate ran | `./scripts/verify-local.sh all` → exit 0, `npm test` pass 2873 / fail 0 | PASS |

## Next action
CP-3: re-run the regression test + `npm test -- --unit-test-headroom` and the
final gate against the committed tree, then record final goal-check evidence and
update the Backlog task description's mission-relevant body without changing its
lifecycle metadata.
