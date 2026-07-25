# CP-1: Failing Reproduction Tests

## Summary

Created two failing reproduction tests at `test/task-2311-console-empty-repro.test.ts` that lock the bug before any fix is written:

1. **Stdout tee test** — Verifies `process.stdout.write` is called with text content during a mocked pi SDK session. Currently fails because `startPiAgent` ignores `teeOptions` and does not write `text_delta` events to stdout.
2. **Watchdog test** — Verifies `teeOptions.noOutputWatchdog.onNoOutput` is invoked when no text output arrives within the configured delay. Currently fails because `teeOptions` is received but never unpacked or used.

Both tests use the same mocking pattern as `test/pi-runner.test.ts` (`__setCreateAgentSessionForTest`) and mock `process.stdout.write` to capture writes. All 15 existing tests in `test/pi-runner.test.ts` continue to pass.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Reproduction test for stdout tee exists | `test/task-2311-console-empty-repro.test.ts:21` — `"startPiAgent writes text_delta to process.stdout during SDK execution (repro: console empty)"` | PASS |
| Reproduction test for watchdog exists | `test/task-2311-console-empty-repro.test.ts:101` — `"startPiAgent invokes teeOptions.noOutputWatchdog.onNoOutput when no text arrives (repro: watchdog ignored)"` | PASS |
| Stdout test fails on current code | `node --test test/task-2311-console-empty-repro.test.ts` — 0 writes, assertion fails with "got 0 writes" | PASS |
| Watchdog test fails on current code | `node --test test/task-2311-console-empty-repro.test.ts` — watchdogCalled is false | PASS |
| Existing tests still pass | `node --test test/pi-runner.test.ts` — 15 pass, 0 fail | PASS |

## Next action

Implement stdout tee and watchdog wiring in `src/platform/runtime/lib/agents/pi.ts` (CP-2): write `text_delta` deltas to `process.stdout` inside the `subscribe` callback and wire `teeOptions.noOutputWatchdog` with a `setTimeout`-based timer.
