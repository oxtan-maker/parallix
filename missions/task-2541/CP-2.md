# CP-2 — relocate timing coverage

Moved the confirmed lifecycle timing suite from the positive GitHub CI registry
to the local integration registry. Its non-empty local reason records that the
suite asserts dwell and cycle-time values and is deliberately retained in local
verification rather than the GitHub 1000 ms budget. No test body or production
file changed.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| confirmed timing suite left the CI lane | `grep -n "task-2376-lifecycle-timing.test.ts" test/lib/test-categories.ts`; `test/task-2376-lifecycle-timing.test.ts` | PASS |
| timing suite is retained locally | `test/lib/test-categories.ts` `INTEGRATION_LOCAL_TESTS`; `test/task-2376-lifecycle-timing.test.ts` | PASS |
| local-only reason is recorded | `test/lib/test-categories.ts` `INTEGRATION_LOCAL_REASONS['task-2376-lifecycle-timing.test.ts']` | PASS |
| named repro remains measured rather than unnecessarily relocated | test `"integrate aborts before merge when a pre-integration gate fails"`; `npm test -- --unit-test-headroom test/task-1039-integrate.test.ts` | PASS |

Next action: Run the mission's sole verification gate on this registry change and capture the category, hygiene, and production-scope checks.
