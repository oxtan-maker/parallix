# CP-4: Implement C6 InfraBlocker Handler

## Goal Check

| Goal Check | Evidence | Status |
|---|---|---|
| `handleGateFailureAutoBounce` checks `isRelaunchable` before bouncing | `lib/review/review-loop.ts:399-404`, `lib/review/review-loop.js:318-323` — HumanOnly errors return `{bounced: false, stranded: true}` immediately | PASS |
| InfraBlocker errors surfaced with "human intervention required" message | Error message includes classification name and action | PASS |
| StateMachineViolation also blocked from auto-bounce | Same check covers all HumanOnly classes | PASS |
| New unit tests for InfraBlocker and StateMachineViolation | 2 new tests in `test/task-1385-pre-review-gate.test.js` | PASS |
| Existing bounce tests updated with relaunchable error messages | All 22 tests pass | PASS |

## Changes

- **`lib/review/review-loop.ts`**: Added `isRelaunchable` check in `handleGateFailureAutoBounce` after classification. If false (InfraBlocker/StateMachineViolation), returns stranded without launching implementer.
- **`lib/review/review-loop.js`**: Same change in compiled JS output.
- **`test/task-1385-pre-review-gate.test.js`**: Added 2 new tests for HumanOnly error handling. Updated 3 existing tests to use GateFailure error messages (were using generic messages that now classify as InfraBlocker).

## Next Action

CP-5: Implement C7 Evidence-reference format validation — validate that evidence cells in goal-check tables contain `file:line` format or test identifiers.
