# CP-3 — Windowed completed-mission metrics

## Summary

`src/application/projections/metrics.ts` now selects the completed-mission
decision cohort by lifecycle completion, and uses each selected mission's full
lifecycle.

- Added `outcomesCompletedInWindow` and `missionsCompletedInWindow`. The window
  selects whole missions by `closedAt`; a private `transitionsOf` then restricts
  lifecycle history to those missions **before** intervals are derived, so
  nothing is truncated at the window edge.
- `medianStateTimes(outcomes, instants, window?)` and
  `medianAgentRuntime(outcomes, instants, window?)` filter their outcome list by
  the window. `medianAgentRuntime` still never filters an individual run by the
  run's own timestamp — the window selects the mission, and the mission owns its
  runs.
- `medianCycleTimeByStateSeries(transitions, missions?)` and
  `reviewBounceRateSeries(transitions, instants, missions?)` take the selected
  mission set.
- `MetricsInput.decisionWindows` is the new optional input. Absent means "no
  window", which is the pre-TASK-2363 behavior every existing caller relies on.
- `BoardMetrics.decisionWindow` (new, in `src/application/projections/board.ts`)
  carries `current` and `previous` `DecisionWindowMetrics`: label, dates,
  `completedMissions`, and a `DecisionMetric` (`value` + `observationCount`) for
  cycle time, agent runtime, active/review/integration dwell, and review bounce.
  Both columns are computed by the *same* windowed functions, so current and
  previous cannot diverge in definition.
- Current-state operational metrics (`medianAgeByLaneSeries`, WIP,
  `cumulativeFlow*`, bottleneck) were deliberately left unwindowed.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC03 — `medianStateTimes` uses only in-window outcomes, `observationCount` reflects it | `"reports the current-window cycle-time population, not all history"` (n 299 → 31) and `"keeps extreme historical cycle times out of the current median"` (890 → 40) in `test/task-2363-weekly-decision-window.test.ts` | PASS |
| SC04 — agent runtime from in-window missions; runs not filtered by run timestamp | `"reports agent runtime only from missions completed in the current window"` asserts n=11, median 15 | PASS |
| SC05 — lane dwell uses full lifecycle intervals, not truncated at the boundary | `"counts the full lifecycle of a mission that started before the window opened"` asserts 7199 min of active dwell for a mission active from 2026-08-01 | PASS |
| SC06 — review bounce from in-window missions | `"reports review bounce rate from current-window missions only"` asserts n=31, value 5/31 | PASS |
| SC08 — operational metrics stay unwindowed | `"keeps current-state lane age unwindowed"` asserts the done-lane age still observes all 299 missions | PASS |
| SC11/SC12 — 240 old missions change neither `n` nor any current-window figure | `test/fixtures/task-2363-decision-window-fixture.ts` (`OLD_HISTORY_COUNT = 240`, cycle times 800–1200) drives every assertion above | PASS |
| SC13 — ~30 current-window missions with exact hand-computed values | `CURRENT_CYCLE_MINUTES` (31 values), `EXPECTED_CURRENT_CYCLE_MEDIAN = 40` in the fixture | PASS |
| SC14 — mission starting before the window but completing inside contributes fully | `"counts the full lifecycle of a mission that started before the window opened"` | PASS |
| SC15 — mission started inside the window but incomplete is excluded | `"excludes a mission that started inside the window but has not completed"` | PASS |
| No existing metrics/board/cohort regression | `test/board-metrics.test.ts`, `test/board-projections.test.ts`, `test/metric-contract.test.ts`, `test/task-2357*.test.ts`, `test/task-2347.09-cohort-metrics.test.ts`, `test/tui-flow-panel.test.ts`, `test/adapters/board-projection-builder-cp3.test.ts` — 108 pass, 0 fail | PASS |
| Static analysis clean | `npx eslint src/application/projections/metrics.ts src/application/projections/board.ts`; `npx tsc --noEmit` exits 0 | PASS |

Next action: CP-4 — restrict `compareCohorts` to the current window and wire `ConcreteMetricsReadAdapter.buildMetrics()` to derive `weeklyDecisionWindows` from its injected clock, so `BoardMetrics` reaching FLOW is already windowed.
