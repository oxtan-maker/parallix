# CP-2: Detect and relaunch on gate failure in active.ts

## Summary

Modified `lib/commands/active.ts` `runHandoffAndReview()` to detect genuine gate failures (verification gate or declared gate), trigger automatic relaunch via `attemptAgentRelaunch` with captured gate output, and enforce a maximum of 2 relaunch attempts. Extended `attemptAgentRelaunch()` to accept `gateOutput` in options and pass it to the relaunch prompt builder. Modified `lib/commands/repair-handoff.ts` to extend `isRelaunchableError()` to also match genuine gate failure patterns and `buildRelaunchPrompt()` to accept optional `gateOutput` parameter.

Changes:
1. `active.ts` `runHandoffAndReview()`: Added detection of genuine gate failures (via `gateOutput` field or error message matching), automatic relaunch loop bounded to 2 attempts, and proper error messaging when limit is reached.
2. `active.ts` `attemptAgentRelaunch()`: Added `gateOutput` to options, passed to `buildRelaunchPromptFn`.
3. `repair-handoff.ts` `isRelaunchableError()`: Extended to also match "verification gate failed" and "declared gate ... failed" patterns.
4. `repair-handoff.ts` `buildRelaunchPrompt()`: Added optional `gateOutput` parameter; appends captured output (truncated to 8000 chars if >16000 total) with `[truncated]` marker.

### Round 1 review fix (Finding 1)

The declared-gate failure branch in `performHandoff()` (`lib/commands/handoff.ts:352`) originally returned `{ ok: false, error: msg }` without attaching `gateOutput`. This caused the relaunch loop to fire but pass `undefined` as gate output to the prompt builder. Fixed by adding `gateOutput: { stdout: gatesResult.stdout, stderr: gatesResult.stderr }` to the return value. The SC3 declared-gate test was also updated to assert that `gateOutput` reaches `attemptAgentRelaunch`.

## Goal Check

| Criterion | Evidence | Status |
|-----------|----------|--------|
| SC3: runHandoffAndReview relaunches on verification gate failure with captured output | test/active.test.js:1538 `runHandoffAndReview relaunches on verification gate failure with captured output (SC3)` asserts `lastGateOutput.stdout` and `lastGateOutput.stderr` match mocked values, `relaunchAttempts===1`, `handoffAttempts===2` | PASS |
| SC3: runHandoffAndReview relaunches on declared gate failure with captured output | test/active.test.js:1579 `runHandoffAndReview relaunches on declared gate failure with captured output (SC3)` asserts `lastGateOutput.stdout` and `lastGateOutput.stderr` match mocked values (round 1 fix) | PASS |
| SC4: relaunch loop terminates after max 2 attempts | test/active.test.js:1616 `runHandoffAndReview limits gate-failure relaunches to 2 attempts (SC4)` asserts `relaunchAttempts===2`, `handoffAttempts===3`, error contains "Gate failure persisting after 2 relaunch attempts" | PASS |
| SC4: relaunch stops when agent relaunch itself fails | test/active.test.js:1642 `runHandoffAndReview stops relaunching when agent relaunch itself fails (SC4)` asserts `relaunchAttempts===2` (first succeeds, second fails), `handoffAttempts===2` | PASS |
| All existing active tests still pass | `node --test test/active.test.js` — 72 tests pass, 0 fail | PASS |
| All existing repair-handoff tests still pass | `node --test test/repair-handoff.test.js` — 15 tests pass, 0 fail | PASS |

Next action: CP-3 — Preserve backward compatibility, run verification
