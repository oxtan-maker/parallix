# CP-3: Refactor active.ts Gate-Failure Detection (C1)

## Goal Check

| Goal Check | Evidence | Status |
|---|---|---|
| `active.ts` delegates to `repairHandoff.classifyError()` | `lib/commands/active.ts:458-467`, `lib/commands/active.js:413-422` — replaces ad-hoc regex with full 8-class dispatch | PASS |
| GitBlockers excluded from relaunch path (handled by repairHandoff) | `classification.failureClass !== 'GitBlockers'` filter | PASS |
| InfraBlocker/StateMachineViolation fall through to HumanOnly error | `dispatchAction !== 'HumanOnly'` check | PASS |
| All 72 active.test.js tests pass | Including SC3 gate-failure relaunch and SC4 limit tests | PASS |

## Changes

- **`lib/commands/active.ts`**: Replaced ad-hoc regex gate-failure detection (`/verification gate failed/i`, `/\bdeclared gate\b/i`) with `repairHandoff.classifyError(handoffResult.error)`. New `isRelaunchableError` flag: true for all classes except HumanOnly (InfraBlocker, StateMachineViolation) and GitBlockers (handled by repairHandoff auto-repair).
- **`lib/commands/active.js`**: Same change in compiled JS output.
- **`test/active.test.js`**: Updated `runHandoffAndReview: relaunch success with post-relaunch handoff failure` test — IncompleteEvidence now takes the relaunch path directly (3 handoff calls instead of 2), reflecting correct ADR 0048 AutoSendBack dispatch.

## Next Action

CP-4: Implement C6 InfraBlocker handler — ensure InfraBlocker errors are surfaced with "human intervention required" messaging.
