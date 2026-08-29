# CP-1 — Lock the bug

Added the hermetic TASK-2423 repro. It drives the reporter with synthetic 501 ms
and 1001 ms pass events and checks both the default and requested headroom run
plans. At parent `9d6187c701941736394b92128bd5299b2c2ee492`, the focused run is
red: the 501 ms headroom diagnostic and `--test-timeout=500` plan option are
absent, while the existing 1001 ms hard-cap output is present.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 hermetic repro is red at the parent | `test/task-2423-repro.test.ts`; `npm test -- test/task-2423-repro.test.ts` exited 1 at `9d6187c701941736394b92128bd5299b2c2ee492` and reported missing `[unit-test-budget:headroom] headroom work: 501ms > 500ms` | PASS |
| SC3 existing hard cap remains observable in the repro | `test/task-2423-repro.test.ts`; `npm test -- test/task-2423-repro.test.ts` output included `[unit-test-budget:exceeded] hard-cap work: 1001ms > 1000ms` | PASS |

Next action: CP-2 will add the reporter threshold and `--unit-test-headroom` plan path in `test/lib/unit-test-budget-reporter.ts` and `test/lib/test-run-plan.ts`.
