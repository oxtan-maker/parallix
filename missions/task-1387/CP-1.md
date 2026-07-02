# CP-1: Capture gate output in handoff.ts

## Summary

Modified `lib/commands/handoff.ts` to capture verification gate and declared gate output on failure.

Changes:
1. `performHandoff()`: Changed verification gate from `stdio: 'inherit'` to `stdio: 'pipe'`, and on non-zero exit, captures `stdout`/`stderr` and attaches them to the failure result as `gateOutput: { stdout, stderr }`. Made `runVerificationGate` injectable via `runVerificationGateFn` option for testability.
2. `runDeclaredGates()`: Changed declared gate execution from `stdio: ['inherit', 'pipe', 'pipe']` to `stdio: 'pipe'`, and on non-zero exit, captures both `stdout` and `stderr` in the failure result.

## Goal Check

| Criterion | Evidence | Status |
|-----------|----------|--------|
| SC1: performHandoff captures verification gate stdout/stderr on non-zero exit | test/handoff.test.js:1042 `performHandoff captures verification gate stdout/stderr on non-zero exit (SC1)` asserts `result.gateOutput.stdout` and `result.gateOutput.stderr` match mocked values | PASS |
| SC2: runDeclaredGates captures gate stdout/stderr on non-zero exit | test/handoff.test.js:1097 `runDeclaredGates captures stdout and stderr on gate failure (SC2)` asserts `result.stdout` and `result.stderr` contain expected output from bash gate command | PASS |
| All existing handoff tests still pass | `node --test test/handoff.test.js` — 33 tests pass, 0 fail | PASS |

Next action: CP-2 — Detect and relaunch on gate failure in active.ts
