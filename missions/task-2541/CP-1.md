# CP-1 — timing-test inventory

Enumerated the timing-dependent test set. `task-2376-lifecycle-timing.test.ts`
asserts lifecycle dwell and cycle-time values and is registered in the GitHub CI
integration lane. The named `task-1039-integrate.test.ts` repro is not in that
lane and its focused budgeted run completed the failing gate assertion in 152 ms;
it remains in the default suite. The full headroom run found no over-budget
default test to relocate.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| timing assertions are identified | `test/task-2376-lifecycle-timing.test.ts`; test `"R2: delayed integration dwell — review 30m, integration 225m"` | PASS |
| named repro is measured and classified | `npm test -- --unit-test-headroom test/task-1039-integrate.test.ts`; test `"integrate aborts before merge when a pre-integration gate fails"` | PASS |
| no additional over-budget default test was found | `npm test -- --unit-test-headroom` | PASS |
| CI membership is independently checkable | `grep -n "task-2376-lifecycle-timing.test.ts" test/lib/test-categories.ts` | PASS |

Next action: Move only `task-2376-lifecycle-timing.test.ts` to the local integration registry and record its CI-runner timing reason.
