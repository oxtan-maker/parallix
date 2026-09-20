# CP-1: Red regression test for GitHub timing-exclusion plan

## Work done

Traced the timing-enforcement surface. Two GitHub-executed timing mechanisms:

- `test/unit-test-timeout-guard.test.ts` is registered in
  `test/lib/test-categories.ts` `INTEGRATION_CI_TESTS`, so it runs in the
  GitHub-safe lane `npm run test:integration:ci` (`run-default-tests.ts
  --integration-ci` → `declaredTier(INTEGRATION_CI_TESTS)`). It spawns the
  runner against a 2 s / 500 ms fixture and fails on the clean runner for an
  unrelated module-resolution reason (`launcher-selection.js`), not a product
  regression.
- `test/lib/unit-test-budget-reporter.ts` is attached as `--test-reporter` to
  the **default** suite `nodeArgs` in `test/lib/test-run-plan.ts`
  (`testTimeoutArgs`). On GitHub it no-ops its accounting
  (`onGitHubActions()`), but it still executes.

Authored `test/task-2542-repro.test.ts` — hermetic, asserts on the resolved
`buildTestRunPlan` plan object (no process spawn), toggling `GITHUB_ACTIONS`
directly:

- GitHub default plan must not carry the budget reporter in `nodeArgs`.
- GitHub `--integration-ci` plan must not select `unit-test-timeout-guard`.
- Local `--unit-test-headroom` plan must carry the reporter and enforce
  `UNIT_TEST_HEADROOM_MS`.
- Local `--integration-ci` plan must still select the timing test.

Ran red at the mission parent commit:

```
$ npx tsx --test test/task-2542-repro.test.ts
✖ task-2542: GitHub default plan must not select the timing reporter
✖ task-2542: GitHub integration-ci plan must not select the timing test
ℹ pass 2 / fail 2
```

Both GitHub assertions fail because the current selection still includes the
timing reporter and the timing test. The two local assertions already pass.
Committed the red test at `961f1e99d`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Regression test is red on the parent commit | `test/task-2542-repro.test.ts` (2 failing GitHub assertions) | PASS |
| Regression test green when GitHub excludes timing | `npx tsx --test test/task-2542-repro.test.ts` (pending CP-2 fix) | PENDING |
| Timing test currently in GitHub CI lane | `INTEGRATION_CI_TESTS` in `test/lib/test-categories.ts` | PASS |
| Timing reporter attached to default suite | `testTimeoutArgs` in `test/lib/test-run-plan.ts` | PASS |

## Next action
CP-2: move `unit-test-timeout-guard.test.ts` from `INTEGRATION_CI_TESTS` to
`INTEGRATION_LOCAL_TESTS` (+ reason), and drop the budget reporter from the
GitHub default plan in `test/lib/test-run-plan.ts`; then re-run the regression
test green.
