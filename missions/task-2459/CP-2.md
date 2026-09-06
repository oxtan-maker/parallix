# CP-2: Server-owned weekly cumulative-flow projection

## Summary

- `decisionWindowDays` added to `src/application/services/decision-window.ts`:
  the shared window authority now enumerates its own inclusive UTC calendar
  days, so no caller re-derives them.
- `weeklyCumulativeFlowByStateSeries` added to
  `src/application/projections/metrics.ts`. It folds the recorded transitions
  before the window's first day into a boundary state, drops missions already
  `done` at that boundary (finished work belongs to the week it closed in),
  carries open work in at its boundary lane, and applies only transitions
  recorded inside the window. Missing history keeps the existing metric
  contract: `estimate` when the initial snapshot is all that is known, empty
  series with `skip` when there are no lifecycle facts at all. No transition or
  point is fabricated.
- `WeeklyStateFlowSeries` added to `src/application/projections/board.ts` and
  published as the optional `BoardMetrics.weeklyCumulativeFlow`, carrying the
  window's `startDate`, `endDate`, and operator label with the series.
- `buildMetrics` computes it from `decisionWindows.current` — the same injected
  clock reading `metrics-read-adapter.ts` gives the decision metrics — and omits
  it entirely when no window was injected, preserving existing callers.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Snapshot publishes a weekly series with explicit window label and bounds from the injected clock | `"weeklyCumulativeFlowByStateSeries scopes the series to the window days and label"` in `test/board-metrics.test.ts` | PASS |
| Pre-window completion excluded; first point starts without historical accumulation | `"weeklyCumulativeFlowByStateSeries leaves a mission completed before the window out of every point"` and `test/task-2459-repro.test.ts` | PASS |
| In-window completion affects the weekly points | `"weeklyCumulativeFlowByStateSeries counts a completion recorded inside the window from that day on"` | PASS |
| In-window lane transition affects the weekly points | `"weeklyCumulativeFlowByStateSeries moves a mission between lanes inside the window"` | PASS |
| Missing history uses the established unavailable/estimated contract only | `"weeklyCumulativeFlowByStateSeries reports missing lifecycle history as estimate or skip, never as zeroes"` | PASS |
| `px stats` and the projection share the same seven-day inclusive UTC bounds for one clock | `"px stats and the weekly FLOW series read the same injected-clock window authority"` | PASS |
| Weekly series shares the decision-window reading, and is absent without one | `"buildMetrics publishes the weekly series on the same window as the decision metrics"`, `"buildMetrics omits the weekly series when no decision window was injected"` | PASS |
| Reproduction test now green | `npx tsx --test test/task-2459-repro.test.ts` passes 1/1 | PASS |
| Types compile | `npx tsc --noEmit` clean | PASS |

Next action: CP-3 — carry `weeklyCumulativeFlow` through
`src/interfaces/web/transport.ts` (shape plus `checkMetrics` validation),
render it in `web/src/flow-panel.tsx` with no client-side window filtering, and
add transport plus rendered-FLOW coverage in `test/web-board-render.test.ts`.
