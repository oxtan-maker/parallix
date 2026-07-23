# CP-3: Time-based metrics with missing-history fallback

## Summary

Implemented time-based metrics (WIP counts, median state times, cumulative-flow, throughput, review-loop rate) derived from recorded events. Each metric declares an explicit `missingHistoryFallback` property specifying exact behavior when event history is incomplete. Every fallback path has a targeted test.

### Files created

- **`src/application/projections/metrics.ts`** — Five metric functions: `wipSeries` (fallback: `'null'` — returns initial state counts), `medianStateTimes` (fallback: `'null'` — returns `null`), `cumulativeFlowSeries` (fallback: `'estimate'` — returns initial state as best estimate), `throughputSeries` (fallback: `'skip'` — returns empty series), `reviewLoopRateSeries` (fallback: `'estimate'` — returns empty series, partial estimate from available data). `buildMetrics()` composes all five into `BoardMetrics`.
- **`test/board-metrics.test.ts`** — 22 tests covering every metric computation path and every `missingHistoryFallback` behavior. Includes dedicated fallback tests: `"cumulativeFlow fallback: estimate when transitions are empty"`, `"medianStateTimes fallback: null when outcomes are empty"`, `"throughput fallback: skip produces empty series when outcomes are empty"`, `"reviewLoopRate fallback: estimate produces empty series when outcomes are empty"`, `"wip fallback: null returns initial state counts when transitions are empty"`.

### Verification

- All 1137 tests pass (`npm test`)
- Types compile cleanly (`npm run typecheck`)

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC3: Cumulative-flow with missingHistoryFallback | `src/application/projections/metrics.ts:119` (`cumulativeFlowSeries` with `missingHistoryFallback: 'estimate'`), `test/board-metrics.test.ts` tests: `"cumulativeFlowSeries returns estimate fallback"`, `"cumulativeFlow fallback: estimate when transitions are empty"` | PASS |
| SC3: Median state times with missingHistoryFallback | `src/application/projections/metrics.ts:82` (`medianStateTimes` with `missingHistoryFallback: 'null'`), `test/board-metrics.test.ts` tests: `"medianStateTimes returns null fallback when no outcomes"`, `"medianStateTimes fallback: null when outcomes are empty"` | PASS |
| SC3: Throughput with missingHistoryFallback | `src/application/projections/metrics.ts:139` (`throughputSeries` with `missingHistoryFallback: 'skip'`), `test/board-metrics.test.ts` tests: `"throughputSeries returns skip fallback when no outcomes"`, `"throughput fallback: skip produces empty series when outcomes are empty"` | PASS |
| SC3: Review-loop rate with missingHistoryFallback | `src/application/projections/metrics.ts:163` (`reviewLoopRateSeries` with `missingHistoryFallback: 'estimate'`), `test/board-metrics.test.ts` tests: `"reviewLoopRateSeries returns estimate fallback when no outcomes"`, `"reviewLoopRate fallback: estimate produces empty series when outcomes are empty"` | PASS |
| SC3: WIP counts with missingHistoryFallback | `src/application/projections/metrics.ts:53` (`wipSeries` with `missingHistoryFallback: 'null'`), `test/board-metrics.test.ts` tests: `"wipSeries returns null fallback"`, `"wip fallback: null returns initial state counts when transitions are empty"` | PASS |
| SC3: Every fallback path has a targeted test | `test/board-metrics.test.ts` — 5 dedicated fallback tests + 22 total metric tests (all pass) | PASS |
| Verification gate | `npm test` — 1137 tests pass; `npm run typecheck` — clean | PASS |

Next action: CP-4 — Finalize guarded command controller with stale-command rejection, progress-event ordering tests, and verify all mission-declared Gates pass before handoff.
