## CP-1: Red-to-green reproduction test

### Summary
Created `test/task-2347-06-repro.test.ts` with 10 tests locking both bugs:
- **Bug A (age clock)**: 2 tests PASS — `medianAgeByLaneSeries` correctly computes age from `asOf` param. The bug is in the adapter passing `instants.at(-1)` instead of injected clock.
- **Bug B (bottleneck)**: 3 tests FAIL — `bottleneckNarrative` selects `done`/`integration` as bottleneck instead of active lanes.
- **formatDuration**: 3 tests FAIL — function not yet implemented.
- **Clock injection**: 1 test FAILS — adapter uses `instants.at(-1)` for `asOf`, not injected clock.
- **Lifecycle fallback**: 1 test FAILS — `medianAgeByLaneSeries` doesn't accept `initialStates`/`lifecycleEntries` yet.

Red state: 2 pass, 8 fail. All 8 will turn green after CP-2 and CP-3 fixes.

### Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Repro test file created | `test/task-2347-06-repro.test.ts` (256 lines) | PASS |
| Age test (SC1) locks correct behavior | Test `"age: mission 3 days (4320 min) before asOf reports age >= 4300 min (SC1)"` in `test/task-2347-06-repro.test.ts:30` — PASS | PASS |
| Bottleneck test (SC4) locks bug | Test `"bottleneck: done lane NOT selected as bottleneck when active has stall (SC4)"` in `test/task-2347-06-repro.test.ts:72` — FAIL (got 'done') | RED |
| Bottleneck unavailable (SC5) locks bug | Test `"bottleneck: unavailable when all non-terminal lanes have no age (SC5)"` in `test/task-2347-06-repro.test.ts:114` — FAIL | RED |
| formatDuration (SC6) locks bug | Tests `"formatDuration: <60 min..."` etc. in `test/task-2347-06-repro.test.ts:148-165` — FAIL (not a function) | RED |
| Clock injection (SC2) locks bug | Test `"ConcreteMetricsReadAdapter: asOf from injected clock..."` in `test/task-2347-06-repro.test.ts:171` — FAIL (age=0) | RED |
| Lifecycle fallback (SC3) locks bug | Test `"medianAgeByLaneSeries: mission with no transition..."` in `test/task-2347-06-repro.test.ts:226` — FAIL (null) | RED |
| Existing tests unchanged | `npm test -- test/board-metrics.test.ts` — 25 pass, 0 fail | PASS |

Next action: CP-2 — inject projection clock into ConcreteMetricsReadAdapter, add formatDuration helper, wire into bottleneckNarrative.
