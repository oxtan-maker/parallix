# CP-1: Red lifecycle regressions

Strengthened the production `px integrate` regression fixture to require authoritative `review → integration` before a landing attempt and exact `review → integration → done` events after a successful review-origin landing. The pre-change implementation fails both assertions: failed landings remain in `review`, and successful landings record direct `review → done`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Approval enters integration before a landing attempt | `test/task-2369-regressions.test.ts`; test name `R1: backlog promotion cannot complete the Mission when landing fails` | RED |
| Failed landing has no done event and retains integration | `test/task-2369-regressions.test.ts`; `npm test -- test/task-2369-regressions.test.ts` | RED |
| Successful review-origin landing records exact lifecycle transitions | `test/task-2369-regressions.test.ts`; test name `R3: a review-origin integration completes only after the commit has landed` | RED |
| Persisted lifecycle dwell projection is available for the required lane sequence | `test/task-2347.02-lifecycle-history.test.ts`; `src/application/projections/metrics.ts` | PASS |

Next action: transition the authoritative Mission with the existing `approve` command during review promotion, then rerun R1–R4.
