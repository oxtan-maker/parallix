## CP-2: Inject projection clock and formatDuration helper

### Summary
- **Clock injection**: Added `clock` option to `ConcreteMetricsReadAdapterOptions`. `asOf` now uses `this.clock()` instead of `instants.at(-1)`. Tests pin clock to fixed value.
- **formatDuration**: Added pure function `formatDuration(minutes)` to `metrics.ts`. Auto-switches unit: `<60 min → integer min`, `60–1439 min → hours (1 decimal)`, `≥1440 min → days (1 decimal)`. Wired into `bottleneckNarrative` sentence.
- **Terminal lanes constant**: Added `TERMINAL_LANES` constant for use in CP-3.

Tests: 31 pass, 4 fail (all CP-3: SC3 lifecycle fallback, SC4/SC5 terminal lane exclusion).

### Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Clock injected into adapter | `src/application/projections/metrics-read-adapter.ts:33` (clock option), `:76` (asOf: this.clock()) | PASS |
| asOf uses injected clock | Test `"ConcreteMetricsReadAdapter: asOf from injected clock not instants.at(-1) (SC2)"` in `test/task-2347-06-repro.test.ts:171` — PASS | PASS |
| formatDuration helper exists | `src/application/projections/metrics.ts:43-52` | PASS |
| formatDuration wired into bottleneckNarrative | `src/application/projections/metrics.ts:318` (sentence uses formatDuration) | PASS |
| formatDuration: <60 min → integer | Test `"formatDuration: <60 min returns integer minutes (SC6)"` in `test/task-2347-06-repro.test.ts:148` — PASS | PASS |
| formatDuration: 60-1439 min → hours | Test `"formatDuration: 60-1439 min returns hours with 1 decimal (SC6)"` in `test/task-2347-06-repro.test.ts:154` — PASS | PASS |
| formatDuration: >=1440 min → days | Test `"formatDuration: >=1440 min returns days with 1 decimal (SC6)"` in `test/task-2347-06-repro.test.ts:161` — PASS | PASS |
| Existing tests preserved | `npm test -- test/board-metrics.test.ts` — 25 pass, 0 fail | PASS |

Next action: CP-3 — add lifecycle-history fallback to medianAgeByLaneSeries, exclude terminal lanes from bottleneckNarrative, verify all tests green and run verification gate.
