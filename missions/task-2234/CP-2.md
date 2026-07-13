# CP-2: Validation Fix and Auto-Bounce Implementation

## Summary

Two changes implemented:

1. **`lib/commands/handoff.ts` (runDeclaredGates)**: Moved the explanatory dash-suffix check to before the stripping step. Gate entries containing em-dash, en-dash, or double-dash followed by prose are now rejected immediately with `validation-failed` before `validateDeclaredGates` is called. This fixes the root cause where the suffix was silently stripped, allowing `true — some description` to pass as `true`.

2. **`lib/review/review-commands.ts` (pushRound)**: Added auto-bounce logic for declared-gate validation failures. When `createPr` returns a `validation-failed` result, the task is transitioned back to `active` with a clear rejection reason surfaced in the error output. Non-validation failures (infrastructure, auth) do not trigger the bounce.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Gate entry with explanatory dash suffix is rejected as validation error | `lib/commands/handoff.ts:830-832` dash-suffix check before strip; `test/handoff.test.js:1516` "runDeclaredGates rejects explanatory dash suffixes" GREEN | PASS |
| Reviewer-push blocked by invalid gate auto-bounces to repairable state | `lib/review/review-commands.ts:907-911` auto-bounce transition to active; `test/task-2234-push-to-reviewer-autobounce.test.js:67` "pushRound auto-bounces task to active on declared-gate validation failure" GREEN | PASS |
| Regression test red-to-green demonstrated | `test/task-2234-push-to-reviewer-autobounce.test.js` — 4/4 GREEN (was 1/4 before fix) | PASS |
| Normal verification gate completes without focused/skipped tests | `./scripts/verify-local.sh static-analysis` — all stages PASSED; no .only or .skip in new test | PASS |

Next action: Write CP-3 with final gate verification evidence, commit all changes, and update the backlog task.
