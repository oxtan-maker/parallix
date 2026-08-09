## CP-3 Summary

Rewrote `medianCycleTimeByStateSeries` to consume `deriveLaneIntervals()` output. Dwell computed from closed intervals only (`exitedAt !== null`), attributed to `interval.state` (the state occupied during the interval).

**Key change**: Replaced adjacent-transition arithmetic (`transition.to`) with interval-based computation (`interval.state`). Open intervals (missions still in a lane) excluded from dwell.

**Evidence**: `test/task-2347.03-inverted-dwell-repro.test.ts` all 3 tests pass. Existing `board-metrics.test.ts` FLOW projection test fails (expected — asserts old inverted values, to be fixed in CP-4). Fixture test passes (no specific cycle time assertions).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC3: medianCycleTimeByStateSeries uses intervals | `src/application/projections/metrics.ts:93` — `const intervals = deriveLaneIntervals(transitions)` | PASS |
| SC3: Dwell attributed to interval.state | `src/application/projections/metrics.ts:102` — `byLane.set(interval.state, ...)` | PASS |
| SC3: Closed intervals only | `src/application/projections/metrics.ts:98` — `if (interval.exitedAt === null) { continue; }` | PASS |
| Red-to-green verified | `test/task-2347.03-inverted-dwell-repro.test.ts` — 3/3 pass | PASS |

Next action: CP-4 — correct expectations in `test/board-metrics.test.ts` FLOW projection test and add assertions in `test/board-event-metrics-fixture.test.ts`, plus out-of-order/duplicate edge-case test.
