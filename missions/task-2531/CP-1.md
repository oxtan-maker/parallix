# CP-1: Locate enforcement points + define shared detection + red test

## Summary
Both enforcement points confirmed in the repo:
1. `test/lib/unit-test-budget-reporter.ts` — reporter emitting `[unit-test-budget:exceeded]` (> `UNIT_TEST_BUDGET_MS` = 1000 ms) and `[unit-test-budget:headroom]` (> `UNIT_TEST_HEADROOM_MS` = 500 ms) in headroom mode.
2. `test/run-default-tests.ts` — suite-level budget check failing the unit suite when `suiteElapsedMs > UNIT_TEST_BUDGET_MS` (180 s via `plan.unitTestBudgetMs`).

Shared detection contract defined: a single export `onGitHubActions()` that returns `true` iff `process.env.GITHUB_ACTIONS === 'true'` (exact value, not any GitHub-ish string). Both enforcement points must import this one definition.

Red state confirmed: `test/unit-test-budget-reporter.test.ts` already asserts the contract (imports `onGitHubActions`, checks GitHub disables the reporter, checks exact-value keying, and asserts the runner imports the shared detection). The test currently fails to load because `onGitHubActions` is not yet exported.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Both enforcement points located | `test/lib/unit-test-budget-reporter.ts`, `test/run-default-tests.ts` | PASS |
| Single shared `onGitHubActions` contract defined | `test/unit-test-budget-reporter.test.ts` (exact-value keying test) | PASS |
| Red test present and failing | `` `node --import tsx test/unit-test-budget-reporter.test.ts` `` → `does not provide an export named 'onGitHubActions'` | PASS |

## Next action
Implement `onGitHubActions()` export in `test/lib/unit-test-budget-reporter.ts` and wire it into both enforcement points (CP-2).
