## CP-1 Summary

Wrote failing reproduction test at `test/task-2347.03-inverted-dwell-repro.test.ts`. Three tests:

1. **Single-mission attribution** — 60 min between `backlog→active` (08:00) and `active→review` (09:00) must be attributed to `active`. Current code returns `null` for `active` (dwell credited to `review` instead). **FAILS (red).**
2. **Shape check** — `LaneMetricSeries` returns 6 lanes + `missingHistoryFallback: 'null'`. **PASSES.**
3. **Multi-mission attribution** — Two missions with different dwell times in `active`. Median of `[60, 120]` = 90 must appear under `active`. Current code returns 120. **FAILS (red).**

Failure root cause: `src/application/projections/metrics.ts:243` — `byLane.set(transition.to, ...)` attributes dwell to state entered, not state occupied. Should use `transition.from`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: Reproduction test fails against current code | `test/task-2347.03-inverted-dwell-repro.test.ts`, `"dwell time between backlog->active and active->review is attributed to active (not review)"` — `null !== 60` | PASS (red) |
| SC1: Reproduction test asserts correct attribution | `test/task-2347.03-inverted-dwell-repro.test.ts:42` — `assert.equal(activeValue, 60, ...)` | PASS |
| Bug root cause identified | `src/application/projections/metrics.ts:243` — `byLane.set(transition.to, ...)` should be `transition.from` | PASS |

Next action: CP-2 — introduce `LaneInterval` type and interval-derivation function in `src/application/projections/metrics.ts`.
