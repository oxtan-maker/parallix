# CP-3: Green controller/composition lifecycle test proving SC1–SC4

Expanded `test/task-2387-board-current-work.test.ts` with the green lifecycle
tests that pin SC1–SC4 through the real `BoardCommandController` boundary. The
CP-2 wiring is already in place; these tests assert the full board launch
lifecycle publishes the same `(phase, state)` facts CLI execution does and that
the WORKING projection reflects a live launch and clears on a terminal state.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 board `active:execute` publishes `running` (phase=execute) before launch completes | `test/task-2387-board-current-work.test.ts`, `"board active:execute publishes running and ended current work"` | PASS |
| SC2 terminal outcomes publish same `(phase,state)` set: `ended` on completion/cancellation, `blocked` on failure | `test/task-2387-board-current-work.test.ts`, `"a board execute that cannot finish publishes blocked carrying the reason"`, `"a board cancellation observed after the durable launch publishes ended"` | PASS |
| SC3 production composition cannot deliver a board dispatcher using `NO_CURRENT_WORK_PORT` | `test/task-2387-board-current-work.test.ts`, `"production composition delivers a board controller that publishes to the wired recorder"`; `src/composition/production-capabilities.ts`, `src/composition/board-projection.ts` | PASS |
| SC4 board-launched agent appears in WORKING projection, then clears (`ended`) or blocks (`blocked`) through the real `BoardCommandController` | `test/task-2387-board-current-work.test.ts`, `"a board-launched agent surfaces in the WORKING projection and clears on completion"`, `"a blocked board launch records a blocking reason in the projection"`; read side `src/application/projections/current-work.ts` (`isWorkInProgress`) | PASS |
| Static-analysis gate passes | `./scripts/verify-local.sh static-analysis` | PASS |
| Integration gate passes | `./scripts/verify-local.sh all` | PASS |

Red-to-green basis: with the CP-2 thread reverted, the board controller falls
back to `NO_CURRENT_WORK_PORT` (see `src/application/recording/current-work-recorder.ts`
`NO_CURRENT_WORK_PORT`), so the spy records zero calls and the SC1/SC2
assertions fail; the committed wiring makes them pass. The no-op-default
regression test (`"the no-op default records no current work"`) pins that the
fallback still publishes nothing for read-only shells, per ADR 0053.

## Tests added

- `"board active:execute publishes running and ended current work"` — SC1 + completion.
- `"a board execute that cannot finish publishes blocked carrying the reason"` — SC2 failure path.
- `"a board cancellation observed after the durable launch publishes ended"` — SC2 cancellation path.
- `"production composition delivers a board controller that publishes to the wired recorder"` — SC3.
- `"a board-launched agent surfaces in the WORKING projection and clears on completion"` — SC4 cleared.
- `"a blocked board launch records a blocking reason in the projection"` — SC4 blocked.
- `"the no-op default records no current work"` — regression guard for the fallback.

Next action: write CP-4 capturing the verification-gate proof, then commit CP-3 and CP-4.
