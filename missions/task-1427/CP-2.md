# CP-2: Fix classifyGateFailure Stub (C1)

## Goal Check

| Goal Check | Evidence | Status |
|---|---|---|
| `classifyGateFailure` delegates to `repairHandoff.classifyError()` | `lib/review/review-loop.ts:245-253`, `lib/review/review-loop.js:241-249` — replaces hardcoded stub with dynamic dispatch | PASS |
| `isRelaunchable` derived from dispatch action | `dispatchAction !== 'HumanOnly'` — InfraBlocker/StateMachineViolation are not relaunchable | PASS |
| All 8 failure classes tested | 10 new unit tests cover all 8 classes + edge cases (empty/null input) | PASS |
| Existing `handleGateFailureAutoBounce` tests still pass | 20/20 tests pass, prompt now includes live classification | PASS |

## Changes

- **`lib/review/review-loop.ts`**: Replaced hardcoded `classifyGateFailure` stub with delegation to `repairHandoff.classifyError(output)`. Returns `{classification, action, isRelaunchable}` derived from the full 8-class dispatch table.
- **`lib/review/review-loop.js`**: Same change in compiled JS output.
- **`test/task-1385-pre-review-gate.test.js`**: Replaced 2 stub-behavior tests with 10 tests covering all 8 failure classes plus edge cases. Updated fix-prompt test to verify live classification appears in auto-bounce prompt.

## Next Action

CP-3: Refactor `active.ts` gate-failure detection (lines 458-462) to delegate to `repairHandoff.classifyError()` instead of ad-hoc regex.
