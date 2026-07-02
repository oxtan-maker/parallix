# CP-2: Gate failure dispatch integrated with error classifier

## Summary

Integrated gate failure dispatch through the TASK-1389 error classifier stub. The `classifyGateFailure` function (defined at `lib/review/review-loop.ts:251-258`) maps all gate failures to Class 6: "genuine gate failure — code issue" with action "auto-send-back". This stub will be replaced by the full 8-class dispatch table when TASK-1389 is implemented.

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| Gate failures dispatched through error classifier | `lib/review/review-loop.ts:399` — `classifyGateFailure(combinedOutput)` called on gate failure |
| Class 6: genuine gate failure — code issue | `lib/review/review-loop.ts:248` — `const GATE_FAILURE_CLASS = 'class-6-genuine-gate-failure'` |
| Auto-send-back action | `lib/review/review-loop.ts:249` — `const GATE_FAILURE_ACTION = 'auto-send-back'` |
| `isRelaunchable: true` enables auto-bounce path | `lib/review/review-loop.ts:257` — `isRelaunchable: true` in classification result |

## Next action
Proceed to CP-3: Auto-bounce mechanism implemented with retry counter tracking.
