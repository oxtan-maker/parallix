# CP-2: Stdout Tee and Watchdog Implementation

## Summary

Implemented real-time console visibility in `src/platform/runtime/lib/agents/pi.ts`:

1. **Stdout tee** — `text_delta` event deltas are now written to `process.stdout` synchronously inside the `subscribe` callback (line 352), so terminal output appears in real time during `session.prompt()` / `session.waitForIdle()` execution.

2. **No-output watchdog** — `teeOptions.noOutputWatchdog` is unpacked and wired with a `setTimeout`-based timer (lines 307-327). The timer fires `onNoOutput` with `{ command, args, pid, elapsedMs }` when no `text_delta` arrives within `initialDelayMs`. On first visible text, the watchdog is cleared. The pattern matches `spawn-tee.ts` (`scheduleWatchdog` / `clearWatchdog` / `sawOutput`).

3. **Type safety** — Added `PiNoOutputWatchdog` and `PiTeeOptions` interfaces (lines 16-23) to replace the generic `object` type for `teeOptions`, resolving TS2339 and TS2722 errors.

4. **Tests** — Added two tests to `test/pi-runner.test.ts` (lines 509 and 555) satisfying SC3 and SC4, plus two red-to-green reproduction tests in `test/task-2311-console-empty-repro.test.ts`. All 1215 tests pass.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: text_delta written to stdout synchronously in subscribe callback | `src/platform/runtime/lib/agents/pi.ts:352` — `process.stdout.write(delta)` | PASS |
| SC2: teeOptions.noOutputWatchdog wired with timer | `src/platform/runtime/lib/agents/pi.ts:307` — `scheduleWatchdog`, `src/platform/runtime/lib/agents/pi.ts:314` — `watchdog.onNoOutput` | PASS |
| SC3: Test verifies process.stdout.write called during SDK execution | `test/pi-runner.test.ts:509` — `"startPiAgent writes text_delta to process.stdout during SDK execution"` | PASS |
| SC4: Test verifies watchdog onNoOutput callback invoked | `test/pi-runner.test.ts:555` — `"startPiAgent invokes teeOptions.noOutputWatchdog.onNoOutput when no text arrives"` | PASS |
| SC5: Existing tests pass (no regression) | `node --test test/pi-runner.test.ts` — 17 pass, 0 fail (15 original + 2 new) | PASS |
| SC6: Verification gate passes | `./scripts/verify-local.sh all` — 1215 pass, 0 fail | PASS |
| Repro test red-to-green: stdout tee | `test/task-2311-console-empty-repro.test.ts:21` — was FAIL (0 writes), now PASS | PASS |
| Repro test red-to-green: watchdog | `test/task-2311-console-empty-repro.test.ts:101` — was FAIL (not called), now PASS | PASS |
| TypeScript type safety | `src/platform/runtime/lib/agents/pi.ts:16` — `PiNoOutputWatchdog`, `src/platform/runtime/lib/agents/pi.ts:22` — `PiTeeOptions` | PASS |
| Static-analysis gate (ESLint + tsc) | `./scripts/verify-local.sh static-analysis` — ESLint clean, tsc clean (pi.ts errors resolved) | PASS |

## Next action

Commit checkpoint documents and hand off mission task-2311 for review.
