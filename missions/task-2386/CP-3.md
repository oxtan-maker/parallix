# CP-3 — Observational watchdog for the full agent lifetime

Removed the suppression-after-first-output behaviour from both watchdog
implementations. `spawnAndTee` now stops liveness reporting only when the child
settles (`finish()` → `clearWatchdog()`), and the Pi SDK runner only stops at its
settle points instead of on the first `text_delta`. Both report events now carry
`sawOutput` and `msSinceLastOutput`, so `startAgent`'s INFO line stays truthful
once the agent has already spoken ("Still waiting on …, last visible output N
ago") instead of claiming no output. No kill/timeout/cancel path was added; the
timing constants are unchanged.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC4 — liveness reports continue after visible output until the agent settles | `npm test -- test/spawn-tee.test.ts`, `"spawnAndTee continues liveness reports after visible output until the child settles"` now passes (13/13, was red at CP-1) | PASS |
| SC3 — watchdog stays observational, never kills/cancels | `grep -nE 'kill|terminate|cancel|\.exit\(' src/adapters/process/spawn-tee.ts` matches only the doc comment on `NoOutputWatchdog`; the Pi watchdog's only control action is `clearWatchdog()` at its settle points (`src/adapters/agents/pi.ts`) | PASS |
| Existing watchdog contracts unregressed (settle/clear on exit, error, signal) | `npm test -- test/spawn-tee.test.ts` — `"spawnAndTee clears no-output watchdog on clean exit before first interval"`, `"… on spawn error"`, `"… on signal exit"` | PASS |
| Pi launcher and startAgent wiring unregressed | `npm test -- test/pi-runner.test.ts test/agents.test.ts test/launcher-availability.test.ts` — 126 pass / 0 fail, incl. `"startPiAgent invokes teeOptions.noOutputWatchdog.onNoOutput when no text arrives"` | PASS |
| Timing constants untouched (mission Out of Scope) | `resolveNoOutputWatchdogConfig` in `src/adapters/agents/launcher-selection.ts` unchanged; not in the CP-3 diff | PASS |

Next action: add the AC #2 conflict-resolver prompt test and the AC #3 never-kill assertion test, then run `./scripts/verify-local.sh static-analysis` as the mission gate.
