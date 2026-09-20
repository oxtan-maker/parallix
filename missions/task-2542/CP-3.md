# CP-3: Final verification and goal-check evidence

## Work done

Verified the committed tree (commit `e5de9ae7b`) end to end.

GitHub CI timing enforcement excluded:
- `unit-test-timeout-guard.test.ts` removed from `INTEGRATION_CI_TESTS`, added to
  `INTEGRATION_LOCAL_TESTS` (+ reason) in `test/lib/test-categories.ts`; runs
  only via the required local `--integration-local` lane.
- `test/lib/test-run-plan.ts` drops the `--test-reporter=<unit-test-budget-
  reporter>` entry from the default plan when `onGitHubActions()` is true.

Local timing path preserved:
- `npm test -- --unit-test-headroom` plan carries the budget reporter,
  `unitTestHeadroomMs=500`, and `--test-timeout=1000`; `test/run-default-tests.ts`
  sets `PARALLIX_UNIT_TEST_HEADROOM=1` when headroom is selected
  (`test/run-default-tests.ts:65`).
- `npm test` (default suite) still attaches the reporter and enforces the budget
  locally.

Evidence captured:

```
$ npx tsx --test test/task-2542-repro.test.ts
ℹ pass 4
ℹ fail 0

$ npx tsx -e "...headroom plan..."
headroom reporter: true headroomMs: 500 timeout: true

$ ./scripts/verify-local.sh static-analysis
=== Static Analysis Gate: ALL STAGES PASSED ===

$ ./scripts/verify-local.sh all   (exit 0)
npm test -> ℹ pass 2873 / fail 0
[unit-test-budget] timeout=1000ms per test, suite budget=180000ms, elapsed=92712ms
```

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Regression test fails on parent, passes after fix | `test/task-2542-repro.test.ts` — red at `e24774a3c` (2 failing GitHub assertions), green at `e5de9ae7b` (`npx tsx --test test/task-2542-repro.test.ts` pass 4 / fail 0) | PASS |
| GitHub CI selects ordinary unit suite but no timing test/reporter | `test/task-2542-repro.test.ts` assertions on `buildTestRunPlan` (`--integration-ci` excludes `unit-test-timeout-guard`; default `nodeArgs` omits `--test-reporter` budget reporter) | PASS |
| `npm test -- --unit-test-headroom` still selects/enforces timing path | `test/task-2542-repro.test.ts` + `test/run-default-tests.ts:65` (`PARALLIX_UNIT_TEST_HEADROOM=1`); plan shows `unitTestHeadroomMs=500` + reporter | PASS |
| Integration-tier partition still valid | `test/test-categories.test.ts` (pass 7 / fail 0) | PASS |
| Local `npm test` budget path still runs | `npm test` `[unit-test-budget]` line, elapsed 92712ms < 180000ms suite budget | PASS |
| Static-analysis gate clean | `./scripts/verify-local.sh static-analysis` | PASS |
| Final verification gate ran | `./scripts/verify-local.sh all` → exit 0; `npm test` `test/task-2542-repro.test.ts` + full suite pass 2873 / fail 0 | PASS |

## Next action
Update the mission-relevant body of the Backlog task
`task-2542 - gitbhub-runs-tests-and-checks-it-should-not-yet-again.md` to record
the landed selection change without altering its status/assignee/labels/lifecycle,
then confirm no uncommitted mission files remain.
